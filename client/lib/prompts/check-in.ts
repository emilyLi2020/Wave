/**
 * Check-in prompt builder.
 *
 * Assembles the per-conversation user-message block sent to local
 * Gemma. The system prompt is the canonical WAVE_SYSTEM_PROMPT from
 * wave-system.ts, augmented with check-in-specific instructions:
 *
 *   - The LLM drives EVERY agent turn. There are no scripted openers
 *     baked into the chat history; the chat starts with the patient's
 *     first message (their craving-score reply from the slider).
 *   - The LLM owns conversational flow: validate before technique,
 *     one technique max, normalize before normalizing-a-second-time.
 *   - When the LLM judges the check-in complete, it returns an
 *     `endConversation` signal. There is no regex-based readiness gate
 *     any more.
 *   - The LLM optionally classifies the patient's primary obstacle as
 *     part of the `endConversation` call so the chunk generator for
 *     the next chunk can ground its narration in it.
 *
 * The context block is the *only* place where chunk-specific guidance
 * (which check-in is this, what's the score trend, what the patient
 * has heard / said earlier in the session, what medication context
 * applies) gets injected.
 */

import { WAVE_SYSTEM_PROMPT } from "./wave-system";
import { CHECK_IN_OPENERS } from "./check-in-openers";
import {
  formatIntakeTriggerLineForPrompt,
  formatMatMissedDoseReferenceForPrompt,
} from "./mat-missed-dose-reference";
import type {
  CheckInContextPayload,
  SessionHistoryEntry,
} from "./schemas";
import { fillScoreReflection } from "@/lib/session/score-tracking";
import {
  checkInLandingSectionPrompt,
  checkInPostLandingFollowUpPrompt,
} from "@/lib/training/check-in-dialogue";

export interface BuiltCheckInPrompt {
  systemPrompt: string;
  /**
   * Single user-message block prepended to the chat history. Frames
   * the check-in for the model. The chat history follows.
   */
  contextBlock: string;
}

export interface BuildCheckInPromptMeta {
  /**
   * Number of agent turns already in the chat history being sent to
   * the model. The prompt uses this to tell the model exactly which
   * turn number it is about to produce, so the per-turn template can
   * be enforced without the model having to count its own replies in
   * a long history.
   */
  agentTurnsInHistory: number;
}

const MAT_LABEL: Record<CheckInContextPayload["profile"]["matType"], string> = {
  buprenorphine: "Buprenorphine / Suboxone",
  naltrexone: "Naltrexone (oral)",
  vivitrol: "Vivitrol (extended-release injectable naltrexone)",
  methadone: "Methadone",
  none: "Not on MAT",
};

const STATUS_LABEL: Record<
  CheckInContextPayload["profile"]["medicationStatus"],
  string
> = {
  on_time: "took today's dose on time",
  late: "is late with today's dose",
  missed: "missed today's dose",
  none: "no current medication status reported",
};

const CHUNK_LABEL: Record<CheckInContextPayload["chunkNumber"], string> = {
  1: "Chunk 1 (intro + settling + urge awareness)",
  2: "Chunk 2 (body scan)",
  3: "Chunk 3 (sound / visualization anchor)",
  4: "Chunk 4 (4-4-6 breathing)",
  5: "Chunk 5 (closing reflection)",
};

const NEXT_CHUNK_LABEL: Partial<
  Record<CheckInContextPayload["chunkNumber"], string>
> = {
  1: "the body scan",
  2: "the sound anchor",
  3: "the breathing",
  4: "the closing reflection",
  // Check-in 5 has no next chunk.
};

const MAX_HISTORY_ENTRIES = 8;

