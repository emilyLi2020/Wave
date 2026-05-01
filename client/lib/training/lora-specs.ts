/**
 * Specialized training-data form specs for the dev-only /training UI.
 *
 * The browser demo ships one multitask adapter (`lora-wave-session`) merged
 * into the Gemma ONNX artifact because browser LoRA hot-swapping is not mature
 * enough yet. These specialized sample sets are still collected separately so
 * clinicians can review each surface in isolation and so future runtimes can
 * train dedicated adapters when adapter swapping is production-ready.
 */

import { z } from "zod";

import {
  LORA_IDS,
  MAT_TYPES,
  MEDICATION_STATUSES,
  TRIGGER_CATEGORIES,
  type FieldSpec,
  type LoRAId,
  type LoraFormSpec,
} from "./types";

const SPECIALIZED_TARGET_COUNT = 20;

const OBSTACLE_CATEGORIES = [
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

const SCORE_TRENDS = [
  "not_started",
  "rising",
  "flat",
  "falling",
  "mixed",
] as const;

const STACK_AXES_BY_STATUS_AND_TRIGGER = {
  rowKey: "medicationStatus",
  rowLabel: "Med status",
  rowOptions: MEDICATION_STATUSES,
  colKey: "trigger",
  colLabel: "Trigger",
  colOptions: TRIGGER_CATEGORIES,
} as const;

const CHUNK_LINE_COUNT = 6;
const CHUNK_LINE_MIN_LENGTH = 12;
const CHUNK_LINE_MAX_LENGTH = 200;

const COMMON_SESSION_CONTEXT_FIELDS = [
  {
    key: "intakeIntensity",
    kind: "number",
    label: "Intake craving intensity (1-10)",
    min: 1,
    max: 10,
    integer: true,
    placeholder: "Example: 7",
    help: "What the patient tapped before the session started.",
  },
  {
    key: "matType",
    kind: "enum",
    label: "Medication for SUD",
    options: MAT_TYPES,
    optionLabels: {
      buprenorphine: "Buprenorphine (generic)",
      naltrexone: "Naltrexone (oral)",
      methadone: "Methadone",
      vivitrol: "Vivitrol (extended-release naltrexone)",
      none: "Not on MAT",
    },
  },
  {
    key: "medicationStatus",
    kind: "enum",
    label: "Medication status",
    options: MEDICATION_STATUSES,
    optionLabels: {
      on_time: "Took on time",
      late: "Took late",
      missed: "Missed dose",
      none: "Not on MAT",
    },
  },
  {
    key: "trigger",
    kind: "enum",
    label: "Trigger category",
    options: TRIGGER_CATEGORIES,
  },
  {
    key: "triggerOther",
    kind: "text",
    label: "Trigger detail, if other",
    maxLength: 120,
    optional: true,
    placeholder: "Example: argument with roommate",
  },
  {
    key: "usedSubstanceToday",
    kind: "boolean",
    label: "usedSubstanceToday flag",
    help: "True only when the intake safety screen recorded Q1=yes and Q2=no.",
  },
] as const;

const commonSessionContextSchema = z.object({
  intakeIntensity: z.number().int().min(1).max(10),
  matType: z.enum(MAT_TYPES),
  medicationStatus: z.enum(MEDICATION_STATUSES),
  trigger: z.enum(TRIGGER_CATEGORIES),
  triggerOther: z.string().max(120).optional(),
  usedSubstanceToday: z.boolean(),
});

function chunkNumberSchema() {
  return z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
  ]);
}

