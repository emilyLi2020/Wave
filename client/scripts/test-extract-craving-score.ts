/* eslint-disable no-console */
/**
 * Unit tests for the craving-score extractor used by the voice check-in.
 *
 * Run with:
 *   pnpm test:voice-loop
 *   # (or directly: pnpm exec tsx scripts/test-extract-craving-score.ts)
 */

import assert from "node:assert/strict";

import { extractCravingScore } from "@/lib/session/extract-craving-score";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(err instanceof Error ? err.message : err);
  }
}

console.log("\nextract-craving-score");

// ── digit form ─────────────────────────────────────────────────────────
test("plain digit", () => {
  assert.equal(extractCravingScore("6"), 6);
});
test("digit with article", () => {
  assert.equal(extractCravingScore("It's about a 6"), 6);
});
test("digit with leading 'maybe'", () => {
  assert.equal(extractCravingScore("Maybe 4"), 4);
});
test("digit 10 (two characters)", () => {
  assert.equal(extractCravingScore("Today it's a 10"), 10);
});
test("digit boundary — does not match 11 as 1", () => {
  assert.equal(extractCravingScore("I weigh 110 pounds"), null);
});

// ── word form ──────────────────────────────────────────────────────────
test("number word lowercase", () => {
  assert.equal(extractCravingScore("about a six"), 6);
});
test("number word capitalized", () => {
  assert.equal(extractCravingScore("Maybe Seven"), 7);
});
test("number word 'ten'", () => {
  assert.equal(extractCravingScore("yeah a ten right now"), 10);
});

// ── multiple candidates ────────────────────────────────────────────────
test("self-correction picks last", () => {
  assert.equal(extractCravingScore("five — actually six"), 6);
});
test("multiple separate numbers picks last", () => {
  assert.equal(extractCravingScore("I started at 7, now I'm at 4"), 4);
});

// ── range disambiguation (pick higher) ─────────────────────────────────
test("'X or Y' picks higher", () => {
  assert.equal(extractCravingScore("seven or eight"), 8);
});
test("'between X and Y' picks higher", () => {
  assert.equal(extractCravingScore("between 4 and 5"), 5);
});
test("'X to Y' picks higher", () => {
  assert.equal(extractCravingScore("around 6 to 7"), 7);
});
test("digit 'or' digit picks higher", () => {
  assert.equal(extractCravingScore("3 or 4"), 4);
});

// ── negation / comparison ──────────────────────────────────────────────
test("'not a 6' returns null when only candidate", () => {
  assert.equal(extractCravingScore("not a 6"), null);
});
test("'less than 5' returns null", () => {
  assert.equal(extractCravingScore("less than 5"), null);
});
test("'more than 7' returns null", () => {
  assert.equal(extractCravingScore("more than 7"), null);
});
test("negation drops one but keeps the other", () => {
  assert.equal(
    extractCravingScore("not a 10, more like a 6"),
    6,
  );
});

// ── empty / no-match ───────────────────────────────────────────────────
test("empty string returns null", () => {
  assert.equal(extractCravingScore(""), null);
});
test("whitespace-only returns null", () => {
  assert.equal(extractCravingScore("   "), null);
});
test("no numbers at all returns null", () => {
  assert.equal(extractCravingScore("um I don't know"), null);
});
test("number out of range silently drops it", () => {
  assert.equal(extractCravingScore("it was 100 yesterday"), null);
});
test("zero is not a valid score", () => {
  // 'zero' is not in the word map at all
  assert.equal(extractCravingScore("zero"), null);
});

// ── realistic Whisper-style transcriptions ─────────────────────────────
test("Whisper-style: 'It's about a 6'", () => {
  assert.equal(extractCravingScore("It's about a 6."), 6);
});
test("Whisper-style: 'Mmm, maybe a four'", () => {
  assert.equal(extractCravingScore("Mmm, maybe a four"), 4);
});
test("Whisper-style: 'I'd say like a 7 right now'", () => {
  assert.equal(extractCravingScore("I'd say like a 7 right now"), 7);
});

console.log(
  `\n${passed} passed, ${failed} failed (extract-craving-score)\n`,
);

if (failed > 0) {
  process.exitCode = 1;
}
