/**
 * Chunk-generation client boundary.
 *
 * Generates chunk narration with local Gemma, then falls back to the
 * clinician-reviewed scripted bank if Gemma fails twice or returns an
 * invalid shape.
 *
 * This boundary wraps the lines as a runtime `Chunk` (text segments
 * separated by default-length pause segments) so callers can hand the
 * result straight to `<ChunkPlayer />` without re-shaping.
 */

import {
  CHUNK_LINE_COUNT,
  chunkLinesSchema,
  type ChunkGenerationContextPayload,
  type ChunkLinesPayload,
} from "@/lib/prompts/schemas";
import { generateWllamaChunk as generateGemmaChunk } from "@/runtime/litert-generators";
import { fallbackChunk } from "@/lib/prompts/fallback-bank";
import type { Chunk, ChunkNumber, Segment } from "@/types/session";

/**
 * Default pause length (seconds) inserted between consecutive spoken
 * narration lines. The text is read aloud by Kokoro TTS now — the pause
 * is the beat of silence between sentences, not reading time. Demo mode
 * in `<ChunkPlayer />` collapses this to 1 s globally — see
 * `DEMO_BEAT_MS` in `chunk-player.tsx`.
 */
export const DEFAULT_LINE_PAUSE_SECONDS = 5;

const CHUNK_TITLES: Record<ChunkNumber, string> = {
  1: "Settle in",
  2: "Body scan",
  3: "Sound anchor",
  4: "Breath",
  5: "Close",
};

const MAX_MODEL_ATTEMPTS = 2;
type GemmaChunkGenerator = typeof generateGemmaChunk;

export interface GenerateChunkOptions {
  context: ChunkGenerationContextPayload;
  signal?: AbortSignal;
  /**
   * Optional generator override for tests and non-browser smoke checks.
   * Production callers use the local Gemma runtime import above.
   */
  generate?: GemmaChunkGenerator;
}

export interface GenerateChunkResult {
  chunk: Chunk;
  /** Plain lines (in order) — convenient for the session-history log. */
  lines: string[];
  source: "model" | "fallback";
  attempts: number;
}

export async function generateChunk(
  options: GenerateChunkOptions,
): Promise<GenerateChunkResult> {
  let attempts = 0;
  let lastError: unknown = null;
  const generate = options.generate ?? generateGemmaChunk;

  while (attempts < MAX_MODEL_ATTEMPTS) {
    attempts += 1;
    try {
      const result = await generate(options.context, {
        signal: options.signal,
        maxNewTokens: 260,
      });
      const payload = coerceChunkLinesPayload(JSON.parse(result.text));

      if (hasPackedBeats(payload.lines)) {
        lastError = new Error("Gemma chunk packed multiple beats into a line");
        continue;
      }

      const lines = sanitizeChunkLines(payload.lines);
      const validatedLines = chunkLinesSchema.safeParse({ lines });
      if (!validatedLines.success) {
        lastError = validatedLines.error;
        continue;
      }

      return {
        chunk: chunkFromLines(options.context.chunkNumber, lines),
        lines,
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
      `[wave] generateChunk falling back for chunk=${options.context.chunkNumber} after ${attempts} attempts`,
      lastError,
    );
  }

  const fallback: ChunkLinesPayload = fallbackChunk(
    options.context.chunkNumber,
  );
  const fallbackLines = sanitizeChunkLines(fallback.lines);
  return {
    chunk: chunkFromLines(options.context.chunkNumber, fallbackLines),
    lines: fallbackLines,
    source: "fallback",
    attempts,
  };
}

function sanitizeChunkLines(lines: readonly string[]): string[] {
  return lines.map((line) =>
    line
      .replace(/\]\s*\[/g, " ")
      .replace(/[\[\]]/g, "")
      .replace(/[–—]/g, ",")
      .replace(/\s+([,.;:?])/g, "$1")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function coerceChunkLinesPayload(value: unknown): ChunkLinesPayload {
  const parsed = chunkLinesSchema.safeParse(value);
  if (parsed.success) return parsed.data;

  if (!value || typeof value !== "object") {
    throw parsed.error;
  }
  const lines = (value as { lines?: unknown }).lines;
  if (!Array.isArray(lines) || lines.length < CHUNK_LINE_COUNT) {
    throw parsed.error;
  }
  const firstSix = lines.slice(0, CHUNK_LINE_COUNT);
  if (!firstSix.every((line) => typeof line === "string")) {
    throw parsed.error;
  }

  return { lines: firstSix };
}

function hasPackedBeats(lines: readonly string[]): boolean {
  return lines.some((line) => {
    return (
      line.includes("\n") ||
      line.includes(" / ") ||
      line.includes(" | ") ||
      line.includes("」「") ||
      line.includes("[") ||
      line.includes("]")
    );
  });
}

/**
 * Wraps `lines.length` text segments in `lines.length - 1` pause
 * segments of length `DEFAULT_LINE_PAUSE_SECONDS`. Order: text →
 * pause → text → pause → … → text. The terminal pause is omitted
 * intentionally so the chunk → check-in handoff feels prompt rather
 * than dragged out.
 */
export function chunkFromLines(
  chunkNumber: ChunkNumber,
  lines: readonly string[],
): Chunk {
  const segments: Segment[] = [];
  lines.forEach((line, index) => {
    segments.push({ type: "text", content: line });
    if (index < lines.length - 1) {
      segments.push({ type: "pause", duration: DEFAULT_LINE_PAUSE_SECONDS });
    }
  });
  return {
    id: chunkNumber,
    title: CHUNK_TITLES[chunkNumber],
    segments,
  };
}

export { CHUNK_LINE_COUNT };
