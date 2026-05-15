/**
 * Multi-turn check-in chat boundary.
 *
 * Calls local Gemma through `local-runtime.ts`, pushes accumulated reply
 * text to `onDelta`, and surfaces an `endConversation` signal via
 * `onEndConversation` when the model decides the chat is over.
 *
 * Two-strikes-then-fallback retains the same semantics as before:
 * model / validation failure twice in a row falls through to
 * `fallbackCheckInTurn()`. The fallback path is text-only and never
 * fires `onEndConversation`; the chat surface uses the legacy
 * scripted readiness ask in that branch instead (see fallback-bank).
 */

import { fallbackCheckInTurn } from "@/lib/prompts/fallback-bank";
import { generateWllamaCheckIn as generateGemmaCheckIn } from "@/lib/gemma/wllama-generators";
import type { ChunkNumber, ObstacleCategory } from "@/types/session";
import type { CheckInContextPayload } from "@/lib/prompts/schemas";

const MAX_MODEL_ATTEMPTS = 2;
const MIN_STREAMED_REPLY_LENGTH = 2;
type GemmaCheckInGenerator = typeof generateGemmaCheckIn;

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
  /**
   * Optional generator override for tests and non-browser smoke checks.
   * Production callers use the local Gemma runtime import above.
   */
  generate?: GemmaCheckInGenerator;
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
  const generate = options.generate ?? generateGemmaCheckIn;

  while (attempts < MAX_MODEL_ATTEMPTS) {
    attempts += 1;
    try {
      const result = await generate(
        options.history,
        options.context,
        {
          maxNewTokens: 180,
          onDelta: (accumulated) =>
            options.onDelta?.(sanitizeCheckInText(accumulated)),
          signal: options.signal,
        },
      );
      const replyText = sanitizeCheckInText(result.text);

      if (result.endConversation) {
        options.onEndConversation?.(result.endConversation);
      }

      // A valid stream that ends with ONLY a tool-equivalent signal (no text)
      // is a success: the model decided "we're done" and emitted only
      // the endConversation event. Treat that as a model-source result
      // with empty text so the caller can advance.
      if (
        replyText.length < MIN_STREAMED_REPLY_LENGTH &&
        !result.endConversation
      ) {
        lastError = new Error("stream produced empty reply");
        continue;
      }

      return {
        text: replyText,
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