function phaseInputFields(): readonly FieldSpec[] {
  return [
    {
      key: "surface",
      kind: "const",
      label: "Surface",
      value: "phase_narration",
    },
    {
      key: "chunkNumber",
      kind: "number",
      label: "Phase number",
      min: 1,
      max: 5,
      integer: true,
      placeholder: "Example: 2",
      help: "Which of the five meditation phases this narration is for.",
    },
    ...COMMON_SESSION_CONTEXT_FIELDS,
    {
      key: "latestCravingScore",
      kind: "number",
      label: "Latest craving score (1-10)",
      min: 1,
      max: 10,
      integer: true,
      optional: true,
      placeholder: "Example: 6",
      help: "Most recent check-in score if this phase follows a check-in.",
    },
    {
      key: "obstacleHint",
      kind: "enum",
      label: "Obstacle from prior check-in",
      options: OBSTACLE_CATEGORIES,
      optional: true,
      help: "Optional summary of what got in the way before this phase.",
    },
    {
      key: "scoreHistorySummary",
      kind: "text",
      label: "Score history summary",
      multiline: true,
      maxLength: 500,
      optional: true,
      placeholder: "Example: intake 8, check-in 1 held at 8, check-in 2 dropped to 6.",
      help: "Example: intake 8, check-in 1 held at 8, check-in 2 dropped to 6.",
    },
    {
      key: "priorSessionSummary",
      kind: "text",
      label: "Prior session summary",
      multiline: true,
      maxLength: 1200,
      optional: true,
      placeholder:
        "Example: Phase 1 introduced the wave metaphor. Patient said the urge felt tight in their chest and rated it 7/10.",
      help: "Briefly summarize prior narration and patient check-in replies. Do not paste real patient data.",
    },
  ];
}

const phaseInputSchema = commonSessionContextSchema.extend({
  surface: z.literal("phase_narration"),
  chunkNumber: chunkNumberSchema(),
  latestCravingScore: z.number().int().min(1).max(10).optional(),
  obstacleHint: z.enum(OBSTACLE_CATEGORIES).optional(),
  scoreHistorySummary: z.string().max(500).optional(),
  priorSessionSummary: z.string().max(1200).optional(),
});

const phaseOutputFields = [
  {
    key: "lines",
    kind: "text-array",
    label: "Six narration lines",
    itemLabel: "Line",
    minItems: CHUNK_LINE_COUNT,
    maxItems: CHUNK_LINE_COUNT,
    minLength: CHUNK_LINE_MIN_LENGTH,
    maxLength: CHUNK_LINE_MAX_LENGTH,
    placeholder:
      "Example: Notice where the urge is strongest right now, without trying to change it.",
    help: "Exactly six plain-text beats. The player inserts pauses between lines, so do not write pause markers.",
  },
] as const;

const phaseOutputSchema = z
  .object({
    lines: z
      .array(
        z.string().min(CHUNK_LINE_MIN_LENGTH).max(CHUNK_LINE_MAX_LENGTH),
      )
      .length(CHUNK_LINE_COUNT),
  })
  .superRefine((output, ctx) => {
    output.lines.forEach((line, index) => {
      if (/you got this|stay strong|don't give up/i.test(line)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["lines", index],
          message: "Avoid toxic-positivity phrases.",
        });
      }
      if (/[\[\]]|\(pause\)|\(breathe\)|stage direction/i.test(line)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["lines", index],
          message: "No brackets, pause markers, or stage directions.",
        });
      }
      if (/chunk\s+\d|phase\s+\d/i.test(line)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["lines", index],
          message: "Do not announce chunk or phase numbers to the patient.",
        });
      }
    });
  });

const phaseNarration: LoraFormSpec = {
  loraId: "lora-phase-narration",
  title: "lora-phase-narration - five-phase meditation narration",
  shortTitle: "Phase narration",
  whereUsed:
    "Future adapter for all five meditation phase narration surfaces. The chunkNumber input tells the model which phase to write.",
  clinicalRationale:
    "The five narration phases share one simple output shape: six plain-text beats that preserve the MBRP flow. Keeping them in one adapter gives the model enough variety without fragmenting a small seed set.",
  invariants: [
    `Output exactly ${CHUNK_LINE_COUNT} lines in the lines array.`,
    "Each line is one plain-text narration beat, with no bullets, numbering, markdown, or pause markers.",
    "Use chunkNumber to preserve the phase order: settle, body scan, sound anchor, breathing, close.",
    "Do not announce chunk or phase numbers in patient-facing text.",
    "Never prescribe, never shame, never use toxic positivity, and never offer crisis routing.",
  ],
  targetCount: SPECIALIZED_TARGET_COUNT,
  isStretch: false,
  inputFields: phaseInputFields(),
  outputFields: phaseOutputFields,
  inputSchema: phaseInputSchema,
  outputSchema: phaseOutputSchema,
  stackAxes: STACK_AXES_BY_STATUS_AND_TRIGGER,
};

