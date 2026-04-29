/**
 * Readiness-gate helper.
 *
 * Returns true when the patient's free-text reply parses as an
 * affirmative answer to a Turn 5 "ready to continue?" prompt. The
 * session state machine refuses to advance from a check-in to the next
 * chunk unless this returns true (PRD § Check-In Conversation Protocol
 * > Rules that never bend > "Never advance to the next chunk without
 * explicit affirmative readiness").
 *
 * The matcher is intentionally loose — we accept short colloquial
 * affirmations ("ok", "yep", "let's go") because the patient is in a
 * meditative state and we do not want to nag them for a more polished
 * answer. We only refuse to advance on clearly negative or ambiguous
 * replies; the chat surface then re-issues the readiness prompt or
 * routes to "Take more time" handling.
 */

const AFFIRMATIVE_PATTERN =
  /^(\s*(yes|yeah|yep|yup|ya|ok(ay)?|sure|ready|i['’]?m ready|i am ready|all ?good|continue|let['’]?s (go|continue|do (it|this))|sounds good|sounds? ?okay|alright|aye|mhm|m+hm+|👍|✅)\b)/i;

/**
 * Tight-bounded check the state machine uses at the readiness gate.
 * Patient replies under 60 characters are checked against the
 * affirmative pattern; longer replies almost always contain caveats
 * ("yes but I'm worried…") that the chat surface should route to a
 * follow-up turn rather than treat as a green light to advance.
 */
export function isAffirmative(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.length > 60) return false;
  return AFFIRMATIVE_PATTERN.test(trimmed);
}

const NEGATIVE_PATTERN =
  /^(\s*(no|not yet|nope|wait|hold on|hang on|one (sec|moment|minute)|need a (sec|minute|moment|bit)|not ready)\b)/i;

/**
 * Distinguishes "patient said no, ask again later" from "ambiguous,
 * the chat surface should follow up." Used by the check-in chat to
 * pick a soft response instead of just stalling silently.
 */
export function isExplicitNotReady(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  return NEGATIVE_PATTERN.test(trimmed);
}
