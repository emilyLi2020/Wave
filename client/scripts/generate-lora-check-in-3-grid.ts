/**
 * Writes data/training-seeds/lora-check-in-3.json with 48 draft seeds (or merges
 * when the file already has exactly one seed: keeps it and appends 47 grid rows).
 *
 * Mirrors check-in-2 stratification: 16 medicationStatus × trigger cells × 3
 * matType-rotated variants. Check-in 3: Turn 1 = CHECK_IN_CHUNK3_SCORE_PROMPT;
 * first post-score WAVE = score reflection vs prior check-in + CHECK_IN_CHUNK3_LANDING_SECTION_PROMPT
 * only; after landing reply, Great./validate + CHECK_IN_CHUNK3_ANCHOR_HOLD_PROMPT verbatim;
 * validate → consent → coping bridge → CHECK_IN_CHUNK3_READINESS_PROMPT.
 *
 * Run: cd client && pnpm exec tsx scripts/generate-lora-check-in-3-grid.ts
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { fillScoreReflection } from "../lib/session/score-tracking";
import {
  CHECK_IN_CHUNK3_ANCHOR_HOLD_PROMPT,
  CHECK_IN_CHUNK3_LANDING_SECTION_PROMPT,
  CHECK_IN_CHUNK3_READINESS_PROMPT,
  CHECK_IN_CHUNK3_SCORE_PROMPT,
  CHECK_IN_COPING_BRIDGE_OPENER,
  CHECK_IN_COPING_CONSENT_PROMPT,
} from "../lib/training/check-in-dialogue";
import { getSpec } from "../lib/training/lora-specs";
import type { LoRAId, TrainingSeed } from "../lib/training/types";

const LORA_ID = "lora-check-in-3" as LoRAId;
const OUT = path.resolve(
  path.join(__dirname, "..", "..", "data", "training-seeds", `${LORA_ID}.json`),
);

type Med = "buprenorphine" | "methadone" | "naltrexone" | "vivitrol" | "none";
type MedStatus = "on_time" | "late" | "missed" | "none";
type Trg = "social" | "stress" | "physical" | "unknown_or_other";

type ObstacleCat =
  | "cannot_visualize"
  | "mind_wandering"
  | "urge_overwhelming"
  | "breath_tight"
  | "breath_anxiety"
  | "gave_in"
  | "guilt_failure"
  | "physical_discomfort"
  | "sleepiness";

type Turn = { role: "patient" | "agent"; content: string };

interface IntensityPair {
  intakeIntensity: number;
  currentIntensity: number;
}

interface CellRow {
  medicationStatus: MedStatus;
  trigger: Trg;
  triggerOther: string | null;
  priorSummary: string;
  obstacleCategory: ObstacleCat;
  /** Patient reply after the anchor-hold question (Turn 2 path for chunk 3). */
  anchorHoldPatient: string;
  /** WAVE validates anchor struggle—no techniques here. */
  validateAnchor: string;
  /** After consent: concrete micro-skill (often real-sound or labeling; PRD obstacle library). */
  copingTechnique: string;
  /** Same order as matTriple(medicationStatus, trigger). */
  intensities: [IntensityPair, IntensityPair, IntensityPair];
}

function intensityTriple(
  pair: IntensityPair,
  variantIndex: number,
): {
  intakeIntensity: number;
  priorCheckInScore: number;
  currentIntensity: number;
} {
  const priorCheckInScore = pair.currentIntensity;
  const bump = variantIndex === 0 ? 0 : variantIndex === 1 ? 1 : -1;
  const currentIntensity = Math.min(
    10,
    Math.max(1, priorCheckInScore + bump),
  );
  return {
    intakeIntensity: pair.intakeIntensity,
    priorCheckInScore,
    currentIntensity,
  };
}

