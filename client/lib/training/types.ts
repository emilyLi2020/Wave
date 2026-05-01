import { z } from "zod";

/**
 * Specialized LoRA sample sets collected in the /training UI. The web demo
 * ships one merged multitask LoRA (`DEMO_LORA_ID`), trained from the combined
 * rows collected under these future specialized adapter IDs.
 */
export const DEMO_LORA_ID = "lora-wave-session" as const;

export const LORA_IDS = [
  "lora-phase-narration",
  "lora-check-in-1",
  "lora-check-in-2",
  "lora-check-in-3",
  "lora-check-in-4",
  "lora-check-in-5",
  "lora-reflection",
] as const;

export type LoRAId = (typeof LORA_IDS)[number];
export type DemoLoRAId = typeof DEMO_LORA_ID;

export const SEED_STATUSES = ["draft", "ready", "approved"] as const;
export type SeedStatus = (typeof SEED_STATUSES)[number];

/**
 * Field-rendering DSL. Each LoRA's input and output are described as a
 * tree of FieldSpec nodes; one shared <SeedForm/> renderer walks the tree
 * and produces the right HTML control. Adding a new control kind means
 * extending this union and the renderer at the same time.
 *
 * Keys must be unique within their parent object; the renderer uses the
 * key as the path into the JSON value.
 */
export type FieldSpec =
  | TextFieldSpec
  | TextArrayFieldSpec
  | NumberFieldSpec
  | EnumFieldSpec
  | BooleanFieldSpec
  | ObjectFieldSpec
  | ConstFieldSpec;

interface BaseField {
  key: string;
  label: string;
  help?: string;
  optional?: boolean;
}

export interface TextFieldSpec extends BaseField {
  kind: "text";
  multiline?: boolean;
  minLength?: number;
  maxLength?: number;
  placeholder?: string;
}

export interface TextArrayFieldSpec extends BaseField {
  kind: "text-array";
  minItems: number;
  maxItems: number;
  itemLabel: string;
  minLength?: number;
  maxLength?: number;
  placeholder?: string;
}

export interface NumberFieldSpec extends BaseField {
  kind: "number";
  min: number;
  max: number;
  integer?: boolean;
  step?: number;
  placeholder?: string;
}

export interface EnumFieldSpec extends BaseField {
  kind: "enum";
  options: readonly string[];
  optionLabels?: Readonly<Record<string, string>>;
}

export interface BooleanFieldSpec extends BaseField {
  kind: "boolean";
}

export interface ObjectFieldSpec extends BaseField {
  kind: "object";
  fields: readonly FieldSpec[];
}

/**
 * A field whose value is fixed and not user-editable (e.g.
 * a check-in spec's fixed `chunkNumber`). Renders as a read-only
 * pill so the doctor sees the constraint without having to pick it.
 */
export interface ConstFieldSpec extends BaseField {
  kind: "const";
  value: string | number | boolean;
}

/**
 * Stack-axis configuration. The stratification grid on the LoRA index
 * page is computed from this — by default, rows × cols with `count` per
 * cell, drawn from the seed's `input` payload. Picking matType ×
 * medicationStatus matches the train/test split in
 * docs/model-training.md §5.
 */
export interface StackAxes {
  rowKey: string; // path into input, e.g. "matType"
  rowLabel: string;
  rowOptions: readonly string[];
  colKey: string;
  colLabel: string;
  colOptions: readonly string[];
}

/**
 * The full per-LoRA spec the renderer + form pages consume.
 */
export interface LoraFormSpec {
  loraId: LoRAId;
  title: string;
  shortTitle: string;
  /** From docs/models.md "Where used in the product" */
  whereUsed: string;
  /** "Why this is its own LoRA" — shown to the doctor for context. */
  clinicalRationale: string;
  /** Hard invariants from docs/models.md, surfaced as reminders. */
  invariants: readonly string[];
  /** Citation prompt — what clinical source the doctor should cite. */
  citationPrompt?: string;
  /** Target seed count per docs/model-training.md §1. */
  targetCount: number;
  isStretch: boolean;
  inputFields: readonly FieldSpec[];
  outputFields: readonly FieldSpec[];
  inputSchema: z.ZodType;
  outputSchema: z.ZodType;
  stackAxes: StackAxes;
}

/**
 * One persisted training seed. Stored as a plain JSON object inside
 * the LoRA's file at <repo-root>/data/training-seeds/<lora-id>.json.
 */
export interface TrainingSeed {
  id: string;
  loraId: LoRAId;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  authorInitials: string | null;
  notes: string | null;
  status: SeedStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * Shared enums reused across multiple LoRA specs, mirrored from
 * client/types/models.ts. Kept here (not imported) so the training
 * registry is the single source of truth for the dropdown options the
 * doctor sees and the Zod validators on the wire.
 */
export const MAT_TYPES = [
  "buprenorphine",
  "naltrexone",
  "methadone",
  "vivitrol",
  "none",
] as const;

export const MEDICATION_STATUSES = [
  "on_time",
  "late",
  "missed",
  "none",
] as const;

export const TRIGGER_CATEGORIES = [
  "social",
  "stress",
  "physical",
  "unknown",
  "other",
] as const;

export const TIME_OF_DAY = [
  "morning",
  "midday",
  "evening",
  "late_night",
] as const;

export const BODY_LOCATIONS = [
  "chest",
  "jaw",
  "shoulders",
  "legs",
  "stomach",
  "other",
] as const;

export const CITATIONS = [
  "FDA_LABEL",
  "SAMHSA_TIP63",
  "MBRP_FACILITATOR",
  "NONE",
] as const;

export const WAVE_PHASES = ["rise", "peak", "fall"] as const;
export const WAVE_TRENDS = ["up", "flat", "down"] as const;
export const WAVE_PACING = ["slower", "hold", "faster"] as const;
export const WAVE_ENCOURAGEMENT = [
  "grounding",
  "normalizing",
  "celebrating",
] as const;

export const SENSATION_LABELS = [
  "tight",
  "warm",
  "cold",
  "fluttery",
  "heavy",
  "absent",
] as const;

export const REFLECTION_NEXT_STEPS = [
  "call",
  "walk",
  "water",
  "hands",
  "rest",
] as const;

export const INSIGHT_KINDS = [
  "time_of_day",
  "trigger_frequency",
  "medication_correlation",
  "body_location",
] as const;

export const INSIGHT_CONFIDENCE = ["low", "medium", "high"] as const;
