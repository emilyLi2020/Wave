/* eslint-disable no-console */
// Dump the rendered WAVE prompts to JSON files so llama.cpp can consume them
// without re-implementing the TS prompt builders.
//
// Usage (from client/):
//   pnpm exec tsx scripts/dump-wave-prompts.ts <out-dir>

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { buildChunkPrompt } from "@/lib/prompts/chunk-generator";
import { buildCheckInPrompt } from "@/lib/prompts/check-in";
import { buildReflectionPrompt } from "@/lib/prompts/reflection";
import type {
  CheckInContextPayload,
  ChunkGenerationContextPayload,
  ReflectionContext,
  SessionHistoryEntry,
} from "@/lib/prompts/schemas";

const PATIENT_PROFILE = {
  matType: "buprenorphine",
  medicationStatus: "on_time",
  trigger: "stress",
  triggerOther: null,
  usedSubstanceToday: false,
} as const;

const SESSION_HISTORY: SessionHistoryEntry[] = [
  {
    kind: "chunk",
    chunkNumber: 1,
    lines: [
      "Welcome back. You showing up for this is the practice.",
      "Find a position your body can rest in for a few minutes.",
      "Urges arrive like waves. They build, they crest, and they fall.",
      "Notice what is already here in the body, without trying to fix anything.",
      "Let your breath be ordinary for one slow round.",
      "When you are ready, we will move into the body together.",
    ],
  },
];

const phase = buildChunkPrompt({
  chunkNumber: 2,
  intakeIntensity: 7,
  profile: PATIENT_PROFILE,
  sessionHistory: SESSION_HISTORY,
});

const checkin = buildCheckInPrompt(
  {
    chunkNumber: 1,
    cravingScore: 7,
    scoreHistory: [],
    obstacleHint: null,
    profile: PATIENT_PROFILE,
    intakeIntensity: 7,
    sessionHistory: SESSION_HISTORY,
    demoMode: false,
  } satisfies CheckInContextPayload,
  { agentTurnsInHistory: 0 },
);

const reflection = buildReflectionPrompt({
  intakeIntensity: 7,
  matType: "buprenorphine",
  medicationStatus: "on_time",
  trigger: "stress",
  usedSubstanceToday: false,
  bodyLocation: "chest",
  currentIntensity: 4,
  endingIntensity: 3,
  durationSeconds: 600,
} satisfies ReflectionContext);

const FIRST_PATIENT_TURN =
  "It's around a 7. It's been building for a couple hours.";

const outDir = resolve(process.argv[2] ?? "../logs/wave-prompts");
mkdirSync(outDir, { recursive: true });

writeFileSync(
  resolve(outDir, "phase.json"),
  JSON.stringify(
    {
      system: phase.systemPrompt,
      user: phase.userPrompt,
      maxNewTokens: 320,
    },
    null,
    2,
  ),
);
writeFileSync(
  resolve(outDir, "checkin.json"),
  JSON.stringify(
    {
      system: checkin.systemPrompt,
      user: `${checkin.contextBlock}\n\n${FIRST_PATIENT_TURN}`,
      maxNewTokens: 220,
    },
    null,
    2,
  ),
);
writeFileSync(
  resolve(outDir, "reflection.json"),
  JSON.stringify(
    {
      system: reflection.systemPrompt,
      user: reflection.userPrompt,
      maxNewTokens: 320,
    },
    null,
    2,
  ),
);
console.log(`Wrote 3 prompts to ${outDir}`);
