"use client";

/**
 * Voice loop for the clinical check-in surface.
 *
 * Narrow hook: encapsulates VAD + Whisper STT + injected LLM generator +
 * Kokoro TTS into a single conversational loop. Carries over the
 * non-obvious behaviors validated on /models/voice-test:
 *
 *   - Singleton long-lived `MicVAD` (Silero v5) created once per mount;
 *     pause/resume between turns. `markAudioOutput()` is called on every
 *     TTS chunk start so the listener doesn't self-trigger from the
 *     speaker output.
 *   - Streaming-sentence Kokoro playback: assistant deltas push into an
 *     `AsyncTextChunkStream`, which Kokoro's native `TextSplitterStream`
 *     consumes for low first-audio latency.
 *   - Opener-once latch: first `setHandsFreeEnabled(true)` speaks the
 *     opener through Kokoro, then resumes VAD. Subsequent off/on toggles
 *     don't re-speak.
 *   - The opener is NEVER sent to the LLM as an assistant message —
 *     Gemma's chat template requires user/assistant alternation starting
 *     from `user`. The opener lives in the system prompt instead.
 *   - Generation-run-id staleness check: when an in-flight turn gets
 *     interrupted by barge-in, the older generation's deltas can still
 *     arrive a few frames later. The run-id stamp on each LLM call drops
 *     stale callbacks before they mutate the visible state.
 *   - Live mic level meter while hands-free is on, even before VAD
 *     confirms speech start, so the user gets visual feedback.
 *
 * The hook is engine-agnostic: the caller provides a `generate` function
 * that maps history → next assistant reply (+ optional endConversation
 * signal). The clinical check-in wraps `streamCheckInTurn`; other
 * surfaces could plug in a different generator.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { EndConversationSignal } from "@/lib/gemma/checkin";
import { AsyncTextChunkStream } from "@/lib/voice/sentence-buffer";
import {
  createKokoroTextToSpeechEngine,
  createVadListener,
  KOKORO_DEFAULT_VOICE_ID,
  type AudioCaptureLevel,
  type KokoroRuntimeId,
  type KokoroTextToSpeechEngine,
  type TextToSpeechResult,
  type TtsPlaybackLifecycleEvent,
  type VadListenerController,
  type VadListenerLevel,
  type WhisperModelId,
} from "@/lib/voice";
import { createWhisperSpeechToTextEngine } from "@/lib/voice/stt-whisper";

const WHISPER_MODEL_ID: WhisperModelId = "onnx-community/whisper-base.en";
const KOKORO_RUNTIME_ID: KokoroRuntimeId = "fp32-webgpu";
const KOKORO_VOICE_ID = KOKORO_DEFAULT_VOICE_ID;
const TTS_OUTPUT_SUPPRESSION_MS = 260;

export type CheckInVoiceLoopStatus =
  | "idle"
  | "warming"
  | "recording"
  | "transcribing"
  | "thinking"
  | "speaking"
  | "error";

export interface CheckInVoiceLoopTurn {
  role: "patient" | "agent";
  content: string;
}

export interface VoiceTranscriptTurn {
  id: string;
  role: "patient" | "agent";
  content: string;
}

export interface VoiceCheckInGenerateOptions {
  signal: AbortSignal;
  onDelta: (accumulated: string) => void;
}

export interface VoiceCheckInGenerateResult {
  text: string;
  source: "model" | "fallback";
  elapsedMs: number;
  endConversation: EndConversationSignal | null;
}

export type VoiceCheckInGenerator = (
  history: ReadonlyArray<CheckInVoiceLoopTurn>,
  options: VoiceCheckInGenerateOptions,
) => Promise<VoiceCheckInGenerateResult>;

export interface VoiceCheckInTurnEvent {
  user: string;
  assistant: string;
  endConversation: EndConversationSignal | null;
  turnIndex: number;
  latencyMs: number;
  source: "lora" | "fallback";
}

export interface UseCheckInVoiceLoopOptions {
  generate: VoiceCheckInGenerator;
  opener: string;
  onTurnComplete: (event: VoiceCheckInTurnEvent) => void;
  onError?: (err: Error) => void;
}

export interface UseCheckInVoiceLoopReturn {
  status: CheckInVoiceLoopStatus;
  transcript: ReadonlyArray<VoiceTranscriptTurn>;
  level: AudioCaptureLevel;
  handsFreeEnabled: boolean;
  errorMessage: string | null;
  setHandsFreeEnabled: (enabled: boolean) => Promise<void>;
}

const INITIAL_LEVEL: AudioCaptureLevel = { rms: 0, peak: 0, speaking: false };

export function useCheckInVoiceLoop(
  options: UseCheckInVoiceLoopOptions,
): UseCheckInVoiceLoopReturn {
  const [status, setStatus] = useState<CheckInVoiceLoopStatus>("idle");
  const [transcript, setTranscript] = useState<VoiceTranscriptTurn[]>([]);
  const [level, setLevel] = useState<AudioCaptureLevel>(INITIAL_LEVEL);
  const [handsFreeEnabled, setHandsFreeEnabledState] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const vadListenerRef = useRef<VadListenerController | null>(null);
  const kokoroRef = useRef<KokoroTextToSpeechEngine | null>(null);
  const turnsRef = useRef<CheckInVoiceLoopTurn[]>([]);
  const transcriptRef = useRef<VoiceTranscriptTurn[]>([]);
  const handsFreeRef = useRef(false);
  const statusRef = useRef<CheckInVoiceLoopStatus>("idle");
  const openerSpokenRef = useRef(false);
  const generationRunIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const ttsPlaybackActiveRef = useRef(false);
  const activeChunkStreamRef = useRef<AsyncTextChunkStream | null>(null);
  const turnIndexRef = useRef(0);
  const completedRef = useRef(false);

  const setLoopStatus = useCallback((next: CheckInVoiceLoopStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const appendTranscript = useCallback(
    (turn: Omit<VoiceTranscriptTurn, "id">) => {
      const next: VoiceTranscriptTurn = { id: createTurnId(), ...turn };
      transcriptRef.current = [...transcriptRef.current, next];
      setTranscript(transcriptRef.current);
      return next;
    },
    [],
  );

  const replaceLastAssistantTranscript = useCallback((content: string) => {
    const all = transcriptRef.current;
    if (all.length === 0) return;
    const last = all[all.length - 1];
    if (last.role !== "agent") return;
    if (last.content === content) return;
    transcriptRef.current = [
      ...all.slice(0, -1),
      { ...last, content },
    ];
    setTranscript(transcriptRef.current);
  }, []);

  const reportError = useCallback((err: unknown, message?: string) => {
    const msg = message ?? toErrorMessage(err);
    setErrorMessage(msg);
    setLoopStatus("error");
    if (err instanceof Error) {
      optionsRef.current.onError?.(err);
    } else {
      optionsRef.current.onError?.(new Error(msg));
    }
  }, [setLoopStatus]);

  const getKokoroEngine = useCallback((): KokoroTextToSpeechEngine => {
    if (!kokoroRef.current) {
      kokoroRef.current = createKokoroTextToSpeechEngine(KOKORO_RUNTIME_ID);
    }
    return kokoroRef.current;
  }, []);

  const handleTtsPlaybackEvent = useCallback(
    (event: TtsPlaybackLifecycleEvent) => {
      if (event.status === "start") {
        ttsPlaybackActiveRef.current = true;
        vadListenerRef.current?.markAudioOutput(TTS_OUTPUT_SUPPRESSION_MS);
      } else if (event.status === "end") {
        // The streaming path emits one end per chunk; only flip the active
        // flag when no chunks remain in-flight (best-effort: trust the
        // outer await chain to clear it).
        ttsPlaybackActiveRef.current = false;
      }
    },
    [],
  );

  const speakAssistant = useCallback(
    async (text: string): Promise<TextToSpeechResult> => {
      const kokoro = getKokoroEngine();
      try {
        return await kokoro.speak(text, KOKORO_VOICE_ID, {
          onPlaybackEvent: handleTtsPlaybackEvent,
        });
      } finally {
        ttsPlaybackActiveRef.current = false;
      }
    },
    [getKokoroEngine, handleTtsPlaybackEvent],
  );

  const speakStreamingAssistant = useCallback(
    async (
      stream: AsyncTextChunkStream,
    ): Promise<TextToSpeechResult> => {
      const kokoro = getKokoroEngine();
      try {
        return await kokoro.speakStream(stream, KOKORO_VOICE_ID, {
          onPlaybackEvent: handleTtsPlaybackEvent,
        });
      } finally {
        ttsPlaybackActiveRef.current = false;
      }
    },
    [getKokoroEngine, handleTtsPlaybackEvent],
  );

  const processPatientTurn = useCallback(
    async (audio: Float32Array, sampleRate: number) => {
      if (completedRef.current) return;
      if (handsFreeRef.current === false) return;

      setLoopStatus("transcribing");

      let userText: string;
      try {
        const stt = await createWhisperSpeechToTextEngine(WHISPER_MODEL_ID);
        const result = await stt.transcribe(audio, sampleRate);
        userText = result.text.trim();
      } catch (err) {
        reportError(err, `Whisper failed: ${toErrorMessage(err)}`);
        return;
      }

      if (userText.length === 0) {
        // Empty transcript: drop the turn, stay listening.
        setLoopStatus("idle");
        return;
      }

      appendTranscript({ role: "patient", content: userText });
      turnsRef.current = [
        ...turnsRef.current,
        { role: "patient", content: userText },
      ];

      const turnIndex = turnIndexRef.current + 1;
      turnIndexRef.current = turnIndex;
      const runId = generationRunIdRef.current + 1;
      generationRunIdRef.current = runId;

      const controller = new AbortController();
      abortRef.current = controller;
      setLoopStatus("thinking");
      const startedAt = performance.now();

      // Set up streaming TTS pipeline before LLM call so first-sentence
      // audio can start as soon as the model emits punctuation.
      const chunkStream = new AsyncTextChunkStream();
      activeChunkStreamRef.current = chunkStream;
      const ttsPromise = speakStreamingAssistant(chunkStream).catch((err) => {
        // Streaming failed — caller will see firstAudioMs===null on the
        // result and we fall back to full-response speak() below.
        return {
          warning: toErrorMessage(err),
          firstAudioMs: null,
        } as Partial<TextToSpeechResult> as TextToSpeechResult;
      });

      // Placeholder transcript bubble that the streaming onDelta fills in.
      appendTranscript({ role: "agent", content: "" });

      let lastStreamedText = "";

      let result: VoiceCheckInGenerateResult;
      try {
        result = await optionsRef.current.generate(turnsRef.current, {
          signal: controller.signal,
          onDelta: (accumulated) => {
            if (runId !== generationRunIdRef.current) return;
            replaceLastAssistantTranscript(accumulated);
            if (accumulated.startsWith(lastStreamedText)) {
              const delta = accumulated.slice(lastStreamedText.length);
              if (delta.length > 0) {
                chunkStream.enqueue(delta);
                lastStreamedText = accumulated;
              }
            }
          },
        });
      } catch (err) {
        if (runId !== generationRunIdRef.current) return;
        chunkStream.close();
        activeChunkStreamRef.current = null;
        if (err instanceof DOMException && err.name === "AbortError") {
          setLoopStatus("idle");
          return;
        }
        reportError(err, `wllama failed: ${toErrorMessage(err)}`);
        return;
      }

      if (runId !== generationRunIdRef.current) {
        chunkStream.close();
        activeChunkStreamRef.current = null;
        return;
      }

      const finalText = result.text.trim();
      const tailDelta = finalText.startsWith(lastStreamedText)
        ? finalText.slice(lastStreamedText.length)
        : lastStreamedText.length === 0
          ? finalText
          : "";
      if (tailDelta.length > 0) {
        chunkStream.enqueue(tailDelta);
      }
      chunkStream.close();
      activeChunkStreamRef.current = null;
      replaceLastAssistantTranscript(finalText);

      setLoopStatus("speaking");
      // Pause VAD during agent speech (barge-in re-arms it via the
      // listener's interruption mode if the user starts talking again).
      vadListenerRef.current?.pause();

      const ttsResult = await ttsPromise;
      if (ttsResult.firstAudioMs === null) {
        // Streaming produced no audio (e.g. Kokoro stream API missing);
        // fall back to full-response playback.
        try {
          await speakAssistant(finalText);
        } catch (err) {
          if (!(err instanceof DOMException && err.name === "AbortError")) {
            reportError(err, `Kokoro failed: ${toErrorMessage(err)}`);
          }
        }
      }

      turnsRef.current = [
        ...turnsRef.current,
        { role: "agent", content: finalText },
      ];

      const event: VoiceCheckInTurnEvent = {
        user: userText,
        assistant: finalText,
        endConversation: result.endConversation,
        turnIndex,
        latencyMs: Math.round(performance.now() - startedAt),
        source: result.source === "model" ? "lora" : "fallback",
      };
      optionsRef.current.onTurnComplete(event);

      if (result.endConversation) {
        completedRef.current = true;
        setLoopStatus("idle");
        // Caller dismounts us once they finalize the CheckIn. Don't
        // resume VAD.
        return;
      }

      setLoopStatus("idle");
      if (handsFreeRef.current && !completedRef.current) {
        vadListenerRef.current?.resume("normal");
      }
    },
    [
      appendTranscript,
      reportError,
      replaceLastAssistantTranscript,
      setLoopStatus,
      speakAssistant,
      speakStreamingAssistant,
    ],
  );

  // ─── VAD listener lifecycle ────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const listener = await createVadListener({
          onLevel: (next) => {
            if (handsFreeRef.current) {
              setLevel({
                rms: next.rms,
                peak: next.peak,
                speaking: next.speaking,
              });
            }
          },
          onStateChange: () => undefined,
          onSpeechStart: () => {
            if (statusRef.current === "idle" && handsFreeRef.current) {
              setLoopStatus("recording");
            }
          },
          onSpeechEnd: (audio: Float32Array, _level: VadListenerLevel) => {
            // VAD returns 16 kHz mono PCM (per docs/voice-test.md).
            void processPatientTurn(audio, 16_000);
          },
          onSpeechMisfire: () => {
            if (statusRef.current === "recording") {
              setLoopStatus("idle");
            }
          },
          onInterruptionStart: () => {
            // Barge-in: abort the in-flight generation and any active TTS.
            generationRunIdRef.current += 1;
            abortRef.current?.abort();
            activeChunkStreamRef.current?.close();
            activeChunkStreamRef.current = null;
            kokoroRef.current?.stop();
            ttsPlaybackActiveRef.current = false;
            setLoopStatus("recording");
          },
          onInterruptionEnd: (audio: Float32Array) => {
            void processPatientTurn(audio, 16_000);
          },
          onInterruptionIgnored: () => undefined,
        });
        if (cancelled) {
          listener.stop();
          return;
        }
        vadListenerRef.current = listener;
      } catch (err) {
        if (cancelled) return;
        reportError(err, `Voice listener failed: ${toErrorMessage(err)}`);
      }
    })();

    return () => {
      cancelled = true;
      vadListenerRef.current?.stop();
      vadListenerRef.current = null;
      abortRef.current?.abort();
      abortRef.current = null;
      activeChunkStreamRef.current?.close();
      activeChunkStreamRef.current = null;
      kokoroRef.current?.stop();
      kokoroRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setHandsFreeEnabled = useCallback(
    async (enabled: boolean): Promise<void> => {
      if (completedRef.current) return;
      handsFreeRef.current = enabled;
      setHandsFreeEnabledState(enabled);
      setErrorMessage(null);

      if (!enabled) {
        vadListenerRef.current?.pause();
        setLevel(INITIAL_LEVEL);
        if (statusRef.current === "recording") {
          setLoopStatus("idle");
        }
        return;
      }

      // Wait for the VAD listener to come up if it hasn't yet.
      const startedAt = performance.now();
      while (
        !vadListenerRef.current &&
        performance.now() - startedAt < 5_000
      ) {
        await delay(50);
      }
      if (!vadListenerRef.current) {
        reportError(new Error("Voice listener did not initialize in time."));
        handsFreeRef.current = false;
        setHandsFreeEnabledState(false);
        return;
      }

      if (!openerSpokenRef.current) {
        openerSpokenRef.current = true;
        const opener = optionsRef.current.opener;
        appendTranscript({ role: "agent", content: opener });
        setLoopStatus("warming");
        try {
          await speakAssistant(opener);
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return;
          }
          reportError(err, `Kokoro opener failed: ${toErrorMessage(err)}`);
          return;
        }
      }

      if (!handsFreeRef.current) return;
      setLoopStatus("idle");
      vadListenerRef.current.resume("normal");
    },
    [appendTranscript, reportError, setLoopStatus, speakAssistant],
  );

  return {
    status,
    transcript,
    level,
    handsFreeEnabled,
    errorMessage,
    setHandsFreeEnabled,
  };
}

function createTurnId(): string {
  return `turn_${Math.random().toString(36).slice(2, 10)}`;
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Unknown error.";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
