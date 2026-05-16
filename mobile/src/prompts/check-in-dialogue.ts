/**
 * Canonical copy for check-in training transcripts and form scaffolding.
 * Intake (baseline) lives in structured context only; the patient names the
 * current score in reply to this prompt.
 */
export const CHECK_IN_CURRENT_URGE_SCALE_PROMPT =
  "On a scale of 1 to 10, how intense is the craving or urge right now?";

/**
 * Shared Turn 1 craving ask for check-ins 2–4 (after chunk narration, before the
 * landing split). Keep one string so training, fallback openers, and UI stay aligned.
 */
export const CHECK_IN_CHUNK234_SCORE_PROMPT =
  "How intense is the craving now, rate from 1 to 10?";

/**
 * Check-in 2 — Turn 1 only (after body-scan chunk). Matches
 * `CHECK_IN_OPENERS[2].turn1` in `client/lib/prompts/check-in-openers.ts`.
 */
export const CHECK_IN_CHUNK2_SCORE_PROMPT = CHECK_IN_CHUNK234_SCORE_PROMPT;

/**
 * Core body-location question (first sentence of
 * {@link CHECK_IN_BODY_URGE_LOCATION_OBSERVE_PROMPT}).
 */
export const CHECK_IN_BODY_URGE_LOCATION_PROMPT =
  "Were you able to locate where the urge lives in your body?";

/**
 * Second agent turn after the landing reply on **check-in 2** only: follows
 * "Great." or a brief validation of landing friction; must appear verbatim as a single block.
 */
export const CHECK_IN_BODY_URGE_LOCATION_OBSERVE_PROMPT =
  "Were you able to locate where the urge lives in your body? It is okay if you cannot; just observe and tell me how you feel?";

/**
 * Check-in 3 — first line (score ask). Matches `CHECK_IN_OPENERS[3].turn1`.
 */
export const CHECK_IN_CHUNK3_SCORE_PROMPT = CHECK_IN_CHUNK234_SCORE_PROMPT;

/**
 * Check-in 3 — second post-landing question (PRD / `CHECK_IN_OPENERS[3].turn2` without the
 * score-reflection prefix; reflection is woven in the first post-score turn).
 */
export const CHECK_IN_CHUNK3_ANCHOR_HOLD_PROMPT =
  "Could you hold onto the sound of water, or was it hard to stay with?";

/**
 * Readiness before Chunk 4 (breathing). Matches `CHECK_IN_OPENERS[3].turn5`.
 */
export const CHECK_IN_CHUNK3_READINESS_PROMPT =
  "Ready to continue with the next part, the breathing, and see if it helps?";

/**
 * Check-in 4 — first line (score ask). Matches `CHECK_IN_OPENERS[4].turn1`.
 */
export const CHECK_IN_CHUNK4_SCORE_PROMPT = CHECK_IN_CHUNK234_SCORE_PROMPT;

/**
 * Check-in 4 — second post-landing question (PRD / `CHECK_IN_OPENERS[4].turn2` without the
 * score-reflection prefix; reflection is woven in the first post-score turn).
 */
export const CHECK_IN_CHUNK4_BREATHING_FOLLOW_UP_PROMPT =
  "How did the breathing feel — were you able to follow your own count, or did something get in the way?";

/**
 * Readiness before Chunk 5 (closing). Matches `CHECK_IN_OPENERS[4].turn5`.
 */
export const CHECK_IN_CHUNK4_READINESS_PROMPT =
  "Ready to continue with the next part, the closing reflection, and see if it helps?";

/**
 * Check-in 5 — Turn 1 only (after closing chunk). Matches
 * `CHECK_IN_OPENERS[5].turn1` in `client/lib/prompts/check-in-openers.ts`.
 */
export const CHECK_IN_CHUNK5_SCORE_PROMPT =
  "Last check-in — craving score 1 to 10?";

/**
 * Check-in 5 — first substantive WAVE turn after the patient gives the final score. The
 * `[full-arc reflection]` slot is replaced by {@link fillScoreReflection} from
 * `client/lib/session/score-tracking.ts` (same mechanism as scripted Turn 2 openers).
 * Matches the shaped content of `CHECK_IN_OPENERS[5].turn2`.
 */
export const CHECK_IN_CHUNK5_NOTICE_OPENER_TEMPLATE =
  "[full-arc reflection] What did you notice about yourself during this practice?";

/**
 * Check-in 5 — closing question (not “ready to continue”; there is no next chunk).
 * Matches `CHECK_IN_OPENERS[5].turn5`.
 */
export const CHECK_IN_CHUNK5_CARRY_FORWARD_PROMPT =
  "Is there anything from this session you want to carry with you as you move through your day?";

/**
 * Verbatim block for the second WAVE turn after the score (after the patient answers the
 * landing prompt): body observe on check-in 2; sound-anchor hold on check-in 3; PRD breathing
 * follow-up on check-in 4.
 */
export function checkInPostLandingFollowUpPrompt(
  chunkNumber: 2 | 3 | 4,
): string {
  if (chunkNumber === 3) return CHECK_IN_CHUNK3_ANCHOR_HOLD_PROMPT;
  if (chunkNumber === 4) return CHECK_IN_CHUNK4_BREATHING_FOLLOW_UP_PROMPT;
  return CHECK_IN_BODY_URGE_LOCATION_OBSERVE_PROMPT;
}

/**
 * First agent turn after the score on check-in 2 — landing only (patient answers,
 * then WAVE says Great/validates and asks {@link CHECK_IN_BODY_URGE_LOCATION_OBSERVE_PROMPT}).
 */
export const CHECK_IN_CHUNK2_LANDING_SECTION_PROMPT =
  "How did the landing section of the meditation feel for you? Any questions or concerns?";

export const CHECK_IN_CHUNK3_LANDING_SECTION_PROMPT =
  "How did the landing section of the sound anchor feel for you? Any questions or concerns?";

export const CHECK_IN_CHUNK4_LANDING_SECTION_PROMPT =
  "How did the landing section of the breathing exercise feel for you? Any questions or concerns?";

export function checkInLandingSectionPrompt(chunkNumber: 2 | 3 | 4): string {
  if (chunkNumber === 2) return CHECK_IN_CHUNK2_LANDING_SECTION_PROMPT;
  if (chunkNumber === 3) return CHECK_IN_CHUNK3_LANDING_SECTION_PROMPT;
  return CHECK_IN_CHUNK4_LANDING_SECTION_PROMPT;
}

/**
 * Readiness ask before Chunk 3 (sound anchor). Matches `CHECK_IN_OPENERS[2].turn5`.
 */
export const CHECK_IN_CHUNK2_READINESS_PROMPT =
  "Ready to continue with the next part, the sound anchor, and see if it helps?";

/** Asked after validating the obstacle; before any coping instructions. */
export const CHECK_IN_COPING_CONSENT_PROMPT =
  "Would you like to try some coping strategies together to see if it helps?";

/**
 * First clause of WAVE’s turn immediately after the patient agrees to coping—keeps
 * continuity before concrete instructions (see `lora-check-in-1` training rules).
 */
export const CHECK_IN_COPING_BRIDGE_OPENER = "Great, let's try this together.";