function checkInInputFields(
  chunkNumber: 1 | 2 | 3 | 4 | 5,
): readonly FieldSpec[] {
  return [
    { key: "surface", kind: "const", label: "Surface", value: "check_in" },
    {
      key: "chunkNumber",
      kind: "const",
      label: "Check-in number",
      value: chunkNumber,
    },
    ...COMMON_SESSION_CONTEXT_FIELDS,
    {
      key: "currentIntensity",
      kind: "number",
      label: "Current intensity (1-10)",
      min: 1,
      max: 10,
      integer: true,
      optional: true,
      placeholder: "Example: 6",
      help: "Most recent score if the patient has already answered the score prompt.",
    },
    {
      key: "scoreTrend",
      kind: "enum",
      label: "Score trend so far",
      options: SCORE_TRENDS,
    },
    {
      key: "priorChunkSummary",
      kind: "text",
      label: "Prior chunk summary",
      multiline: true,
      minLength: 8,
      maxLength: 500,
      placeholder:
        "Example: The previous chunk invited a body scan and asked the patient to notice where the urge felt strongest.",
      help: "Briefly summarize the scripted chunk or generated lines the patient just heard.",
    },
    {
      key: "priorTranscript",
      kind: "text",
      label: "Prior check-in transcript",
      multiline: true,
      maxLength: 1200,
      optional: true,
      placeholder:
        "Example: patient: 7. WAVE: A 7 is a lot to sit with. Where do you feel it most? patient: chest.",
      help: "Use role labels if helpful. Leave blank for check-in 1 openers.",
    },
  ];
}

const checkInInputSchema = commonSessionContextSchema.extend({
  surface: z.literal("check_in"),
  chunkNumber: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
  ]),
  currentIntensity: z.number().int().min(1).max(10).optional(),
  scoreTrend: z.enum(SCORE_TRENDS),
  priorChunkSummary: z.string().min(8).max(500),
  priorTranscript: z.string().max(1200).optional(),
});

const checkInOutputFields = [
  {
    key: "reply",
    kind: "text",
    label: "Patient-facing reply",
    multiline: true,
    minLength: 12,
    maxLength: 600,
    placeholder:
      "Example: A 7 is a lot to sit with, and you are still staying with it. What did you notice in your body during that last part?",
    help: "One WAVE turn only: validate, ask one question or offer one technique, then stop.",
  },
  {
    key: "endConversation",
    kind: "object",
    label: "End-conversation signal",
    help: "Use action=continue unless this turn should advance to the next session phase.",
    fields: [
      {
        key: "action",
        kind: "enum",
        label: "Action",
        options: ["continue", "end"],
      },
      {
        key: "cravingScore",
        kind: "number",
        label: "Ending craving score",
        min: 1,
        max: 10,
        integer: true,
        optional: true,
      },
      {
        key: "obstacleCategory",
        kind: "enum",
        label: "Obstacle category",
        options: OBSTACLE_CATEGORIES,
        optional: true,
      },
    ],
  },
] as const;

const checkInOutputSchema = z
  .object({
    reply: z.string().min(12).max(600),
    endConversation: z
      .object({
        action: z.enum(["continue", "end"]),
        cravingScore: z.number().int().min(1).max(10).optional(),
        obstacleCategory: z.enum(OBSTACLE_CATEGORIES).optional(),
      })
      .superRefine((value, ctx) => {
        if (value.action === "end" && value.cravingScore === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["cravingScore"],
            message: "cravingScore is required when action=end",
          });
        }
      }),
  })
  .superRefine((output, ctx) => {
    const toxic = /you got this|stay strong|don't give up/i.test(output.reply);
    if (toxic) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reply"],
        message: "Avoid toxic-positivity phrases.",
      });
    }
  });

