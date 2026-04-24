/**
 * Obstacle Response Library — the nine canonical obstacle classes.
 *
 * Source-of-truth copy for both the LoRA training data generator (in
 * client/synthetix/) and the scripted fallback bank (in
 * fallback-bank.ts). Any edit here propagates to both and requires a
 * clinician citation per AGENTS.md > Code Style and PRD.md >
 * Obstacle Response Library.
 *
 * Each obstacle is a Validate / Technique / Did-it-land triplet. The
 * Check-In Conversation Protocol places these strings in fixed slots:
 *   - Turn 3 = Validate (validation always before technique)
 *   - Turn 4 = Technique  (exactly one per turn, never two)
 *   - End of Turn 4 = Did-it-land
 *
 * Clinical grounding
 *   - Classes 1-8: MBRP (Bowen / Chawla / Marlatt) and DBT.
 *   - Class 9 (sleepiness): the Buddhist five-hindrances framing
 *     ("sloth and torpor") referenced in the Greo MBRP manual; clinically
 *     important for post-use patients and patients on sedating MAT.
 *   - Class 7 (guilt / failing) uses Tara Brach's RAIN protocol
 *     (True Refuge, 2013).
 *   - Validations flagged below use Marlatt's "double dukkha" framing.
 */

import type { ObstacleCategory } from "@/types/session";

export interface ObstacleEntry {
  id: ObstacleCategory;
  /** Human-readable name shown in eval reports and clinician review. */
  label: string;
  /** Turn 3 string. Validation, never a technique. */
  validate: string;
  /**
   * Turn 4 string. Exactly one technique. May be null only for
   * `gave_in`, whose "technique" is just the forward-looking
   * continuation question — there is no skill to teach in that moment.
   */
  technique: string | null;
  /** End-of-Turn-4 string. The "did it land" check. */
  didItLand: string;
}

export const OBSTACLE_LIBRARY: Record<ObstacleCategory, ObstacleEntry> = {
  cannot_visualize: {
    id: "cannot_visualize",
    label: "Cannot visualize / mind blank",
    validate:
      "That's completely normal — visualization is genuinely hard when the urge is strong. It takes practice, and it's okay that it didn't come easily today.",
    technique:
      "Instead of trying to picture anything, anchor to real sound first. Name 3 things you can actually hear right now. Then let the water sound layer in from there. You don't need to see anything. Just listen.",
    didItLand: "Does that feel more accessible?",
  },
  mind_wandering: {
    id: "mind_wandering",
    label: "Mind keeps wandering / can't focus",
    validate:
      "A wandering mind is not a failure — it's just what minds do, especially under stress. Every time you noticed and came back, that's the practice actually working.",
    technique:
      "Try labeling thoughts as they come. 'Planning.' 'Worrying.' 'Remembering.' Just the word, then return to the breath. The label creates a small distance between you and the thought.",
    didItLand: "Want to try that now before we continue?",
  },
  urge_overwhelming: {
    id: "urge_overwhelming",
    label: "Urge too intense / overwhelming",
    validate:
      "What you're feeling is real, and it takes courage to sit with it instead of running. You're doing that right now. Urges rarely last longer than 30 minutes, even when they feel endless. You don't need to make it go away — you just need to stay a little longer. The wave will break.",
    technique:
      "Bring your attention to exactly where you feel the urge most. Notice its edges — is it sharp or fuzzy? Warm or cool? Watching with that kind of curiosity creates just enough space that it becomes survivable.",
    didItLand: "Can you try that for a moment and tell me what you notice?",
  },
  breath_tight: {
    id: "breath_tight",
    label: "Breathing difficult / chest tight / couldn't complete exhale",
    validate:
      "When the urge is strong, the breath gets short — that's your nervous system in protection mode. That's not a sign you did it wrong.",
    technique:
      "Try shortening the counts: inhale for 3, hold for 2, exhale for 4. A shorter cycle you can actually complete does more than a longer one you're forcing.",
    didItLand: "Want to try a round right now?",
  },
  breath_anxiety: {
    id: "breath_anxiety",
    label: "Breathing increased anxiety",
    validate:
      "For some people, focused attention on the breath can increase awareness of body sensations, which can feel anxious at first. That's a real response, not something you did wrong.",
    technique:
      "Try grounding outward first — 5-4-3-2-1: name 5 things you see, 4 you hear, 3 you can touch, 2 you smell, 1 you taste. Come into the room first, then ease back into the body. The order matters.",
    // Implicit check per the PRD — no explicit "did it land" before
    // advancing to Turn 5. We still ship a soft acknowledgement string
    // so the chat surface always has something to render.
    didItLand: "When you're ready, we'll keep going.",
  },
  gave_in: {
    id: "gave_in",
    label: "Gave in to the urge / acted on it",
    validate:
      "Getting knocked off the wave is part of surfing. What matters is that you came back. A lot of people would have stopped entirely — you didn't. Research consistently shows that urge surfing builds capacity even when it's imperfect.",
    technique: null,
    didItLand: "You're still here. Want to keep going?",
  },
  guilt_failure: {
    id: "guilt_failure",
    // Validation uses Marlatt's "double dukkha" framing — see PRD.
    label: "Feeling guilty / like they're failing",
    validate:
      "There is no failing in urge surfing. The practice is just noticing — and you're doing that right now by recognizing this feeling. Adding shame on top of an urge makes the whole thing heavier; you don't have to carry that second layer.",
    technique:
      "Let's try something called RAIN — four quick steps. Recognize: name what's here, quietly to yourself — 'This is shame' or 'This is self-judgment.' Just naming it. Allow: you're not trying to make it leave, just letting it be there for a moment. Investigate: where do you feel it in your body? What does that part of you want? Nurture: put a hand on your heart, and offer whatever you most need to hear — 'I'm here,' or 'It's okay,' or 'I'm listening.' Even if it feels a little awkward at first.",
    didItLand:
      "Stay with that for a moment. What do you notice when you offer yourself that?",
  },
  physical_discomfort: {
    id: "physical_discomfort",
    label: "Physical discomfort (tension, headache, restlessness, pounding heart)",
    validate:
      "That physical discomfort is real. Let's work with it, not against it.",
    technique:
      "Bring your attention directly to where you feel the tension. Notice its edges — where exactly does it start and stop? Does it have a temperature? Does it shift with your breath? You're not trying to fix it. You're just watching it. Sometimes that attention is exactly what lets it soften.",
    didItLand: "What do you notice when you do that?",
  },
  sleepiness: {
    id: "sleepiness",
    label: "Sleepiness / drowsy / drifting off",
    validate:
      "Drowsiness in meditation is really common — the tradition calls it 'sloth and torpor.' It's often your body catching up after a long period of tension, and it doesn't mean you're doing this wrong.",
    technique:
      "Open your eyes softly and lift your gaze slightly — you can keep it low, it doesn't need to be bright. Sit up a little taller if you can. Take three slightly deeper, slightly faster breaths to bring a little energy back in. You can continue the rest of the practice with your eyes open — that's completely fine, and for right now it may actually help more than closing them again.",
    didItLand: "Feeling a little more awake? Good — no rush, whenever you're ready.",
  },
};