function scoreTrendForTraining(
  prior: number,
  current: number,
): "rising" | "falling" | "flat" | "mixed" {
  if (current < prior) return "falling";
  if (current > prior) return "rising";
  if (current === prior) return "flat";
  return "mixed";
}

function lastAgentReply(turns: Turn[]): string {
  const last = [...turns].reverse().find((t) => t.role === "agent");
  if (!last) throw new Error("No agent turn");
  return last.content.trim();
}

function matTriple(medicationStatus: MedStatus, trigger: Trg): [Med, Med, Med] {
  if (medicationStatus === "none") {
    return ["none", "none", "none"];
  }
  const key = `${medicationStatus}-${trigger}` as const;
  const map: Record<string, [Med, Med, Med]> = {
    "on_time-social": ["buprenorphine", "methadone", "naltrexone"],
    "on_time-stress": ["methadone", "naltrexone", "vivitrol"],
    "on_time-physical": ["naltrexone", "buprenorphine", "methadone"],
    "on_time-unknown_or_other": ["vivitrol", "buprenorphine", "methadone"],
    "late-social": ["buprenorphine", "methadone", "vivitrol"],
    "late-stress": ["methadone", "buprenorphine", "naltrexone"],
    "late-physical": ["buprenorphine", "naltrexone", "methadone"],
    "late-unknown_or_other": ["naltrexone", "vivitrol", "buprenorphine"],
    "missed-social": ["buprenorphine", "methadone", "naltrexone"],
    "missed-stress": ["methadone", "buprenorphine", "vivitrol"],
    "missed-physical": ["methadone", "naltrexone", "buprenorphine"],
    "missed-unknown_or_other": ["naltrexone", "methadone", "buprenorphine"],
  };
  return map[key] ?? ["buprenorphine", "methadone", "naltrexone"];
}

function patientCurrentScoreOnly(
  current: number,
  variantIndex: number,
): string {
  const mod = variantIndex % 3;
  if (mod === 0) {
    return String(current);
  }
  if (mod === 1) {
    return `About a ${current}.`;
  }
  return `Maybe ${current}.`;
}

function agentCopingAfterConsent(techniqueBody: string): string {
  return `${CHECK_IN_COPING_BRIDGE_OPENER} ${techniqueBody} After you give that a short try, what do you notice, even a small shift?`;
}

function patientConsentToCoping(variantIndex: number): string {
  const mod = variantIndex % 3;
  if (mod === 0) {
    return "Yes, I would like that.";
  }
  if (mod === 1) {
    return "Sure, we can try.";
  }
  return "Okay, let us try.";
}

const LANDING_ALL_CLEAR_PHRASES = [
  "No concerns, the water sound landed steady enough for me.",
  "No, nothing major—the anchor felt fine at the end.",
  "Fine, no real questions about the closing part.",
] as const;

const LANDING_FRICTION_BY_OBSTACLE: Record<
  ObstacleCat,
  { patient: string; agentLead: string }
> = {
  cannot_visualize: {
    patient:
      "The water imagery and sound went fuzzy in the closing lines—I could not really stay with it.",
    agentLead:
      "When the anchor thins out near the close, that is a normal nervous system move, not a failure.",
  },
  mind_wandering: {
    patient: "My mind kept wandering in the last minutes of the water sound.",
    agentLead:
      "Mind wandering near the close is really common, and it does not erase what you already practiced.",
  },
  urge_overwhelming: {
    patient:
      "The urge spiked right as the guidance slowed and the wave language got intense.",
    agentLead:
      "A late spike can show up when the pacing shifts; you are still allowed to stay curious instead of fighting it.",
  },
  breath_tight: {
    patient: "My chest felt tight during the landing lines of the water chunk.",
    agentLead:
      "Chest tightness at the end of an anchor is something a lot of people notice; you do not have to force calm.",
  },
  breath_anxiety: {
    patient: "Focusing on the close made my breath feel jumpy.",
    agentLead:
      "Breath anxiety at the tail of a practice is real, and you can keep the next step gentle.",
  },
  gave_in: {
    patient: "I almost checked out completely for the last bit of the water sound.",
    agentLead:
      "Checking out for a slice of the close still counts as staying in the room with yourself.",
  },
  guilt_failure: {
    patient:
      "I felt like I messed up the ending because I could not hold the sound the right way.",
    agentLead:
      "Perfection is not the goal here; shame voice is loud for a lot of people at the close.",
  },
  physical_discomfort: {
    patient: "My body felt restless and achy as the water chunk wrapped up.",
    agentLead:
      "Restlessness at the wrap-up is information, not proof you did it wrong.",
  },
  sleepiness: {
    patient: "I got heavy and foggy right at the end of the anchor.",
    agentLead:
      "Sleepy-heavy near the close happens often; your system may be down-shifting.",
  },
};

