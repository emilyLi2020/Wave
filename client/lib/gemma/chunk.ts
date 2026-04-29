/**
 * Chunk-generation client boundary.
 *
 * Returns pre-generated chunk narration from the local scripted bank.
 * This keeps the instruction segments fast and predictable during a
 * live session, and avoids runtime model punctuation artifacts.
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
  CHUNK_LINE_COUNT,
  type ChunkGenerationContextPayload,
  type ChunkLinesPayload,
} from "@/lib/prompts/schemas";
import { fallbackChunk } from "@/lib/prompts/fallback-bank";
import type { Chunk, ChunkNumber, Segment } from "@/types/session";

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
  const fallback: ChunkLinesPayload = fallbackChunk(
    options.context.chunkNumber,
  );
  const fallbackLines = sanitizeChunkLines(fallback.lines);
  return {
    chunk: chunkFromLines(options.context.chunkNumber, fallbackLines),
    lines: fallbackLines,
    source: "fallback",
    attempts: 0,
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
