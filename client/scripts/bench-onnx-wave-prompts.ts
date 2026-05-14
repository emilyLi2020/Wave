/* eslint-disable no-console */
// Runs the three production WAVE prompts (phase, check-in turn 1, reflection)
// against the fine-tuned ONNX export *in Node CPU* via transformers.js v4.
//
// Why: the browser /models/onnx-test/compare page emits zero tokens for these
// prompts even though bench-onnx.ts (simple user-only chat prompts) produces
// coherent text. This script isolates the variable: same runtime
// (transformers.js v4 + onnxruntime-node), same model file, but with the EXACT
// production prompt builders the browser uses. If output here is coherent then
// the bug is in the browser/WebGPU path. If it's empty here too then the bug is
// in the ONNX model's response to those prompt shapes.
//
// Usage (from client/):
//   pnpm exec tsx scripts/bench-onnx-wave-prompts.ts

import {
  pipeline,
  env,
  type TextGenerationPipeline,
} from "@huggingface/transformers";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { buildChunkPrompt } from "@/lib/prompts/chunk-generator";
import { buildCheckInPrompt } from "@/lib/prompts/check-in";
import { buildReflectionPrompt } from "@/lib/prompts/reflection";
import type {
  CheckInContextPayload,
  ChunkGenerationContextPayload,
  ReflectionContext,
  SessionHistoryEntry,
} from "@/lib/prompts/schemas";

const __dirname = dirname(fileURLToPath(import.meta.url));

env.allowRemoteModels = true;
env.allowLocalModels = true;
env.localModelPath = resolve(__dirname, "../../models/runs/");

const MODEL_ID = process.env.MODEL_ID ?? "onnx-export-v3"; // local: models/runs/<MODEL_ID>
const DTYPE = "q4f16" as const;

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

const PHASE_CONTEXT: ChunkGenerationContextPayload = {
  chunkNumber: 2,
  intakeIntensity: 7,
  profile: PATIENT_PROFILE,
  sessionHistory: SESSION_HISTORY,
};

const CHECK_IN_CONTEXT: CheckInContextPayload = {
  chunkNumber: 1,
  cravingScore: 7,
  scoreHistory: [],
  obstacleHint: null,
  profile: PATIENT_PROFILE,
  intakeIntensity: 7,
  sessionHistory: SESSION_HISTORY,
  demoMode: false,
};

const REFLECTION_CONTEXT: ReflectionContext = {
  intakeIntensity: 7,
  matType: "buprenorphine",
  medicationStatus: "on_time",
  trigger: "stress",
  usedSubstanceToday: false,
  bodyLocation: "chest",
  currentIntensity: 4,
  endingIntensity: 3,
  durationSeconds: 600,
};

const FIRST_PATIENT_TURN =
  "It's around a 7. It's been building for a couple hours.";

interface PromptCase {
  label: string;
  maxNewTokens: number;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
}

function buildCases(): PromptCase[] {
  const phase = buildChunkPrompt(PHASE_CONTEXT);
  const checkin = buildCheckInPrompt(CHECK_IN_CONTEXT, {
    agentTurnsInHistory: 0,
  });
  const reflection = buildReflectionPrompt(REFLECTION_CONTEXT);

  return [
    {
      label: "phase (chunk 2 narration)",
      maxNewTokens: 320,
      messages: [
        { role: "system", content: phase.systemPrompt },
        { role: "user", content: phase.userPrompt },
      ],
    },
    {
      label: "check-in (turn 1, craving=7)",
      maxNewTokens: 220,
      messages: [
        { role: "system", content: checkin.systemPrompt },
        {
          role: "user",
          content: `${checkin.contextBlock}\n\n${FIRST_PATIENT_TURN}`,
        },
      ],
    },
    {
      label: "reflection (end-of-session)",
      maxNewTokens: 320,
      messages: [
        { role: "system", content: reflection.systemPrompt },
        { role: "user", content: reflection.userPrompt },
      ],
    },
  ];
}

async function main(): Promise<void> {
  console.log(`Loading ${MODEL_ID} (dtype=${DTYPE}) ...`);
  const loadStart = performance.now();
  const pipe = (await pipeline("text-generation", MODEL_ID, {
    dtype: DTYPE,
  })) as TextGenerationPipeline;
  console.log(`  loaded in ${((performance.now() - loadStart) / 1000).toFixed(1)}s\n`);

  const cases = buildCases();

  for (const c of cases) {
    const sysLen = c.messages.find((m) => m.role === "system")?.content.length ?? 0;
    const usrLen = c.messages.find((m) => m.role === "user")?.content.length ?? 0;
    console.log(`=== ${c.label} ===`);
    console.log(
      `  system=${sysLen} chars · user=${usrLen} chars · max_new=${c.maxNewTokens}`,
    );
    const startedAt = performance.now();
    const out = (await pipe(c.messages, {
      max_new_tokens: c.maxNewTokens,
      do_sample: false,
      return_full_text: false,
    })) as unknown;
    const elapsedMs = performance.now() - startedAt;

    let text = "";
    const arr = out as Array<{ generated_text?: unknown }>;
    if (Array.isArray(arr) && arr.length > 0) {
      const gen = arr[0]?.generated_text;
      if (typeof gen === "string") text = gen;
      else if (Array.isArray(gen)) {
        const last = gen[gen.length - 1] as {
          role?: string;
          content?: string;
        };
        if (last?.role === "assistant" && typeof last.content === "string") {
          text = last.content;
        }
      }
    }

    console.log(`  raw len=${text.length} · ${(elapsedMs / 1000).toFixed(1)}s`);
    if (text.length === 0) {
      console.log("  !!! EMPTY OUTPUT — model emitted a stop token immediately");
    } else {
      const preview = text.slice(0, 500).replace(/\n/g, " ");
      console.log(`  output: ${preview}${text.length > 500 ? "..." : ""}`);
    }
    console.log("");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
