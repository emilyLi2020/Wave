/**
 * @deprecated Legacy three-phase wave (rise/peak/fall) one-shot stream
 * prompt.
 *
 * Replaced by the scripted five-chunk session
 * (`client/lib/prompts/session-script.ts`) where Chunk 4 owns the
 * breathing wave and the rise/peak/fall framing is delivered as
 * clinician-reviewed scripted segments rather than per-tier model
 * output. This file is retained only for the Synthetix LoRA
 * scaffolding and will be removed in a follow-up cleanup PR. Do not
 * import from here in new code.
 */

import type { WaveContext } from "./schemas";
import type { BuiltPrompt } from "./medication-ack";

type WavePhase = "rise" | "peak" | "fall";
type IntensityTier = "low" | "mid" | "high";

const PHASE_GUIDANCE: Record<WavePhase, string> = {
  rise: "The wave is rising. Voice is the most active and grounding here. Acknowledge that this is the hardest part. Invite the patient to stay with the sensation rather than push it away. Do not promise it will pass quickly — name that it will pass.",
  peak: "The wave is at its peak. Voice is the most still and steady here. Acknowledge that they are at the top. Remind them that peaks do not last. Hold the moment with them.",
  fall: "The wave is falling. Voice is the warmest and most affirming here, without becoming saccharine. Acknowledge the descent. Name that they surfed it. Do not say 'you did it' or 'you've got this' — say what is true: the wave is coming down.",
};

// Intensity-tier guidance overrides the default phase tone when the
// live slider value falls into a band that calls for a meaningfully
// different response. Today only `rise` has tiered copy because that
// is where the patient is most likely to move the slider — peak and
// fall fall through to PHASE_GUIDANCE alone until clinical review
// signs off on tiered copy for those phases too.
const INTENSITY_GUIDANCE: Partial<
  Record<WavePhase, Record<IntensityTier, string>>
> = {
  rise: {
    low: "The wave is small right now (1-3/10). Validate and affirm — they noticed the urge while it was still quiet, and that early-catch is real progress, not a small thing. Name what they are doing well without flattery.",
    mid: "The wave is climbing (4-7/10). Use the standard rise guidance: name the build, invite them to stay with the sensation, and remind them it will pass.",
    high: "The wave is big right now (8-10/10). This is a hard moment. Validate plainly that the urge to use feels real and strong; do not minimize it. Acknowledge that part of them really wants the craving to win, and thank them for being here with the wave instead of acting on it.",
  },
};

function intensityTier(value: number): IntensityTier {
  if (value <= 3) return "low";
  if (value >= 8) return "high";
  return "mid";
}

const SYSTEM_PROMPT = `<role>
You write urge-surfing wave narration for WAVE. There are three sub-phases — rise, peak, and fall — and the user turn names which one this turn is.
</role>

<voice>
- Trauma-informed, second-person, present-tense, slow.
- Two to four short sentences total.
- Match the tone described in <phase_guidance> for the current sub-phase.
- When an <intensity_guidance> block is present, treat it as the OVERRIDING instruction for what to validate, affirm, or thank the patient for at this exact intensity. The reply must read noticeably different at a low intensity than at a high one.
</voice>

<never>
- NEVER use toxic-positivity ("you've got this", "you did it", "stay strong").
- NEVER imply the patient has failed if intensity is still high.
- NEVER give medical advice.
- NEVER name the medication here — that was the acknowledgment phase.
</never>

<output>
Reply with the wave narration only — 2-4 short sentences of plain prose. No JSON, no preamble, no headings, no encouragement footer (the UI adds that). No quotation marks around the whole reply.
</output>`;

function buildWavePrompt(phase: WavePhase, input: WaveContext): BuiltPrompt {
  const tier = intensityTier(input.currentIntensity);
  const intensityGuidance = INTENSITY_GUIDANCE[phase]?.[tier];

  const userPrompt = [
    "<phase>",
    `Wave sub-phase: ${phase}`,
    "</phase>",
    "",
    "<phase_guidance>",
    PHASE_GUIDANCE[phase],
    "</phase_guidance>",
    ...(intensityGuidance
      ? [
          "",
          "<intensity_guidance>",
          `Current intensity tier: ${tier} (${input.currentIntensity}/10).`,
          intensityGuidance,
          "</intensity_guidance>",
        ]
      : []),
    "",
    "<situation>",
    `- Intake intensity: ${input.intakeIntensity}/10`,
    `- Current intensity (live slider): ${input.currentIntensity}/10`,
    `- Body region they named earlier: ${input.bodyLocation}`,
    `- Trigger: ${input.trigger}`,
    "</situation>",
    "",
    "<task>",
    "Write only the wave narration. Plain text. No JSON.",
    "</task>",
  ].join("\n");

  return { systemPrompt: SYSTEM_PROMPT, userPrompt };
}

export function buildWaveRisePrompt(input: WaveContext): BuiltPrompt {
  return buildWavePrompt("rise", input);
}

export function buildWavePeakPrompt(input: WaveContext): BuiltPrompt {
  return buildWavePrompt("peak", input);
}

export function buildWaveFallPrompt(input: WaveContext): BuiltPrompt {
  return buildWavePrompt("fall", input);
}