export const ALL_OBSTACLE_CATEGORIES: readonly ObstacleCategory[] = [
  "cannot_visualize",
  "mind_wandering",
  "urge_overwhelming",
  "breath_tight",
  "breath_anxiety",
  "gave_in",
  "guilt_failure",
  "physical_discomfort",
  "sleepiness",
];

export function obstacleEntry(id: ObstacleCategory): ObstacleEntry {
  return OBSTACLE_LIBRARY[id];
}

/**
 * Heuristic obstacle classifier used by the fallback bank when the
 * LLM is unavailable. The live LLM path infers the obstacle from the
 * patient's free text directly; this function is the offline-only
 * shortcut. Returns null when no clear obstacle keyword matches —
 * the caller should treat that as "no obstacle, advance with
 * affirmation only".
 */
export function classifyObstacle(text: string): ObstacleCategory | null {
  const t = text.toLowerCase();

  // Order matters: more specific matches first.
  if (
    /\b(used|drank|took|relapsed|gave in|caved|slipped)\b/.test(t) ||
    /\bi (had|did) (a |some )?\b/.test(t)
  ) {
    return "gave_in";
  }
  if (/\b(guilty|guilt|ashamed|shame|failing|failed|failure|stupid|hate myself)\b/.test(t)) {
    return "guilt_failure";
  }
  if (/\b(sleepy|drowsy|tired|drifting|nodding off|exhausted)\b/.test(t)) {
    return "sleepiness";
  }
  if (
    /\b(can'?t (see|picture|imagine|visualize)|mind (went )?blank|nothing comes)\b/.test(
      t,
    )
  ) {
    return "cannot_visualize";
  }
  if (/\b(mind wander|distract|can'?t focus|keep thinking|thoughts (keep|won'?t))\b/.test(t)) {
    return "mind_wandering";
  }
  if (/\b(panic|anxious|anxiety|breathing (made|makes) (me|it))\b/.test(t)) {
    return "breath_anxiety";
  }
  if (
    /\b(can'?t breathe|chest (tight|tightens)|short of breath|hard to breathe|hold(ing)? my breath)\b/.test(
      t,
    )
  ) {
    return "breath_tight";
  }
  if (
    /\b(too (much|strong|intense)|overwhelm|unbearable|can'?t (do this|take it)|9\/10|10\/10)\b/.test(
      t,
    )
  ) {
    return "urge_overwhelming";
  }
  if (/\b(headache|tension|restless|pain|sore|tight (in|in my)|nausea|nauseous|heart ?beats?|heartbeat|heart (is )?(pounding|racing|beating fast)|pulse|palpitations?|hot|flushed|shaky|shaking)\b/.test(t)) {
    return "physical_discomfort";
  }
  return null;
}
