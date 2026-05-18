/**
 * End-session ("endConversation") path — deterministic Node tests.
 *
 * The check-in WAVE serves is the fine-tune `Maelstrome/lora-wave-session-r32`
 * through wllama. The "end session tool" is NOT a native function call:
 * it's the `endConversation` field of the strict
 * `response_format: json_schema` output (`{ reply, endConversation }`).
 * llama.cpp's grammar guarantees that field is always structurally valid
 * (null, or `{ cravingScore, obstacleCategory }`) — the model cannot
 * emit a malformed tool call. The only model-dependent question is
 * whether the fine-tune sets it non-null at the right moment, which can
 * only be observed running the GGUF in the browser harness
 * (`/models/wllama-schema-probe` · `/models/voice-test`). wllama cannot
 * run in Node (browser-only: navigator.gpu, OPFS, Workers).
 *
 * These tests therefore lock down the end-session *plumbing* the app
 * depends on: that a non-null `endConversation` survives the JSON parse,
 * is normalized to the downstream finalize signal, and is propagated by
 * `streamCheckInTurn` to the caller (which dismisses the check-in).
 *
 * Run with:  npx tsx scripts/test-check-in-end-session.ts
 */

import assert from "node:assert/strict";

import {
  normalizeEndConversation,
  parseCheckInJson,
} from "@/lib/gemma/wllama-generators";
import {
  streamCheckInTurn,
  type CheckInChatTurnPayload,
} from "@/lib/gemma/checkin";
import type { CheckInContextPayload } from "@/lib/prompts/schemas";

let passed = 0;
let failed = 0;

async function test(
  name: string,
  fn: () => void | Promise<void>,
): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  }
}

const PROFILE = {
  matType: "buprenorphine" as const,
  medicationStatus: "on_time" as const,
  trigger: "stress" as const,
  triggerOther: null,
  usedSubstanceToday: false,
};

const CONTEXT: CheckInContextPayload = {
  chunkNumber: 2,
  cravingScore: 4,
  scoreHistory: [7, 4],
  obstacleHint: null,
  profile: PROFILE,
  intakeIntensity: 7,
  sessionHistory: [],
  demoMode: false,
};

// A realistic "patient is ready to continue" transcript — the moment the
// fine-tune is supposed to fire the end-session tool.
const READY_HISTORY: CheckInChatTurnPayload[] = [
  { role: "patient", content: "About a 4." },
  {
    role: "agent",
    content:
      "Four is down from seven, and you stayed with it. Where did you feel the urge most?",
  },
  { role: "patient", content: "My chest, but it eased." },
  {
    role: "agent",
    content:
      "That easing is worth noticing. Ready to continue with the next part, the sound anchor, and see if it helps?",
  },
  { role: "patient", content: "Yes, I'm ready." },
];

// The exact JSON the fine-tune emits under the grammar when it decides
// the check-in is over: a short closing reply PLUS a non-null
// endConversation object.
const END_SESSION_RAW =
  '{"reply":"Okay, let\'s move into the sound anchor together.","endConversation":{"cravingScore":4,"obstacleCategory":"none"}}';

async function main(): Promise<void> {
  console.log("\nend-session signal survives the JSON parse");

  await test("parseCheckInJson extracts a non-null endConversation", () => {
    const parsed = parseCheckInJson(END_SESSION_RAW);
    assert.equal(
      parsed.reply,
      "Okay, let's move into the sound anchor together.",
    );
    assert.deepEqual(parsed.endConversation, {
      cravingScore: 4,
      obstacleCategory: "none",
    });
  });

  await test("mid-conversation turn keeps endConversation null", () => {
    const parsed = parseCheckInJson(
      '{"reply":"Where do you feel that in your body right now?","endConversation":null}',
    );
    assert.equal(parsed.endConversation, null);
  });

  await test("model leak (prose after JSON) still yields the end signal", () => {
    const parsed = parseCheckInJson(`${END_SESSION_RAW}\n\nHope that helps.`);
    assert.deepEqual(parsed.endConversation, {
      cravingScore: 4,
      obstacleCategory: "none",
    });
  });

  console.log("\nnormalizeEndConversation maps the tool call to a finalize signal");

  await test("'none' obstacle → null obstacle, score preserved", () => {
    const parsed = parseCheckInJson(END_SESSION_RAW);
    assert.deepEqual(normalizeEndConversation(parsed.endConversation), {
      cravingScore: 4,
      obstacleCategory: null,
    });
  });

  await test("a real obstacle is carried through", () => {
    const parsed = parseCheckInJson(
      '{"reply":"We can come back to that. Let\'s keep going.","endConversation":{"cravingScore":6,"obstacleCategory":"urge_overwhelming"}}',
    );
    assert.deepEqual(normalizeEndConversation(parsed.endConversation), {
      cravingScore: 6,
      obstacleCategory: "urge_overwhelming",
    });
  });

  await test("null endConversation normalizes to null (no finalize)", () => {
    assert.equal(normalizeEndConversation(null), null);
  });

  console.log("\nstreamCheckInTurn propagates the end-session signal");

  await test(
    "patient says 'ready' → endConversation reaches the caller as a model result",
    async () => {
      const deltas: string[] = [];
      // Mirror exactly what the (non-streaming) generateWllamaCheckIn
      // returns: emit the full reply once, surface the parsed signal.
      const result = await streamCheckInTurn({
        history: READY_HISTORY,
        context: CONTEXT,
        onDelta: (acc) => deltas.push(acc),
        generate: async (_history, _ctx, opts) => {
          const parsed = parseCheckInJson(END_SESSION_RAW);
          opts.onDelta?.(parsed.reply);
          return {
            text: parsed.reply,
            endConversation: normalizeEndConversation(
              parsed.endConversation,
            ),
          };
        },
      });

      assert.equal(result.source, "model");
      assert.equal(result.attempts, 1);
      assert.equal(
        result.text,
        "Okay, let's move into the sound anchor together.",
      );
      assert.deepEqual(result.endConversation, {
        cravingScore: 4,
        obstacleCategory: null,
      });
      assert.ok(
        deltas.length >= 1 && !deltas[deltas.length - 1].includes("endConversation"),
        "spoken reply must not contain the tool JSON",
      );
    },
  );

  await test(
    "tool-only turn (empty closing text) still finalizes the check-in",
    async () => {
      const result = await streamCheckInTurn({
        history: READY_HISTORY,
        context: CONTEXT,
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
    },
  );

  console.log(
    `\n${passed} passed, ${failed} failed (check-in end-session)\n`,
  );
  if (failed > 0) process.exitCode = 1;
}

void main();
