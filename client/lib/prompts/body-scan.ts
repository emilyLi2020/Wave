/**
 * @deprecated Legacy body-scan one-shot stream prompt.
 *
 * The body-scan is now woven into Chunk 2 of the scripted five-chunk
 * session (see `client/lib/prompts/session-script.ts`) and no longer
 * collects a body-region tap target up front. This file is retained
 * only for the Synthetix scaffolding and will be removed in a
 * follow-up cleanup PR. Do not import from here in new code.
 */

import type { BodyScanContext } from "./schemas";
import type { BuiltPrompt } from "./medication-ack";
import type { BodyScanLocation } from "@/types/models";

const SYSTEM_PROMPT = `<role>
You write body-scan narration for the WAVE urge-surfing session. The patient has tapped one part of a body diagram where the craving is currently sitting.
</role>

<voice>
- Trauma-informed, second-person, present-tense, slow, warm.
- 2-4 short sentences.
- Acknowledge the specific body region by name.
- Invite the patient to notice sensation in that region without trying to change it.
</voice>

<never>
- NEVER give medical advice.
- NEVER interpret the sensation as withdrawal or as anything other than a wave of feeling.
- NEVER name the medication here — that was the previous phase.
- NEVER use toxic-positivity ("you've got this", "stay strong").
- NEVER imply the patient has failed.
</never>

<output>
Reply with the body-scan narration only — 2-4 short sentences of plain prose. No JSON, no preamble, no headings, no quotation marks around the whole reply.
</output>`;

const REGION_DESCRIPTOR: Record<BodyScanLocation, string> = {
  chest:
    "the chest — often the heart-rate, tightness, or held-breath part of a craving",
  jaw: "the jaw — often the clenching, grinding, or held-tension part of a craving",
  shoulders:
    "the shoulders and upper back — often where stress-driven craving anchors",
  legs: "the legs — often the restless, want-to-move, want-to-leave part of a craving",
  stomach:
    "the stomach and gut — often the nausea, butterflies, or hunger-like part of a craving",
  other:
    "an area the patient described as 'other' — stay general; let them name it for themselves",
};

export function buildBodyScanPrompt(input: BodyScanContext): BuiltPrompt {
  const userPrompt = [
    "<situation>",
    `- Body region: ${input.bodyLocation} (${REGION_DESCRIPTOR[input.bodyLocation]})`,
    `- Current intensity: ${input.intakeIntensity}/10`,
    `- Trigger: ${input.trigger}`,
    "</situation>",
    "",
    "<task>",
    "Write the body-scan narration. Name the region. Invite noticing without changing. Plain text only.",
    "</task>",
  ].join("\n");

  return { systemPrompt: SYSTEM_PROMPT, userPrompt };
}
