/**
 * Chunk-generator prompt builder.
 *
 * Produces the system + user prompt pair for a history-aware chunk
 * generator. The model returns a strict JSON `{ lines: string[] }`
 * payload — exactly `CHUNK_LINE_COUNT` plain-text lines that the chunk
 * player wraps as text segments with default-length pauses between
 * them.
 *
 * What the model sees
 *   - The canonical WAVE voice (trauma-informed, second-person,
 *     unhurried, no toxic positivity, no medical advice).
 *   - The clinical purpose of THIS chunk (settle, body scan, sound
 *     anchor, breathing, close).
 *   - The patient's intake context (intensity, MAT, trigger).
 *   - A condensed transcript of every prior chunk + check-in this
 *     session, so each new chunk grounds itself in what the patient
 *     has already heard and said. This is the difference between the
 *     scripted bank (medication-agnostic, history-blind) and the
 *     model-generated chunk path (history-aware).
 *
 * What the model never does
 *   - Recommend dose changes, prescribe, or shame missed doses.
 *   - Give crisis routing (988 / SAMHSA) — that is rule-based, never
 *     delegated to the model.
 *   - Reference the chunk number in patient-visible copy ("Now in
 *     chunk 3 of 5…"). The five-chunk shape is internal; the patient
 *     only ever sees the narration.
 */

import {
  CHUNK_LINE_COUNT,
  type ChunkGenerationContextPayload,
} from "./schemas";
import { WAVE_SYSTEM_PROMPT } from "./wave-system";
import type { ChunkNumber } from "@/types/session";

interface ChunkBrief {
  title: string;
  /** One-line clinical purpose, used in the user-prompt brief. */
  purpose: string;
  /** Concrete instructions on what the chunk's lines should cover. */
  guidance: string;
}

const CHUNK_BRIEFS: Record<ChunkNumber, ChunkBrief> = {
  1: {
    title: "Settle in",
    purpose:
      "Welcome the patient, invite them to settle their body, and introduce the wave metaphor for urges.",
    guidance: [
      "Open with a warm, low-stakes welcome that names that showing up matters.",
      "Invite a comfortable position (sit, lie down, whatever works) without prescribing one.",
      "Introduce the wave metaphor: urges rise, crest, and fall; none last forever.",
      "Invite a short noticing pass — what is already present in the body, no fixing.",
    ].join(" "),
  },
  2: {
    title: "Body scan",
    purpose:
      "Help the patient locate where the urge lives in the body and observe its qualities without trying to change it.",
    guidance: [
      "Move attention top-down (head → face → jaw → throat → chest → stomach → hands → legs).",
      "Land on the most intense spot and invite curiosity: edges, temperature, pulse, steadiness.",
      "Frame it as observing weather, not fixing.",
      "Affirm that not making the sensation leave is the practice.",
    ].join(" "),
  },
  3: {
    title: "Sound anchor",
    purpose:
      "Anchor attention on sound (real ambient sound + the imagined sound of waves) as an alternative to visualization.",
    guidance: [
      "Acknowledge that visualization is hard for some; sound works just as well.",
      "First invite listening to whatever is actually around them.",
      "Layer in the sound of waves pulling in and pushing out as a rhythm that needs nothing from them.",
      "Normalize mind-wandering — the coming back is the practice, not staying still.",
    ].join(" "),
  },
  4: {
    title: "Breath",
    purpose:
      "Use box-style breathing (4 in, 4 hold, 6 out) as a surfboard the patient rides through the wave.",
    guidance: [
      "Introduce the 4-4-6 pattern: 4 in, 4 hold, 6 out.",
      "Cue a few guided rounds, then invite them to keep the pattern on their own.",
      "Speak the cues as count-in-your-head instructions, never as 'I will count for you'.",
      "Close by inviting them to let the count go and just breathe slow with the wave.",
    ].join(" "),
  },
  5: {
    title: "Close",
    purpose:
      "Bring the session to a close: notice what changed (or didn't), normalize the outcome, and prepare for one final check-in.",
    guidance: [
      "Invite a comparison to where they started — body, thoughts, urge intensity.",
      "Normalize whatever happened: a fall is something they did; holding is something they survived; rising is still practice.",
      "Do not promise the urge is gone or that next time will be easier.",
      "Close gently and signal that one more brief conversation follows.",
    ].join(" "),
  },
};

const MAT_LABEL: Record<ChunkGenerationContextPayload["profile"]["matType"], string> = {
  buprenorphine: "Buprenorphine / Suboxone",
  naltrexone: "Naltrexone (oral)",
  vivitrol: "Vivitrol (extended-release naltrexone)",
  methadone: "Methadone",
  none: "No MAT",
};

const STATUS_LABEL: Record<
  ChunkGenerationContextPayload["profile"]["medicationStatus"],
  string
> = {
  on_time: "took today's dose on time",
  late: "took today's dose, but late",
  missed: "missed today's dose",
  none: "not on MAT",
};

const TRIGGER_LABEL: Record<
  ChunkGenerationContextPayload["profile"]["trigger"],
  string
> = {
  social: "a social situation",
  stress: "stress / emotions",
  physical: "a physical sensation",
  unknown_or_other: "don't know / something else",
};

export interface BuiltChunkPrompt {
  systemPrompt: string;
  userPrompt: string;
}

/**
 * Builds the system + user prompts for a single chunk generation. The
 * caller passes the full session history; we render only the most
 * recent ~10 entries into the prompt to stay inside a comfortable
 * token budget while still giving the model real context.
 */
