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
): BuiltCheckInPrompt {
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
    context.chunkNumber === 5
      ? "- This is Check-in 5 (closing). Do NOT ask 'ready to continue' or imply more chunks follow. Reflect the full session arc, ask what they noticed about themselves, then ask one 'carry forward' question, then call endConversation."
      : `- The next chunk after this check-in is ${NEXT_CHUNK_LABEL[context.chunkNumber] ?? "the next chunk"}. End the conversation by confirming the patient is ready, then call the endConversation tool.`,
    "</conversation_rules>",
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
      ? "DEMO MODE (hard override): The check-in is running in fast-demo mode. The endConversation tool is NOT available to you in this mode — the system advances the session itself after your 2nd text turn. You only ever produce text. Look at the `history` array you were given.\n- TURN A — `history` ends with exactly 1 patient message (the score) and 0 agent messages: produce ONE short text reply (2-3 sentences max) that reflects the score and asks one brief question about how the chunk landed.\n- TURN B — `history` ends with exactly 2 patient messages (score + 1 free-text reply) and 1 agent message: this is your closing turn. Produce ONE short text reply (1-2 sentences) that briefly reflects what the patient said and warmly hands off (e.g. 'thanks for sharing — let's keep going with the next part'). Do NOT ask another question; this is a hand-off, not a continuation.\nStill validate first; still never prescribe; still never push positivity; still never mention that demo mode exists."
      : "Floor: never call endConversation on your FIRST agent turn after the score — your first agent turn is always a text-only validating reply, no tool call. Never call it before the patient has sent at least 2 messages after their score (so: score + 2 more patient messages, minimum). When you DO call endConversation, accompany it with a brief closing text turn (1-2 sentences) that warmly hands off — do not call the tool with no text.",
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
