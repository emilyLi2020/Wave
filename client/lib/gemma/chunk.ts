/**
 * Chunk-generation client boundary.
 *
 * Mirrors `generateJSON()` in client/lib/gemma/session.ts: POSTs to
 * `/api/chunk`, validates the response with Zod, retries once on
 * stream/Zod failure, and falls through to `fallbackChunk()` after
 * the second failure (PRD § Session Runtime Requirements rule 7).
 *
 * The route returns plain `{ lines: string[] }`. This boundary
 * additionally wraps the lines as a runtime `Chunk` (text segments
 * separated by default-length pause segments) so callers can hand the
 * result straight to `<ChunkPlayer />` without re-shaping.
 *
 * TODO:replace-with-gemma — when the in-browser Gemma stack lands,
 * swap the `fetch("/api/chunk", …)` for a transformers.js inference
 * call gated by a JSON-grammar constrained decoder. The boundary
 * signature stays the same.
 */

import {
  chunkLinesSchema,
  CHUNK_LINE_COUNT,
  type ChunkGenerationContextPayload,
  type ChunkLinesPayload,
} from "@/lib/prompts/schemas";
import { fallbackChunk } from "@/lib/prompts/fallback-bank";
import type { Chunk, ChunkNumber, Segment } from "@/types/session";

const MAX_MODEL_ATTEMPTS = 2;

/**
 * Default pause length (seconds) inserted between consecutive text
 * lines in a generated chunk. Demo mode in `<ChunkPlayer />`
 * collapses this to 2 s globally — see DEMO_BEAT_MS in
 * `chunk-player.tsx`.
 */
export const DEFAULT_LINE_PAUSE_SECONDS = 7;

const CHUNK_TITLES: Record<ChunkNumber, string> = {
  1: "Settle in",
  2: "Body scan",
  3: "Sound anchor",
  4: "Breath",
  5: "Close",
};

export interface GenerateChunkOptions {
  context: ChunkGenerationContextPayload;
  signal?: AbortSignal;
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

  while (attempts < MAX_MODEL_ATTEMPTS) {
    attempts += 1;
    try {
      const response = await fetch("/api/chunk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: options.signal,
        body: JSON.stringify({ context: options.context }),
      });

      if (!response.ok) {
        lastError = new Error(`chunk route returned ${response.status}`);
        continue;
      }

      const json: unknown = await response.json();
      const parsed = chunkLinesSchema.safeParse(json);
      if (!parsed.success) {
        lastError = parsed.error;
        continue;
      }

      const lines = sanitizeChunkLines(parsed.data.lines);
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
      .replace(/[\[\]]/g, "")
      .replace(/\s+([,.;:?])/g, "$1")
      .replace(/\s+/g, " ")
      .trim(),
  );
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