function buildDialogueTurns(row: CellRow, variantIndex: number): Turn[] {
  const triple = intensityTriple(row.intensities[variantIndex], variantIndex);
  const { priorCheckInScore: prior, currentIntensity: current } = triple;

  const scoreClause = fillScoreReflection(
    "[score reflection]",
    [prior, current],
    3,
  ).trim();

  const landingClear = variantIndex % 2 === 0;
  const patientLandingReply = landingClear
    ? LANDING_ALL_CLEAR_PHRASES[variantIndex % LANDING_ALL_CLEAR_PHRASES.length]
    : LANDING_FRICTION_BY_OBSTACLE[row.obstacleCategory].patient;

  const agentAfterLanding = landingClear
    ? `Great. ${CHECK_IN_CHUNK3_ANCHOR_HOLD_PROMPT}`
    : `${LANDING_FRICTION_BY_OBSTACLE[row.obstacleCategory].agentLead} ${CHECK_IN_CHUNK3_ANCHOR_HOLD_PROMPT}`;

  const agentLandingOnly = `Thanks for naming that. ${scoreClause} ${CHECK_IN_CHUNK3_LANDING_SECTION_PROMPT}`;

  const agentValidateAndAskConsent = `${row.validateAnchor} ${CHECK_IN_COPING_CONSENT_PROMPT}`;

  const patientAfterTechnique =
    "A little—not gone, but a small notch down. Enough that I could imagine the next step.";

  const agentCheckSkill =
    "Does that shift feel big enough to try the breathing section, or do you want one more slow moment with whatever sound you chose as an anchor before we go any further?";

  const patientMoveOn = "Enough to try moving on.";

  const patientYes = "Yes, I am ready.";

  return [
    { role: "agent", content: CHECK_IN_CHUNK3_SCORE_PROMPT },
    { role: "patient", content: patientCurrentScoreOnly(current, variantIndex) },
    { role: "agent", content: agentLandingOnly },
    { role: "patient", content: patientLandingReply },
    { role: "agent", content: agentAfterLanding },
    { role: "patient", content: row.anchorHoldPatient },
    { role: "agent", content: agentValidateAndAskConsent },
    { role: "patient", content: patientConsentToCoping(variantIndex) },
    { role: "agent", content: agentCopingAfterConsent(row.copingTechnique) },
    { role: "patient", content: patientAfterTechnique },
    { role: "agent", content: agentCheckSkill },
    { role: "patient", content: patientMoveOn },
    { role: "agent", content: CHECK_IN_CHUNK3_READINESS_PROMPT },
    { role: "patient", content: patientYes },
  ];
}

