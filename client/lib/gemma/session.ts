/**
 * The single client-side boundary every session phase calls to talk to
 * the LLM. Three functions live here:
 *
 *   - `generateJSON<P>()` — for the blocking structured-payload phase
 *     (med-ack). POSTs to `/api/narrate`, validates the response with
 *     Zod, retries once, falls through to the scripted bank.
 *   - `generateText<P>()` — for the streaming-text phases (body-scan,
 *     wave-rise, wave-peak, wave-fall). POSTs to
 *     `/api/narrate/stream`, parses Server-Sent Events, calls the
 *     caller-supplied `onDelta` for each accumulated chunk, retries
 *     once on stream error, falls through to the scripted bank.
 *   - `generateReflection()` — for the reflection phase, which is JSON
 *     but slow enough (medium reasoning budget) that we stream the
 *     model's reasoning-summary section titles to the UI as a progress
 *     indicator while the structured payload is still being produced.
 *     POSTs to `/api/narrate/reflection`, parses Server-Sent Events
 *     (`title`, `payload`, `done`, `error`), calls `onTitle` for each
 *     title and resolves with the validated reflection payload.
 *
 * All three routes are TEMPORARY scaffolding. When the in-browser
 * Gemma 4 E2B-it + LoRA stack lands they get replaced by direct
 * @huggingface/transformers + WebGPU calls and ZERO network traffic.
 *
 * TODO:replace-with-gemma — when the in-browser Gemma stack lands:
 *   1. Import the transformers.js pipeline + the LoRA loader.
 *   2. For `generateJSON`, replace the `fetch("/api/narrate", …)` with
 *      an in-browser inference call gated by `pickAdapter(phase)` and
 *      a JSON-grammar constrained decoder.
 *   3. For `generateText`, replace the SSE consumer with a
 *      transformers.js `TextStreamer` callback that pushes tokens to
 *      `onDelta` directly. The boundary signature stays the same.
 *   4. For `generateReflection`, keep the `onTitle` shape and emit
 *      synthetic milestones from the in-browser pipeline (e.g. one per
 *      output-token threshold) so the progress UI never has to change.
 *   5. Delete /api/narrate, /api/narrate/stream,
 *      /api/narrate/reflection, the openai dependency, and the
 *      OPENAI_API_KEY env var.
 *   6. Keep the two-strikes-then-fallback semantics unchanged so no
 *      call site has to move.
 *
 * The retry-then-fallback policy is required by:
 *   PRD.md > Risk Areas > WebGPU unavailable
 *   AGENTS.md > Tech Stack ("scripted local narration bank … is the
 *               single fallback when … a model call fails Zod
 *               validation twice")
 */

import {
  fallbackJSONForPhase,
  fallbackTextForPhase,
} from "@/lib/prompts/fallback-bank";
import { pickAdapter } from "@/lib/gemma/adapter-manager";
import {
  PHASE_SCHEMAS,
  type JSONNarrationPhase,
  type PhaseInputMap,
  type PhasePayloadMap,
  type TextNarrationPhase,
} from "@/lib/prompts/schemas";

const MAX_MODEL_ATTEMPTS = 2;

