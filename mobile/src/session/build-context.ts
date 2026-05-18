// Maps SessionProvider reducer state → the payloads the gemma boundaries
// expect. Keeping this here means the flow screens never hand-assemble
// schema objects.

import type {
  ChunkGenerationContextPayload,
  ReflectionContext,
} from "@/lib/prompts/schemas";
import type { ChunkNumber } from "@/types/session";
import type { State } from "@/session/session-machine";

/** Profile block shared by the chunk + check-in contexts. */
export function profileFromState(state: State): ChunkGenerationContextPayload["profile"] {
  const intake = state.intake;
  return {
    matType: intake?.matType ?? "none",
    medicationStatus: intake?.medicationStatus ?? "none",
    trigger: intake?.trigger ?? "unknown_or_other",
    triggerOther: intake?.triggerOther ?? null,
    usedSubstanceToday: state.usedSubstanceToday,
  };
}

export function chunkContextFromState(state: State): ChunkGenerationContextPayload {
  return {
    chunkNumber: state.currentChunk as ChunkNumber,
    intakeIntensity: state.intake?.intakeIntensity ?? 5,
    profile: profileFromState(state),
    // sessionHistory entries are already SessionHistoryEntry-shaped in
    // the reducer; cap mirrors the schema's .max(20).
    sessionHistory: state.sessionHistory.slice(-20),
  };
}

export function reflectionContextFromState(state: State): ReflectionContext {
  const scores = state.checkIns.map((c) => c.cravingScore);
  const intakeIntensity = state.intake?.intakeIntensity ?? 5;
  const ending = scores.length ? scores[scores.length - 1] : intakeIntensity;
  const startedMs = Date.parse(state.startedAt);
  const durationSeconds = Number.isFinite(startedMs)
    ? Math.max(0, Math.min(3600, Math.round((Date.now() - startedMs) / 1000)))
    : 0;
  return {
    intakeIntensity,
    matType: state.intake?.matType ?? "none",
    medicationStatus: state.intake?.medicationStatus ?? "none",
    trigger: state.intake?.trigger ?? "unknown_or_other",
    usedSubstanceToday: state.usedSubstanceToday,
    // No body-scan capture in this flow yet; chest is the modal answer.
    bodyLocation: "chest",
    currentIntensity: ending,
    endingIntensity: ending,
    durationSeconds,
  };
}
