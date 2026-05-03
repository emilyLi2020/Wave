/* eslint-disable no-console */
/**
 * Live integration test for the planned check-in runtime:
 * local Gemma generation through AI SDK + @browser-ai/transformers-js,
 * streamed patient-facing text, and a validated endConversation tool.
 *
 * This test downloads Gemma weights on first run and stores them in
 * `client/.cache/transformers/`, which is gitignored. Later runs reuse
 * that cache.
 *
 * Run with:
 *   pnpm test:gemma:tools:live
 */

import assert from "node:assert/strict";
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";

import { env, LogLevel } from "@huggingface/transformers";

import { GEMMA_MODEL_ID } from "@/lib/gemma/local-runtime";
import { streamCheckInTurn } from "@/lib/gemma/checkin";
import type { CheckInContextPayload } from "@/lib/prompts/schemas";

const CACHE_DIR = path.resolve(process.cwd(), ".cache", "transformers");
const EXPECTED_CRAVING_SCORE = 3;

const PROFILE = {
  matType: "buprenorphine" as const,
  medicationStatus: "on_time" as const,
  trigger: "stress" as const,
  triggerOther: null,
  usedSubstanceToday: false,
};
const CHECK_IN_CONTEXT: CheckInContextPayload = {
  chunkNumber: 2,
  cravingScore: EXPECTED_CRAVING_SCORE,
  scoreHistory: [7, EXPECTED_CRAVING_SCORE],
  obstacleHint: null,
  profile: PROFILE,
  intakeIntensity: 7,
  sessionHistory: [],
  demoMode: false,
};
const READY_HISTORY = [
  { role: "patient" as const, content: `${EXPECTED_CRAVING_SCORE}/10` },
  {
    role: "agent" as const,
    content:
      "Three is lower than where you started, and you stayed with the practice even while it was hard. Where did you notice the urge most during that last chunk?",
  },
  { role: "patient" as const, content: "Mostly in my chest." },
  {
    role: "agent" as const,
    content:
      "Chest is useful information, urges can show up as pressure there. Try noticing the edges of that pressure for one breath, without pushing it away. What changes, even a little?",
  },
  { role: "patient" as const, content: "It softened a little." },
  {
    role: "agent" as const,
    content:
      "Softening a little is worth noticing, you tried the practice while the urge was still present. Ready to continue with the next part, the sound anchor, and see if it helps?",
  },
  { role: "patient" as const, content: "Yes, ready." },
];

// The Transformers.js AI SDK provider currently warns that the default
// `toolChoice: auto` hint is unsupported. Tool detection/execution still works,
// and this test asserts that behavior directly.
(globalThis as typeof globalThis & { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS =
  false;

function configureTransformersCache() {
  env.logLevel = LogLevel.WARNING;
  env.allowRemoteModels = true;
  env.allowLocalModels = false;
  env.useFSCache = true;
  env.useBrowserCache = false;
  env.cacheDir = CACHE_DIR;
}

async function hasCachedFiles(directory: string): Promise<boolean> {
  try {
    const entries = await readdir(directory, { recursive: true });
    return entries.length > 0;
  } catch {
    return false;
  }
}

async function main() {
  const start = Date.now();
  await mkdir(CACHE_DIR, { recursive: true });
  configureTransformersCache();

  console.log(`[gemma] cache: ${CACHE_DIR}`);
  console.log(`[gemma] model: ${GEMMA_MODEL_ID}`);

  let streamedText = "";
  const deltas: string[] = [];
  const endSignals: unknown[] = [];

  const result = await streamCheckInTurn({
    history: READY_HISTORY,
    context: CHECK_IN_CONTEXT,
    onDelta: (text) => {
      streamedText = text;
      deltas.push(text);
      process.stdout.write(`\r${text}`);
    },
    onEndConversation: (signal) => {
      endSignals.push(signal);
      console.log(`\n[gemma] endConversation: ${JSON.stringify(signal)}`);
    },
  });

  console.log("");

  assert.equal(result.source, "model");
  assert.equal(deltas.length > 0, true, "expected at least one streamed delta");
  assert.equal(result.text, streamedText);
  assert.equal(result.text.length > 0, true, "expected visible streamed text");
  assert.deepEqual(result.endConversation, {
    cravingScore: EXPECTED_CRAVING_SCORE,
    obstacleCategory: null,
  });
  assert.deepEqual(endSignals, [result.endConversation]);
  assert.equal(
    await hasCachedFiles(CACHE_DIR),
    true,
    "expected Gemma files to be present in the local Transformers cache",
  );

  const elapsedSeconds = ((Date.now() - start) / 1000).toFixed(1);
  console.log(
    `[gemma] PASS streamed text + endConversation tool in ${elapsedSeconds}s`,
  );
}

void main().catch((error) => {
  console.error("\n[gemma] FAIL live AI SDK tool integration");
  console.error(error);
  process.exit(1);
});
