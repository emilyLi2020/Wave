// Pure reducer for the five-chunk urge surfing flow. Lifted from
// client/app/session/_components/session-machine.tsx lines 73-228; React
// glue is rewritten in mobile/src/screens/. Behavior is identical.
//
// Flow:
//   intake → safety → loop(loadingChunk → chunk N → check-in N) for N=1..5
//          → reflection → done
//
// Both chunk narration and check-in agent are LLM-driven (via the runtime
// layer). The chunk generator receives the full prior sessionHistory, and
// each check-in is a multi-turn LLM conversation that ends when the model
// signals endConversation.

import type {
  MatType,
  MedicationStatus,
  SessionOutcome,
  TriggerCategory,
} from "@/types/models";
import type { CheckIn, Chunk, ChunkNumber } from "@/types/session";
import type { SessionHistoryEntry } from "@/lib/prompts/schemas";

// ────────────────────────────────────────────────────────────────────────
// Hoisted from client/app/session/_components/intake-form.tsx so the
// reducer module can stand alone (no UI-component dependency cycle).
// ────────────────────────────────────────────────────────────────────────

export interface IntakeAnswers {
  intakeIntensity: number;
  matType: MatType;
  medicationStatus: MedicationStatus;
  trigger: TriggerCategory;
  /** Optional when trigger is `unknown_or_other` (patient-named context). */
  triggerOther: string | null;
  /**
   * Demo mode collapses every scripted pause/breath segment in the chunk
   * player to a flat 2-second beat so a reviewer can watch the entire
   * 5-chunk + 5-check-in arc end-to-end quickly. UI rehearsal aid only.
   */
  demoMode: boolean;
}

// ────────────────────────────────────────────────────────────────────────
// Hoisted from client/app/session/_components/safety-screen.tsx
// ────────────────────────────────────────────────────────────────────────

export type SafetyOutcome =
  | { kind: "proceed"; usedSubstanceToday: boolean }
  | { kind: "handoff" };

// ────────────────────────────────────────────────────────────────────────
// State machine
// ────────────────────────────────────────────────────────────────────────

export type Phase =
  | "intake"
  | "safety"
  | "safetyHandoff"
  | "loadingChunk"
  | "chunk"
  | "checkIn"
  | "reflection"
  | "done";

export interface State {
  phase: Phase;
  startedAt: string;
  intake: IntakeAnswers | null;
  usedSubstanceToday: boolean;
  currentChunk: ChunkNumber;
  /** The generated chunk for `currentChunk`, or null while loading. */
  generatedChunk: Chunk | null;
  /** Provenance for the most recently generated chunk (for DevTools). */
  generatedChunkSource: "model" | "fallback" | null;
  checkIns: CheckIn[];
  /**
   * Cross-chunk conversation log. One entry per completed chunk
   * (kind: "chunk", lines = the LLM-generated narration that played)
   * and one per completed check-in (kind: "checkIn", with the
   * cravingScore + obstacleCategory + full transcript). Forwarded to
   * BOTH the chunk generator and the check-in chat so each new
   * surface grounds itself in everything that has already happened.
   */
  sessionHistory: SessionHistoryEntry[];
  outcome: SessionOutcome | null;
  pickedNextStep: string | null;
  demoMode: boolean;
  /**
   * Number of chunk/check-in rounds before reflection. Standard run is
   * 5; demo mode runs an abbreviated 2 (2 chunks + 2 check-ins + the
   * final reflection) so a reviewer can watch the whole arc quickly.
   * Set from `IntakeAnswers.demoMode` at intake.
   */
  totalChunks: number;
}

export type Action =
  | { type: "intakeSubmitted"; answers: IntakeAnswers }
  | { type: "safetyResolved"; outcome: SafetyOutcome }
  | {
      type: "chunkGenerated";
      chunk: Chunk;
      lines: string[];
      source: "model" | "fallback";
    }
  | { type: "chunkCompleted" }
  | { type: "checkInCompleted"; checkIn: CheckIn }
  | { type: "nextStepPicked"; choice: string }
  | { type: "sessionFinished" };

export function initialState(): State {
  return {
    phase: "intake",
    startedAt: new Date().toISOString(),
    intake: null,
    usedSubstanceToday: false,
    currentChunk: 1,
    generatedChunk: null,
    generatedChunkSource: null,
    checkIns: [],
    sessionHistory: [],
    outcome: null,
    pickedNextStep: null,
    demoMode: false,
    totalChunks: 5,
  };
}

/** Rounds for a run: demo is an abbreviated 2, standard is 5. */
export const DEMO_TOTAL_CHUNKS = 2;
export const STANDARD_TOTAL_CHUNKS = 5;

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "intakeSubmitted":
      return {
        ...state,
        intake: action.answers,
        demoMode: action.answers.demoMode,
        totalChunks: action.answers.demoMode
          ? DEMO_TOTAL_CHUNKS
          : STANDARD_TOTAL_CHUNKS,
        phase: "safety",
      };
    case "safetyResolved":
      if (action.outcome.kind === "handoff") {
        return {
          ...state,
          phase: "safetyHandoff",
          outcome: "safety_exited",
        };
      }
      return {
        ...state,
        usedSubstanceToday: action.outcome.usedSubstanceToday,
        phase: "loadingChunk",
        currentChunk: 1,
        generatedChunk: null,
      };
    case "chunkGenerated":
      // The effect that fetches the chunk may resolve after the patient
      // has navigated forward. Only honor the result if we were still
      // waiting for it.
      if (
        state.phase !== "loadingChunk" ||
        action.chunk.id !== state.currentChunk
      ) {
        return state;
      }
      return {
        ...state,
        generatedChunk: action.chunk,
        generatedChunkSource: action.source,
        phase: "chunk",
      };
    case "chunkCompleted": {
      const lines = state.generatedChunk
        ? state.generatedChunk.segments
            .filter((segment) => segment.type === "text")
            .map((segment) =>
              segment.type === "text" ? segment.content : "",
            )
        : [];
      const newEntry: SessionHistoryEntry = {
        kind: "chunk",
        chunkNumber: state.currentChunk,
        lines,
      };
      return {
        ...state,
        phase: "checkIn",
        sessionHistory: [...state.sessionHistory, newEntry],
      };
    }
    case "checkInCompleted": {
      const checkIns = [...state.checkIns, action.checkIn];
      const checkInEntry: SessionHistoryEntry = {
        kind: "checkIn",
        chunkNumber: action.checkIn.chunkNumber,
        cravingScore: action.checkIn.cravingScore,
        obstacleCategory: action.checkIn.obstacleCategory,
        turns: action.checkIn.turns.map((turn) => ({
          role: turn.role,
          content: turn.content,
        })),
      };
      const sessionHistory = [...state.sessionHistory, checkInEntry];

      if (action.checkIn.chunkNumber >= state.totalChunks) {
        return {
          ...state,
          checkIns,
          sessionHistory,
          phase: "reflection",
        };
      }
      return {
        ...state,
        checkIns,
        sessionHistory,
        phase: "loadingChunk",
        currentChunk: (action.checkIn.chunkNumber + 1) as ChunkNumber,
        generatedChunk: null,
      };
    }
    case "nextStepPicked":
      return { ...state, pickedNextStep: action.choice };
    case "sessionFinished":
      return { ...state, phase: "done", outcome: "completed" };
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}
