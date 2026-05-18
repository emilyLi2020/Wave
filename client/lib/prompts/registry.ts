/**
 * Prompt registry — the single source the hidden `/prompts` visualizer
 * renders.
 *
 * This module reconstructs the EXACT `messages[]` arrays handed to the
 * local model by `lib/gemma/wllama-generators.ts`, one entry per model
 * surface. It calls the real prompt builders (`buildCheckInPrompt`,
 * `buildChunkPrompt`, `buildReflectionPrompt`, `buildInsightsPrompt`,
 * `buildMockCheckInSystemPrompt`) with a representative example scenario,
 * then applies the same thin assembly each generator does (check-in's
 * `<output_contract>` wrapper, the context-block-rides-the-first-user-turn
 * rule, etc.).
 *
 * It is intentionally pure and server-safe: it imports only the prompt
 * builders, never the wllama runtime, so the visualizer page stays light.
 *
 * Where a span is filled at runtime from live data (the patient's spoken
 * turns, the accumulating session transcript), it is shown as a
 * `placeholder` message or a `«token»` so the structure reads as a
 * template. Enum-driven copy (MAT type, trigger, chunk) is rendered for
 * one concrete example documented in each variant's `scenario` line.
 *
 * Keep the `<output_contract>` text below in sync with
 * `lib/gemma/wllama-generators.ts` if that wrapper changes.
 */

import { buildCheckInPrompt } from "./check-in";
import { buildChunkPrompt } from "./chunk-generator";
import { buildInsightsPrompt } from "./insights";
import { buildReflectionPrompt } from "./reflection";
import type {
  CheckInContextPayload,
  ChunkGenerationContextPayload,
  ReflectionContext,
  SessionHistoryEntry,
} from "./schemas";
import { buildMockCheckInSystemPrompt } from "@/lib/gemma/voice-test-prompt";
import { MOCK_SESSIONS } from "@/lib/data/mock-sessions";
import type { ChunkNumber } from "@/types/session";

export type PromptRole = "system" | "user" | "assistant";

export interface PromptMessage {
  role: PromptRole;
  content: string;
  /**
   * True when this message is not a fixed template but a stand-in for a
   * value supplied at runtime (a live STT turn, the accumulating
   * transcript). The visualizer styles these distinctly.
   */
  placeholder?: boolean;
}

export interface PromptVariant {
  id: string;
  title: string;
  /** Human description of the concrete example values used here. */
  scenario: string;
  messages: PromptMessage[];
}

export interface PromptFeature {
  id: string;
  title: string;
  description: string;
  /** What the model is asked to return (decoding constraint). */
  responseFormat: string;
  /** Where this prompt is assembled in the codebase. */
  source: string;
  /** Free spans filled from live data each call. */
  runtimeFilled: string[];
  variants: PromptVariant[];
}

// ─────────────────────────────────────────────────────────────────────────
// Shared example fixtures
// ─────────────────────────────────────────────────────────────────────────

const EXAMPLE_PROFILE: CheckInContextPayload["profile"] = {
  matType: "buprenorphine",
  medicationStatus: "on_time",
  trigger: "stress",
  triggerOther: null,
  usedSubstanceToday: false,
};

const EXAMPLE_HISTORY_CHUNK1: SessionHistoryEntry = {
  kind: "chunk",
  chunkNumber: 1,
  lines: [
    "Welcome. You showed up, and that already counts for something.",
    "Find a position that lets you settle, whatever that looks like for you.",
    "Urges move like waves. They rise, they crest, and they fall. None of them last.",
  ],
};

const EXAMPLE_HISTORY_CHECKIN1: SessionHistoryEntry = {
  kind: "checkIn",
  chunkNumber: 1,
  cravingScore: 7,
  obstacleCategory: "mind_wandering",
  turns: [
    { role: "patient", content: "7" },
    {
      role: "agent",
      content:
        "You came in at a 7, same as where you started. That is a strong wave to be sitting with. What came up during the settling part?",
    },
    { role: "patient", content: "my mind kept running, couldn't focus" },
  ],
};

