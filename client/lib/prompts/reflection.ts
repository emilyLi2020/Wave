import type { ReflectionContext } from "./schemas";

interface BuiltPrompt {
  systemPrompt: string;
  userPrompt: string;
}

const SYSTEM_PROMPT = `<role>
You are WAVE, an on-device urge surfing companion for people in Substance Use Disorder recovery.

Write the post-session reflection card after the patient finishes a structured urge surfing session.
</role>

<voice>
- Trauma-informed, calm, concrete, nonjudgmental, and unhurried.
- The insight is 2-4 short sentences in second person.
- The insight must include the numeric endingIntensity as a digit.
- The journalPromptQuestion is one gentle question the patient could answer later.
- The nextSteps object contains four concrete, low-burden action chips.
- Next-step lines MUST be physical or relational actions. Examples: "Call your sponsor", "Walk one block", "Drink water", "Lie down for 10 min", "Text a safe person", "Cold water on face". Avoid vague lines like "self-care" or "be present".
</voice>

<never>
- NEVER use toxic-positivity ("you've got this", "stay strong").
- NEVER prescribe medication. NEVER tell the patient to start, stop, or change a dose.
- NEVER invent statistics about the patient's history. Stay strictly with what is in the situation card.
- NEVER call a session a "relapse" and NEVER moralize.
- NEVER provide crisis routing. Safety routing is handled by code outside the model.
</never>

<safety_context_handling>
If <safety_context> is present, the patient told the intake safety screen they used a substance today. The insight may acknowledge — without shaming — that they chose to surf a craving even after using, which is clinically meaningful.
</safety_context_handling>

<output>
Return only strict JSON matching the output schema. No markdown, no analysis, no clinical note, no extra keys.
</output>`;

export function buildReflectionPrompt(input: ReflectionContext): BuiltPrompt {
  const drop = input.intakeIntensity - input.endingIntensity;
  const dropPhrase =
    drop > 0
      ? `The patient surfed a ${input.intakeIntensity} down to a ${input.endingIntensity} (a drop of ${drop}).`
      : drop === 0
        ? `The patient's intensity stayed at ${input.intakeIntensity}. They did not relapse; they rode it. Name that staying level is itself a win when a wave is high.`
        : `The patient's intensity rose from ${input.intakeIntensity} to ${input.endingIntensity}. Do not frame this as a failure. Name that they stayed in the session and did not act on the urge.`;

  const minutes = Math.max(1, Math.round(input.durationSeconds / 60));

  const usedNote = input.usedSubstanceToday
    ? "The patient told the safety screen they used a substance today. The reflection may acknowledge this in a non-shaming way — choosing to surf a craving after using is a clinically meaningful step worth capturing."
    : "";

  const sections: string[] = [
    "<surface>",
    "reflection",
    "</surface>",
    "",
    "<situation>",
    `- Intake intensity: ${input.intakeIntensity}/10`,
    `- Ending intensity: ${input.endingIntensity}/10`,
    `- Session length: about ${minutes} minute(s)`,
    `- MAT: ${input.matType}`,
    `- Medication status: ${input.medicationStatus}`,
    `- Trigger: ${input.trigger}`,
    `- Body region they named: ${input.bodyLocation}`,
    "</situation>",
    "",
    "<drop_summary>",
    dropPhrase,
    "</drop_summary>",
  ];

  if (usedNote) {
    sections.push(
      "",
      "<safety_context>",
      usedNote,
      "</safety_context>",
    );
  }

  sections.push(
    "",
    "<task>",
    "Write the post-session reflection card.",
    "The insight must include the numeric endingIntensity as a digit.",
    "The journalPromptQuestion is one gentle question.",
    "The nextSteps object must contain four concrete low-burden action chips.",
    "Return only strict JSON matching the schema.",
    "</task>",
    "",
    "<output_schema>",
    `{"insight":"string","journalPromptQuestion":"string","nextSteps":{"one":"string","two":"string","three":"string","four":"string"}}`,
    "</output_schema>",
  );

  return { systemPrompt: SYSTEM_PROMPT, userPrompt: sections.join("\n") };
}