function sanitizePatientFacingText(text: string): string {
  return text
    .replace(/\]\s*\[/g, " ")
    .replace(/[\[\]]/g, "")
    .replace(/[–—]/g, ",")
    .replace(/\s+([,.;:?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeStructuredPayload<T>(value: T): T {
  if (typeof value === "string") {
    return sanitizePatientFacingText(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeStructuredPayload(item)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        sanitizeStructuredPayload(entry),
      ]),
    ) as T;
  }
  return value;
}

// ---------------------------------------------------------------------------
// generateJSON — structured payload phases (med-ack, reflection)
// ---------------------------------------------------------------------------

export type GenerateJSONResult<P extends JSONNarrationPhase> = {
  payload: PhasePayloadMap[P];
  /** Where the payload came from. Surfaces in DevTools for the demo. */
  source: "model" | "fallback";
  /** How many model attempts were made before settling. 0 = fallback only. */
  attempts: number;
};

export interface GenerateJSONOptions {
  /**
   * Optional AbortSignal so a phase that gets cancelled (e.g. patient
   * leaves the session early) does not finish a stale model call.
   */
  signal?: AbortSignal;
}

export async function generateJSON<P extends JSONNarrationPhase>(
  phase: P,
  input: PhaseInputMap[P],
  options: GenerateJSONOptions = {},
): Promise<GenerateJSONResult<P>> {
  const adapterId = pickAdapter(phase);
  const schema = PHASE_SCHEMAS[phase].zod;

  let attempts = 0;
  let lastError: unknown = null;

  while (attempts < MAX_MODEL_ATTEMPTS) {
    attempts += 1;
    try {
      const response = await fetch("/api/narrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: options.signal,
        body: JSON.stringify({
          phase,
          input,
          adapterId,
        }),
      });

      if (!response.ok) {
        lastError = new Error(`narrate route returned ${response.status}`);
        continue;
      }

      const json: unknown = await response.json();
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        lastError = parsed.error;
        continue;
      }

      return {
        payload: sanitizeStructuredPayload(
          parsed.data as PhasePayloadMap[P],
        ),
        source: "model",
        attempts,
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
      `[wave] generateJSON falling back for phase=${phase} after ${attempts} attempts`,
      lastError,
    );
  }

  return {
    payload: sanitizeStructuredPayload(fallbackJSONForPhase(phase, input)),
    source: "fallback",
    attempts,
  };
}

// ---------------------------------------------------------------------------
// generateText — streaming text phases (body-scan, wave-*)
// ---------------------------------------------------------------------------

export type GenerateTextResult = {
  text: string;
  source: "model" | "fallback";
  attempts: number;
};

export interface GenerateTextOptions {
  /**
   * Optional AbortSignal so a phase that gets cancelled (e.g. patient
   * leaves the session early) does not finish a stale model call.
   */
  signal?: AbortSignal;
  /**
   * Called every time the route emits an SSE `delta` event. The
   * argument is the *accumulated* text so far, not just the new chunk
   * — the UI almost always wants to render the full string anyway.
   * Fallback text from the scripted bank is also pushed once via
   * `onDelta` before the function resolves so the streaming UI doesn't
   * need to know which path produced the result.
   */
  onDelta?: (accumulated: string) => void;
}

/** Minimum length of the streamed body that counts as a successful reply. */
const MIN_STREAMED_TEXT_LENGTH = 20;

export async function generateText<P extends TextNarrationPhase>(
  phase: P,
  input: PhaseInputMap[P],
  options: GenerateTextOptions = {},
): Promise<GenerateTextResult> {
  const adapterId = pickAdapter(phase);

  let attempts = 0;
  let lastError: unknown = null;

  while (attempts < MAX_MODEL_ATTEMPTS) {
    attempts += 1;
    try {
      const response = await fetch("/api/narrate/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: options.signal,
        body: JSON.stringify({
          phase,
          input,
          adapterId,
        }),
      });

      if (!response.ok || !response.body) {
        lastError = new Error(`narrate stream returned ${response.status}`);
        continue;
      }

      const result = await consumeSSE(response.body, options.onDelta);
      if (result.kind === "error") {
        lastError = new Error(result.message);
        continue;
      }
      if (result.text.length < MIN_STREAMED_TEXT_LENGTH) {
        lastError = new Error("stream produced empty/short text");
        continue;
      }

      return {
        text: sanitizePatientFacingText(result.text),
        source: "model",
        attempts,
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
      `[wave] generateText falling back for phase=${phase} after ${attempts} attempts`,
      lastError,
    );
  }

  const fallback = sanitizePatientFacingText(fallbackTextForPhase(phase, input));
  // Push the fallback through the same onDelta channel so the UI's
  // "streaming" branch doesn't have a special case for fallback copy.
  options.onDelta?.(fallback);
  return { text: fallback, source: "fallback", attempts };
}

// ---------------------------------------------------------------------------
// generateReflection — JSON payload + streamed reasoning-summary titles
// ---------------------------------------------------------------------------

export interface ReflectionTitle {
  /** Stable index from the upstream reasoning summary parts. */
  index: number;
  /** Short human-readable section heading (e.g. "Reading the situation"). */
  text: string;
}

export interface GenerateReflectionOptions {
  /**
   * Optional AbortSignal so a phase that gets cancelled (e.g. patient
   * leaves the session early) does not finish a stale model call.
   */
  signal?: AbortSignal;
  /**
   * Called every time the route emits an SSE `title` event. Indices
   * are stable per-stream so the UI can dedupe / order; the same index
   * is never emitted twice. Callers should treat this as a one-way
   * notification — the resolved promise is the source of truth for the
   * structured payload.
   */
  onTitle?: (title: ReflectionTitle) => void;
}

/**
 * Boundary call for the reflection phase. Streams reasoning-summary
 * titles into `onTitle` while the model is still composing its
 * structured insight, then resolves with the validated payload. Two
 * strikes then falls through to the scripted reflection bank, just like
 * `generateJSON`.
 */
export async function generateReflection(
  input: PhaseInputMap["reflection"],
  options: GenerateReflectionOptions = {},
): Promise<GenerateJSONResult<"reflection">> {
  const adapterId = pickAdapter("reflection");
  const schema = PHASE_SCHEMAS.reflection.zod;

  let attempts = 0;
  let lastError: unknown = null;

  while (attempts < MAX_MODEL_ATTEMPTS) {
    attempts += 1;
    try {
      const response = await fetch("/api/narrate/reflection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: options.signal,
        body: JSON.stringify({
          phase: "reflection",
          input,
          adapterId,
        }),
      });

      if (!response.ok || !response.body) {
        lastError = new Error(
          `narrate/reflection returned ${response.status}`,
        );
        continue;
      }

      const result = await consumeReflectionSSE(response.body, options.onTitle);
      if (result.kind === "error") {
        lastError = new Error(result.message);
        continue;
      }

      const validated = schema.safeParse(result.payload);
      if (!validated.success) {
        lastError = validated.error;
        continue;
      }

      return {
        payload: sanitizeStructuredPayload(validated.data),
        source: "model",
        attempts,
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
      `[wave] generateReflection falling back after ${attempts} attempts`,
      lastError,
    );
  }

  // Surface a single synthetic title so the progress UI doesn't sit
  // empty when the route fails — the UX contract is "the card always
  // says something while the patient waits."
  options.onTitle?.({ index: 0, text: "Pulling a saved reflection" });

  return {
    payload: sanitizeStructuredPayload(fallbackJSONForPhase("reflection", input)),
    source: "fallback",
    attempts,
  };
}

// ---------------------------------------------------------------------------
// SSE plumbing
// ---------------------------------------------------------------------------

type SSEResult =
  | { kind: "done"; text: string }
  | { kind: "error"; message: string };

/**
 * Consumes a Server-Sent Events stream produced by /api/narrate/stream.
 * Supports `delta`, `done`, and `error` event types and ignores
 * anything else (forward-compatible). Calls `onDelta` with the
 * accumulated text on every delta event.
 */
async function consumeSSE(
  body: ReadableStream<Uint8Array>,
  onDelta: ((accumulated: string) => void) | undefined,
): Promise<SSEResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulated = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line ("\n\n"). Process every
      // complete frame in the buffer; keep the trailing partial frame.
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
            accumulated += sanitizePatientFacingText(chunk);
            onDelta?.(accumulated);
          }
        } else if (event === "done") {
          const finalText = (data as { text?: string }).text;
          return {
            kind: "done",
            text:
              typeof finalText === "string"
                ? sanitizePatientFacingText(finalText)
                : accumulated,
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
      // Already released; nothing to do.
    }
  }

  // Stream ended without an explicit terminator. Treat any accumulated
  // text as a soft success; otherwise surface as an error so the caller
  // can retry / fall back.
  if (accumulated.length > 0) {
    return { kind: "done", text: accumulated };
  }
  return { kind: "error", message: "stream_closed_without_done" };
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
    // Other SSE fields (id:, retry:) are intentionally ignored.
  }
  if (dataLines.length === 0) return null;
  const dataText = dataLines.join("\n");
  try {
    return { event, data: JSON.parse(dataText) };
  } catch {
    return { event, data: dataText };
  }
}

