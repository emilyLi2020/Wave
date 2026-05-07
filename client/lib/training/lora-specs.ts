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
  CHECK_IN_BODY_URGE_LOCATION_OBSERVE_PROMPT,
  CHECK_IN_CHUNK2_LANDING_SECTION_PROMPT,
  CHECK_IN_CHUNK2_SCORE_PROMPT,
  CHECK_IN_COPING_BRIDGE_OPENER,
  CHECK_IN_COPING_CONSENT_PROMPT,
  CHECK_IN_CURRENT_URGE_SCALE_PROMPT,
} from "./check-in-dialogue";
import {
  LORA_IDS,
  MAT_TYPES,
  MEDICATION_STATUSES,
  STARTING_INTENSITY_BANDS,
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

/** Phase narration: two meditation tones by intake scale × five chunks. */
const STACK_AXES_PHASE_NARRATION = {
  rowKey: "chunkNumber",
  rowLabel: "Phase (chunk)",
  rowOptions: ["1", "2", "3", "4", "5"] as const,
  colKey: "startingIntensityBand",
  colLabel: "Starting craving (intake)",
  colOptions: STARTING_INTENSITY_BANDS,
} as const;

const PHASE_NARRATION_TARGET_COUNT = 10;

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
    optionLabels: {
      social: "Social situation",
      stress: "Stress / emotions",
      physical: "Physical sensation",
      unknown_or_other: "Don't know / other",
    },
  },
  {
    key: "triggerOther",
    kind: "text",
    label: "Trigger detail (optional, for Don't know / other)",
    maxLength: 120,
    optional: true,
    placeholder: "Example: argument with roommate",
    help: "Only when the patient chose the merged Don't know / other category and named more.",
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
      help: "Which of the five meditation phases this narration is for (settle, body scan, sound anchor, breathing, close).",
    },
    {
      key: "startingIntensityBand",
      kind: "enum",
      label: "Starting craving band (intake)",
      options: STARTING_INTENSITY_BANDS,
      optionLabels: {
        "7-10": "7-10 (higher urge at session start)",
        "1-6": "1-6 (milder urge at session start)",
      },
      help: "Stratifies the meditation script only. Medication, triggers, and obstacles belong in check-in seeds, not here.",
    },
    {
      key: "priorSessionSummary",
      kind: "text",
      label: "Prior session summary (optional)",
      multiline: true,
      maxLength: 1200,
      optional: true,
      placeholder:
        "Example: Patient completed chunk 1 narration; check-in 1 score unchanged.",
      help: "Optional continuity note. Do not paste real patient identifiers.",
    },
  ];
}

const phaseInputSchema = z.object({
  surface: z.literal("phase_narration"),
  chunkNumber: chunkNumberSchema(),
  startingIntensityBand: z.enum(STARTING_INTENSITY_BANDS),
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
    "Future adapter for all five meditation phase narration surfaces. chunkNumber picks the phase; startingIntensityBand picks how urgent the opening tone should feel from intake alone.",
  clinicalRationale:
    "Phase lines are a meditation script, not medication- or trigger-specific therapy. Check-in LoRAs carry the targeted clinical work. Collect two variants per chunk (intake 7-10 vs 1-6) so the model learns pacing without duplicating MAT/stratification here.",
  invariants: [
    `Output exactly ${CHUNK_LINE_COUNT} lines in the lines array.`,
    "Each line is one plain-text narration beat, with no bullets, numbering, markdown, or pause markers.",
    "Use chunkNumber to preserve the phase order: settle, body scan, sound anchor, breathing, close.",
    "Do not announce chunk or phase numbers in patient-facing text.",
    "Never prescribe, never shame, never use toxic positivity, and never offer crisis routing.",
  ],
  targetCount: PHASE_NARRATION_TARGET_COUNT,
  isStretch: false,
  inputFields: phaseInputFields(),
  outputFields: phaseOutputFields,
  inputSchema: phaseInputSchema,
  outputSchema: phaseOutputSchema,
  stackAxes: STACK_AXES_PHASE_NARRATION,
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

const checkInDialogueTurnSchema = z.object({
  role: z.enum(["patient", "agent"]),
  content: z.string().min(1).max(2000),
});

type CheckInDialoguePack = "one" | "two" | "generic";

const checkInOutputBaseSchema = z
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
    /** Full scripted check-in for training exports and clinician review. */
    dialogueTurns: z.array(checkInDialogueTurnSchema).max(24).optional(),
  });

