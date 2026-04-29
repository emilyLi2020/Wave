/**
 * @deprecated Legacy one-shot medication-acknowledgment prompt.
 *
 * The five-chunk session rewrite (PRD § Session Structure) folded
 * medication-aware copy into the validation slot of the multi-turn
 * check-in chat (see `client/lib/prompts/wave-system.ts` and
 * `client/lib/prompts/check-in.ts`). The standalone "med-ack" phase is
 * no longer mounted by the session shell. This file is retained only
 * so the Synthetix LoRA scaffolding under `client/synthetix/` keeps
 * compiling while we land the rewrite. It will be removed in a
 * follow-up cleanup PR — do not import from here in new code.
 */

import { outputContractFor, type IntakeContext, type CitationKey } from "./schemas";

const SYSTEM_PROMPT = `<role>
You write medication-aware urge-surfing acknowledgments for WAVE, a tool for adults in Substance Use Disorder recovery.
</role>

<voice>
- Trauma-informed, grounded, second-person, present-tense, warm but never saccharine.
- 2-3 sentences total.
- Pharmacology MUST be FDA-label-correct. Use the <clinical_source> block as the canonical clinical framing. Do NOT invent half-lives, peak times, or receptor effects beyond what it states.
</voice>

<never>
- NEVER use toxic-positivity ("you've got this", "stay strong").
- NEVER imply the patient has failed.
- NEVER prescribe. "Take your medication if available" is allowed; "increase your dose" is NOT.
- NEVER suggest starting or stopping a medication.
- If the patient missed a dose, normalize and redirect — never shame.
</never>

<output>
Strict JSON matching the supplied schema. The "citationKey" field MUST equal the value <citation_required> asks you to cite — copy it verbatim.
</output>`;

interface AckTemplate {
  /** Clinical situation note that gets pasted verbatim into the user turn. */
  situation: string;
  citationKey: CitationKey;
}

type MatKey = IntakeContext["matType"];
type StatusKey = IntakeContext["medicationStatus"];

type TemplateGrid = {
  [M in MatKey]: { [S in StatusKey]?: AckTemplate } & { default: AckTemplate };
};

const NONE_TEMPLATE: AckTemplate = {
  situation:
    "Patient is not on Medication-Assisted Treatment. Stay strictly within standard MBRP urge-surfing language. Make no pharmacology claims of any kind. Acknowledge the wave, name that it will rise and fall, and orient them to ride it.",
  citationKey: "MBRP",
};

