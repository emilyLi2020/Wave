/**
 * Score-tracking response patterns for the check-in chat.
 *
 * Implements PRD § Score-tracking response patterns. Drives two
 * surfaces:
 *   - The Turn 2 opener uses the literal `[score reflection]` slot
 *     (or `[full-arc reflection]` at Check-in 5). `fillScoreReflection()`
 *     replaces it with the right phrase from this file.
 *   - The check-in prompt builder also surfaces a `tone` hint
 *     (`scoreReflectionTone()`) so the LoRA system prompt can adjust
 *     Turn 3 affirmation copy without inventing a new phrase.
 *
 * The score history is the ordered list of craving scores collected at
 * Turn 1 of every check-in completed so far, INCLUDING the one we are
 * filling the slot for. So at Check-in 2 the array has length 2: the
 * Check-in 1 score and the just-collected Check-in 2 score.
 */

import type { ChunkNumber } from "@/types/session";

export type ScoreTone =
  | "no-prior"
  | "decreased"
  | "steady"
  | "increased"
  | "stays-high"
  | "stays-low"
  | "high-single"
  | "high-stuck-since-baseline"
  | "low-final"
  | "no-change-final";

const HIGH_SCORE = 7;
const VERY_HIGH_SCORE = 8;
const LOW_SCORE = 4;

/**
 * Decides which score-trend bucket the latest reading falls into. The
 * bucket priority for the closing check-in (Check-in 5) considers
 * "no-change-final" and "low-final" before the standard movement
 * buckets.
 */
export function scoreReflectionTone(scores: readonly number[]): ScoreTone {
  if (scores.length === 0) return "no-prior";
  if (scores.length === 1) return "no-prior";

  const now = scores[scores.length - 1];
  const prev = scores[scores.length - 2];

  const allSame = scores.every((s) => s === scores[0]);
  if (allSame && scores.length >= 5) return "no-change-final";

  // Two-or-more consecutive high reads (≥7) without a drop.
  if (
    scores.length >= 2 &&
    now >= HIGH_SCORE &&
    prev >= HIGH_SCORE &&
    now >= prev
  ) {
    // Stronger escalation: same high score has held since Check-in 1.
    if (
      now >= VERY_HIGH_SCORE &&
      scores.length >= 3 &&
      scores.every((s) => s >= scores[0])
    ) {
      return "high-stuck-since-baseline";
    }
    return "stays-high";
  }

  // Two-or-more consecutive low reads (≤4) without an upward fluctuation.
  if (
    scores.length >= 2 &&
    now <= LOW_SCORE &&
    prev <= LOW_SCORE &&
    now <= prev
  ) {
    return "stays-low";
  }

  if (now < prev) return "decreased";
  if (now > prev) return "increased";
  return "steady";
}

const CHUNK_EFFECT_LABEL: Record<ChunkNumber, string> = {
  1: "the settling",
  2: "the body scan",
  3: "the sound anchor",
  4: "the breathing",
  5: "this practice",
};

/**
 * Picks the runtime phrase for the [score reflection] slot in the
 * Turn 2 opener of check-ins 2-5. At Check-in 1 (no prior score),
 * the slot phrase is empty.
 *
 * At Check-in 5 the slot is `[full-arc reflection]` instead — handled
 * the same way.
 */
export function fillScoreReflection(
  template: string,
  scores: readonly number[],
  chunkNumber: ChunkNumber,
): string {
  const slot = /\[(score reflection|full-arc reflection)\]/;
  if (!slot.test(template)) return template;

  const phrase = scoreReflectionPhrase(scores, chunkNumber);
  return template.replace(slot, phrase).replace(/\s{2,}/g, " ").trim();
}

function scoreReflectionPhrase(
  scores: readonly number[],
  chunkNumber: ChunkNumber,
): string {
  if (scores.length === 0) return "";

  const tone = scoreReflectionTone(scores);
  const now = scores[scores.length - 1];
  const prev = scores.length >= 2 ? scores[scores.length - 2] : null;
  const baseline = scores[0];

  const chunkEffect = CHUNK_EFFECT_LABEL[chunkNumber];

  switch (tone) {
    case "no-prior":
      return "";
    case "decreased":
      return `You moved from ${prev} to ${now} — that's ${chunkEffect} doing its work.`;
    case "steady":
      return `Still at ${now} — holding steady without acting is the practice.`;
    case "increased":
      return `It moved from ${prev} to ${now}. That's not failure — urges often spike before they crest, and staying with it still counts.`;
    case "stays-high":
      return `Still sitting at ${now}. This one is really holding on — and you are too.`;
    case "stays-low":
      return `Still at ${now} — you came in grounded and you're staying there. Noticing that you're okay is part of the practice.`;
    case "high-single":
      return `You're at ${now}. That's a lot to be sitting with.`;
    case "high-stuck-since-baseline":
      return `You're at ${now}. That's a lot to be sitting with, and it's been building for a while now.`;
    case "low-final":
      return `You started at ${baseline} and you're at ${now} now. The wave moved through you.`;
    case "no-change-final":
      return `You held at ${baseline} the whole way. You sat with an intense urge and didn't act on it — that is the practice.`;
  }
}