function refineCheckInDialogueOutput(
  output: z.infer<typeof checkInOutputBaseSchema>,
  ctx: z.RefinementCtx,
  pack: CheckInDialoguePack,
): void {
  const toxic = /you got this|stay strong|don't give up/i;
  if (toxic.test(output.reply)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["reply"],
      message: "Avoid toxic-positivity phrases.",
    });
  }
  const turns = output.dialogueTurns;
  if (!turns || turns.length === 0) return;

  for (let index = 0; index < turns.length; index += 1) {
    const line = turns[index];
    if (line.role === "agent" && toxic.test(line.content)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dialogueTurns", index, "content"],
        message: "Avoid toxic-positivity phrases.",
      });
    }
  }

  const minTurns = pack === "generic" ? 2 : 3;
  if (turns.length < minTurns) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["dialogueTurns"],
      message:
        pack === "generic"
          ? "Include at least two lines (one WAVE prompt and one patient reply), or a fuller transcript."
          : "Include at least the score question, the patient’s number, and one follow-up WAVE turn.",
    });
  }

  if (turns[0]?.role !== "agent") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["dialogueTurns", 0, "role"],
      message: "First dialogue line should be WAVE (agent).",
    });
  } else if (pack === "one") {
    const normalized = turns[0].content.replace(/\s+/g, " ").trim();
    const expected = CHECK_IN_CURRENT_URGE_SCALE_PROMPT.replace(/\s+/g, " ").trim();
    if (normalized !== expected) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dialogueTurns", 0, "content"],
        message: `First WAVE line should be exactly: ${CHECK_IN_CURRENT_URGE_SCALE_PROMPT}`,
      });
    }
  } else if (pack === "two") {
    const normalized = turns[0].content.replace(/\s+/g, " ").trim();
    const expected = CHECK_IN_CHUNK2_SCORE_PROMPT.replace(/\s+/g, " ").trim();
    if (normalized !== expected) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dialogueTurns", 0, "content"],
        message: `First WAVE line should be exactly: ${CHECK_IN_CHUNK2_SCORE_PROMPT}`,
      });
    }
  }

  if (pack !== "generic" && turns[1]?.role !== "patient") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["dialogueTurns", 1, "role"],
      message: "Second line should be the patient’s current score (or short answer).",
    });
  }

  if (pack === "two") {
    const landingNeedle = CHECK_IN_CHUNK2_LANDING_SECTION_PROMPT.replace(
      /\s+/g,
      " ",
    ).trim();
    const observeNeedle = CHECK_IN_BODY_URGE_LOCATION_OBSERVE_PROMPT.replace(
      /\s+/g,
      " ",
    ).trim();
    const afterScore = turns[2];
    const normalizedFirstFollowUp = afterScore?.content.replace(/\s+/g, " ") ?? "";
    if (
      afterScore?.role !== "agent" ||
      !normalizedFirstFollowUp.includes(landingNeedle) ||
      normalizedFirstFollowUp.includes(observeNeedle)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dialogueTurns", 2, "content"],
        message: `The first WAVE turn after the patient gives their score must include this landing prompt verbatim and must not include the body-location observe block yet: ${CHECK_IN_CHUNK2_LANDING_SECTION_PROMPT}`,
      });
    }
    const afterLandingPatient = turns[4];
    const normalizedSecondFollowUp =
      afterLandingPatient?.content.replace(/\s+/g, " ") ?? "";
    if (
      afterLandingPatient?.role !== "agent" ||
      !normalizedSecondFollowUp.includes(observeNeedle)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dialogueTurns", 4, "content"],
        message: `The second WAVE turn after the score (after the patient answers about the landing) must include this block verbatim: ${CHECK_IN_BODY_URGE_LOCATION_OBSERVE_PROMPT}`,
      });
    }
    if (turns[3]?.role !== "patient") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dialogueTurns", 3, "role"],
        message:
          "Line 4 should be the patient’s reply about how the landing section felt.",
      });
    }
  }

  const consentNeedle = CHECK_IN_COPING_CONSENT_PROMPT.replace(/\s+/g, " ").trim();
  const hasCopingConsentAsk = turns.some(
    (line, index) =>
      line.role === "agent" &&
      index > 0 &&
      line.content.replace(/\s+/g, " ").includes(consentNeedle),
  );

  if (
    (pack === "one" || pack === "two") &&
    turns.length >= 5 &&
    !hasCopingConsentAsk
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["dialogueTurns"],
      message: `After validating the patient’s response, include this consent question verbatim before any coping instructions: ${CHECK_IN_COPING_CONSENT_PROMPT}`,
    });
  }

  const bridgeNormalized = CHECK_IN_COPING_BRIDGE_OPENER.replace(/\s+/g, " ").trim();
  for (let index = 0; index < turns.length; index += 1) {
    const line = turns[index];
    if (line.role === "agent" && !line.content.trim().endsWith("?")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dialogueTurns", index, "content"],
        message:
          "Every WAVE line must end with a question mark so the patient knows what to answer next.",
      });
    }
  }

  if ((pack === "one" || pack === "two") && hasCopingConsentAsk) {
    const consentAgentIndex = turns.findIndex(
      (line, index) =>
        line.role === "agent" &&
        index > 0 &&
        line.content.replace(/\s+/g, " ").includes(consentNeedle),
    );
    if (consentAgentIndex !== -1) {
      let nextIndex = consentAgentIndex + 1;
      while (nextIndex < turns.length && turns[nextIndex].role === "patient") {
        nextIndex += 1;
      }
      const copingAgent = turns[nextIndex];
      if (copingAgent?.role === "agent") {
        const copingLead = copingAgent.content.replace(/\s+/g, " ").trim().toLowerCase();
        if (!copingLead.startsWith(bridgeNormalized.toLowerCase())) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["dialogueTurns", nextIndex, "content"],
            message: `The first WAVE turn after the patient agrees to coping must start with: ${CHECK_IN_COPING_BRIDGE_OPENER}`,
          });
        }
      }
    }
  }

  const lastAgent = [...turns].reverse().find((line) => line.role === "agent");
  if (!lastAgent) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["dialogueTurns"],
      message: "Include at least one agent (WAVE) turn.",
    });
  } else if (lastAgent.content.trim() !== output.reply.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["reply"],
      message:
        "When dialogue turns are present, reply must match the last WAVE turn (trimmed).",
    });
  }

  if (output.endConversation?.action === "end" && turns.length >= 1) {
    const lastLine = turns[turns.length - 1];
    if (lastLine?.role !== "patient") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dialogueTurns"],
        message:
          "When action is end, end the transcript on the patient’s readiness line—no WAVE message after they say they are ready; the session advances to the next chunk.",
      });
    }
  }
}

