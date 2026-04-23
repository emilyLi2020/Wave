/**
 * Check-in prompt builder.
 *
 * Assembles the per-conversation user-message block sent to the LLM
 * (gpt-5-mini today, in-browser Gemma 4 + check-in LoRA tomorrow).
 * The system prompt is the canonical WAVE_SYSTEM_PROMPT from
 * wave-system.ts, augmented with check-in-specific instructions:
 *
 *   - The LLM drives EVERY agent turn. There are no scripted openers
 *     baked into the chat history; the chat starts with the patient's
 *     first message (their craving-score reply from the slider).
 *   - The LLM owns conversational flow: validate before technique,
 *     one technique max, normalize before normalizing-a-second-time.
 *   - When the LLM judges the check-in complete, it calls the
 *     `endConversation` tool. The route handler turns that tool call
 *     into an SSE `end_conversation` event the chat surface listens
 *     for. There is no regex-based readiness gate any more.
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
import type {
  CheckInContextPayload,
  SessionHistoryEntry,
} from "./schemas";

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
   * a long history (which gpt-5-mini at `low` reasoning effort was
   * reliably miscounting, producing a warm close on turn 2 instead
   * of asking a follow-up question).
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

  const sections: string[] = [
    `You are running Check-in ${context.chunkNumber} of 5, immediately after ${CHUNK_LABEL[context.chunkNumber]}.`,
    "",
    "<conversation_rules>",
    "- The patient has just sent their craving score (1-10) via a slider as their first message in the chat history below. Treat that as turn 1 of the patient's contribution.",
    "- You generate every agent turn. Keep each one to 1-3 short sentences, plain prose, no markdown, no lists.",
    "- Validate FIRST. Never offer a technique before reflecting what the patient said.",
    "- One technique per check-in maximum. If you teach a skill, ask whether it landed before moving on.",
    "- Do not push for positivity. 'It's hard' is a complete answer.",
    "- Never prescribe medication, recommend a dose change, or shame a missed dose.",
    "- Never offer crisis routing — that lives outside this conversation.",
    "- Every agent turn except the final closing hand-off MUST end with a question. Format rule: the LAST character of your reply must be a literal '?' unless this is the closing hand-off that accompanies endConversation (which is demo mode only OR the tool-call turn in non-demo). A reflection with a period at the end traps the patient — they see a message and have no idea what to type next. Re-read your reply before sending: if it ends in '.' or '!' and you are not firing endConversation, rewrite it to end in '?'.",
    "- When the patient has already answered your 'ready?' question with a clear yes (yes / ready / let's go / ok / sure / keep going), STOP asking. Your next turn is the closing hand-off that accompanies endConversation — a warm 1-2 sentence statement with NO question.",
    "</conversation_rules>",
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
    "  • obstacleCategory — your best classification of what got in the way this chunk, or null if none was clearly present.",
    "Allowed obstacleCategory values: cannot_visualize, mind_wandering, urge_overwhelming, breath_tight, breath_anxiety, gave_in, guilt_failure, physical_discomfort, sleepiness, or null.",
    "Pair the tool with text: when you call endConversation, ALSO produce a brief 1-2 sentence closing text turn in the same response. Don't end the check-in with no words — the patient should hear a soft hand-off before the next chunk starts.",
    context.demoMode
      ? "DEMO MODE (hard override): The check-in is running in fast-demo mode. The endConversation tool is NOT available to you in this mode — the system advances the session itself after your 2nd text turn. You only ever produce text. Look at the `history` array you were given.\n- TURN A — `history` ends with exactly 1 patient message (the score) and 0 agent messages: produce ONE short text reply (2-3 sentences max) that reflects the score AND ends with ONE concrete question about how the chunk landed (e.g. 'what came up for you during the body scan?', 'where did your mind go?'). The reply MUST end with a question mark — without one, the patient won't know what to type next.\n- TURN B — `history` ends with exactly 2 patient messages (score + 1 free-text reply) and 1 agent message: this is your closing turn. Produce ONE short text reply (1-2 sentences) that briefly reflects what the patient said and warmly hands off (e.g. 'thanks for sharing — let's keep going with the next part'). Do NOT ask another question; this is a hand-off, not a continuation, and the system jumps to the next chunk as soon as you finish.\nStill validate first; still never prescribe; still never push positivity; still never mention that demo mode exists."
      : "Floor: never call endConversation on your FIRST agent turn after the score — your first agent turn is always a text-only validating reply, no tool call. Never call it before the patient has sent at least 2 messages after their score (so: score + 2 more patient messages, minimum).\nCeiling: once the patient has said yes / I'm ready / let's go (or any clear affirmative) to your 'ready?' question AND the minimum turn count above is met, you MUST call endConversation in your next response. Do NOT ask 'ready?' a second time. The accompanying text is a warm 1-2 sentence hand-off with NO question — e.g. 'alright, let's head into the sound anchor together.' The patient already answered; re-asking the same question makes the app feel stuck.",
    "</end_conversation_tool>",
    "",
    `<patient_score>`,
    `Just-reported craving: ${context.cravingScore} / 10.`,
    context.scoreHistory.length === 0
      ? `Intake intensity at session start: ${context.intakeIntensity} / 10. This is the first check-in.`
      : `Prior check-in scores (oldest → most recent): ${context.scoreHistory.join(" → ")}. Intake intensity at session start: ${context.intakeIntensity} / 10.`,
    `</patient_score>`,
    "",
    "<medication_context>",
    `Patient: ${MAT_LABEL[context.profile.matType]}, ${STATUS_LABEL[context.profile.medicationStatus]}.`,
    context.profile.matType === "none"
      ? "Standard MBRP framing. No pharmacology claims."
      : "You may weave a brief medication-aware validation clause into your reply if it fits naturally. Never prescribe. Never recommend a dose change. Never shame a missed dose.",
    context.profile.usedSubstanceToday
      ? "The patient said yes to 'used a substance today' at the safety screen but is not in physical distress. Do not bring this up directly during the check-in — the closing reflection handles it."
      : "",
    "</medication_context>",
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
    systemPrompt: WAVE_SYSTEM_PROMPT,
    contextBlock: sections.filter((line) => line !== "").join("\n"),
  };
}

/**
 * Renders an explicit turn-by-turn template plus a line that tells the
 * model exactly which agent turn it is about to write. Two shapes:
 *
 *   - Non-closing check-ins (chunks 1-4): score → body/experience
 *     question → free-text reply → 'ready?' question → affirmative →
 *     hand-off + endConversation. Three agent turns in the normal
 *     arc, possibly more if the patient raises a concern.
 *
 *   - Check-in 5 (closing): score → reflection question → free-text →
 *     carry-forward question → one-word reply → hand-off + endConversation.
 *
 * Demo mode does not use this template because its 2-agent-turn shape
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

  if (context.chunkNumber === 5) {
    return [
      "<turn_template>",
      "This is the CLOSING check-in. Expected shape, agent turns numbered in [brackets]:",
      "",
      "  (patient) sends final craving score",
      "  [agent 1] validate the score, briefly reflect on the full session arc, and ask ONE question about what they noticed about themselves. MUST end with '?'.",
      "  (patient) reflective reply",
      "  [agent 2] brief reflection of what they said + ONE 'carry forward' question (what they want to take with them into the rest of their day). MUST end with '?'.",
      "  (patient) carry-forward reply (one word is enough).",
      "  [agent 3] warm 1-2 sentence close, NO question, AND call endConversation in the same response.",
      "",
      `YOU ARE WRITING AGENT TURN #${agentTurnNumber} NOW. Produce exactly that turn's content — do not skip ahead, do not regress.`,
      "</turn_template>",
    ].join("\n");
  }

  return [
    "<turn_template>",
    `Expected shape for this check-in (next chunk after this is ${nextChunkLabel}), agent turns numbered in [brackets]:`,
    "",
    "  (patient) sends craving score",
    "  [agent 1] validate the score and ask ONE specific question about their experience during the chunk (body sensation, what came up, how something landed). MUST end with '?'.",
    "  (patient) free-text reply describing what came up",
    `  [agent 2] briefly reflect what they said, then ask ONE readiness question such as 'ready to continue?' or 'anything else before we head into ${nextChunkLabel}?'. MUST end with '?'. DO NOT write a warm close here — the patient has not confirmed yet.`,
    "  (patient) affirmative (yes / ready / ok / let's go) OR a new concern",
    "  [agent 3]",
    "    • if affirmative: warm 1-2 sentence hand-off (no question) AND call endConversation in the same response.",
    "    • if new concern: briefly address it + ask ONE more question ending with '?', then expect another patient turn before the hand-off.",
    "",
    `YOU ARE WRITING AGENT TURN #${agentTurnNumber} NOW. Produce exactly that turn's content — do not skip ahead to a warm close before the patient has confirmed, and do not regress to re-asking about body sensation if they already answered.`,
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
