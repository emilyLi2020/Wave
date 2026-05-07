import type { TtsPlaybackMode, KokoroStreamMode } from "@/lib/voice";

export type VoiceTurnPhase =
  | "idle"
  | "warming"
  | "listening"
  | "capturing"
  | "transcribing"
  | "generating"
  | "speaking"
  | "interrupting"
  | "cancelled"
  | "error";

export type VoiceLoopStatus =
  | "idle"
  | "warming"
  | "recording"
  | "transcribing"
  | "thinking"
  | "speaking"
  | "error";

export type AssistantDraftStatus =
  | "streaming"
  | "complete"
  | "interrupted"
  | "discarded";

export interface AssistantDraft {
  status: AssistantDraftStatus;
  content: string;
  turnId: string;
  generationRunId: number;
  startedAt: number;
}

export type VoiceDebugEventName =
  | "manual_start"
  | "manual_stop"
  | "hands_free_start"
  | "hands_free_stop"
  | "vad_speech_start"
  | "vad_speech_real_start"
  | "vad_speech_end"
  | "vad_misfire"
  | "interrupt_detected"
  | "interrupt_rearm"
  | "gemma_abort"
  | "gemma_delta"
  | "gemma_delta_ignored"
  | "tts_chunk_start"
  | "tts_chunk_end"
  | "tts_stop"
  | "stt_start"
  | "stt_done"
  | "turn_idle"
  | "turn_failed"
  | "turn_cancelled";

export interface VoiceDebugEvent {
  id: string;
  name: VoiceDebugEventName;
  detail: string;
  phase: VoiceTurnPhase;
  timestamp: number;
}

export interface VoiceTurnState {
  phase: VoiceTurnPhase;
  assistantDraft: AssistantDraft | null;
  events: VoiceDebugEvent[];
}

export type VoiceTurnEvent =
  | {
      type: "PHASE_CHANGED";
      phase: VoiceTurnPhase;
    }
  | {
      type: "ASSISTANT_DRAFT_CHANGED";
      draft: AssistantDraft | null;
    }
  | {
      type: "EVENT_LOGGED";
      event: VoiceDebugEvent;
    }
  | {
      type: "RESET";
    };

export const INITIAL_VOICE_TURN_STATE: VoiceTurnState = {
  phase: "idle",
  assistantDraft: null,
  events: [],
};

const MAX_DEBUG_EVENTS = 30;

export function voiceTurnReducer(
  state: VoiceTurnState,
  event: VoiceTurnEvent,
): VoiceTurnState {
  switch (event.type) {
    case "PHASE_CHANGED":
      return {
        ...state,
        phase: event.phase,
      };
    case "ASSISTANT_DRAFT_CHANGED":
      return {
        ...state,
        assistantDraft: event.draft,
      };
    case "EVENT_LOGGED":
      return {
        ...state,
        events: [...state.events, event.event].slice(-MAX_DEBUG_EVENTS),
      };
    case "RESET":
      return INITIAL_VOICE_TURN_STATE;
    default:
      return state;
  }
}

export function voicePhaseToLoopStatus(phase: VoiceTurnPhase): VoiceLoopStatus {
  switch (phase) {
    case "warming":
      return "warming";
    case "listening":
    case "capturing":
    case "interrupting":
      return "recording";
    case "transcribing":
      return "transcribing";
    case "generating":
      return "thinking";
    case "speaking":
      return "speaking";
    case "error":
      return "error";
    case "idle":
    case "cancelled":
    default:
      return "idle";
  }
}

export function formatVoiceDebugDetail(input: {
  source?: string;
  text?: string;
  ms?: number | null;
  chunkIndex?: number;
  playbackMode?: TtsPlaybackMode;
  streamMode?: KokoroStreamMode | "idle";
}): string {
  const parts = [
    input.source,
    input.text,
    input.ms === null || input.ms === undefined ? null : `${input.ms}ms`,
    input.chunkIndex === undefined ? null : `chunk ${input.chunkIndex}`,
    input.playbackMode,
    input.streamMode,
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(" · ") : "no detail";
}
