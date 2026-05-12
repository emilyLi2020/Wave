import { z } from "zod";

import type {
  BodyScanLocation,
  MatType,
  MedicationStatus,
  TriggerCategory,
} from "@/types/models";

/**
 * Prompt-boundary schemas for the mounted local Gemma surfaces:
 * reflection, insights, multi-turn check-ins, and chunk generation.
 * The old one-shot `med-ack`, `body-scan`, and `wave-*` contracts were
 * removed with the deleted API routes.
 */
export type JsonSchema = Record<string, unknown>;

export const reflectionPayloadSchema = z.object({
  insight: z.string().min(20).max(500),
  journalPromptQuestion: z.string().min(10).max(200),
  /** Shown only after "No ideas" — four tap options; patient still picks one. */
  nextSteps: z.object({
    one: z.string().min(3).max(80),
    two: z.string().min(3).max(80),
    three: z.string().min(3).max(80),
    four: z.string().min(3).max(80),
  }),
});

export type ReflectionPayload = z.infer<typeof reflectionPayloadSchema>;

export const reflectionJsonSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["insight", "journalPromptQuestion", "nextSteps"],
  properties: {
    insight: { type: "string", minLength: 20, maxLength: 500 },
    journalPromptQuestion: {
      type: "string",
      minLength: 10,
      maxLength: 200,
    },
    nextSteps: {
      type: "object",
      additionalProperties: false,
      required: ["one", "two", "three", "four"],
      properties: {
        one: { type: "string", minLength: 3, maxLength: 80 },
        two: { type: "string", minLength: 3, maxLength: 80 },
        three: { type: "string", minLength: 3, maxLength: 80 },
        four: { type: "string", minLength: 3, maxLength: 80 },
      },
    },
  },
};

/**
 * Reflection input shape passed from the session state machine into
 * local Gemma. Each field is a narrow union from `@/types/models`,
 * never free text.
 */
export interface ReflectionContext {
  intakeIntensity: number;
  matType: MatType;
  medicationStatus: MedicationStatus;
  trigger: TriggerCategory;
  usedSubstanceToday: boolean;
  bodyLocation: BodyScanLocation;
  currentIntensity: number;
  endingIntensity: number;
  durationSeconds: number;
}

const reflectionContextSchema = z.object({
  intakeIntensity: z.number().int().min(1).max(10),
  matType: z.enum([
    "buprenorphine",
    "naltrexone",
    "methadone",
    "vivitrol",
    "none",
  ]),
  medicationStatus: z.enum(["on_time", "late", "missed", "none"]),
  trigger: z.enum(["social", "stress", "physical", "unknown_or_other"]),
  usedSubstanceToday: z.boolean(),
  bodyLocation: z.enum([
    "chest",
    "jaw",
    "shoulders",
    "legs",
    "stomach",
    "other",
  ]),
  currentIntensity: z.number().int().min(1).max(10),
  endingIntensity: z.number().int().min(1).max(10),
  durationSeconds: z.number().int().min(0).max(60 * 60),
});

/**
 * Insights regeneration — distinct from the narration phases above.
 * The /insights page renders four static "Gemma-on-device" cards by
 * default and lets the patient regenerate fresh cards locally by
 * reasoning over their session history.
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
 * imported) so prompt-boundary validation does not couple directly to
 * the UI types module.
 */
const sessionSchema = z.object({
  id: z.string().min(1).max(64),
  startedAt: z.string().min(10).max(40),
  endedAt: z.string().min(10).max(40).optional(),
  intakeIntensity: z.number().int().min(1).max(10),
  endingIntensity: z.number().int().min(1).max(10).optional(),
  medicationStatus: z.enum(["on_time", "late", "missed", "none"]),
  trigger: z.enum(["social", "stress", "physical", "unknown_or_other"]),
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
 * Multi-turn check-in chat — request shape for the local Gemma boundary.
 *
 * The check-in is a conversation: the model is called once per agent
 * turn and gets the full alternating chat history. The system prompt is
 * the canonical `WAVE_SYSTEM_PROMPT` from
 * `client/lib/prompts/wave-system.ts`; per-turn framing is built by
 * `buildCheckInPrompt()` in `client/lib/prompts/check-in.ts`.
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
  trigger: z.enum(["social", "stress", "physical", "unknown_or_other"]),
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
 * Chunk generation — request + response shapes.
 *
 * History-aware chunk generation. The live session asks local Gemma for
 * these lines first, then falls back to clinician-reviewed scripted
 * chunks from `fallback-bank.ts` after two failed attempts.
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