function checkInSpec(
  loraId: LoRAId,
  chunkNumber: 1 | 2 | 3 | 4 | 5,
  shortTitle: string,
  focus: string,
  extraInvariant: string,
): LoraFormSpec {
  return {
    loraId,
    title: `${loraId} - check-in ${chunkNumber}`,
    shortTitle,
    whereUsed:
      chunkNumber === 5
        ? "Future specialized adapter for the closing check-in before reflection."
        : `Future specialized adapter for the check-in after chunk ${chunkNumber}.`,
    clinicalRationale: `${focus} This specialized adapter is collected for evaluation and future native/mobile hot-swapping. For the browser demo, its 20 reviewed examples are folded into the combined lora-wave-session fine-tune.`,
    invariants: [
      "Score first when the patient has not given a current score.",
      "One open-ended question or one technique per turn, never both.",
      "Validate before offering a technique when the patient reports an obstacle.",
      "Never shame, never use toxic positivity, and never give medication directives.",
      extraInvariant,
    ],
    targetCount: SPECIALIZED_TARGET_COUNT,
    isStretch: false,
    inputFields: checkInInputFields(chunkNumber),
    outputFields: checkInOutputFields,
    inputSchema: checkInInputSchema.refine(
      (input) => input.chunkNumber === chunkNumber,
      {
        path: ["chunkNumber"],
        message: `chunkNumber must be ${chunkNumber}`,
      },
    ),
    outputSchema: checkInOutputSchema,
    stackAxes: STACK_AXES_BY_STATUS_AND_TRIGGER,
  };
}

const reflectionInputSchema = z.object({
  surface: z.literal("reflection"),
  intakeIntensity: z.number().int().min(1).max(10),
  endingIntensity: z.number().int().min(1).max(10),
  durationSeconds: z.number().int().min(30).max(60 * 60),
  medicationStatus: z.enum(MEDICATION_STATUSES),
  matType: z.enum(MAT_TYPES),
  trigger: z.enum(TRIGGER_CATEGORIES),
  sessionsCount: z.number().int().min(1).max(10000),
  usedSubstanceToday: z.boolean(),
  scoreHistorySummary: z.string().max(500).optional(),
});

const reflection: LoraFormSpec = {
  loraId: "lora-reflection",
  title: "lora-reflection - post-session reflection",
  shortTitle: "Reflection",
  whereUsed:
    "Future specialized adapter for the post-session reflection card. Its rows also train lora-wave-session for the browser demo.",
  clinicalRationale:
    "Reflection sees the full session arc, ending score, and usedSubstanceToday flag. We keep its seed set separate for clinical review, then fold the same rows into the multitask demo LoRA.",
  invariants: [
    "insight MUST contain the numeric endingIntensity.",
    "When usedSubstanceToday is true: never shame, never imply failure, never frame the decision to use as a relapse event.",
    "Next steps are concrete, low-burden, and non-prescriptive.",
    "Never tell the patient to start, stop, or change medication.",
  ],
  targetCount: SPECIALIZED_TARGET_COUNT,
  isStretch: false,
  inputFields: [
    { key: "surface", kind: "const", label: "Surface", value: "reflection" },
    {
      key: "intakeIntensity",
      kind: "number",
      label: "Intake intensity (1-10)",
      min: 1,
      max: 10,
      integer: true,
      placeholder: "Example: 7",
    },
    {
      key: "endingIntensity",
      kind: "number",
      label: "Ending intensity (1-10)",
      min: 1,
      max: 10,
      integer: true,
      placeholder: "Example: 2",
    },
    {
      key: "durationSeconds",
      kind: "number",
      label: "Session duration (seconds)",
      min: 30,
      max: 60 * 60,
      integer: true,
      placeholder: "Example: 420",
    },
    {
      key: "medicationStatus",
      kind: "enum",
      label: "Medication status",
      options: MEDICATION_STATUSES,
    },
    {
      key: "matType",
      kind: "enum",
      label: "MAT type",
      options: MAT_TYPES,
    },
    {
      key: "trigger",
      kind: "enum",
      label: "Trigger category",
      options: TRIGGER_CATEGORIES,
    },
    {
      key: "sessionsCount",
      kind: "number",
      label: "Total sessions to date",
      min: 1,
      max: 10000,
      integer: true,
      placeholder: "Example: 4",
      help: "Used for longitudinal framing in the insight line.",
    },
    {
      key: "usedSubstanceToday",
      kind: "boolean",
      label: "usedSubstanceToday flag",
      help: "Captured at the intake safety screen. True means the patient said yes to Q1 but cleared Q2.",
    },
    {
      key: "scoreHistorySummary",
      kind: "text",
      label: "Score history summary",
      multiline: true,
      maxLength: 500,
      optional: true,
      placeholder: "Example: intake 7, check-in scores 6, 5, 3, ending 2.",
    },
  ],
  outputFields: [
    {
      key: "insight",
      kind: "text",
      label: "Insight one-liner",
      multiline: true,
      minLength: 10,
      maxLength: 500,
      placeholder:
        "Example: You surfed a 7 down to a 2. That drop does not mean the urge was easy; it means you stayed close enough to notice it changing.",
      help: "Must include the numeric ending intensity, e.g. \"You surfed a 7 down to 2.\"",
    },
    {
      key: "journalPromptQuestion",
      kind: "text",
      label: "Journal prompt question",
      multiline: true,
      minLength: 10,
      maxLength: 200,
      placeholder:
        "Example: What helped you stay with the wave when it started to shift?",
    },
    {
      key: "nextSteps",
      kind: "object",
      label: "Four next-step chips",
      fields: [
        {
          key: "one",
          kind: "text",
          label: "Next step 1",
          minLength: 3,
          maxLength: 80,
          placeholder: "Example: Drink water",
        },
        {
          key: "two",
          kind: "text",
          label: "Next step 2",
          minLength: 3,
          maxLength: 80,
          placeholder: "Example: Walk one block",
        },
        {
          key: "three",
          kind: "text",
          label: "Next step 3",
          minLength: 3,
          maxLength: 80,
          placeholder: "Example: Text a safe person",
        },
        {
          key: "four",
          kind: "text",
          label: "Next step 4",
          minLength: 3,
          maxLength: 80,
          placeholder: "Example: Rest for 10 min",
        },
      ],
    },
  ],
  inputSchema: reflectionInputSchema,
  outputSchema: z
    .object({
      insight: z.string().min(10).max(500),
      journalPromptQuestion: z.string().min(10).max(200),
      nextSteps: z.object({
        one: z.string().min(3).max(80),
        two: z.string().min(3).max(80),
        three: z.string().min(3).max(80),
        four: z.string().min(3).max(80),
      }),
    })
    .superRefine((output, ctx) => {
      if (!/\d/.test(output.insight)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["insight"],
          message:
            "Must contain the numeric ending intensity (e.g. \"down to 2\"). The eval harness will fail this row otherwise.",
        });
      }
    }),
  stackAxes: STACK_AXES_BY_STATUS_AND_TRIGGER,
};

