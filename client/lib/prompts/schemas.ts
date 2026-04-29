import { z } from "zod";

import type {
  BodyScanLocation,
  MatType,
  MedicationStatus,
  TriggerCategory,
} from "@/types/models";

/**
 * Narration phases come in two flavors:
 *
 * - JSON phases: the LLM must return strict structured JSON. We render the
 *   typed payload (med-ack uses `acknowledgment` + `citationKey`,
 *   reflection uses `insight` + `nextSteps[4]`).
 * - Text phases: the LLM streams plain narration. There is no JSON
 *   contract; the body-scan and wave phases just stream text into the UI.
 *   Encouragement on the wave phases is sampled from a client-side bank
 *   in `client/lib/prompts/encouragement-bank.ts`, never produced by the
 *   model.
 *
 * The intake safety screen is intentionally absent from both lists: it is
 * rule-based and never touches an LLM (PRD.md > Domain Constraints >
 * Crisis handoff).
 *
 * Legacy-shape phases
 * -------------------
 * `med-ack`, `body-scan`, `wave-rise`, `wave-peak`, and `wave-fall` are
 * the legacy one-shot phase contracts replaced by the five-chunk
 * session in PRD § Session Structure. They are kept here only so the
 * `reflection` phase keeps validating against the same `WaveContext`
 * type and so the Synthetix LoRA scaffolding under `client/synthetix/`
 * keeps compiling. The new session path consumes none of them — see
 * `client/lib/prompts/check-in.ts`, `wave-system.ts`, and the chunk
 * scripts in `session-script.ts` instead. Slated for removal in the
 * post-rewrite cleanup PR.
 *
 * @deprecated The `med-ack`, `body-scan`, and three `wave-*` entries
 * are no longer mounted by the session shell. Only `reflection`
 * remains live.
 */
export const JSON_NARRATION_PHASES = ["med-ack", "reflection"] as const;
/**
 * @deprecated The body-scan and wave-rise/peak/fall phases were
 * replaced by the five-chunk session script and the multi-turn
 * check-in chat. Kept temporarily so `synthetix/` scaffolding compiles.
 */
export const TEXT_NARRATION_PHASES = [
  "body-scan",
  "wave-rise",
  "wave-peak",
  "wave-fall",
] as const;

export type JSONNarrationPhase = (typeof JSON_NARRATION_PHASES)[number];
export type TextNarrationPhase = (typeof TEXT_NARRATION_PHASES)[number];

export const NARRATION_PHASES = [
  ...JSON_NARRATION_PHASES,
  ...TEXT_NARRATION_PHASES,
] as const;

export type NarrationPhase = JSONNarrationPhase | TextNarrationPhase;

/**
 * Citation keys point at the clinical source justifying a piece of copy.
 * Every shipped narration string must trace back to one of these.
 */
export const CITATION_KEYS = [
  "FDA:Suboxone",
  "FDA:Vivitrol",
  "FDA:Methadone",
  "FDA:Naltrexone",
  "SAMHSA:MAT-TIP63",
  "MBRP",
] as const;

export type CitationKey = (typeof CITATION_KEYS)[number];

const ackSchema = z.object({
  acknowledgment: z.string().min(20).max(500),
  citationKey: z.enum(CITATION_KEYS),
});

const reflectionSchema = z.object({
  insight: z.string().min(20).max(500),
  nextSteps: z.array(z.string().min(2).max(60)).length(4),
});

export type AckPayload = z.infer<typeof ackSchema>;
export type ReflectionPayload = z.infer<typeof reflectionSchema>;

/**
 * JSON Schema literals are hand-written next to their Zod twin because
 * OpenAI's structured outputs require strict, closed schemas
 * (additionalProperties: false, every property required).
 */
type JsonSchema = Record<string, unknown>;

const ackJsonSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["acknowledgment", "citationKey"],
  properties: {
    acknowledgment: { type: "string", minLength: 20, maxLength: 500 },
    citationKey: { type: "string", enum: CITATION_KEYS as readonly string[] },
  },
};

const reflectionJsonSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["insight", "nextSteps"],
  properties: {
    insight: { type: "string", minLength: 20, maxLength: 500 },
    nextSteps: {
      type: "array",
      minItems: 4,
      maxItems: 4,
      items: { type: "string", minLength: 2, maxLength: 60 },
    },
  },
};

export interface PhaseSchemaSpec<T> {
  zod: z.ZodType<T>;
  jsonSchemaName: string;
  jsonSchema: JsonSchema;
}