const TEMPLATES: TemplateGrid = {
  buprenorphine: {
    on_time: {
      situation:
        "Patient is on buprenorphine/Suboxone and took today's dose on time. Buprenorphine is a partial mu-opioid agonist with a long half-life (24-60 hours); a current on-time dose is actively dampening the craving signal. Tell the patient that what they feel at their current rating would be measurably more intense without the medication, and invite them to surf what is left.",
      citationKey: "FDA:Suboxone",
    },
    late: {
      situation:
        "Patient is on buprenorphine/Suboxone and is late with today's dose. Levels are dropping but the long half-life means there is still substantial receptor occupancy. Acknowledge that the rising wave likely tracks the dropping level, and that taking the medication if available will help. Do not tell them what to do; offer the option.",
      citationKey: "FDA:Suboxone",
    },
    missed: {
      situation:
        "Patient is on buprenorphine/Suboxone and missed today's dose. Part of what they feel is partial withdrawal layered onto craving, which makes the wave feel sharper than usual. Normalize this without shame and offer that taking the medication now, if available, will help. Do not prescribe a dose.",
      citationKey: "FDA:Suboxone",
    },
    none: {
      situation:
        "Patient says they are on buprenorphine/Suboxone but currently report no medication status. Treat this as a generic on-MAT moment: acknowledge that their medication regimen is part of how they got here, and orient them to the wave without making claims about today's specific dose timing.",
      citationKey: "SAMHSA:MAT-TIP63",
    },
    default: {
      situation:
        "Patient is on buprenorphine/Suboxone. Stay within SAMHSA MAT TIP 63 guidance. Acknowledge the medication's role in dampening craving and orient the patient to the wave.",
      citationKey: "SAMHSA:MAT-TIP63",
    },
  },
  naltrexone: {
    on_time: {
      situation:
        "Patient is on oral naltrexone and took today's dose. Naltrexone is a mu-opioid antagonist that blocks the reward pathway. The brain may be chasing a reward it physically cannot access right now. Acknowledge the futility of the chase compassionately and offer the wave as a way to redirect the energy.",
      citationKey: "FDA:Naltrexone",
    },
    late: {
      situation:
        "Patient is on oral naltrexone and is late with today's dose. Receptor blockade is fading but still partially in effect. Acknowledge the wave, name that taking the medication when available will restore the block, and invite them to surf what is here now.",
      citationKey: "FDA:Naltrexone",
    },
    missed: {
      situation:
        "Patient is on oral naltrexone and missed today's dose. Receptor blockade is fading. Normalize the missed dose without shame, mention that taking it when available restores the block, and orient them to ride the current wave.",
      citationKey: "FDA:Naltrexone",
    },
    default: {
      situation:
        "Patient is on naltrexone. Stay within FDA-label framing of opioid receptor antagonism. Acknowledge the wave without making claims about today's specific dose timing.",
      citationKey: "FDA:Naltrexone",
    },
  },
  vivitrol: {
    on_time: {
      situation:
        "Patient is on Vivitrol (extended-release injectable naltrexone). The injection is monthly, so 'on time' means the most recent injection is still inside its therapeutic window. Acknowledge that the brain may be recalibrating; intensity in the early weeks of an injection cycle is often higher and is expected, not a sign of failure.",
      citationKey: "FDA:Vivitrol",
    },
    late: {
      situation:
        "Patient is on Vivitrol and the next injection is overdue. Acknowledge that drug levels drop in the final week of the cycle and waves can feel sharper. Offer that scheduling the next injection when possible will restore the block. Do not tell them to dose themselves.",
      citationKey: "FDA:Vivitrol",
    },
    missed: {
      situation:
        "Patient is on Vivitrol and missed the most recent monthly injection. Receptor blockade has likely faded. Normalize without shame; offer that contacting their prescriber to schedule the next injection is a clinically meaningful step. Acknowledge the wave they are riding right now.",
      citationKey: "FDA:Vivitrol",
    },
    default: {
      situation:
        "Patient is on Vivitrol. Stay within FDA-label framing for extended-release injectable naltrexone. Acknowledge the wave without making claims about specific cycle timing.",
      citationKey: "FDA:Vivitrol",
    },
  },
  methadone: {
    on_time: {
      situation:
        "Patient is on methadone and took today's dose on time. Methadone peaks roughly 2-4 hours after dosing and has a long half-life (8-59 hours, person-dependent). Without knowing exactly when they dosed today, gently locate them in the curve: if they dosed recently they are near peak; if many hours ago they are in trough territory. Offer the wave as a way to ride the current spot.",
      citationKey: "FDA:Methadone",
    },
    late: {
      situation:
        "Patient is on methadone and is late with today's dose. Levels are in a trough, which is when cravings frequently spike. Acknowledge that the wave timing matches the dose timing and that getting to today's dose when possible will help.",
      citationKey: "FDA:Methadone",
    },
    missed: {
      situation:
        "Patient is on methadone and missed today's dose. Trough-level cravings are physiologically expected. Normalize without shame; offer that contacting their clinic to discuss today's dose is the clinically right step. Stay with them through this wave.",
      citationKey: "FDA:Methadone",
    },
    default: {
      situation:
        "Patient is on methadone. Stay within FDA-label and SAMHSA MAT TIP 63 framing. Acknowledge the wave without making claims about today's specific dose timing.",
      citationKey: "FDA:Methadone",
    },
  },
  none: {
    none: NONE_TEMPLATE,
    default: NONE_TEMPLATE,
  },
};

function pickTemplate(input: IntakeContext): AckTemplate {
  const grid = TEMPLATES[input.matType];
  return grid[input.medicationStatus] ?? grid.default;
}

const TRIGGER_NOTE: Record<IntakeContext["trigger"], string> = {
  social: "The trigger is a social situation.",
  stress: "The trigger is stress or emotional load.",
  physical: "The trigger is a physical sensation.",
  unknown: "The trigger is unknown to the patient right now.",
  other: "The trigger does not fit the standard categories.",
};

export interface BuiltPrompt {
  systemPrompt: string;
  userPrompt: string;
}

export function buildMedAckPrompt(input: IntakeContext): BuiltPrompt {
  const template = pickTemplate(input);
  const safetyNote = input.usedSubstanceToday
    ? "Note: the patient told the safety screen they used a substance today and is not in physical distress. Do not bring this up directly here — the reflection phase handles that. Stay focused on the medication-aware acknowledgment."
    : "";

  const sections: string[] = [
    "<situation>",
    `- Intake intensity: ${input.intakeIntensity}/10`,
    `- MAT: ${input.matType}`,
    `- Medication status: ${input.medicationStatus}`,
    `- Trigger: ${input.trigger}`,
    "</situation>",
    "",
    "<clinical_source>",
    template.situation,
    "</clinical_source>",
    "",
    "<trigger_note>",
    TRIGGER_NOTE[input.trigger],
    "</trigger_note>",
  ];

  if (safetyNote) {
    sections.push(
      "",
      "<safety_context>",
      safetyNote,
      "</safety_context>",
    );
  }

  sections.push(
    "",
    "<citation_required>",
    `Set "citationKey" exactly to: "${template.citationKey}"`,
    "</citation_required>",
    "",
    "<output_shape>",
    outputContractFor("med-ack"),
    "</output_shape>",
  );

  return { systemPrompt: SYSTEM_PROMPT, userPrompt: sections.join("\n") };
}