export function buildCheckInPrompt(
  context: CheckInContextPayload,
  meta: BuildCheckInPromptMeta = { agentTurnsInHistory: 0 },
): BuiltCheckInPrompt {
  // The turn the model is about to write (1-indexed). Telling the
  // model this explicitly — instead of asking it to count assistant
  // messages in history — makes turn-template adherence dramatically
  // more reliable at low reasoning effort.
  const agentTurnNumber = meta.agentTurnsInHistory + 1;
  const demoTurnALineCheckIn1 =
    `TURN A — \`history\` ends with exactly 1 patient message (the score) and 0 agent messages: produce ONE short text reply (2-3 sentences max) that reflects the score with specific validation AND ends with ONE concrete question about how the chunk landed (e.g. 'what came up for you during the body scan?', 'where did your mind go?'). The reply MUST end with a question mark.`;

  const demoBlockCheckIns2Thru4 = (() => {
    const landing = checkInLandingSectionPrompt(
      context.chunkNumber as 2 | 3 | 4,
    );
    const followUp = checkInPostLandingFollowUpPrompt(
      context.chunkNumber as 2 | 3 | 4,
    );
    const turnC =
      context.chunkNumber === 3 ?
        `- TURN C — \`history\` ends with exactly 3 patient messages and 2 agent messages: validate what they said about the sound or visualization anchor; if the anchor did not land, do not ask them to try harder visually. Offer ONE brief practice from the PRD obstacle path (e.g. real-sound anchoring or thought labeling). End by asking what they notice.`
      : context.chunkNumber === 4 ?
        `- TURN C — \`history\` ends with exactly 3 patient messages and 2 agent messages: validate what they said about 4-4-6 breathing (count, hold, exhale, intruding thoughts). If they report breath anxiety or chest tightness, do not push deeper or longer breaths; offer ONE gentler skill from the PRD obstacle path (smaller breaths, outer focus, orientation). End by asking what they notice.`
      : `- TURN C — \`history\` ends with exactly 3 patient messages and 2 agent messages: validate their body answer specifically, offer ONE brief practice, end by asking what they notice.`;
    return [
      "DEMO MODE (hard override): The check-in is running in fast-demo mode. The endConversation tool is NOT available to you in this mode — the system advances the session itself after the patient answers your readiness question. You only ever produce text. Look at the `history` array you were given.",
      `- TURN A — \`history\` ends with exactly 1 patient message (the score) and 0 agent messages: weave the score reflection from the score lines in this prompt, then end with this landing prompt verbatim (nothing after it in this turn): "${landing}"`,
      `- TURN B — \`history\` ends with exactly 2 patient messages and 1 agent message: if their landing answer sounds fine, open with Great.; if they name friction, validate briefly first. Then in the SAME turn include this block verbatim: "${followUp}"`,
      turnC,
      `- TURN D — \`history\` ends with exactly 4 patient messages and 3 agent messages: reflect how the practice landed, then ask readiness using this exact pattern: 'Ready to continue with the next part, [next part name], and see if it helps?' MUST end with '?'.`,
      `- TURN E — \`history\` ends with exactly 5 patient messages and 4 agent messages: if the patient is affirmative, produce a warm hand-off with NO question. If not affirmative, validate and ask what they need before continuing.`,
      "Still validate first; still never prescribe; still never push positivity; still never mention that demo mode exists.",
    ].join("\n");
  })();

  const demoBlockCheckIn1Or5 = [
    "DEMO MODE (hard override): The check-in is running in fast-demo mode. The endConversation tool is NOT available to you in this mode — the system advances the session itself after the patient answers your readiness question. You only ever produce text. Look at the `history` array you were given.",
    `- ${demoTurnALineCheckIn1}`,
    "- TURN B — `history` ends with exactly 2 patient messages (score + 1 free-text reply) and 1 agent message: validate specifically, offer ONE brief practice to try right now, and end by asking what they notice. Example: 'Stomach is useful information — urges often show up as a pull or knot there. Try placing attention around the edges of that sensation, like you are tracing its outline rather than fighting it. Can you try that for one breath and tell me what shifts, even a little?'",
    "- TURN C — `history` ends with exactly 3 patient messages and 2 agent messages: reflect how the practice landed, then ask readiness using this exact pattern: 'Ready to continue with the next part, [next part name], and see if it helps?' MUST end with '?'. Do NOT ask a generic 'ready to continue?' question.",
    "- TURN D — `history` ends with exactly 4 patient messages and 3 agent messages: if the patient is affirmative, produce a warm hand-off with NO question (e.g. 'Alright, let's try the next part together and see if it helps.'). If not affirmative, validate and ask what they need before continuing.",
    "Still validate first; still never prescribe; still never push positivity; still never mention that demo mode exists.",
  ].join("\n");
  const scoreHistoryIncludingCurrent =
    context.scoreHistory[context.scoreHistory.length - 1] ===
    context.cravingScore
      ? context.scoreHistory
      : [...context.scoreHistory, context.cravingScore];
  const priorScores = scoreHistoryIncludingCurrent.slice(0, -1);
  const trendAwareTurn2 = fillScoreReflection(
    CHECK_IN_OPENERS[context.chunkNumber].turn2,
    scoreHistoryIncludingCurrent,
    context.chunkNumber,
  );

  const sections: string[] = [
    "<surface>",
    "check_in",
    "</surface>",
    "",
    `You are running Check-in ${context.chunkNumber} of 5, immediately after ${CHUNK_LABEL[context.chunkNumber]}.`,
    "",
    "<runtime_contract>",
    "This mounted frontend surface streams patient-facing prose. Do not wrap the visible reply in JSON, markdown, analysis, or a clinical note.",
    "When the check-in is complete, use the endConversation tool supplied by the runtime after a brief closing hand-off.",
    "</runtime_contract>",
    "",
    "<conversation_rules>",
    "- The patient has just sent their craving score (1-10) via a slider as their first message in the chat history below. Treat that as turn 1 of the patient's contribution.",
    "- You generate every agent turn. Keep each one to 1-3 short sentences, plain prose, no markdown, no lists.",
    "- Do not use em dashes, en dashes, square brackets, or bracketed stage directions in patient-facing text. Use commas, periods, or short sentences instead.",
    "- Validate FIRST. Never offer a technique before reflecting what the patient said.",
    "- Validation must be specific enough to feel heard. Do NOT use 'that makes sense' as the whole reply. Name what sounds hard, affirm that they are still trying, and then ask the next concrete question.",
    "- Use gentle encouragement without toxic positivity: 'this is hard and you're still staying with it', 'we can try the next part and see if it helps', 'you don't have to force it'.",
    "- One technique per check-in maximum. If the patient names body sensations (for example: stomach, chest, throat, jaw), treat that as enough information to offer one brief body-based practice when that fits this check-in. On check-in 3, ground techniques in the anchor obstacle path (sound, visualization, mind-wandering) per PRD. On check-in 4, ground techniques in the breathing obstacle path (tight chest, intruding thoughts, breath-induced anxiety) per PRD; never push deeper breathing when they report breath anxiety or chest tightness.",
    "- If the patient reports physical arousal after a practice (heart beating fast, pounding, hot, flushed, shaky), do NOT jump to readiness. Validate it as nervous-system activation and choose exactly ONE easing skill: place one hand on the chest and say 'it's okay'; loosen/remove an extra layer if they feel hot; or use cool water on the face/hands if available. Ask what changes after they try it.",
    "- Do not jump from the patient's answer to your second post-landing question straight to readiness. For check-ins 2–4, follow the landing split in <turn_template> (second question is body-location observe on check-in 2, the sound-anchor hold question on check-in 3, and the PRD breathing follow-up question on check-in 4).",
    "- Do not push for positivity. 'It's hard' is a complete answer.",
    "- Never prescribe medication, recommend a dose change, or shame a missed dose.",
    "- Never offer crisis routing — that lives outside this conversation.",
    "- Every agent turn except the final closing hand-off MUST end with a question. Format rule: the LAST character of your reply must be a literal '?' unless this is the closing hand-off that accompanies endConversation (which is demo mode only OR the tool-call turn in non-demo). A reflection with a period at the end traps the patient — they see a message and have no idea what to type next. Re-read your reply before sending: if it ends in '.' or '!' and you are not firing endConversation, rewrite it to end in '?'.",
    "- When the patient has already answered your 'ready?' question with a clear yes (yes / ready / let's go / ok / sure / uh-huh / mm-hmm / keep going), STOP asking. Your next turn is the closing hand-off that accompanies endConversation — a warm 1-2 sentence statement with NO question.",
    "</conversation_rules>",
    ...(context.chunkNumber === 1 ?
      [
        "",
        "<check_in_1_priority>",
        "For Check-in 1, the CHECK-IN 1 block inside <turn_template> overrides generic sequencing hints elsewhere in this prompt if they conflict.",
        "</check_in_1_priority>",
      ]
    : []),
    ...(context.chunkNumber >= 2 && context.chunkNumber <= 4 ?
      [
        "",
        "<check_in_2_4_landing_split>",
        "For check-ins 2–4, use the two-turn post-score split in <turn_template>: first agent turn after the score ends with the landing prompt only; after the patient answers, the next agent turn says Great. if they were fine or validates briefly if not, then asks the verbatim follow-up from <turn_template> (body-location observe on check-in 2; PRD sound-anchor hold question on check-in 3; PRD breathing follow-up on check-in 4).",
        "</check_in_2_4_landing_split>",
      ]
    : []),
    "",
    buildTurnTemplate(context, agentTurnNumber),
    "",
    "<end_conversation_tool>",
    "Call the `endConversation` tool — and ONLY that tool — when:",
    context.chunkNumber === 5
      ? "  • The patient has shared a 'carry forward' answer to your closing question (one word is enough). Do not keep the conversation going past that."
      : "  • The patient has clearly signalled they are ready to keep going. A direct yes to a 'ready?' question counts. So does an unambiguous self-initiated readiness signal like 'I'm good', 'let's keep going', 'ready to continue', 'I'm ready', or 'yeah, move on', even if your most recent turn did not literally ask 'ready?'. Do not insist on a literal 'ready?' question before firing the tool — that just adds friction.",
    "Required tool args:",
    "  • cravingScore — the integer the patient sent at the start (echo it back so the system has it).",
    "  • obstacleCategory — your best classification of what got in the way this chunk, or none if no obstacle was clearly present.",
    "Allowed obstacleCategory values: none, cannot_visualize, mind_wandering, urge_overwhelming, breath_tight, breath_anxiety, gave_in, guilt_failure, physical_discomfort, sleepiness.",
    "Pair the tool with text: when you call endConversation, ALSO produce a brief 1-2 sentence closing text turn in the same response. Don't end the check-in with no words — the patient should hear a soft hand-off before the next chunk starts.",
    context.demoMode
      ? context.chunkNumber >= 2 && context.chunkNumber <= 4
        ? demoBlockCheckIns2Thru4
        : demoBlockCheckIn1Or5
      : context.chunkNumber >= 2 && context.chunkNumber <= 4
        ? "Floor: never call endConversation on your first two agent turns after the score (landing prompt, then the second scripted follow-up in <turn_template>), no tool on those turns. Never call it before the patient has sent their readiness reply after your readiness question in <turn_template>.\nCeiling: once the patient has answered your readiness question with yes / I'm ready / let's go (or any clear affirmative) AND the minimum turn count above is met, you MUST call endConversation in your next response. Do NOT ask 'ready?' a second time. The accompanying text is a warm 1-2 sentence hand-off with NO question — e.g. 'alright, let's try the next part together and see if it helps.' The patient already answered; re-asking the same question makes the app feel stuck."
        : "Floor: never call endConversation on your FIRST agent turn after the score — your first agent turn is always a text-only validating reply, no tool call. Never call it before the patient has sent 4 patient messages total: score + body/experience answer + practice-landing answer + readiness answer.\nCeiling: once the patient has answered your readiness question with yes / I'm ready / let's go (or any clear affirmative) AND the minimum turn count above is met, you MUST call endConversation in your next response. Do NOT ask 'ready?' a second time. The accompanying text is a warm 1-2 sentence hand-off with NO question — e.g. 'alright, let's try the sound anchor together and see if it helps.' The patient already answered; re-asking the same question makes the app feel stuck.",
    "</end_conversation_tool>",
    "",
    `<patient_score>`,
    `Just-reported craving: ${context.cravingScore} / 10.`,
    priorScores.length === 0
      ? `Intake intensity at session start: ${context.intakeIntensity} / 10. This is the first check-in.`
      : `Prior check-in scores before this one (oldest → most recent): ${priorScores.join(" → ")}. Intake intensity at session start: ${context.intakeIntensity} / 10.`,
    `Score trend to reflect now: ${trendAwareTurn2}`,
    `</patient_score>`,
    "",
    "<medication_context>",
    `Patient: ${MAT_LABEL[context.profile.matType]}, ${STATUS_LABEL[context.profile.medicationStatus]}.`,
    context.profile.matType === "none"
      ? "Standard MBRP framing. No pharmacology claims."
      : context.chunkNumber >= 2 && context.chunkNumber <= 4
        ? "Keep medication mentions brief and optional. Do not repeat check-in 1's long medication-status affirmation plus surf-framed trigger validation on your first turn after the score. Never prescribe. Never recommend a dose change. Never shame a missed dose."
        : "You may weave a brief medication-aware validation clause into your reply if it fits naturally. Never prescribe. Never recommend a dose change. Never shame a missed dose.",
    context.profile.usedSubstanceToday
      ? "The patient said yes to 'used a substance today' at the safety screen but is not in physical distress. Do not bring this up directly during the check-in — the closing reflection handles it."
      : "",
    "</medication_context>",
    ...(context.chunkNumber === 1 ?
      [
        "",
        "<intake_trigger_context>",
        formatIntakeTriggerLineForPrompt(context.profile),
        "Name this trigger (and optional free-text detail) naturally in validation when it helps the patient feel seen.",
        "</intake_trigger_context>",
        "",
        formatMatMissedDoseReferenceForPrompt(context.profile),
      ]
    : []),
    "",
    renderHistoryBlock(context.sessionHistory),
  ];

  if (context.obstacleHint) {
    sections.push(
      "",
      "<heuristic_hint>",
      `A keyword heuristic flagged a possible obstacle: ${context.obstacleHint}. This is a hint, not a verdict — confirm or override based on what the patient actually says.`,
      "</heuristic_hint>",
    );
  }

  return {
    systemPrompt: sanitizePromptPunctuation(WAVE_SYSTEM_PROMPT),
    contextBlock: sanitizePromptPunctuation(
      sections.filter((line) => line !== "").join("\n"),
    ),
  };
}

