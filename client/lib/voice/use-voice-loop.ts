// useVoiceLoop — reusable on-device voice loop. Owns mic capture (VAD),
// Whisper STT, an injected LLM generator, and Kokoro/browser TTS. The
// /models/voice-test page and the clinical check-in/reflection components
// all consume this hook; only the LLM generator and visible UI differ.
//
// The hook is generator-agnostic: callers pass a `generateReply` function
// that maps history → next assistant text. Generators can attach a metadata
// bag (e.g. the clinical check-in's `endConversation` signal) which we
// surface in `onTurnComplete` callbacks but never interpret here.
//
// This file currently exports the API surface only; implementation lands
// in a follow-up edit once the contract is signed off.

import type { ReactNode } from "react";

import type {
  AudioCaptureLevel,
  BrowserVoiceInfo,
  KokoroRuntimeId,
  KokoroStreamMode,
  KokoroVoiceInfo,
  TextToSpeechBackendId,
  TtsPlaybackMode,
  VadInterruptionIgnoredReason,
  VadListenerLevel,
  VadListenerState,
  VoiceModelLoadState,
  VoiceRuntimeCapabilities,
  WhisperModelId,
} from "@/lib/voice";
import type {
  AssistantDraft,
  VoiceDebugEvent,
  VoiceDebugEventName,
  VoiceLoopStatus,
  VoiceTurnPhase,
} from "@/app/models/voice-test/voice-turn-machine";

/** One turn in the conversation, in chronological order. */
export interface VoiceLoopTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * Result returned by an injected LLM generator. `metadata` is a generic
 * caller-defined bag — the clinical check-in puts its `endConversation`
 * signal here; the dev voice-test page leaves it undefined.
 */
export interface VoiceLoopReplyResult<TMeta = unknown> {
  text: string;
  source: "model" | "fallback";
  elapsedMs: number;
  errorMessage: string | null;
  metadata?: TMeta;
}

/** Signature an LLM generator must implement to plug into the loop. */
export type VoiceLoopGenerator<TMeta = unknown> = (
  history: ReadonlyArray<VoiceLoopTurn>,
  options: {
    signal: AbortSignal;
    onDelta: (accumulated: string) => void;
  },
) => Promise<VoiceLoopReplyResult<TMeta>>;

/** A single visible turn in the transcript shown to the user. */
export interface TranscriptTurn {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  meta: string;
}

/** Timing/quality stats for the most recent turn, for debug panels. */
export interface LastRunMetrics {
  audioMs: number | null;
  sttMs: number | null;
  firstTokenMs: number | null;
  firstAudioMs: number | null;
  gemmaMs: number | null;
  ttsMs: number | null;
  totalMs: number | null;
  chunkCount: number;
  playbackMode: TtsPlaybackMode;
  streamMode: KokoroStreamMode | null;
  fallbackUsed: boolean;
}

export type InterruptionStatus =
  | "idle"
  | "armed"
  | "suppressed"
  | "detected"
  | "ignored";

export interface InterruptionDebugState {
  status: InterruptionStatus;
  confidence: number | null;
  lastIgnoredReason: VadInterruptionIgnoredReason | null;
  lastEvent: string;
}

/**
 * Options to configure the loop on mount. Most are runtime-mutable —
 * callers should pass current values from their own state.
 */
export interface UseVoiceLoopOptions<TMeta = unknown> {
  /** Injected LLM generator. The only required field. */
  generateReply: VoiceLoopGenerator<TMeta>;

  /**
   * Optional turns to seed the transcript with. Useful when the host
   * surface needs to show "you said X" / "assistant opened with Y"
   * before the user has spoken (e.g. mock check-in opener, real
   * clinical check-in score from a prior composer).
   */
  initialHistory?: ReadonlyArray<VoiceLoopTurn>;

  /**
   * Optional system message describing the assistant's first line. When
   * provided, the loop will speak this line via TTS the first time the
   * user enters hands-free mode (once per `reset()`). The opener is NOT
   * sent to the LLM as an assistant turn — Gemma's chat template rejects
   * leading assistant turns. Callers should mention it in their system
   * prompt instead.
   */
  opener?: string;