/**
 * Single-line JSON shape echo per JSON phase, used inside the user turn
 * so the model has an explicit format anchor in the prompt itself. The
 * route handler also passes `text.format: { type: "json_schema", strict }`
 * to the Responses API; the echo is additive and matches that schema.
 * Gemma 4 E2B-it (on-device, post-swap) has no native structured-output
 * mode and relies on this echo to produce conforming JSON.
 */
const CITATION_UNION = CITATION_KEYS.join(" | ");

const OUTPUT_CONTRACTS: Record<JSONNarrationPhase, string> = {
  "med-ack": `{"acknowledgment": "<string, 20-500 chars>", "citationKey": "<one of: ${CITATION_UNION}>"}`,
  reflection: `{"insight": "<string, 20-500 chars>", "nextSteps": ["<chip, 2-60 chars>", "<chip>", "<chip>", "<chip>"]}`,
};

export function outputContractFor(phase: JSONNarrationPhase): string {
  return OUTPUT_CONTRACTS[phase];
}

export const PHASE_SCHEMAS = {
  "med-ack": {
    zod: ackSchema,
    jsonSchemaName: "MedicationAcknowledgment",
    jsonSchema: ackJsonSchema,
  } satisfies PhaseSchemaSpec<AckPayload>,
  reflection: {
    zod: reflectionSchema,
    jsonSchemaName: "ReflectionInsight",
    jsonSchema: reflectionJsonSchema,
  } satisfies PhaseSchemaSpec<ReflectionPayload>,
} as const;

export type PhasePayloadMap = {
  "med-ack": AckPayload;
  reflection: ReflectionPayload;
};

/**
 * The per-phase input shape passed from the client into the LLM
 * boundary functions and forwarded to the route handlers. Each field is
 * a narrow union from `@/types/models`, never free-text.
 */
export interface IntakeContext {
  intakeIntensity: number;
  matType: MatType;
  medicationStatus: MedicationStatus;
  trigger: TriggerCategory;
  /** True when the patient said yes at intake safety Q1; default false. */
  usedSubstanceToday: boolean;
}

export interface BodyScanContext extends IntakeContext {
  bodyLocation: BodyScanLocation;
}

export interface WaveContext extends BodyScanContext {
  /** Patient's most recent slider reading (1-10). */
  currentIntensity: number;
}

export interface ReflectionContext extends WaveContext {
  endingIntensity: number;
  /** Total session length in seconds, used to color the closing insight. */
  durationSeconds: number;
}

export type PhaseInputMap = {
  "med-ack": IntakeContext;
  "body-scan": BodyScanContext;
  "wave-rise": WaveContext;
  "wave-peak": WaveContext;
  "wave-fall": WaveContext;
  reflection: ReflectionContext;
};

const intakeContextSchema = z.object({
  intakeIntensity: z.number().int().min(1).max(10),
  matType: z.enum([
    "buprenorphine",
    "naltrexone",
    "methadone",
    "vivitrol",
    "none",
  ]),
  medicationStatus: z.enum(["on_time", "late", "missed", "none"]),
  trigger: z.enum(["social", "stress", "physical", "unknown", "other"]),
  usedSubstanceToday: z.boolean(),
});

const bodyScanContextSchema = intakeContextSchema.extend({
  bodyLocation: z.enum([
    "chest",
    "jaw",
    "shoulders",
    "legs",
    "stomach",
    "other",
  ]),
});

const waveContextSchema = bodyScanContextSchema.extend({
  currentIntensity: z.number().int().min(1).max(10),
});

const reflectionContextSchema = waveContextSchema.extend({
  endingIntensity: z.number().int().min(1).max(10),
  durationSeconds: z.number().int().min(0).max(60 * 60),
});

export const PHASE_INPUT_SCHEMAS: {
  [P in NarrationPhase]: z.ZodType<PhaseInputMap[P]>;
} = {
  "med-ack": intakeContextSchema,
  "body-scan": bodyScanContextSchema,
  "wave-rise": waveContextSchema,
  "wave-peak": waveContextSchema,
  "wave-fall": waveContextSchema,
  reflection: reflectionContextSchema,
};

/**
 * The JSON narrate route only accepts the two JSON phases.
 */
export const narrateRequestSchema = z.discriminatedUnion("phase", [
  z.object({ phase: z.literal("med-ack"), input: intakeContextSchema }),
  z.object({ phase: z.literal("reflection"), input: reflectionContextSchema }),
]);

export type NarrateRequest = z.infer<typeof narrateRequestSchema>;

/**
 * The streaming narrate route only accepts the four text phases.
 */