// ─────────────────────────────────────────────────────────────────────────
// Check-in: mirror of generateWllamaCheckIn() in wllama-generators.ts
// ─────────────────────────────────────────────────────────────────────────

const CHECK_IN_ALLOWED_OBSTACLES = [
  "cannot_visualize",
  "mind_wandering",
  "urge_overwhelming",
  "breath_tight",
  "breath_anxiety",
  "gave_in",
  "guilt_failure",
  "physical_discomfort",
  "sleepiness",
] as const;
const CHECK_IN_TOOL_NONE_OBSTACLE = "none" as const;
const CHECK_IN_TOOL_OBSTACLES = [
  CHECK_IN_TOOL_NONE_OBSTACLE,
  ...CHECK_IN_ALLOWED_OBSTACLES,
] as const;

/** Exact `<output_contract>` wrapper appended in wllama-generators.ts. */
function wrapCheckInSystem(systemPrompt: string): string {
  return `${systemPrompt}

<output_contract>
Respond with a JSON object matching this exact schema:

{
  "reply": "<patient-facing prose, 1-3 short sentences>",
  "endConversation": null | { "cravingScore": <integer 1-10>, "obstacleCategory": "<one of: ${CHECK_IN_TOOL_OBSTACLES.join(", ")}>" }
}

Rules:
- "reply" is the visible patient-facing text the speaker will hear. Plain prose, no markdown, no lists.
- "endConversation" is null UNLESS this check-in is complete and the patient is ready to continue.
- When ending, "obstacleCategory" is "${CHECK_IN_TOOL_NONE_OBSTACLE}" when no clear obstacle is present.
- Emit nothing outside the JSON object — no preamble, no analysis, no extra keys.
</output_contract>`;
}

function buildCheckInVariant(args: {
  id: string;
  title: string;
  scenario: string;
  context: CheckInContextPayload;
  /** Agent turns already in the transcript (drives the turn counter). */
  agentTurnsInHistory: number;
  firstPatientPlaceholder: string;
  /** Extra placeholder turns illustrating the alternating live transcript. */
  trailingPlaceholders?: PromptMessage[];
}): PromptVariant {
  const { systemPrompt, contextBlock } = buildCheckInPrompt(args.context, {
    agentTurnsInHistory: args.agentTurnsInHistory,
  });

  const messages: PromptMessage[] = [
    { role: "system", content: wrapCheckInSystem(systemPrompt) },
    {
      role: "user",
      content: `${contextBlock}\n\n${args.firstPatientPlaceholder}`,
    },
    ...(args.trailingPlaceholders ?? []),
  ];

  return {
    id: args.id,
    title: args.title,
    scenario: args.scenario,
    messages,
  };
}

const PATIENT_SCORE_PLACEHOLDER =
  '«patient turn 1 — the craving score the slider sent, e.g. "6». This rides on the first user message with the context block above it (Gemma\'s chat template requires the first turn to be `user`).';

const SUBSEQUENT_TURNS_NOTE: PromptMessage = {
  role: "user",
  placeholder: true,
  content:
    "« …and so on. Every later agent turn re-calls the model with the full alternating transcript (assistant = WAVE, user = patient) appended after the message above. The context block is rebuilt each call with an incremented `YOU ARE WRITING AGENT TURN #N` and refreshed <session_history> / <patient_score> blocks. »",
};

