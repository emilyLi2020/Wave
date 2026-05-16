/**
 * Pulls a 1–10 craving score out of a free-form patient utterance.
 *
 * The voice check-in uses this on the first STT transcript ("about a six"
 * → 6) to seed `cravingScore` before the LLM has a chance to emit an
 * `endConversation` signal. It is intentionally permissive but rejects
 * comparative or negated mentions, because picking a clinically wrong
 * score is worse than asking again.
 *
 * Rules:
 *   - Digit boundary `\b(10|[1-9])\b` and number-word forms ("one" …
 *     "ten") both count as candidates.
 *   - "not a 6", "less than 5", "more than 7" → that candidate is
 *     dropped. If nothing else is left, return null and let the caller
 *     re-ask.
 *   - Two candidates joined by `or` / `and` (including "between X and Y"
 *     and "X to Y") → pick the higher (conservative clinical default).
 *   - Otherwise prefer the LAST candidate to handle self-correction
 *     ("five — actually six").
 *   - Empty/no-match → null.
 */

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

/** Words that disqualify the candidate they precede. */
const NEGATION_PREFIXES = [
  "not",
  "less than",
  "fewer than",
  "more than",
  "greater than",
  "over",
  "under",
  "below",
  "above",
  "almost",
  "around about",
  "near",
];

interface Candidate {
  value: number;
  start: number;
  end: number;
}

/**
 * Returns a craving score in [1, 10] or null if the text doesn't contain
 * a confidently extractable number.
 */
export function extractCravingScore(text: string): number | null {
  if (!text || typeof text !== "string") return null;
  const normalized = text.toLowerCase().trim();
  if (normalized.length === 0) return null;

  const candidates: Candidate[] = [];

  // Digit form: 1-10. \b avoids matching the "1" in "11" or the "2" in "12".
  const digitRegex = /\b(10|[1-9])\b/g;
  let match: RegExpExecArray | null;
  while ((match = digitRegex.exec(normalized)) !== null) {
    candidates.push({
      value: Number.parseInt(match[1], 10),
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  // Word form: one … ten.
  const wordRegex = /\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/g;
  while ((match = wordRegex.exec(normalized)) !== null) {
    const value = NUMBER_WORDS[match[1]];
    if (value === undefined) continue;
    candidates.push({
      value,
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.start - b.start);

  // Drop candidates whose immediate left context is a negation/comparison
  // marker. We look at up to ~24 chars before the candidate, ignoring a
  // single filler word like "a", "an", "like", "maybe", "really".
  const valid = candidates.filter((c) => !hasNegationBefore(normalized, c.start));
  if (valid.length === 0) return null;

  // Range disambiguation: if two adjacent valid candidates are joined by
  // an "or" / "and" / "to" connector, pick the higher of the two
  // (conservative clinical bias). Look at the literal gap text only —
  // anything more nuanced is the model's job.
  for (let i = 0; i < valid.length - 1; i += 1) {
    const gap = normalized.slice(valid[i].end, valid[i + 1].start);
    if (/^\s*(or|and|to|-|–|—)\s*$/.test(gap)) {
      return Math.max(valid[i].value, valid[i + 1].value);
    }
  }

  // Default: last wins. Handles "five — actually six" and "I'm at a 6"
  // (single candidate) identically.
  return valid[valid.length - 1].value;
}

function hasNegationBefore(text: string, position: number): boolean {
  const lookback = text.slice(Math.max(0, position - 24), position).trimEnd();
  // Strip a trailing filler word so "not a 6" and "not really a 6" both match.
  const stripped = lookback.replace(/\b(a|an|like|maybe|really|just|about)\s*$/i, "").trimEnd();
  for (const prefix of NEGATION_PREFIXES) {
    if (stripped.endsWith(prefix)) return true;
  }
  return false;
}