const GRID: CellRow[] = [
  {
    medicationStatus: "on_time",
    trigger: "social",
    triggerOther: null,
    priorSummary:
      "The sound-anchor chunk layered gentle water imagery, invited returns to the sound when attention wandered, and framed the urge as a wave to watch without obeying it.",
    obstacleCategory: "mind_wandering",
    anchorHoldPatient:
      "Partly—I caught the water for a second, but my mind kept replaying lunch and I kept losing the thread of the sound.",
    validateAnchor:
      "When social stress meets an anchor, attention can skip between face heat and replay thoughts—that is a normal split focus.",
    copingTechnique:
      "Pick one real sound you can hear right now—HVAC, traffic, a clock—and let that be the anchor for three slow breaths; when commentary shows up, silently label it as thinking and return to that sound.",
    intensities: [
      { intakeIntensity: 6, currentIntensity: 7 },
      { intakeIntensity: 6, currentIntensity: 8 },
      { intakeIntensity: 7, currentIntensity: 7 },
    ],
  },
  {
    medicationStatus: "on_time",
    trigger: "stress",
    triggerOther: null,
    priorSummary:
      "The anchor chunk used ocean or stream sound as a steadying thread, normalized mind-wandering, and encouraged curiosity toward the urge as it moved.",
    obstacleCategory: "mind_wandering",
    anchorHoldPatient:
      "Stress hooked a money text I have not answered—my mind kept drafting replies instead of staying with the water sound.",
    validateAnchor:
      "Money stress can glue attention to problem-solving when your nervous system is already full.",
    copingTechnique:
      "For three breaths, keep your eyes softly open if that helps, and rest attention on the quietest real sound in the room—far away counts. Let exhale be slightly longer than inhale without forcing depth.",
    intensities: [
      { intakeIntensity: 7, currentIntensity: 8 },
      { intakeIntensity: 7, currentIntensity: 7 },
      { intakeIntensity: 8, currentIntensity: 6 },
    ],
  },
  {
    medicationStatus: "on_time",
    trigger: "physical",
    triggerOther: null,
    priorSummary:
      "The chunk introduced water sound as something to ride with, offered brief imagery of safety on the shore, and reminded you to come back to sound when the mind drifts.",
    obstacleCategory: "physical_discomfort",
    anchorHoldPatient:
      "Restless legs and sweating—the urge buzzed and the sound felt thin, like I could not really land on it.",
    validateAnchor:
      "When sensation and urge tangle, a thin-sounding anchor can feel unfair; that mismatch is common, not proof you failed.",
    copingTechnique:
      "Place both feet flat and press gently into the floor for three breaths—light pressure, not a workout. Add one real sound you can hear and let that be the thread instead of forcing the imagined water.",
    intensities: [
      { intakeIntensity: 8, currentIntensity: 6 },
      { intakeIntensity: 8, currentIntensity: 7 },
      { intakeIntensity: 7, currentIntensity: 8 },
    ],
  },
  {
    medicationStatus: "on_time",
    trigger: "unknown_or_other",
    triggerOther: "racing thoughts before bed",
    priorSummary:
      "The anchor section offered a steady water bed under the practice, language about the wave rising and falling, and permission to return without self-attack.",
    obstacleCategory: "mind_wandering",
    anchorHoldPatient:
      "Racing thoughts before bed—many threads, I could not keep the water sound in front long enough.",
    validateAnchor:
      "Nighttime racing thoughts are real, and they can drown out a gentle sound anchor.",
    copingTechnique:
      "Try labeling thoughts as background noise, then return to one real environmental sound for two slow breaths—no debate with the thoughts, just a soft return.",
    intensities: [
      { intakeIntensity: 5, currentIntensity: 5 },
      { intakeIntensity: 5, currentIntensity: 6 },
      { intakeIntensity: 6, currentIntensity: 5 },
    ],
  },
  {
    medicationStatus: "late",
    trigger: "social",
    triggerOther: null,
    priorSummary:
      "The sound chunk invited listening without forcing calm, used water as a repeatable return point, and reminded you the wave peaks and falls.",
    obstacleCategory: "guilt_failure",
    anchorHoldPatient:
      "I kept judging whether I was doing the sound right—inner critic loud, like everyone can tell I am off.",
    validateAnchor:
      "Shame voice loves to yell during social urges, and it is not a moral verdict on you.",
    copingTechnique:
      "Soften your gaze or let vision go slightly wide for a few seconds—less laser focus. Pick a boring real sound and stay with it for three breaths; when the critic speaks, note it as thinking and return.",
    intensities: [
      { intakeIntensity: 7, currentIntensity: 8 },
      { intakeIntensity: 7, currentIntensity: 7 },
      { intakeIntensity: 8, currentIntensity: 7 },
    ],
  },
  {
    medicationStatus: "late",
    trigger: "stress",
    triggerOther: null,
    priorSummary:
      "The anchor used steady water audio as a thread, encouraged gentle returns when attention wandered, and framed discomfort as observable.",
    obstacleCategory: "breath_tight",
    anchorHoldPatient:
      "Future worry about bills—chest tight, and the water sound almost made me feel like I had to breathe deeper than I could.",
    validateAnchor:
      "Chest tightness with stress is common here, and you do not have to force a deep breath to use an anchor.",
    copingTechnique:
      "Breathe through your nose if it is comfortable, smaller volume, steady pace. Let a real nearby sound carry the anchor while you keep inhales easy and favor a slightly longer, unforced exhale.",
    intensities: [
      { intakeIntensity: 6, currentIntensity: 6 },
      { intakeIntensity: 6, currentIntensity: 7 },
      { intakeIntensity: 5, currentIntensity: 6 },
    ],
  },
  {
    medicationStatus: "late",
    trigger: "physical",
    triggerOther: null,
    priorSummary:
      "The chunk described the urge as a wave, used water sound as something to return to, and normalized intensification when attention shifts.",
    obstacleCategory: "physical_discomfort",
    anchorHoldPatient:
      "Restlessness and sweating—the ache got sharper when I tried to lock onto the sound, then my mind bounced away.",
    validateAnchor:
      "Turning toward sensation and sound together can feel like too much for a moment—that is data, not failure.",
    copingTechnique:
      "For three breaths, name silently where your feet meet the floor—heels, toes, sides—without changing posture. Add one real sound thread and let the imagined water rest.",
    intensities: [
      { intakeIntensity: 9, currentIntensity: 7 },
      { intakeIntensity: 9, currentIntensity: 8 },
      { intakeIntensity: 8, currentIntensity: 7 },
    ],
  },
  {
    medicationStatus: "late",
    trigger: "unknown_or_other",
    triggerOther: "hard to explain, just off",
    priorSummary:
      "The sound anchor offered a wash of water imagery, simple returns to listening, and language about staying on the wave without wrestling.",
    obstacleCategory: "sleepiness",
    anchorHoldPatient:
      "Heavy and a little buzzy—static feeling, hard to explain, and I kept drifting off the water sound.",
    validateAnchor:
      "Vague off feelings still deserve respect, and drifting attention is a normal nervous system move.",
    copingTechnique:
      "Open and close your hands slowly twice, feeling contact at the palms. Then pick one real sound—even quiet room tone—and listen for three slow breaths without forcing alertness.",
    intensities: [
      { intakeIntensity: 4, currentIntensity: 5 },
      { intakeIntensity: 4, currentIntensity: 4 },
      { intakeIntensity: 5, currentIntensity: 5 },
    ],
  },
  {
    medicationStatus: "missed",
    trigger: "social",
    triggerOther: null,
    priorSummary:
      "The anchor chunk used water as a steady reference, invited curiosity about the urge, and reminded you to return kindly when the mind drifts.",
    obstacleCategory: "urge_overwhelming",
    anchorHoldPatient:
      "Judgment spike—like everyone can tell—and the urge volume jumped while the sound felt far away.",
    validateAnchor:
      "A sharp social spike can flood attention fast; the sound feeling distant is a common mismatch.",
    copingTechnique:
      "Ground contact: press feet gently, notice seat or floor support, and add one slow exhale longer than the inhale—two cycles only. Use the smallest real sound you can find as the anchor instead of pushing the imagery.",
    intensities: [
      { intakeIntensity: 7, currentIntensity: 9 },
      { intakeIntensity: 7, currentIntensity: 8 },
      { intakeIntensity: 8, currentIntensity: 8 },
    ],
  },
  {
    medicationStatus: "missed",
    trigger: "stress",
    triggerOther: null,
    priorSummary:
      "The water-sound section framed riding the wave, offered brief safe imagery, and emphasized return over perfection.",
    obstacleCategory: "mind_wandering",
    anchorHoldPatient:
      "Long-running overload—chest like a vise, mind drafting worst cases instead of staying with the water.",
    validateAnchor:
      "Overload narrows the window on purpose; your mind tries to solve everything at once.",
    copingTechnique:
      "Try exhale-longer-only pacing for two rounds; if counting feels like pressure, drop numbers. Let a real environmental sound be the return point and label planning thoughts as thinking when they hook you.",
    intensities: [
      { intakeIntensity: 8, currentIntensity: 8 },
      { intakeIntensity: 8, currentIntensity: 9 },
      { intakeIntensity: 7, currentIntensity: 8 },
    ],
  },
  {
    medicationStatus: "missed",
    trigger: "physical",
    triggerOther: null,
    priorSummary:
      "The chunk used ocean or stream sound as an anchor to surf discomfort, with gentle reminders to come back without shame.",
    obstacleCategory: "physical_discomfort",
    anchorHoldPatient:
      "Nausea and fatigue tied together—I could not tell craving from feeling sick, and the sound felt irritating.",
    validateAnchor:
      "When nausea and urge tangle, a sound anchor can feel irritating; small sensory shifts help without arguing with the body.",
    copingTechnique:
      "Notice cool air at the nostrils on inhale, warmer on exhale—three breaths. If even that feels like too much, feel the weight of your head supported and add one neutral real sound you can tolerate.",
    intensities: [
      { intakeIntensity: 6, currentIntensity: 5 },
      { intakeIntensity: 6, currentIntensity: 6 },
      { intakeIntensity: 7, currentIntensity: 6 },
    ],
  },
  {
    medicationStatus: "missed",
    trigger: "unknown_or_other",
    triggerOther: "anniversary date",
    priorSummary:
      "The anchor invited listening to water as a steady thread, normalized wandering minds, and used wave language for the urge.",
    obstacleCategory: "guilt_failure",
    anchorHoldPatient:
      "Anniversary tension with grief underneath—intrusive memories kept pulling me off the sound.",
    validateAnchor:
      "Anniversaries can braid grief with craving cues, and that is not weakness.",
    copingTechnique:
      "Place one palm over your sternum, light contact, and breathe so the hand rises a little—small breaths are fine. Pick one real sound in the room and return to it after each memory surge, without forcing the water image.",
    intensities: [
      { intakeIntensity: 5, currentIntensity: 7 },
      { intakeIntensity: 5, currentIntensity: 6 },
      { intakeIntensity: 6, currentIntensity: 7 },
    ],
  },
  {
    medicationStatus: "none",
    trigger: "social",
    triggerOther: null,
    priorSummary:
      "The sound chunk offered water as something you can return to anytime, described the urge as a wave, and kept tone nonjudgmental.",
    obstacleCategory: "mind_wandering",
    anchorHoldPatient:
      "Flooded in the room—comparison thoughts, face hot, mind blank when I tried to listen for the water.",
    validateAnchor:
      "Flooded is an accurate word, and comparison thoughts are a common hijack.",
    copingTechnique:
      "Let your vision soften slightly—less detail, more periphery—for a few seconds. Choose one real sound you can hear and stay with it for three breaths; when comparison shows up, label it and return.",
    intensities: [
      { intakeIntensity: 7, currentIntensity: 8 },
      { intakeIntensity: 7, currentIntensity: 7 },
      { intakeIntensity: 8, currentIntensity: 7 },
    ],
  },
  {
    medicationStatus: "none",
    trigger: "stress",
    triggerOther: null,
    priorSummary:
      "The anchor section used steady water audio, encouraged gentle returns, and framed urge surfing as staying present without obeying.",
    obstacleCategory: "breath_tight",
    anchorHoldPatient:
      "Thoughts first, then my stomach dropped—the sound felt like it demanded a breath I could not take.",
    validateAnchor:
      "Snap-back still happens in real practice; it does not erase the half-step, and anchors do not require big breaths.",
    copingTechnique:
      "Ground through sound: notice the quietest real sound you can hear for three breaths—far away is fine. Keep inhales easy; favor a slightly longer, unforced exhale without reaching for depth.",
    intensities: [
      { intakeIntensity: 8, currentIntensity: 6 },
      { intakeIntensity: 8, currentIntensity: 8 },
      { intakeIntensity: 7, currentIntensity: 8 },
    ],
  },
  {
    medicationStatus: "none",
    trigger: "physical",
    triggerOther: null,
    priorSummary:
      "The water chunk layered imagery of cool sand or shoreline safety with instructions to ride the urge like a wave.",
    obstacleCategory: "physical_discomfort",
    anchorHoldPatient:
      "Sensation jumped—chest then legs—craving and achy mixed, and I argued with the sound in my head.",
    validateAnchor:
      "Mixed body signals can argue with an anchor; that reaction is information, not proof the practice failed.",
    copingTechnique:
      "Trace an imaginary line from crown to tailbone as a slow inner scan—no fixing, just noticing contact with chair or floor. Add one boring real sound as a thread for two slow exhales.",
    intensities: [
      { intakeIntensity: 6, currentIntensity: 6 },
      { intakeIntensity: 6, currentIntensity: 7 },
      { intakeIntensity: 5, currentIntensity: 6 },
    ],
  },
  {
    medicationStatus: "none",
    trigger: "unknown_or_other",
    triggerOther: "loneliness",
    priorSummary:
      "The anchor chunk used water sound as a return point, normalized mind-wandering, and invited watching the urge crest and fall.",
    obstacleCategory: "mind_wandering",
    anchorHoldPatient:
      "Isolation even when I am not alone—heaviness, foggy focus, shame thoughts pulling me away from the water.",
    validateAnchor:
      "Loneliness can sit in the body like weight, and shame thoughts are not the truth of who you are.",
    copingTechnique:
      "Try hand-on-heart, gentle pressure, and two breaths where exhale leaves a little slower. Silently name one real sound, then one texture you can touch nearby, and return to the sound.",
    intensities: [
      { intakeIntensity: 7, currentIntensity: 5 },
      { intakeIntensity: 7, currentIntensity: 6 },
      { intakeIntensity: 6, currentIntensity: 5 },
    ],
  },
];

