/**
 * Educational reference for check-in validation when medication is late or missed.
 * Not individualized medical advice. Citations: SAMHSA TIP 63 (Medications for Opioid
 * Use Disorder); FDA labeling for buprenorphine-containing products and methadone;
 * product labeling for extended-release naltrexone (Vivitrol).
 *
 * WAVE uses this only to suggest tentative, non-diagnostic language in prompts.
 * The model must not diagnose or prescribe.
 */

import type { CheckInContextPayload } from "@/lib/prompts/schemas";

export const MAT_MISSED_DOSE_REFERENCE_VERSION = "2026-05-07";

type MatType = CheckInContextPayload["profile"]["matType"];

export interface MatSymptomReference {
  /** Patient-facing label used in prompts */
  label: string;
  /**
   * Short clauses the model may paraphrase when status is late/missed.
   * Keep hedged language ("some people notice…", "not everyone…").
   */
  lateOrMissedHints: readonly string[];
  /** When antagonist / depot — different framing than daily agonist gaps */
  note?: string;
}

export const MAT_SYMPTOM_REFERENCE: Record<MatType, MatSymptomReference> = {
  buprenorphine: {
    label: "buprenorphine (often combined with naloxone in products like Suboxone)",
    lateOrMissedHints: [
      "Some people notice restlessness, muscle aches, stomach upset, sweating, yawning, runny nose, anxiety, or trouble sleeping when coverage drops — timing and intensity vary widely.",
      "A single late dose does not predict what any one person will feel; many people feel little change at first.",
    ],
    note: "Partial agonist MOUD: withdrawal-type discomfort can emerge if doses are repeatedly missed or substantially delayed — a prescriber or clinic can help plan what to do next.",
  },
  methadone: {
    label: "methadone",
    lateOrMissedHints: [
      "Because methadone lasts longer in the body than short-acting opioids, symptoms may build more slowly, but some people eventually notice opioid withdrawal-type discomfort (for example aches, sweating, stomach cramping, anxiety, or poor sleep) if doses are missed.",
      "Onset and severity vary a lot by dose, timing, and individual biology.",
    ],
    note: "Daily observed dosing programs have specific protocols for missed doses — encourage contacting the clinic rather than guessing.",
  },
  naltrexone: {
    label: "oral naltrexone",
    lateOrMissedHints: [
      "Missing oral naltrexone mainly reduces opioid blockade rather than causing classic agonist withdrawal from the pill itself.",
      "Craving or urges can resurface when blockade fades — that is different from labeling it as 'withdrawal from naltrexone' in stable use.",
    ],
  },
  vivitrol: {
    label: "extended-release injectable naltrexone (Vivitrol)",
    lateOrMissedHints: [
      "Near the end of the dosing interval or after a delayed injection, some people notice return of craving or opioid sensitivity; experiences vary.",
      "This is not the same narrative as missing a daily agonist dose.",
    ],
    note: "Injection scheduling is managed with a prescriber — encourage reaching out if an appointment was missed.",
  },
  none: {
    label: "not on medication-assisted treatment for opioids",
    lateOrMissedHints: [
      "No MAT medication context applies; focus validation on the urge, trigger, and grounding skills instead of withdrawal pharmacology.",
    ],
  },
};

/**
 * Compact block inserted into check-in 1 prompts when medication is late or missed.
 */
export function formatMatMissedDoseReferenceForPrompt(
  profile: CheckInContextPayload["profile"],
): string {
  if (profile.matType === "none") return "";
  if (profile.medicationStatus !== "late" && profile.medicationStatus !== "missed") {
    return "";
  }

  const ref = MAT_SYMPTOM_REFERENCE[profile.matType];
  const statusWord =
    profile.medicationStatus === "missed" ? "missed" : "late with";

  return [
    "<missed_or_late_medication_reference>",
    `Medication status: patient is ${statusWord} today's ${ref.label} dose.`,
    "Use hedged, non-diagnostic language only. Do not claim the patient is in withdrawal.",
    "If symptoms sound severe, unfamiliar, or frightening, encourage contacting their prescriber, clinic, or (if appropriate) urgent/emergency care.",
    "Paraphrase-friendly hints (do not read as a checklist diagnosis):",
    ...ref.lateOrMissedHints.map((line) => `  • ${line}`),
    ref.note ? `Context: ${ref.note}` : "",
    `Reference pack version: ${MAT_MISSED_DOSE_REFERENCE_VERSION} (SAMHSA TIP 63; FDA labeling).`,
    "</missed_or_late_medication_reference>",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function formatIntakeTriggerLineForPrompt(
  profile: CheckInContextPayload["profile"],
): string {
  const triggerLabels: Record<
    CheckInContextPayload["profile"]["trigger"],
    string
  > = {
    social: "social situation",
    stress: "stress or strong emotions",
    physical: "physical sensation or discomfort",
    unknown_or_other: "something they could not pin down (or other)",
  };
  const base = triggerLabels[profile.trigger];
  const detail =
    profile.trigger === "unknown_or_other" && profile.triggerOther?.trim()
      ? ` — they wrote: "${profile.triggerOther.trim()}"`
      : "";
  return `Intake trigger category: ${base}${detail}.`;
}