const checkInFeature: PromptFeature = {
  id: "check-in",
  title: "Multi-turn check-in",
  description:
    "The conversational check-in after each meditation chunk. Called once per agent turn. System prompt is the canonical WAVE_SYSTEM_PROMPT plus a JSON <output_contract>; the per-turn context block rides on the first user message, followed by the live alternating transcript.",
  responseFormat:
    'Strict JSON schema "wave_check_in_turn" — { reply, endConversation } (temperature 0, top_k 1)',
  source:
    "lib/prompts/check-in.ts + lib/prompts/wave-system.ts, assembled in lib/gemma/wllama-generators.ts → generateWllamaCheckIn()",
  runtimeFilled: [
    "Patient spoken turns (STT) — every `user` message after the context block",
    "WAVE replies (model output) — replayed as `assistant` turns on later calls",
    "<patient_score>: craving score from the slider + prior-score trend",
    "<session_history>: every prior chunk + check-in this session",
    "`YOU ARE WRITING AGENT TURN #N`: increments each call",
    "<heuristic_hint>: only present when a keyword heuristic flags an obstacle",
  ],
  variants: [
    buildCheckInVariant({
      id: "check-in-1",
      title: "Check-in 1 (baseline, after the settling chunk)",
      scenario:
        "Chunk 1 just finished. Craving 7/10, no prior scores. Buprenorphine/Suboxone, dose on time, stress trigger. Writing agent turn #1, empty session history.",
      context: {
        chunkNumber: 1,
        cravingScore: 7,
        scoreHistory: [],
        obstacleHint: null,
        profile: EXAMPLE_PROFILE,
        intakeIntensity: 7,
        sessionHistory: [],
        demoMode: false,
      },
      agentTurnsInHistory: 0,
      firstPatientPlaceholder: PATIENT_SCORE_PLACEHOLDER,
      trailingPlaceholders: [SUBSEQUENT_TURNS_NOTE],
    }),
    buildCheckInVariant({
      id: "check-in-2-4",
      title: "Check-in 2–4 (landing split + obstacle path)",
      scenario:
        "Representative of check-ins 2, 3 and 4 (this one is check-in 2, after the body scan). Craving 6/10, prior score 7. One prior chunk + check-in in history. Writing agent turn #1.",
      context: {
        chunkNumber: 2,
        cravingScore: 6,
        scoreHistory: [7],
        obstacleHint: null,
        profile: EXAMPLE_PROFILE,
        intakeIntensity: 7,
        sessionHistory: [EXAMPLE_HISTORY_CHUNK1, EXAMPLE_HISTORY_CHECKIN1],
        demoMode: false,
      },
      agentTurnsInHistory: 0,
      firstPatientPlaceholder: PATIENT_SCORE_PLACEHOLDER,
      trailingPlaceholders: [SUBSEQUENT_TURNS_NOTE],
    }),
    buildCheckInVariant({
      id: "check-in-5",
      title: "Check-in 5 (closing — no readiness gate)",
      scenario:
        "Final check-in after the closing chunk. Craving 4/10, trend 7 → 6 → 6 → 5. Full session history. Writing agent turn #1.",
      context: {
        chunkNumber: 5,
        cravingScore: 4,
        scoreHistory: [7, 6, 6, 5],
        obstacleHint: null,
        profile: EXAMPLE_PROFILE,
        intakeIntensity: 7,
        sessionHistory: [EXAMPLE_HISTORY_CHUNK1, EXAMPLE_HISTORY_CHECKIN1],
        demoMode: false,
      },
      agentTurnsInHistory: 0,
      firstPatientPlaceholder: PATIENT_SCORE_PLACEHOLDER,
      trailingPlaceholders: [SUBSEQUENT_TURNS_NOTE],
    }),
    buildCheckInVariant({
      id: "check-in-2-demo",
      title: "Check-in 2 — fast-demo mode",
      scenario:
        "Same as check-in 2–4 but demoMode: true. The endConversation tool is withheld and a compressed text-only turn sequence is injected. Used by the /demo surface.",
      context: {
        chunkNumber: 2,
        cravingScore: 6,
        scoreHistory: [7],
        obstacleHint: null,
        profile: EXAMPLE_PROFILE,
        intakeIntensity: 7,
        sessionHistory: [EXAMPLE_HISTORY_CHUNK1, EXAMPLE_HISTORY_CHECKIN1],
        demoMode: true,
      },
      agentTurnsInHistory: 0,
      firstPatientPlaceholder: PATIENT_SCORE_PLACEHOLDER,
      trailingPlaceholders: [SUBSEQUENT_TURNS_NOTE],
    }),
  ],
};

