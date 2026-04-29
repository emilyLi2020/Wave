/* eslint-disable no-console */
/**
 * Exercises the client-side fallback path of `generateChunk()` without
 * involving the dev server.
 *
 * Strategy:
 *   - Stub `globalThis.fetch` to always return HTTP 502.
 *   - Call `generateChunk()`. Expect it to retry MAX_MODEL_ATTEMPTS times,
 *     then fall through to `fallbackChunk()`.
 *   - Validate the returned `Chunk` is well-shaped: the right number of
 *     text segments, default-length pauses interleaved, and every line
 *     within the schema's MIN/MAX length window.
 *
 * Also spot-checks `fallbackChunk()` directly for every chunk number.
 *
 * Run with:  npx --yes tsx scripts/test-fallback.ts
 */

import { generateChunk, DEFAULT_LINE_PAUSE_SECONDS } from "@/lib/gemma/chunk";
import { fallbackChunk } from "@/lib/prompts/fallback-bank";
import { CHUNK_LINE_COUNT, chunkLinesSchema } from "@/lib/prompts/schemas";
import type { ChunkNumber } from "@/types/session";

let total = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: string) {
  total += 1;
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const PROFILE = {
  matType: "buprenorphine" as const,
  medicationStatus: "on_time" as const,
  trigger: "stress" as const,
  triggerOther: null,
  usedSubstanceToday: false,
};

async function testFallbackOnRouteFailure() {
  console.log("\n[A] generateChunk() falls back when /api/chunk returns 502 twice");

  let calls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response("upstream down", { status: 502 });
  }) as typeof fetch;

  try {
    const result = await generateChunk({
      context: {
        chunkNumber: 3,
        intakeIntensity: 7,
        profile: PROFILE,
        sessionHistory: [],
      },
    });

    assert(calls === 2, `fetched twice before fallback (got ${calls})`);
    assert(result.source === "fallback", `source === "fallback" (got "${result.source}")`);
    assert(result.attempts === 2, `attempts === 2 (got ${result.attempts})`);
    assert(result.lines.length === CHUNK_LINE_COUNT, `lines.length === ${CHUNK_LINE_COUNT}`);
    assert(result.chunk.id === 3, `chunk.id === 3 (got ${result.chunk.id})`);
    assert(result.chunk.title.length > 0, "chunk.title set");

    const segs = result.chunk.segments;
    const expectedSegCount = CHUNK_LINE_COUNT * 2 - 1;
    assert(
      segs.length === expectedSegCount,
      `segments.length === ${expectedSegCount} (got ${segs.length})`,
    );
    let textCount = 0;
    let pauseCount = 0;
    for (const [idx, seg] of segs.entries()) {
      if (idx % 2 === 0) {
        assert(seg.type === "text", `segment[${idx}] is text`);
        if (seg.type === "text") textCount += 1;
      } else {
        assert(
          seg.type === "pause" && seg.duration === DEFAULT_LINE_PAUSE_SECONDS,
          `segment[${idx}] is ${DEFAULT_LINE_PAUSE_SECONDS}s pause`,
        );
        if (seg.type === "pause") pauseCount += 1;
      }
    }
    assert(textCount === CHUNK_LINE_COUNT, `${CHUNK_LINE_COUNT} text segments`);
    assert(pauseCount === CHUNK_LINE_COUNT - 1, `${CHUNK_LINE_COUNT - 1} pause segments`);
  } finally {
    globalThis.fetch = realFetch;
  }
}

async function testFallbackOnInvalidJson() {
  console.log(
    "\n[B] generateChunk() falls back when /api/chunk returns malformed JSON twice",
  );

  let calls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response('{"lines":["too short"]}', {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const result = await generateChunk({
      context: {
        chunkNumber: 4,
        intakeIntensity: 7,
        profile: PROFILE,
        sessionHistory: [],
      },
    });
    assert(calls === 2, `retried after first Zod failure (got ${calls})`);
    assert(result.source === "fallback", "source === fallback after Zod failure");
    assert(result.lines.length === CHUNK_LINE_COUNT, `lines.length === ${CHUNK_LINE_COUNT}`);
  } finally {
    globalThis.fetch = realFetch;
  }
}

function testFallbackBank() {
  console.log("\n[C] fallbackChunk() bank shape — every chunk number");

  for (const n of [1, 2, 3, 4, 5] as ChunkNumber[]) {
    const payload = fallbackChunk(n);
    assert(payload.lines.length === CHUNK_LINE_COUNT, `chunk ${n}: 6 lines`);
    const parsed = chunkLinesSchema.safeParse(payload);
    assert(parsed.success, `chunk ${n}: passes chunkLinesSchema`);
    if (!parsed.success) {
      console.log("    issues:", JSON.stringify(parsed.error.issues, null, 2));
    }
  }
}

(async () => {
  const start = Date.now();
  try {
    await testFallbackOnRouteFailure();
    await testFallbackOnInvalidJson();
    testFallbackBank();
  } catch (err) {
    failed += 1;
    console.error("\n[FATAL]", err);
  }
  const elapsed = ((Date.now() - start) / 1000).toFixed(2);
  console.log(`\n=== ${total - failed}/${total} assertions passed in ${elapsed}s ===`);
  process.exit(failed === 0 ? 0 : 1);
})();