function sanitizePromptPunctuation(text: string): string {
  return text.replace(/[–—]/g, ",");
}

/**
 * Renders an explicit turn-by-turn template plus a line that tells the
 * model exactly which agent turn it is about to write. Two shapes:
 *
 *   - Non-closing check-ins (chunks 1-4): score → follow-up questions →
 *     free-text replies → validation + one practice → practice reply →
 *     readiness → affirmative → hand-off + endConversation. Check-ins 2–4 use
 *     a landing question, then a chunk-specific follow-up (body observe, anchor hold,
 *     or breathing follow-up per PRD), before the obstacle path.
 *
 *   - Check-in 5 (closing): score → reflection question → free-text →
 *     carry-forward question → one-word reply → hand-off + endConversation.
 *
 * Demo mode does not use this template because its compressed text-only shape
 * is already documented inline in the end_conversation_tool block and
 * backstopped client-side.
 */
function buildTurnTemplate(
  context: CheckInContextPayload,
  agentTurnNumber: number,
): string {
  if (context.demoMode) {
    // Demo has its own sequence described in end_conversation_tool.
    return "";
  }

  const nextChunkLabel = NEXT_CHUNK_LABEL[context.chunkNumber] ?? "the next chunk";

  if (context.chunkNumber === 1) {
    return [
      "<turn_template>",
      "CHECK-IN 1 (after intro/settling chunk, before the body scan). Expected shape:",
      "",
      "  (patient) sends craving score on the slider",
      "  [agent 1] Compare the score to intakeIntensity by name (baseline vs now).",
      "    • If current is higher than intake: normalize — feelings can intensify when attention turns toward the body; frame that as a common experience of paying attention, not failure.",
      "    • If current is lower: celebrate this moment; add that healing is not linear and practice can support protective effects over time without promising outcomes.",
      "    • Explicitly name matType, medicationStatus, and trigger (and triggerOther when present) in plain, respectful language.",
      "    • If medication is on time and trigger is stress (or similar): you may use a pattern like acknowledging they took medication as planned, affirming accountability without sounding patronizing, then validating stress and welcoming them to surf the wave together.",
      "    • If medicationStatus is late or missed, read <missed_or_late_medication_reference> when present — use only hedged, non-diagnostic language; never claim they are in withdrawal.",
      "    • End with ONE question inviting obstacles from the practice (mind wandering, sweating, other strong body sensations, feeling overwhelmed). MUST end with '?'.",
      "  (patient) describes obstacles or how the chunk felt",
      "  [agent 2] Validate first — mind wandering and strong sensations are common. If what they describe sounds medically severe or unsafe, encourage contacting their therapist, prescriber, or appropriate medical care. Otherwise offer AT MOST ONE brief technique (for example progressive tension/release, orienting to sound and touch, naming sensations to ground). MUST end with '?'.",
      "  (patient) says how the technique landed",
      "  [agent 3] Reflect what shifted or did not shift. Then ask this readiness question verbatim: 'Ready to continue into the body scan?' MUST end with '?'.",
      "  (patient) clear yes (yes, sure, okay, uh-huh, mm-hmm, let's go, ready, etc.) OR hesitation / no",
      "  [agent 4]",
      "    • If clearly affirmative: warm 1-2 sentence hand-off with NO question, AND call endConversation in the same response.",
      "    • If not ready: ask what feels in the way, validate, optionally offer one more brief skill, then return to the readiness question when appropriate — do not force advance.",
      "",
      `YOU ARE WRITING AGENT TURN #${agentTurnNumber} NOW.`,
      "</turn_template>",
    ].join("\n");
  }

  if (context.chunkNumber === 5) {
    return [
      "<turn_template>",
      "This is the CLOSING check-in. Expected shape, agent turns numbered in [brackets]:",
      "",
      "  (patient) sends final craving score",
      "  [agent 1] validate the score with a real reflection of effort, briefly reflect on the full session arc, and ask ONE question about what they noticed about themselves. MUST end with '?'.",
      "  (patient) reflective reply",
      "  [agent 2] brief reflection of what they said + gentle encouragement that continuing can be worth trying even when it feels hard + ONE 'carry forward' question (what they want to take with them into the rest of their day). MUST end with '?'.",
      "  (patient) carry-forward reply (one word is enough).",
      "  [agent 3] warm 1-2 sentence close, NO question, AND call endConversation in the same response.",
      "",
      `YOU ARE WRITING AGENT TURN #${agentTurnNumber} NOW. Produce exactly that turn's content — do not skip ahead, do not regress.`,
      "</turn_template>",
    ].join("\n");
  }

  const chunkNum = context.chunkNumber as 2 | 3 | 4;
  const landingSection = checkInLandingSectionPrompt(chunkNum);
  const postLandingFollowUp = checkInPostLandingFollowUpPrompt(chunkNum);
  const patientAfterFollowUp =
    chunkNum === 3 ?
      "  (patient) answers about the sound anchor — whether they could stay with the water sound, visualization, or what made it hard"
    : chunkNum === 4 ?
      "  (patient) answers about 4-4-6 breathing — following their own count, chest tightness, intruding thoughts, breath-induced anxiety, or what got in the way"
    : "  (patient) answers where the urge lives or how it feels to observe, including if they cannot locate it";
  const agent3ValidatePractice =
    chunkNum === 3 ?
      "  [agent 3] validate what they named about the anchor (sound, imagery, mind-wandering, urge intensity). PRD Chunk 3: if the anchor did not land, do not ask them to try harder visually; offer exactly ONE technique from the obstacle path (e.g. real-sound anchoring, thought labeling, or normalizing urge intensification). MUST end with '?'. DO NOT ask readiness here."
    : chunkNum === 4 ?
      "  [agent 3] validate what they named about the breathing practice (inhale/hold/exhale pacing, intruding thoughts). PRD Check-in 4: if they report breath anxiety or chest tightness, do not push deeper, longer, or more disciplined breaths; offer exactly ONE gentler skill (e.g. smaller breaths, outer focus, orienting touch or sound). For other obstacles, at most one technique from the obstacle library. MUST end with '?'. DO NOT ask readiness here."
    : "  [agent 3] validate what they named with more than 'that makes sense', offer exactly ONE concrete practice, and ask them to try it right now and report what they notice. For body-location answers, use the MBRP body-scan practice: bring attention to the strongest spot, notice the edges, temperature, pressure, pulsing, or change with breath. MUST end with '?'. DO NOT ask readiness here.";

  return [
    "<turn_template>",
    `Expected shape for this check-in (next chunk after this is ${nextChunkLabel}), agent turns numbered in [brackets]:`,
    "",
    "  (patient) sends craving score",
    `  [agent 1] Weave the score reflection from <patient_score> (Score trend to reflect now) in your own words. Do NOT repeat check-in 1's long medication-status affirmation plus surf-framed trigger validation on this turn. End this turn with this landing prompt verbatim (do not add the second follow-up block in the same turn): "${landingSection}"`,
    "  (patient) answers how the landing section felt; any questions or concerns",
    `  [agent 2] If they sound fine with no concerns, open with Great. If they name difficulty, validate in one or two short sentences first (no technique yet). In the SAME turn, include this block verbatim after that opener: "${postLandingFollowUp}"`,
    patientAfterFollowUp,
    agent3ValidatePractice,
    "  (patient) replies with how that brief practice landed, even one word",
    `  [agent 4] reflect how the practice landed, affirm that trying while it feels hard still counts, then ask this exact readiness question: 'Ready to continue with the next part, ${nextChunkLabel}, and see if it helps?' MUST end with '?'. Do NOT ask a generic 'ready to continue?' question.`,
    "  (patient) affirmative (yes / ready / ok / let's go) OR a new concern",
    "  [agent 5]",
    `    • if affirmative: warm 1-2 sentence hand-off (no question) that says you will try ${nextChunkLabel} together and see if it helps, AND call endConversation in the same response.`,
    "    • if new concern: briefly address it + ask ONE more question ending with '?', then expect another patient turn before the hand-off.",
    "",
    `YOU ARE WRITING AGENT TURN #${agentTurnNumber} NOW. Produce exactly that turn's content — do not skip ahead to a warm close before the patient has confirmed, and do not regress to re-asking earlier questions if they already answered.`,
    "</turn_template>",
  ].join("\n");
}

function renderHistoryBlock(history: readonly SessionHistoryEntry[]): string {
  if (history.length === 0) {
    return "<session_history>\n(no prior chunks or check-ins yet — this is Check-in 1, immediately after Chunk 1)\n</session_history>";
  }

  const recent = history.slice(-MAX_HISTORY_ENTRIES);
  const renderedEntries: string[] = [];
  for (const entry of recent) {
    if (entry.kind === "chunk") {
      renderedEntries.push(
        `[chunk ${entry.chunkNumber} narration] ${entry.lines.join(" / ")}`,
      );
    } else {
      const transcript = entry.turns
        .map(
          (turn) =>
            `${turn.role === "agent" ? "WAVE" : "patient"}: ${turn.content}`,
        )
        .join("\n");
      const obstacle = entry.obstacleCategory
        ? ` (obstacle: ${entry.obstacleCategory})`
        : "";
      renderedEntries.push(
        `[check-in ${entry.chunkNumber}, score ${entry.cravingScore}/10${obstacle}]\n${transcript}`,
      );
    }
  }

  return `<session_history>\n${renderedEntries.join("\n\n")}\n</session_history>`;
}