// ─────────────────────────────────────────────────────────────────────────
// Chunk narration: mirror of generateWllamaChunk()
// ─────────────────────────────────────────────────────────────────────────

function buildChunkVariant(
  chunkNumber: ChunkNumber,
  title: string,
  history: SessionHistoryEntry[],
  scenario: string,
): PromptVariant {
  const context: ChunkGenerationContextPayload = {
    chunkNumber,
    intakeIntensity: 7,
    profile: EXAMPLE_PROFILE,
    sessionHistory: history,
  };
  const prompt = buildChunkPrompt(context);
  return {
    id: `chunk-${chunkNumber}`,
    title,
    scenario,
    messages: [
      { role: "system", content: prompt.systemPrompt },
      { role: "user", content: prompt.userPrompt },
    ],
  };
}

const chunkFeature: PromptFeature = {
  id: "chunk",
  title: "Chunk narration",
  description:
    "History-aware meditation narration for each of the 5 chunks. The system prompt is WAVE_SYSTEM_PROMPT plus chunk-output rules; the user prompt carries the chunk brief, patient intake context, and the running session transcript.",
  responseFormat:
    'Strict JSON schema "WaveChunkLines" — { lines: string[6] } (temperature 0, top_k 1)',
  source:
    "lib/prompts/chunk-generator.ts, assembled in lib/gemma/wllama-generators.ts → generateWllamaChunk()",
  runtimeFilled: [
    "<patient_context>: intake craving, MAT type/status, trigger (enum-driven copy)",
    "<session_history>: every prior chunk + check-in (empty on chunk 1)",
  ],
  variants: [
    buildChunkVariant(
      1,
      "Chunk 1 — Settle in",
      [],
      "First chunk of the session. Empty session history (shows the no-history state).",
    ),
    buildChunkVariant(
      2,
      "Chunk 2 — Body scan",
      [EXAMPLE_HISTORY_CHUNK1, EXAMPLE_HISTORY_CHECKIN1],
      "After chunk 1 + check-in 1. History block populated with one prior chunk and check-in.",
    ),
    buildChunkVariant(
      3,
      "Chunk 3 — Sound anchor",
      [EXAMPLE_HISTORY_CHUNK1, EXAMPLE_HISTORY_CHECKIN1],
      "Same example history as chunk 2 — only the <chunk> brief differs.",
    ),
    buildChunkVariant(
      4,
      "Chunk 4 — Breath",
      [EXAMPLE_HISTORY_CHUNK1, EXAMPLE_HISTORY_CHECKIN1],
      "Same example history — only the <chunk> brief differs.",
    ),
    buildChunkVariant(
      5,
      "Chunk 5 — Close",
      [EXAMPLE_HISTORY_CHUNK1, EXAMPLE_HISTORY_CHECKIN1],
      "Closing chunk. Same example history — only the <chunk> brief differs.",
    ),
  ],
};

// ─────────────────────────────────────────────────────────────────────────
// Reflection: mirror of generateWllamaReflection()
// ─────────────────────────────────────────────────────────────────────────

function buildReflectionVariant(
  id: string,
  title: string,
  scenario: string,
  input: ReflectionContext,
): PromptVariant {
  const prompt = buildReflectionPrompt(input);
  return {
    id,
    title,
    scenario,
    messages: [
      { role: "system", content: prompt.systemPrompt },
      { role: "user", content: prompt.userPrompt },
    ],
  };
}

const BASE_REFLECTION: ReflectionContext = {
  intakeIntensity: 7,
  matType: "buprenorphine",
  medicationStatus: "on_time",
  trigger: "stress",
  usedSubstanceToday: false,
  bodyLocation: "chest",
  currentIntensity: 4,
  endingIntensity: 4,
  durationSeconds: 600,
};

