/* eslint-disable no-console */
/**
 * Tests for the parsing layer of @/lib/gemma/wllama-generators.
 *
 * We can't run wllama in Node (it uses browser-only APIs — `document`,
 * `navigator.gpu`, OPFS, Workers). Browser smoke testing of the actual
 * inference is a separate task. What we CAN test here is the layer
 * *between* wllama's raw string output and the typed result the
 * application consumes:
 *
 *   - `extractFirstJsonObject`: trims BOS/whitespace/trailing garbage
 *     around a {...} payload.
 *   - `parseCheckInJson`: safely decodes the check-in JSON shape with
 *     graceful fallback when the model leaks plain text despite the
 *     `response_format: json_schema` constraint.
 *   - `normalizeEndConversation`: clamps cravingScore, validates the
 *     obstacleCategory enum, and maps "none" → null per the
 *     downstream contract.
 *
 * Plus integration coverage of `streamCheckInTurn` (the boundary in
 * `lib/gemma/checkin.ts`) using an injected `generate` override that
 * simulates what the real wllama generator returns — endConversation
 * propagation, two-attempts-then-fallback, AbortError passthrough.
 *
 * Run with:
 *   pnpm test:voice-loop
 */

import assert from "node:assert/strict";

import {
  streamCheckInTurn,
  type CheckInChatTurnPayload,
} from "@/lib/gemma/checkin";
import {
  extractFirstJsonObject,
  normalizeEndConversation,
  parseCheckInJson,
} from "@/lib/gemma/wllama-generators";
import type { CheckInContextPayload } from "@/lib/prompts/schemas";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(err instanceof Error ? err.stack ?? err.message : err);
  }
}

const PROFILE = {
  matType: "buprenorphine" as const,
  medicationStatus: "on_time" as const,
  trigger: "stress" as const,
  triggerOther: null,
  usedSubstanceToday: false,
};

const CHECK_IN_CONTEXT: CheckInContextPayload = {
  chunkNumber: 2,
  cravingScore: 6,
  scoreHistory: [7, 6],
  obstacleHint: null,
  profile: PROFILE,
  intakeIntensity: 7,
  sessionHistory: [],
  demoMode: false,
};

const SAMPLE_HISTORY: CheckInChatTurnPayload[] = [
  { role: "patient", content: "About a 6." },
];

