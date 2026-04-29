/**
 * Multi-turn check-in chat boundary.
 *
 * Mirrors `generateText()` in client/lib/gemma/session.ts: POSTs to a
 * temporary `/api/checkin` route, parses Server-Sent Events, calls
 * `onDelta` with the accumulated agent reply, and additionally
 * surfaces a `endConversation` tool-call signal via `onEndConversation`
 * when the model decides the chat is over (PRD § Check-In
 * Conversation Protocol — readiness is now an LLM judgement, not a
 * regex match).
 *
 * Two-strikes-then-fallback retains the same semantics as before:
 * stream / Zod failure twice in a row falls through to
 * `fallbackCheckInTurn()`. The fallback path is text-only and never
 * fires `onEndConversation` — the chat surface uses the legacy
 * scripted readiness ask in that branch instead (see fallback-bank).
 *
 * The route + this boundary form the swap point for in-browser
 * Gemma 4 + check-in LoRA. When the in-browser stack ships, this file
 * keeps its signature; only the `fetch` body is replaced by a
 * transformers.js TextStreamer with the check-in LoRA loaded. See
 * AGENTS.md > Setup Commands > Temporary scaffolding.
 */

import { fallbackCheckInTurn } from "@/lib/prompts/fallback-bank";
import type { ChunkNumber, ObstacleCategory } from "@/types/session";
import type { CheckInContextPayload } from "@/lib/prompts/schemas";

const MAX_MODEL_ATTEMPTS = 2;
const MIN_STREAMED_REPLY_LENGTH = 2;

const ALLOWED_OBSTACLES: readonly ObstacleCategory[] = [
  "cannot_visualize",
  "mind_wandering",
  "urge_overwhelming",
  "breath_tight",
  "breath_anxiety",
  "gave_in",
  "guilt_failure",
  "physical_discomfort",
  "sleepiness",
];

export interface CheckInChatTurnPayload {
  role: "agent" | "patient";
  content: string;
}

export interface EndConversationSignal {
  cravingScore: number;
  obstacleCategory: ObstacleCategory | null;
}

export interface StreamCheckInTurnOptions {
  history: readonly CheckInChatTurnPayload[];
  context: CheckInContextPayload;
  signal?: AbortSignal;
  /** Called with the accumulated reply text on every SSE delta event. */
  onDelta?: (accumulated: string) => void;
  /**
   * Fired exactly once if (and only if) the model emits a valid
   * `endConversation` tool call. Receives the parsed args. The
   * promise still resolves with the accumulated text afterward — the
   * caller is responsible for reading the signal as the canonical
   * "this check-in is over" trigger.
   */
  onEndConversation?: (signal: EndConversationSignal) => void;
}

export interface StreamCheckInTurnResult {
  text: string;
  source: "model" | "fallback";
  attempts: number;
  endConversation: EndConversationSignal | null;
}

export async function streamCheckInTurn(
  options: StreamCheckInTurnOptions,
): Promise<StreamCheckInTurnResult> {
  let attempts = 0;
  let lastError: unknown = null;

  while (attempts < MAX_MODEL_ATTEMPTS) {
    attempts += 1;
    try {
      const response = await fetch("/api/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: options.signal,
        body: JSON.stringify({
          history: options.history,
          context: options.context,
        }),
      });

      if (!response.ok || !response.body) {
        lastError = new Error(`checkin route returned ${response.status}`);
        continue;
      }

      const result = await consumeSSE(
        response.body,
        options.onDelta,
        options.onEndConversation,
      );
      if (result.kind === "error") {
        lastError = new Error(result.message);
        continue;
      }

      // A valid stream that ends with ONLY a tool call (no text) is
      // a success: the model decided "we're done" and emitted only
      // the endConversation event. Treat that as a model-source
      // result with empty text so the caller can advance.
      if (
        result.text.trim().length < MIN_STREAMED_REPLY_LENGTH &&
        !result.endConversation
      ) {
        lastError = new Error("stream produced empty reply");
        continue;
      }

      return {
        text: result.text,
        source: "model",
        attempts,
        endConversation: result.endConversation,
      };
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw err;
      }
      lastError = err;
    }
  }

  if (typeof console !== "undefined") {
    console.warn(
      `[wave] streamCheckInTurn falling back for chunk=${options.context.chunkNumber} after ${attempts} attempts`,
      lastError,
    );
  }

  const fallback = fallbackCheckInTurn(
    options.context.chunkNumber as ChunkNumber,
    options.history,
    options.context.scoreHistory,
  );
  const fallbackText = sanitizeCheckInText(fallback.text);
  options.onDelta?.(fallbackText);
  return {
    text: fallbackText,
    source: "fallback",
    attempts,
    endConversation: null,
  };
}

function sanitizeCheckInText(text: string): string {
  return text
    .replace(/\]\s*\[/g, " ")
    .replace(/[\[\]]/g, "")
    .replace(/[–—]/g, ",")
    .replace(/\s+([,.;:?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// SSE plumbing — recognises `delta`, `done`, `error`, and the new
// `end_conversation` event.
// ---------------------------------------------------------------------------

type SSEResult =
  | {
      kind: "done";
      text: string;
      endConversation: EndConversationSignal | null;
    }
  | { kind: "error"; message: string };

async function consumeSSE(
  body: ReadableStream<Uint8Array>,
  onDelta: ((accumulated: string) => void) | undefined,
  onEndConversation: ((signal: EndConversationSignal) => void) | undefined,
): Promise<SSEResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulated = "";
  let endConversation: EndConversationSignal | null = null;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let separatorIdx: number;
      while ((separatorIdx = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, separatorIdx);
        buffer = buffer.slice(separatorIdx + 2);

        const parsed = parseSSEFrame(frame);
        if (!parsed) continue;
        const { event, data } = parsed;

        if (event === "delta") {
          const chunk = (data as { text?: string }).text;
          if (typeof chunk === "string" && chunk.length > 0) {
            accumulated += chunk;
            onDelta?.(accumulated);
          }
        } else if (event === "end_conversation") {
          const signal = parseEndConversationData(data);
          if (signal && !endConversation) {
            endConversation = signal;
            onEndConversation?.(signal);
          }
        } else if (event === "done") {
          const finalText = (data as { text?: string }).text;
          return {
            kind: "done",
            text: typeof finalText === "string" ? finalText : accumulated,
            endConversation,
          };
        } else if (event === "error") {
          const message =
            (data as { message?: string }).message ?? "stream_error";
          return { kind: "error", message };
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Already released.
    }
  }

  if (accumulated.length > 0 || endConversation) {
    return { kind: "done", text: accumulated, endConversation };
  }
  return { kind: "error", message: "stream_closed_without_done" };
}

function parseEndConversationData(data: unknown): EndConversationSignal | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as { cravingScore?: unknown; obstacleCategory?: unknown };
  const score = Number(obj.cravingScore);
  if (!Number.isInteger(score) || score < 1 || score > 10) return null;
  const obstacleRaw = obj.obstacleCategory;
  let obstacle: ObstacleCategory | null = null;
  if (
    typeof obstacleRaw === "string" &&
    (ALLOWED_OBSTACLES as readonly string[]).includes(obstacleRaw)
  ) {
    obstacle = obstacleRaw as ObstacleCategory;
  }
  return { cravingScore: score, obstacleCategory: obstacle };
}

function parseSSEFrame(
  frame: string,
): { event: string; data: unknown } | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }
  if (dataLines.length === 0) return null;
  const dataText = dataLines.join("\n");
  try {
    return { event, data: JSON.parse(dataText) };
  } catch {
    return { event, data: dataText };
  }
}
