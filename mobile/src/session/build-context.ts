// Maps SessionProvider reducer state → the payloads the gemma boundaries
// expect. Keeping this here means the flow screens never hand-assemble
// schema objects.

import type { ChunkGenerationContextPayload } from "@/lib/prompts/schemas";
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
