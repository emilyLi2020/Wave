/**
 * Scripted Turn 1 + Turn 2 + Turn 5 openers for every check-in (1–5).
 *
 * NO LONGER THE RUNTIME SOURCE OF TRUTH.
 *
 * As of the LLM-driven check-in rewrite, the live `<CheckInChat />`
 * surface lets the LLM produce every agent turn — there are no
 * scripted openers in the live chat. Readiness is now signaled by
 * the model's `endConversation` tool call, not a regex match against
 * Turn 5.
 *
 * This file remains as the canonical phrasing the scripted fallback
 * bank reaches for when the LLM call fails twice in a row
 * (`fallbackCheckInTurn()` in fallback-bank.ts), and as a clinician-
 * reviewed reference for prompt tuning. Keep edits clinically
 * equivalent so a fallback session reads the same as a live one.
 *
 * @deprecated for runtime use by the live chat surface. Importing
 * `CHECK_IN_OPENERS` from `<CheckInChat />` is a bug. Fallback paths
 * and Synthetix scaffolding may still consume these.
 */

import type { ChunkNumber } from "@/types/session";

export interface CheckInOpeners {
  /** Turn 1 phrasing — the craving-score ask. */
  turn1: string;
  /**
   * Turn 2 phrasing — the open-ended "how did the chunk go" question.
   * The literal substring `[score reflection]` is replaced at runtime
   * by the score-tracking response phrase. The substring is ALWAYS
   * present in Turn 2 except for Check-in 1 (the baseline check-in,
   * where there is no prior score to reflect against).
   */
  turn2: string;
  /**
   * Turn 5 phrasing — the explicit readiness ask. Check-in 5 has no
   * Turn 5 readiness ask (PRD § Check-In Conversation Protocol >
   * Check-in 5 exception); its `turn5` is the closing prompt instead.
   */
  turn5: string;
}

export const CHECK_IN_OPENERS: Record<ChunkNumber, CheckInOpeners> = {
  1: {
    turn1:
      "Before we go deeper — on a scale of 1 to 10, how intense is the craving or urge right now?",
    turn2:
      "How are you feeling right now — emotionally, in your body? Anything that stands out?",
    turn5:
      "Ready to continue with the next part, the body scan, and see if it helps?",
  },
  2: {
    turn1: "Craving score right now, 1 to 10?",
    turn2:
      "[score reflection] Were you able to locate where the urge lives in your body?",
    turn5:
      "Ready to continue with the next part, the sound anchor, and see if it helps?",
  },
  3: {
    turn1: "How intense is the craving now, 1 to 10?",
    turn2:
      "[score reflection] Could you hold onto the sound of water, or was it hard to stay with?",
    turn5:
      "Ready to continue with the next part, the breathing, and see if it helps?",
  },
  4: {
    turn1: "Craving score, 1 to 10?",
    turn2:
      "[score reflection] How did the breathing feel — were you able to follow your own count, or did something get in the way?",
    turn5:
      "Ready to continue with the next part, the closing reflection, and see if it helps?",
  },
  5: {
    turn1: "Last check-in — craving score 1 to 10?",
    turn2:
      "[full-arc reflection] What did you notice about yourself during this practice?",
    // Check-in 5 closes; this is NOT a readiness ask.
    turn5:
      "Is there anything from this session you want to carry with you as you move through your day?",
  },
};

/**
 * Returns the opener triplet for a given check-in. Turn 2's
 * `[score reflection]` slot is left intact — fill it with
 * `fillScoreReflection(turn2, scores)` from
 * client/lib/session/score-tracking.ts before showing it to the
 * patient.
 */
export function openersForCheckIn(chunkNumber: ChunkNumber): CheckInOpeners {
  return CHECK_IN_OPENERS[chunkNumber];
}