  /** Whisper STT model id. */
  whisperModelId: WhisperModelId;

  /** TTS routing. */
  ttsBackend: TextToSpeechBackendId;
  kokoroRuntimeId: KokoroRuntimeId;
  kokoroVoiceId: string;
  /** Browser voice URI when ttsBackend === "browser". */
  browserVoiceURI?: string;

  /** Full-response vs streaming-sentence playback. */
  playbackMode: TtsPlaybackMode;

  /** Whether the patient is allowed to interrupt TTS by speaking over it. */
  bargeInEnabled: boolean;

  /**
   * Called after every completed assistant turn (model or fallback).
   * The clinical check-in uses this to read `metadata.endConversation`.
   */
  onTurnComplete?: (event: {
    user: string;
    assistant: string;
    reply: VoiceLoopReplyResult<TMeta>;
  }) => void;
}

/** Reactive state + actions returned by the hook. */
export interface UseVoiceLoopReturn {
  // Status / phase
  status: VoiceLoopStatus;
  voicePhase: VoiceTurnPhase;
  events: readonly VoiceDebugEvent[];

  // Transcript
  transcript: readonly TranscriptTurn[];
  assistantDraft: AssistantDraft | null;

  // Mic / VAD
  level: AudioCaptureLevel;
  vadState: VadListenerState;
  vadLevel: VadListenerLevel;
  interruptionDebug: InterruptionDebugState;
  handsFreeEnabled: boolean;
  isRecording: boolean;

  // TTS playback debug
  ttsPlaybackActive: boolean;
  streamingTtsStatus: string;
  streamingTtsMode: KokoroStreamMode | "idle";

  // Model load state (host renders warm-up UI)
  whisperState: VoiceModelLoadState;
  kokoroState: VoiceModelLoadState;

  // Capabilities + voices for config panels
  capabilities: VoiceRuntimeCapabilities | null;
  onlineStatus: boolean | null;
  browserVoices: readonly BrowserVoiceInfo[];
  localBrowserVoices: readonly BrowserVoiceInfo[];
  kokoroVoices: readonly KokoroVoiceInfo[];

  // Metrics
  metrics: LastRunMetrics;

  // Surface messages
  errorMessage: string | null;
  warningMessage: string | null;

  // Actions
  /** Preload Whisper + Kokoro. Safe to call multiple times. */
  warmModels: () => Promise<void>;
  /**
   * Toggle hands-free mode. Entering hands-free speaks the opener (once
   * per session, reset by `reset()`), then resumes VAD in normal mode.
   * Exiting pauses VAD and clears any pending barge-in state.
   */
  setHandsFreeEnabled: (enabled: boolean) => Promise<void>;
  /** Start a single-turn manual recording (Stop & transcribe model). */
  startRecording: () => Promise<void>;
  /** Stop the active manual recording and submit to STT. */
  stopRecording: () => Promise<void>;
  /** Append a user turn programmatically (e.g. from a non-voice composer). */
  submitTurn: (userText: string) => Promise<void>;
  /** Cancel the in-flight assistant turn (interrupt generation + TTS). */
  cancel: () => void;
  /** Clear transcript + metrics + reset opener flag. */
  reset: () => void;

  // Internal helpers exposed for advanced hosts
  logVoiceEvent: (
    name: VoiceDebugEventName,
    detail?: string,
    phase?: VoiceTurnPhase,
  ) => void;
}

/**
 * Stub. Will be filled in once we agree on the API surface above. The
 * runtime export below exists so callers can type-check against the
 * return shape during the refactor; it throws at runtime.
 */
export function useVoiceLoop<TMeta = unknown>(
  _options: UseVoiceLoopOptions<TMeta>,
): UseVoiceLoopReturn {
  throw new Error(
    "useVoiceLoop is not yet implemented — see lib/voice/use-voice-loop.ts.",
  );
}

/** Re-exported for hosts that compose voice-loop UI. */
export type { ReactNode };