async function main(): Promise<void> {
  // ──────────────────────────────────────────────────────────────────────
  console.log("\nextractFirstJsonObject");
  // ──────────────────────────────────────────────────────────────────────

  await test("clean JSON returned as-is", () => {
    assert.equal(extractFirstJsonObject('{"a":1}'), '{"a":1}');
  });

  await test("leading whitespace trimmed", () => {
    assert.equal(extractFirstJsonObject('\n\n  {"a":1}'), '{"a":1}');
  });

  await test("trailing prose stripped", () => {
    assert.equal(
      extractFirstJsonObject('{"a":1} I hope that helps.'),
      '{"a":1}',
    );
  });

  await test("markdown code-fence wrapper stripped", () => {
    assert.equal(
      extractFirstJsonObject('```json\n{"a":1}\n```'),
      '{"a":1}',
    );
  });

  await test("no braces → trimmed original text", () => {
    assert.equal(extractFirstJsonObject("not json"), "not json");
  });

  await test("nested braces — outermost slice preserved", () => {
    assert.equal(
      extractFirstJsonObject('{"reply": "she said {hi}", "x": 1}'),
      '{"reply": "she said {hi}", "x": 1}',
    );
  });

  // ──────────────────────────────────────────────────────────────────────
  console.log("\nparseCheckInJson");
  // ──────────────────────────────────────────────────────────────────────

  await test("clean JSON with null endConversation", () => {
    const out = parseCheckInJson(
      '{"reply": "hello", "endConversation": null}',
    );
    assert.equal(out.reply, "hello");
    assert.equal(out.endConversation, null);
  });

  await test("clean JSON with valid endConversation object", () => {
    const out = parseCheckInJson(
      '{"reply": "bye", "endConversation": {"cravingScore": 4, "obstacleCategory": "none"}}',
    );
    assert.equal(out.reply, "bye");
    assert.deepEqual(out.endConversation, {
      cravingScore: 4,
      obstacleCategory: "none",
    });
  });

  await test("JSON with trailing prose (model leak)", () => {
    const out = parseCheckInJson(
      '{"reply": "hi", "endConversation": null} Hope this helps.',
    );
    assert.equal(out.reply, "hi");
  });

  await test("markdown-fenced JSON", () => {
    const out = parseCheckInJson(
      '```json\n{"reply": "ok", "endConversation": null}\n```',
    );
    assert.equal(out.reply, "ok");
  });

  await test("malformed JSON falls back to whole-text reply", () => {
    const out = parseCheckInJson("{not actually json}");
    assert.equal(out.reply, "{not actually json}");
    assert.equal(out.endConversation, null);
  });

  await test("missing endConversation key → null", () => {
    const out = parseCheckInJson('{"reply": "fine"}');
    assert.equal(out.reply, "fine");
    assert.equal(out.endConversation, null);
  });

  await test("malformed endConversation (missing cravingScore) → null", () => {
    const out = parseCheckInJson(
      '{"reply": "x", "endConversation": {"foo": "bar"}}',
    );
    assert.equal(out.reply, "x");
    assert.equal(out.endConversation, null);
  });

  await test("reply key missing → empty string", () => {
    const out = parseCheckInJson('{"foo": "bar"}');
    assert.equal(out.reply, "");
  });

  await test("escaped quotes in reply preserved", () => {
    const out = parseCheckInJson(
      '{"reply": "she said \\"hi\\"", "endConversation": null}',
    );
    assert.equal(out.reply, 'she said "hi"');
  });

  // ──────────────────────────────────────────────────────────────────────
  console.log("\nnormalizeEndConversation");
  // ──────────────────────────────────────────────────────────────────────

  await test("null in → null out", () => {
    assert.equal(normalizeEndConversation(null), null);
  });

  await test("'none' obstacle → null obstacle", () => {
    assert.deepEqual(
      normalizeEndConversation({
        cravingScore: 5,
        obstacleCategory: "none",
      }),
      { cravingScore: 5, obstacleCategory: null },
    );
  });

  await test("valid obstacle preserved", () => {
    assert.deepEqual(
      normalizeEndConversation({
        cravingScore: 3,
        obstacleCategory: "mind_wandering",
      }),
      { cravingScore: 3, obstacleCategory: "mind_wandering" },
    );
  });

  await test("unknown obstacle string → obstacle:null but score kept", () => {
    assert.deepEqual(
      normalizeEndConversation({
        cravingScore: 2,
        obstacleCategory: "bogus_value",
      }),
      { cravingScore: 2, obstacleCategory: null },
    );
  });

  await test("cravingScore out of range (0) → null result", () => {
    assert.equal(
      normalizeEndConversation({
        cravingScore: 0,
        obstacleCategory: "none",
      }),
      null,
    );
  });

  await test("cravingScore out of range (11) → null result", () => {
    assert.equal(
      normalizeEndConversation({
        cravingScore: 11,
        obstacleCategory: "none",
      }),
      null,
    );
  });

  await test("non-integer cravingScore rounded", () => {
    assert.deepEqual(
      normalizeEndConversation({
        cravingScore: 5.7,
        obstacleCategory: "none",
      }),
      { cravingScore: 6, obstacleCategory: null },
    );
  });

  // ──────────────────────────────────────────────────────────────────────
  console.log("\nstreamCheckInTurn (with simulated wllama generator)");
  // ──────────────────────────────────────────────────────────────────────

  await test("model success path returns text + endConversation", async () => {
    const result = await streamCheckInTurn({
      history: SAMPLE_HISTORY,
      context: CHECK_IN_CONTEXT,
      generate: async () => ({
        text: "I hear you. Three is a good drop. Ready to continue?",
        endConversation: { cravingScore: 3, obstacleCategory: null },
      }),
    });
    assert.equal(result.source, "model");
    assert.equal(result.attempts, 1);
    assert.equal(
      result.text,
      "I hear you. Three is a good drop. Ready to continue?",
    );
    assert.deepEqual(result.endConversation, {
      cravingScore: 3,
      obstacleCategory: null,
    });
  });

  await test("onDelta receives sanitized streaming text", async () => {
    const deltas: string[] = [];
    await streamCheckInTurn({
      history: SAMPLE_HISTORY,
      context: CHECK_IN_CONTEXT,
      onDelta: (acc) => deltas.push(acc),
      generate: async (_history, _ctx, options) => {
        options.onDelta?.("Hi");
        options.onDelta?.("Hi there");
        return { text: "Hi there.", endConversation: null };
      },
    });
    assert.ok(deltas.length >= 2);
    assert.equal(deltas[deltas.length - 1], "Hi there");
  });

  await test("empty model reply retries once then falls back", async () => {
    let attempts = 0;
    const result = await streamCheckInTurn({
      history: SAMPLE_HISTORY,
      context: CHECK_IN_CONTEXT,
      generate: async () => {
        attempts += 1;
        return { text: "", endConversation: null };
      },
    });
    assert.equal(attempts, 2, "should retry once after empty reply");
    assert.equal(result.source, "fallback");
    assert.ok(result.text.length > 0, "fallback should produce text");
  });

  await test("thrown error retries once then falls back", async () => {
    let attempts = 0;
    const result = await streamCheckInTurn({
      history: SAMPLE_HISTORY,
      context: CHECK_IN_CONTEXT,
      generate: async () => {
        attempts += 1;
        throw new Error("simulated wllama failure");
      },
    });
    assert.equal(attempts, 2);
    assert.equal(result.source, "fallback");
  });

  await test("AbortError propagates (no retry, no fallback)", async () => {
    let attempts = 0;
    await assert.rejects(
      streamCheckInTurn({
        history: SAMPLE_HISTORY,
        context: CHECK_IN_CONTEXT,
        generate: async () => {
          attempts += 1;
          throw new DOMException("aborted", "AbortError");
        },
      }),
      (err) => err instanceof DOMException && err.name === "AbortError",
    );
    assert.equal(attempts, 1);
  });

  await test("endConversation with only tool signal (empty text) is accepted", async () => {
    // The wllama path is supposed to always have text; this case mirrors
    // the original ONNX path where the model could emit ONLY a tool call.
    // We preserve the behavior so a model that decides "we're done" via
    // structured output alone still finalizes the check-in.
    const result = await streamCheckInTurn({
      history: SAMPLE_HISTORY,
      context: CHECK_IN_CONTEXT,
      generate: async () => ({
        text: "",
        endConversation: { cravingScore: 4, obstacleCategory: null },
      }),
    });
    assert.equal(result.source, "model");
    assert.deepEqual(result.endConversation, {
      cravingScore: 4,
      obstacleCategory: null,
    });
  });

  console.log(`\n${passed} passed, ${failed} failed (wllama-generators)\n`);
  if (failed > 0) process.exitCode = 1;
}

void main();