type ReflectionSSEResult =
  | { kind: "done"; payload: unknown }
  | { kind: "error"; message: string };

/**
 * Consumes a Server-Sent Events stream produced by
 * /api/narrate/reflection. Recognises three event types:
 *   - `title`   — `{ index, text }`, forwarded to `onTitle`
 *   - `payload` — the final structured reflection JSON
 *   - `error`   — `{ message }`, surfaced as a stream error
 *
 * Anything else (including `done`) is ignored. The promise resolves
 * either when a `payload` event arrives (success), an `error` event
 * arrives (caller will retry), or the stream closes without ever
 * delivering a payload (treated as an error).
 */
async function consumeReflectionSSE(
  body: ReadableStream<Uint8Array>,
  onTitle: ((title: ReflectionTitle) => void) | undefined,
): Promise<ReflectionSSEResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  // Track which indices we've already pushed to the consumer so a
  // route bug (re-emitting a title) never reaches the UI.
  const seen = new Set<number>();

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

        if (event === "title") {
          const obj = data as { index?: unknown; text?: unknown };
          if (
            typeof obj.index === "number" &&
            typeof obj.text === "string" &&
            obj.text.length > 0 &&
            !seen.has(obj.index)
          ) {
            seen.add(obj.index);
            onTitle?.({
              index: obj.index,
              text: sanitizePatientFacingText(obj.text),
            });
          }
        } else if (event === "payload") {
          return { kind: "done", payload: sanitizeStructuredPayload(data) };
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

  return { kind: "error", message: "stream_closed_without_payload" };
}