function assertGridMatRotation() {
  for (const row of GRID) {
    for (let i = 0; i < 3; i += 1) {
      const turns = buildDialogueTurns(row, i);
      if (turns[0]?.role !== "agent") throw new Error("First turn must be WAVE");
      if (turns[1]?.role !== "patient") throw new Error("Second turn must be patient");
    }
  }
}

function assertOutputs(spec: ReturnType<typeof getSpec>) {
  for (const row of GRID) {
    for (let variantIndex = 0; variantIndex < 3; variantIndex += 1) {
      const triple = intensityTriple(row.intensities[variantIndex], variantIndex);
      const { currentIntensity } = triple;
      const turns = buildDialogueTurns(row, variantIndex);
      const reply = lastAgentReply(turns);
      if (reply.length > 600) {
        throw new Error(
          `Reply too long (${reply.length}) for ${row.medicationStatus}/${row.trigger} variant ${variantIndex}`,
        );
      }
      for (const line of turns) {
        if (
          line.role === "agent" &&
          !line.content.trim().endsWith("?")
        ) {
          throw new Error(
            `Agent line must end with ?: ${line.content.slice(0, 80)}…`,
          );
        }
      }
      const output = {
        reply,
        endConversation: {
          action: "end" as const,
          cravingScore: currentIntensity,
          obstacleCategory: row.obstacleCategory,
        },
        dialogueTurns: turns,
      };
      const check = spec.outputSchema.safeParse(output);
      if (!check.success) {
        throw new Error(
          `Output invalid ${row.medicationStatus}/${row.trigger} v${variantIndex}: ${JSON.stringify(check.error.issues)}`,
        );
      }
    }
  }
}