const reflectionFeature: PromptFeature = {
  id: "reflection",
  title: "Post-session reflection card",
  description:
    "The single structured card written after check-in 5 (insight + journal prompt + four next-step chips). System prompt is a self-contained WAVE reflection role; the user prompt is the situation card.",
  responseFormat:
    'Strict JSON schema "WaveReflection" — { insight, journalPromptQuestion, nextSteps{one..four} } (temperature 0, top_k 1)',
  source:
    "lib/prompts/reflection.ts, assembled in lib/gemma/wllama-generators.ts → generateWllamaReflection()",
  runtimeFilled: [
    "<situation>: intake/ending intensity, session length, MAT, trigger, body region",
    "<drop_summary>: derived from intake vs ending intensity",
    "<safety_context>: present only when the patient said they used a substance today",
  ],
  variants: [
    buildReflectionVariant(
      "reflection-standard",
      "Standard close (intensity held at 4)",
      "Intake 7, ended 4, ~10 min, Suboxone on-time, stress trigger, chest. No substance use reported.",
      BASE_REFLECTION,
    ),
    buildReflectionVariant(
      "reflection-used",
      "With <safety_context> (used a substance today)",
      "Same as standard but usedSubstanceToday: true — the extra <safety_context> block appears.",
      { ...BASE_REFLECTION, usedSubstanceToday: true },
    ),
  ],
};

// ─────────────────────────────────────────────────────────────────────────
// Insights: mirror of generateWllamaInsights()
// ─────────────────────────────────────────────────────────────────────────

function buildInsightsFeature(): PromptFeature {
  const prompt = buildInsightsPrompt([...MOCK_SESSIONS]);
  return {
    id: "insights",
    title: "Cross-session insights cards",
    description:
      'The "What Wave noticed" cards on /insights. The model reasons over the patient\'s own session log. Not part of the fine-tune mix — runs as a generic chat prompt.',
    responseFormat:
      "JSON object mode — { insights: [{ tag, title, body }] } (temperature 0, top_k 1)",
    source:
      "lib/prompts/insights.ts, assembled in lib/gemma/wllama-generators.ts → generateWllamaInsights()",
    runtimeFilled: [
      "<session_log>: one plain-English line per session, computed from the patient's history",
      "<summary_numbers>: aggregates (avg drop, top trigger, densest time window, …)",
    ],
    variants: [
      {
        id: "insights-default",
        title: "Insights over the bundled MOCK_SESSIONS",
        scenario: `Rendered over the ${MOCK_SESSIONS.length}-session fixture the /insights page ships with. In production this is the patient's real local session history.`,
        messages: [
          { role: "system", content: prompt.systemPrompt },
          { role: "user", content: prompt.userPrompt },
        ],
      },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Voice-test (dev): mirror of generateVoiceTestReply() in voice-test.ts
// ─────────────────────────────────────────────────────────────────────────

const voiceTestFeature: PromptFeature = {
  id: "voice-test",
  title: "Voice-test mock check-in (dev only)",
  description:
    "Developer-only STT → Gemma → TTS loop at /models/voice-test. A self-contained mocked check-in system prompt followed by the live spoken transcript. Not used in the patient flow.",
  responseFormat: "Free text reply (temperature 0, top_k 1, max 220 tokens)",
  source:
    "lib/gemma/voice-test-prompt.ts → buildMockCheckInSystemPrompt(), assembled in lib/gemma/voice-test.ts → generateVoiceTestReply()",
  runtimeFilled: [
    "Spoken patient turns (STT) — appended as alternating user/assistant messages",
  ],
  variants: [
    {
      id: "voice-test-default",
      title: "Mock check-in 2 after body scan",
      scenario:
        "Fixed developer scenario (MOCK_VOICE_CHECK_IN_SESSION). The opener is in the system context; the real assistant reply turns come from the model at runtime.",
      messages: [
        { role: "system", content: buildMockCheckInSystemPrompt() },
        {
          role: "user",
          placeholder: true,
          content:
            "«live STT transcript — the patient's spoken turns, alternating user/assistant, with any leading synthetic assistant opener dropped before the model sees it»",
        },
      ],
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────

export const PROMPT_REGISTRY: PromptFeature[] = [
  checkInFeature,
  chunkFeature,
  reflectionFeature,
  buildInsightsFeature(),
  voiceTestFeature,
];