export const LORA_SPECS: Record<LoRAId, LoraFormSpec> = {
  "lora-phase-narration": phaseNarration,
  "lora-check-in-1": checkInSpec(
    "lora-check-in-1",
    1,
    "Check-in 1",
    "Focus: baseline score, current body/emotional state, and medication-aware validation.",
    "Check-in 1 should orient the patient gently and must not assume the urge has shifted yet.",
  ),
  "lora-check-in-2": checkInSpec(
    "lora-check-in-2",
    2,
    "Check-in 2",
    "Focus: body-scan obstacles and somatic noticing after the first guided chunk.",
    "If the patient reports body discomfort, validate sensation before naming any grounding technique.",
  ),
  "lora-check-in-3": checkInSpec(
    "lora-check-in-3",
    3,
    "Check-in 3",
    "Focus: sound or visualization anchor obstacles and mind-wandering.",
    "If visualization failed, offer a non-visual anchor instead of asking the patient to try harder.",
  ),
  "lora-check-in-4": checkInSpec(
    "lora-check-in-4",
    4,
    "Check-in 4",
    "Focus: breathing obstacles, chest tightness, and breath-induced anxiety.",
    "Never push deeper breathing when the patient reports breath anxiety or chest tightness.",
  ),
  "lora-check-in-5": checkInSpec(
    "lora-check-in-5",
    5,
    "Check-in 5",
    "Focus: closing score, full-arc reflection, and carry-forward question.",
    "Check-in 5 must close the conversation and must not ask whether the patient is ready for another chunk.",
  ),
  "lora-reflection": reflection,
};

export const LORA_SPEC_LIST: readonly LoraFormSpec[] = LORA_IDS.map(
  (id) => LORA_SPECS[id],
);

export function getSpec(loraId: LoRAId): LoraFormSpec {
  return LORA_SPECS[loraId];
}

export function isLoraId(value: string): value is LoRAId {
  return (LORA_IDS as readonly string[]).includes(value);
}