function buildGridSeeds(): TrainingSeed[] {
  const now = new Date().toISOString();
  const spec = getSpec(LORA_ID);
  assertGridMatRotation();
  assertOutputs(spec);

  const seeds: TrainingSeed[] = [];
  for (const row of GRID) {
    const expectedMats = matTriple(row.medicationStatus, row.trigger);
    for (let variantIndex = 0; variantIndex < 3; variantIndex += 1) {
      const matType = expectedMats[variantIndex];
      const triple = intensityTriple(row.intensities[variantIndex], variantIndex);
      const { intakeIntensity, currentIntensity } = triple;
      const turns = buildDialogueTurns(row, variantIndex);
      const reply = lastAgentReply(turns);

      const input = {
        surface: "check_in" as const,
        chunkNumber: 3 as const,
        intakeIntensity,
        matType,
        medicationStatus: row.medicationStatus,
        trigger: row.trigger,
        ...(row.triggerOther ? { triggerOther: row.triggerOther } : {}),
        usedSubstanceToday: false,
        currentIntensity,
        scoreTrend: scoreTrendForTraining(
          triple.priorCheckInScore,
          triple.currentIntensity,
        ),
        priorChunkSummary: row.priorSummary,
        priorTranscript: undefined as string | undefined,
      };

      const output = {
        reply,
        endConversation: {
          action: "end" as const,
          cravingScore: currentIntensity,
          obstacleCategory: row.obstacleCategory,
        },
        dialogueTurns: turns,
      };

      const inputCheck = spec.inputSchema.safeParse(input);
      if (!inputCheck.success) {
        throw new Error(
          `Input invalid: ${JSON.stringify(inputCheck.error.issues)}`,
        );
      }
      const outputCheck = spec.outputSchema.safeParse(output);
      if (!outputCheck.success) {
        throw new Error(
          `Output invalid: ${JSON.stringify(outputCheck.error.issues)}`,
        );
      }

      seeds.push({
        id: randomUUID(),
        loraId: LORA_ID,
        input: inputCheck.data as Record<string, unknown>,
        output: outputCheck.data as Record<string, unknown>,
        authorInitials: null,
        notes:
          "Draft grid: check-in 3 after sound anchor; score reflection vs prior check-in; landing split; verbatim anchor-hold question; consent + coping bridge; readiness for breathing. 3 mat rotations per cell. Clinician review before promotion.",
        status: "draft",
        createdAt: now,
        updatedAt: now,
      });
    }
  }
  return seeds;
}

function loadSingleExistingSeed(): TrainingSeed | null {
  if (!existsSync(OUT)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(OUT, "utf8")) as unknown;
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 1) return null;
  const only = parsed[0] as TrainingSeed;
  if (only.loraId !== LORA_ID) return null;
  return only;
}

const gridSeeds = buildGridSeeds();
const handcrafted = loadSingleExistingSeed();
const merged: TrainingSeed[] = handcrafted
  ? [handcrafted, ...gridSeeds.slice(1)]
  : gridSeeds;

writeFileSync(OUT, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
console.log(
  handcrafted
    ? `Merged 1 existing + ${merged.length - 1} grid seeds (${merged.length} total) → ${OUT}`
    : `Wrote ${merged.length} seeds to ${OUT}`,
);