function buildCheckInOutputSchema(pack: CheckInDialoguePack) {
  return checkInOutputBaseSchema.superRefine((output, ctx) =>
    refineCheckInDialogueOutput(output, ctx, pack),
  );
}

function checkInDialoguePackFor(
  chunkNumber: 1 | 2 | 3 | 4 | 5,
): CheckInDialoguePack {
  if (chunkNumber === 1) return "one";
  if (chunkNumber === 2) return "two";
  return "generic";
}

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
      "When dialogueTurns are present, every WAVE line must always end with a question mark.",
      "Validate before offering a technique when the patient reports an obstacle.",
      "Never shame, never use toxic positivity, and never give medication directives.",
      "Optional dialogueTurns captures a full training transcript; when present, reply must match the last WAVE line.",
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
    outputSchema: buildCheckInOutputSchema(checkInDialoguePackFor(chunkNumber)),
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
      optionLabels: {
        social: "Social situation",
        stress: "Stress / emotions",
        physical: "Physical sensation",
        unknown_or_other: "Don't know / other",
      },
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
    "Training transcripts (match `data/training-seeds/lora-check-in-1.json` and the grid generator): (1) Turn 1 is WAVE with the exact 1–10 craving prompt from `check-in-dialogue.ts`. (2) Turn 2 is the patient’s current score only—never the baseline; intake lives in input and WAVE compares baseline vs current on the first substantive WAVE turn after the number. (3) When recalling medication, affirm on-time and late with gratitude (e.g. thank you for keeping on track with your medication; that is very important, and you are doing the right thing) before status details; missed doses use honest, non-shaming acknowledgment plus prescriber/clinic routing as in examples. (4) Validate triggers with the surf pattern: sometimes {trigger context} alone can trigger the urge, and we are here to help you surf the wave. (5) Every WAVE line must always end with a question mark. (6) After validating an obstacle, ask consent verbatim: Would you like to try some coping strategies together to see if it helps? before any technique. (7) On the first WAVE turn after the patient agrees to coping, open with CHECK_IN_COPING_BRIDGE_OPENER from `check-in-dialogue.ts`, then give the technique, and end that same turn with a brief check-in question. (8) When the patient confirms readiness for the next chunk, end the dialogue on that patient line—no closing WAVE reply; `reply` still matches the last WAVE line (the readiness question). Use endConversation when appropriate.",
  ),
  "lora-check-in-2": checkInSpec(
    "lora-check-in-2",
    2,
    "Check-in 2",
    "Focus: craving score, score reflection vs prior check-in, body-location question after the body-scan chunk, and somatic validation (PRD § Check-in 2).",
    "Training transcripts (match `data/training-seeds/lora-check-in-2.json` and `client/scripts/generate-lora-check-in-2-grid.ts`). (1) Turn 1 is WAVE with exactly CHECK_IN_CHUNK2_SCORE_PROMPT from `check-in-dialogue.ts`. (2) Turn 2 is the patient’s current score only. (3) The first WAVE turn after the score: score-reflection clause (`fillScoreReflection` / `score-tracking.ts`), then CHECK_IN_CHUNK2_LANDING_SECTION_PROMPT verbatim only (no body observe block on this turn). (4) Patient answers about the landing; the next WAVE turn briefly says Great if they were fine, or validates if they named friction, then CHECK_IN_BODY_URGE_LOCATION_OBSERVE_PROMPT verbatim. (5) Patient answers body-location; then validate → CHECK_IN_COPING_CONSENT_PROMPT → CHECK_IN_COPING_BRIDGE_OPENER → technique → CHECK_IN_CHUNK2_READINESS_PROMPT → patient affirms ready. (6) Every WAVE line ends with ?. (7) End on the patient’s readiness line; `reply` matches the last WAVE line.",
  ),
  "lora-check-in-3": checkInSpec(
    "lora-check-in-3",
    3,
    "Check-in 3",
    "Focus: sound / visualization anchor — landing split, PRD anchor-hold question, obstacle-aware one technique.",
    "Align with AGENTS.md § lora-check-in-3 and `check-in-dialogue.ts`: Turn 1 = CHECK_IN_CHUNK3_SCORE_PROMPT; first post-score WAVE = score reflection + CHECK_IN_CHUNK3_LANDING_SECTION_PROMPT verbatim only; after patient landing reply, Great. or brief validate + CHECK_IN_CHUNK3_ANCHOR_HOLD_PROMPT verbatim; then validate → CHECK_IN_COPING_CONSENT_PROMPT (when needed) → CHECK_IN_COPING_BRIDGE_OPENER → one technique → CHECK_IN_CHUNK3_READINESS_PROMPT. No check-in-1 med + surf block on the first post-score turn. If the anchor fails, prefer real-sound or thought-labeling paths over pressing visualization (PRD Obstacle Library).",
  ),
  "lora-check-in-4": checkInSpec(
    "lora-check-in-4",
    4,
    "Check-in 4",
    "Focus: 4-4-6 breathing — landing split, PRD breathing follow-up, obstacle-aware one technique (no deeper breaths for breath anxiety / chest tightness).",
    "Align with AGENTS.md § lora-check-in-4 and `check-in-dialogue.ts`: Turn 1 = CHECK_IN_CHUNK4_SCORE_PROMPT; first post-score WAVE = score reflection + CHECK_IN_CHUNK4_LANDING_SECTION_PROMPT verbatim only; after patient landing reply, Great. or brief validate + CHECK_IN_CHUNK4_BREATHING_FOLLOW_UP_PROMPT verbatim (not CHECK_IN_BODY_URGE_LOCATION_OBSERVE_PROMPT); then validate → CHECK_IN_COPING_CONSENT_PROMPT (when needed) → CHECK_IN_COPING_BRIDGE_OPENER → one technique → CHECK_IN_CHUNK4_READINESS_PROMPT. No check-in-1 med + surf block on the first post-score turn. Never push deeper or longer breaths when the patient reports breath anxiety or chest tightness (PRD obstacle library).",
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