export const narrateStreamRequestSchema = z.discriminatedUnion("phase", [
  z.object({ phase: z.literal("body-scan"), input: bodyScanContextSchema }),
  z.object({ phase: z.literal("wave-rise"), input: waveContextSchema }),
  z.object({ phase: z.literal("wave-peak"), input: waveContextSchema }),
  z.object({ phase: z.literal("wave-fall"), input: waveContextSchema }),
]);

export type NarrateStreamRequest = z.infer<typeof narrateStreamRequestSchema>;

/**
 * Insights regeneration — distinct from the narration phases above.
 * The /insights page renders four static "Gemma-on-device" cards by
 * default and lets the patient regenerate fresh cards by reasoning
 * over their session history server-side via gpt-5-mini.
 */

const insightCardSchema = z.object({
  tag: z.string().min(3).max(30),
  title: z.string().min(10).max(120),
  body: z.string().min(40).max(400),
});

export const insightsPayloadSchema = z.object({
  insights: z.array(insightCardSchema).min(3).max(5),
});

export type InsightCardPayload = z.infer<typeof insightCardSchema>;
export type InsightsPayload = z.infer<typeof insightsPayloadSchema>;

const insightCardJsonSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["tag", "title", "body"],
  properties: {
    tag: { type: "string", minLength: 3, maxLength: 30 },
    title: { type: "string", minLength: 10, maxLength: 120 },
    body: { type: "string", minLength: 40, maxLength: 400 },
  },
};

export const insightsJsonSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["insights"],
  properties: {
    insights: {
      type: "array",
      minItems: 3,
      maxItems: 5,
      items: insightCardJsonSchema,
    },
  },
};

export const INSIGHTS_JSON_SCHEMA_NAME = "WaveInsights";

/**
 * Zod mirror of `Session` from `@/types/models`. Kept here (instead of
 * imported) so the route handler can validate the inbound payload
 * without coupling the API surface to the UI types module.
 */
const sessionSchema = z.object({
  id: z.string().min(1).max(64),
  startedAt: z.string().min(10).max(40),
  endedAt: z.string().min(10).max(40).optional(),
  intakeIntensity: z.number().int().min(1).max(10),
  endingIntensity: z.number().int().min(1).max(10).optional(),
  medicationStatus: z.enum(["on_time", "late", "missed", "none"]),
  trigger: z.enum(["social", "stress", "physical", "unknown", "other"]),
  bodyScanLocation: z
    .enum(["chest", "jaw", "shoulders", "legs", "stomach", "other"])
    .optional(),
  outcome: z.enum(["completed", "left_early", "used", "safety_exited"]),
  usedSubstanceToday: z.boolean(),
  journal: z.string().max(2000).optional(),
});

export const insightsRequestSchema = z.object({
  sessions: z.array(sessionSchema).min(1).max(200),
});

export type InsightsRequest = z.infer<typeof insightsRequestSchema>;

/**
 * The streaming reflection route accepts only the reflection phase. It
 * is a sibling of `narrateRequestSchema` (which still serves the
 * blocking JSON path for med-ack) — reflection is split out because it
 * streams reasoning-summary titles for the in-progress UI before
 * delivering its final structured payload.
 */
export const narrateReflectionStreamRequestSchema = z.object({
  phase: z.literal("reflection"),
  input: reflectionContextSchema,
});

export type NarrateReflectionStreamRequest = z.infer<
  typeof narrateReflectionStreamRequestSchema
>;

/**
 * Multi-turn check-in chat — request shape for /api/checkin.
 *
 * Distinct from the legacy one-shot narrate routes above because the
 * check-in is a conversation: the route is called once per agent turn
 * and gets the full alternating chat history, NOT a single "phase" of
 * pre-rendered context. The system prompt is the canonical
 * `WAVE_SYSTEM_PROMPT` from `client/lib/prompts/wave-system.ts`; per-
 * turn framing is built by `buildCheckInPrompt()` in
 * `client/lib/prompts/check-in.ts`.
 *
 * The check-in agent has a single tool, `endConversation`, that the
 * model calls when it judges the check-in is complete (the patient is
 * ready to move into the next chunk, or, at Check-in 5, has shared
 * their closing reflection). The state machine treats that tool call
 * as the readiness gate — there is no regex-based affirmative match
 * any more.
 */
const obstacleCategorySchema = z.enum([
  "cannot_visualize",
  "mind_wandering",
  "urge_overwhelming",
  "breath_tight",
  "breath_anxiety",
  "gave_in",
  "guilt_failure",
  "physical_discomfort",
  "sleepiness",
]);

const checkInChatTurnSchema = z.object({
  role: z.enum(["agent", "patient"]),
  content: z.string().min(1).max(2000),
});