export function buildChunkPrompt(
  context: ChunkGenerationContextPayload,
): BuiltChunkPrompt {
  const brief = CHUNK_BRIEFS[context.chunkNumber];
  const intakeBlock = renderIntakeBlock(context);
  const historyBlock = renderHistoryBlock(context.sessionHistory);

  // DEMO CORNER-CUT (Wave#15): this appended block was trimmed ~half
  // (~280 -> ~140 tok) to fit the stock-LiteRT 2048 budget. Canonical
  // WAVE_SYSTEM_PROMPT above is clinically gated and left verbatim; only
  // the redundant formatting verbosity here was condensed (the userPrompt
  // <task> block still restates the format rules). All safety lines
  // (never prescribe / dose / crisis) and the one-beat-per-element / JSON
  // constraints are preserved. Documented in
  // docs/runbooks/stock-litert-working-config.md and Wave#15.
  const systemPrompt = `${WAVE_SYSTEM_PROMPT}

CHUNK NARRATION OUTPUT
You are generating the scripted narration for one meditation chunk (not a check-in). Stay in second person. Never prescribe, never recommend dose changes, never offer crisis routing (rule-based, outside the model). Return only strict JSON matching the requested schema — no markdown, analysis, clinical note, or extra keys.

Each element of \`lines\` is ONE beat: one to three short plain-prose sentences. Never merge beats with a delimiter (" / ", " — ", " | ", semicolons, brackets, stage directions, ASCII art) or with line breaks inside an element. No bullets, numbering, or chunk-number / "complete" announcements — the next surface mounts seamlessly.`;

  const userPrompt = `<chunk>
Number ${context.chunkNumber} of 5 — ${brief.title}.
Purpose: ${brief.purpose}
What to cover (in order, condensed): ${brief.guidance}
</chunk>

${intakeBlock}

${historyBlock}

<task>
Generate the narration for this chunk as a JSON object of the form:
{ "lines": [ "...", "...", ... ] }

Example response (generic placeholders, replace with real narration):
{ "lines": ["str 1", "str 2", "str 3", "str 4", "str 5", "str 6"] }

Requirements:
- Exactly ${CHUNK_LINE_COUNT} lines. Do not return ${CHUNK_LINE_COUNT - 1}, ${CHUNK_LINE_COUNT + 1}, or any other count.
- Each line is plain text, one to three short sentences.
- Never use square brackets. Do not include bracketed pauses, bracketed breath cues, or stage directions.
- Lines flow as a meditation script — each one a beat the patient sits with for ~7 seconds before the next line.
- Tone: trauma-informed, unhurried, second person, no toxic positivity.
- Reference the patient's prior session entries when it is useful (e.g. if a check-in mentioned a body location or a specific obstacle), but do NOT explicitly name a "check-in" or quote their words back verbatim.
- Do not mention the wave count or chunk number.
- The first line is the opener for this chunk; the last line is the closer that hands off to the upcoming check-in without announcing it.
- Return only strict JSON. No markdown, no analysis, no explanations.
</task>`;

  return {
    systemPrompt: sanitizePromptPunctuation(systemPrompt),
    userPrompt: sanitizePromptPunctuation(userPrompt),
  };
}

function sanitizePromptPunctuation(text: string): string {
  return text.replace(/[–—]/g, ",");
}

function renderIntakeBlock(
  context: ChunkGenerationContextPayload,
): string {
  const triggerWording =
    context.profile.trigger === "unknown_or_other" &&
    context.profile.triggerOther
      ? `don't know / other (${context.profile.triggerOther})`
      : TRIGGER_LABEL[context.profile.trigger];
  const usedToday = context.profile.usedSubstanceToday
    ? "Yes, used a substance today (continued the session per protocol)."
    : "No substance use reported today.";
  return `<patient_context>
Intake craving: ${context.intakeIntensity} / 10
MAT: ${MAT_LABEL[context.profile.matType]} (${STATUS_LABEL[context.profile.medicationStatus]})
Trigger: ${triggerWording}
Used substance today: ${usedToday}
</patient_context>`;
}

// DEMO CORNER-CUT (Wave#15): on stock LiteRT the 2048-token budget can't
// hold the canonical system prompt + a full accumulating session history.
// So phase narration uses ONLY the single immediately-preceding check-in
// (the check-in that followed chunk N-1) — no chunk-narration history, no
// older check-ins. Chunk 1 has no prior check-in, so it uses nothing.
// This caps the history block at ~one short check-in transcript instead
// of growing unbounded with the session. Documented in
// docs/runbooks/stock-litert-working-config.md and Wave#15.
// Trade-off: later chunks lose long-range continuity (earlier obstacles /
// score arc) and only react to the most recent check-in. Acceptable for
// the phone demo; revisit if a larger-context bundle ships.
function renderHistoryBlock(
  history: ChunkGenerationContextPayload["sessionHistory"],
): string {
  // Most recent check-in only (chunk N sees the check-in after chunk N-1).
  let lastCheckIn: Extract<
    ChunkGenerationContextPayload["sessionHistory"][number],
    { kind: "checkIn" }
  > | null = null;
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    if (entry.kind === "checkIn") {
      lastCheckIn = entry;
      break;
    }
  }

  if (!lastCheckIn) {
    return "<session_history>\n(no prior check-in yet — this is the first chunk)\n</session_history>";
  }

  const transcript = lastCheckIn.turns
    .map((turn) => `${turn.role === "agent" ? "WAVE" : "patient"}: ${turn.content}`)
    .join("\n");
  const obstacle = lastCheckIn.obstacleCategory
    ? ` (obstacle: ${lastCheckIn.obstacleCategory})`
    : "";

  return `<session_history>
[check-in ${lastCheckIn.chunkNumber}, score ${lastCheckIn.cravingScore}/10${obstacle}]
${transcript}
</session_history>`;
}
