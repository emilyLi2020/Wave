/**
 * @deprecated Legacy per-phase encouragement bank for the rise / peak /
 * fall wave sub-phases.
 *
 * The five-chunk session rewrite removed the rise/peak/fall sub-phase
 * UI; the equivalent affirmations now live inside the scripted Chunk 4
 * breathing copy and inside the multi-turn check-in chat's scripted
 * fallback bank (`client/lib/prompts/fallback-bank.ts`). This file is
 * retained only for the Synthetix scaffolding and will be removed in a
 * follow-up cleanup PR. Do not import from here in new code.
 *
 * ---
 * Per-phase encouragement banks for the three wave sub-phases. The model
 * never produces these lines — the wave block samples one at phase entry
 * and shows it under the streaming narration. Voice intentionally
 * mirrors the trauma-informed tone of the live wave prompt: no
 * toxic-positivity, no "you've got this", no promises about timing.
 *
 * Lines are stable enough to read as scripted clinical copy. When the
 * Gemma 4 + LoRA stack lands, this bank stays exactly as-is — it is
 * already model-free.
 */

type WaveTextPhase = "wave-rise" | "wave-peak" | "wave-fall";

const BANK: Record<WaveTextPhase, readonly string[]> = {
  "wave-rise": [
    "You're not making this happen. You're noticing it.",
    "Notice it climbing. You don't have to climb with it.",
    "It's allowed to rise. You're allowed to stay.",
    "This is the loudest part. It is also temporary.",
    "Breathing slow is enough right now.",
    "Stay close to the sensation, not the story.",
  ],
  "wave-peak": [
    "The peak is the shortest part of every wave.",
    "Still here. Still riding.",
    "You don't have to do anything. Just stay.",
    "Top of the curve. The next move is down.",
    "One slow breath. Then another.",
    "You're doing the work by not leaving.",
  ],
  "wave-fall": [
    "Coming down. Stay with it.",
    "It's leaving the body now. Let it.",
    "You stayed. The wave is doing what waves do.",
    "Notice the loosening. That's real.",
    "The intensity is releasing — slowly.",
    "You surfed it. That counts.",
  ],
};

/**
 * Pick one encouragement line for the given wave phase. Sampling is
 * uniformly random; the caller is expected to capture the result in
 * useState so it stays stable for the lifetime of the phase.
 */
export function encouragementForPhase(phase: WaveTextPhase): string {
  const options = BANK[phase];
  const idx = Math.floor(Math.random() * options.length);
  return options[idx] ?? options[0]!;
}

/**
 * Exposed for tests and dashboards that want to assert the bank shape.
 */
export const ENCOURAGEMENT_BANK = BANK;