const sessionUserProfileSchema = z.object({
  matType: z.enum([
    "buprenorphine",
    "naltrexone",
    "methadone",
    "vivitrol",
    "none",
  ]),
  medicationStatus: z.enum(["on_time", "late", "missed", "none"]),
  trigger: z.enum(["social", "stress", "physical", "unknown", "other"]),
  triggerOther: z.string().max(120).nullable(),
  usedSubstanceToday: z.boolean(),
});

/**
 * One entry in the cross-chunk session history. Both the chunk
 * generator and the check-in chat take the full ordered list of these
 * so the LLM can ground every new line in everything the patient has
 * already heard / said this session.
 */
const sessionHistoryEntrySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("chunk"),
    chunkNumber: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
    ]),
    /** The lines the chunk player narrated, in display order. */
    lines: z.array(z.string().min(1).max(600)).min(1).max(20),
  }),
  z.object({
    kind: z.literal("checkIn"),
    chunkNumber: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
    ]),
    cravingScore: z.number().int().min(1).max(10),
    obstacleCategory: obstacleCategorySchema.nullable(),
    turns: z.array(checkInChatTurnSchema).max(40),
  }),
]);

export type SessionHistoryEntry = z.infer<typeof sessionHistoryEntrySchema>;

export const checkInContextSchema = z.object({
  chunkNumber: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
  ]),
  cravingScore: z.number().int().min(1).max(10),
  scoreHistory: z.array(z.number().int().min(1).max(10)).max(5),
  obstacleHint: obstacleCategorySchema.nullable(),
  profile: sessionUserProfileSchema,
  intakeIntensity: z.number().int().min(1).max(10),
  /** Every prior chunk + check-in this session, oldest first. */
  sessionHistory: z.array(sessionHistoryEntrySchema).max(20),
  /**
   * When true, the check-in is running in demo mode: the LLM should
   * wrap in a single patient free-text turn after the score (so the
   * conversation is score -> 1 agent validation -> 1 patient reply ->
   * endConversation). Clinical invariants (validate before technique,
   * no prescribing, no toxic positivity) still apply.
   */
  demoMode: z.boolean().default(false),
});

export type CheckInContextPayload = z.infer<typeof checkInContextSchema>;

export const checkInRequestSchema = z.object({
  history: z.array(checkInChatTurnSchema).max(40),
  context: checkInContextSchema,
});

export type CheckInRequest = z.infer<typeof checkInRequestSchema>;

/**
 * Chunk generation — request + response shapes for /api/chunk.
 *
 * Each chunk's narration is now LLM-generated rather than read from
 * the static `session-script.ts` bank. The generator receives the
 * patient profile + the full prior session history (every chunk's
 * lines + every check-in's transcript) so it can ground the next
 * chunk's copy in what the patient has already heard and said.
 *
 * Output is a fixed-length list of plain-text lines. The chunk player
 * wraps each line as a `text` segment and inserts a default-length
 * `pause` segment between consecutive lines — pause durations are a
 * client-side runtime concern, not part of the model contract.
 */
export const CHUNK_LINE_COUNT = 6;
const MIN_LINE_LENGTH = 12;
// Tight cap so the model can't pack multiple meditation beats into a
// single array element with a delimiter (e.g. ` / `, `; `, or CJK
// `」「`). One beat per element is part of the runtime contract — the
// chunk player drops a fixed pause between every element.
const MAX_LINE_LENGTH = 200;

export const chunkGenerationContextSchema = z.object({
  chunkNumber: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
  ]),
  intakeIntensity: z.number().int().min(1).max(10),
  profile: sessionUserProfileSchema,
  sessionHistory: z.array(sessionHistoryEntrySchema).max(20),
});

export type ChunkGenerationContextPayload = z.infer<
  typeof chunkGenerationContextSchema
>;

export const chunkGenerationRequestSchema = z.object({
  context: chunkGenerationContextSchema,
});

export type ChunkGenerationRequest = z.infer<
  typeof chunkGenerationRequestSchema
>;

export const chunkLinesSchema = z.object({
  lines: z
    .array(z.string().min(MIN_LINE_LENGTH).max(MAX_LINE_LENGTH))
    .length(CHUNK_LINE_COUNT),
});

export type ChunkLinesPayload = z.infer<typeof chunkLinesSchema>;

export const CHUNK_LINES_JSON_SCHEMA_NAME = "WaveChunkLines";

export const chunkLinesJsonSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["lines"],
  properties: {
    lines: {
      type: "array",
      minItems: CHUNK_LINE_COUNT,
      maxItems: CHUNK_LINE_COUNT,
      items: {
        type: "string",
        minLength: MIN_LINE_LENGTH,
        maxLength: MAX_LINE_LENGTH,
      },
    },
  },
};
