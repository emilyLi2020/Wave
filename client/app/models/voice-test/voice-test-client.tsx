"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";

import {
  getGemmaModelLoadState,
  preloadLocalGemma,
  subscribeGemmaModelLoad,
  type GemmaModelLoadState,
} from "@/lib/gemma/local-runtime";
import {
  MOCK_VOICE_CHECK_IN_SESSION,
  generateVoiceTestReply,
  type GenerateVoiceTestReplyResult,
  type VoiceTestTurn,
} from "@/lib/gemma/voice-test";
import {
  AsyncTextChunkStream,
} from "@/lib/voice/sentence-buffer";
import {
  INITIAL_VOICE_TURN_STATE,
  formatVoiceDebugDetail,
  voicePhaseToLoopStatus,
  voiceTurnReducer,
  type AssistantDraft,
  type VoiceDebugEvent,
  type VoiceDebugEventName,
  type VoiceLoopStatus,
  type VoiceTurnPhase,
} from "@/app/models/voice-test/voice-turn-machine";
import {
  createBrowserTextToSpeechEngine,
  createKokoroTextToSpeechEngine,
  createVadListener,
  createWhisperSpeechToTextEngine,
  getKokoroLoadState,
  getVoiceRuntimeCapabilities,
  getWhisperLoadState,
  KOKORO_DEFAULT_VOICE_ID,
  KOKORO_DEFAULT_RUNTIME_ID,
  KOKORO_MODEL_ID,
  KOKORO_RUNTIME_OPTIONS,
  preloadKokoroTextToSpeech,
  subscribeKokoroLoad,
  subscribeWhisperLoad,
  WHISPER_MODEL_IDS,
  type AudioCaptureLevel,
  type AudioCaptureResult,
  type BrowserVoiceInfo,
  type KokoroRuntimeId,
  type KokoroRuntimeOption,
  type KokoroStreamMode,
  type KokoroTextToSpeechEngine,
  type KokoroVoiceInfo,
  type SpeechToTextResult,
  type TextToSpeechBackendId,
  type TextToSpeechEngine,
  type TextToSpeechResult,
  type TtsPlaybackLifecycleEvent,
  type TtsPlaybackMode,
  type VadInterruptionIgnoredReason,
  type VadListenerController,
  type VadListenerLevel,
  type VadListenerState,
  type VoiceModelLoadState,
  type VoiceRuntimeCapabilities,
  type WhisperModelId,
} from "@/lib/voice";

type RecordingSource = "manual" | "hands-free" | "interruption";
type InterruptionStatus = "idle" | "armed" | "suppressed" | "detected" | "ignored";
type MainModelPhase = "idle" | "loading" | "ready" | "error";

interface InterruptionDebugState {
  status: InterruptionStatus;
  confidence: number | null;
  lastIgnoredReason: VadInterruptionIgnoredReason | null;
  lastEvent: string;
}

interface MainModelStatusSummary {
  label: string;
  phase: MainModelPhase | "skipped";
  progress: number | null;
  detail: string;
}

interface TranscriptTurn {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  meta: string;
}

interface LastRunMetrics {
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

interface PendingVadAudioTurn {
  audioResult: AudioCaptureResult;
  source: RecordingSource;
  level: VadListenerLevel;
}

const INITIAL_METRICS: LastRunMetrics = {
  audioMs: null,
  sttMs: null,
  firstTokenMs: null,
  firstAudioMs: null,
  gemmaMs: null,
  ttsMs: null,
  totalMs: null,
  chunkCount: 0,
  playbackMode: "full-response",
  streamMode: null,
  fallbackUsed: false,
};

const INITIAL_VAD_LEVEL: VadListenerLevel = {
  rms: 0,
  peak: 0,
  speaking: false,
  noiseFloor: 0,
  threshold: 0,
  confidence: 0,
};

const INITIAL_INTERRUPTION_DEBUG: InterruptionDebugState = {
  status: "idle",
  confidence: null,
  lastIgnoredReason: null,
  lastEvent: "not armed",
};

function createInitialTranscript(): TranscriptTurn[] {
  return [
    {
      id: createTurnId(),
      role: "system",
      content:
        "Developer-only voice test. This mock check-in does not touch the clinical session flow.",
      meta: MOCK_VOICE_CHECK_IN_SESSION.title,
    },
    {
      id: createTurnId(),
      role: "assistant",
      content: MOCK_VOICE_CHECK_IN_SESSION.opener,
      meta: "mock check-in opener",
    },
  ];
}

function createInitialHistory(): VoiceTestTurn[] {
  return [
    {
      role: "assistant",
      content: MOCK_VOICE_CHECK_IN_SESSION.opener,
    },
  ];
}

export function VoiceTestClient() {
  const [status, setStatus] = useState<VoiceLoopStatus>("idle");
  const [selectedModelId, setSelectedModelId] =
    useState<WhisperModelId>("onnx-community/whisper-tiny.en");
  const [ttsBackend, setTtsBackend] =
    useState<TextToSpeechBackendId>("kokoro");
  const [playbackMode, setPlaybackMode] =
    useState<TtsPlaybackMode>("streaming-sentence");
  const [selectedVoiceURI, setSelectedVoiceURI] = useState<string>("");
  const [selectedKokoroVoiceId, setSelectedKokoroVoiceId] = useState(
    KOKORO_DEFAULT_VOICE_ID,
  );
  const [selectedKokoroRuntimeId, setSelectedKokoroRuntimeId] =
    useState<KokoroRuntimeId>(KOKORO_DEFAULT_RUNTIME_ID);
  const [capabilities, setCapabilities] =
    useState<VoiceRuntimeCapabilities | null>(null);
  const [onlineStatus, setOnlineStatus] = useState<boolean | null>(null);
  const [gemmaState, setGemmaState] = useState<GemmaModelLoadState>(
    getGemmaModelLoadState(),
  );
  const [whisperState, setWhisperState] = useState<VoiceModelLoadState>(
    getWhisperLoadState(),
  );
  const [kokoroState, setKokoroState] = useState<VoiceModelLoadState>(
    getKokoroLoadState(),
  );
  const [voices, setVoices] = useState<BrowserVoiceInfo[]>([]);
  const [kokoroVoices, setKokoroVoices] = useState<KokoroVoiceInfo[]>([]);
  const [level, setLevel] = useState<AudioCaptureLevel>({
    rms: 0,
    peak: 0,
    speaking: false,
  });
  const [handsFreeEnabled, setHandsFreeEnabled] = useState(false);
  const [vadState, setVadState] = useState<VadListenerState>("idle");
  const [vadLevel, setVadLevel] = useState<VadListenerLevel>(INITIAL_VAD_LEVEL);
  const [interruptionDebug, setInterruptionDebug] =
    useState<InterruptionDebugState>(INITIAL_INTERRUPTION_DEBUG);
  const [bargeInEnabled, setBargeInEnabled] = useState(true);
  const [streamingTtsStatus, setStreamingTtsStatus] = useState("idle");
  const [streamingTtsMode, setStreamingTtsMode] = useState<
    KokoroStreamMode | "idle"
  >("idle");
  const [ttsPlaybackActive, setTtsPlaybackActive] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptTurn[]>(() =>
    createInitialTranscript(),
  );
  const [metrics, setMetrics] = useState<LastRunMetrics>(INITIAL_METRICS);
  const [voiceTurn, dispatchVoiceTurn] = useReducer(
    voiceTurnReducer,
    INITIAL_VOICE_TURN_STATE,
  );

  const vadListenerRef = useRef<VadListenerController | null>(null);
  const browserTtsRef = useRef<TextToSpeechEngine | null>(null);
  const kokoroTtsRef = useRef<KokoroTextToSpeechEngine | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const textChunkStreamRef = useRef<AsyncTextChunkStream | null>(null);
  const generationRunIdRef = useRef(0);
  const assistantDraftRef = useRef<AssistantDraft | null>(null);
  const historyRef = useRef<VoiceTestTurn[]>(createInitialHistory());
  const stoppingRef = useRef(false);
  const handsFreeEnabledRef = useRef(false);
  const statusRef = useRef<VoiceLoopStatus>("idle");
  const voicePhaseRef = useRef<VoiceTurnPhase>("idle");
  const bargeInEnabledRef = useRef(true);
  const ttsPlaybackActiveRef = useRef(false);
  const activeTtsPlaybackCountRef = useRef(0);
  const activeRecordingSourceRef = useRef<RecordingSource | null>(null);
  const pendingVadAudioRef = useRef<PendingVadAudioTurn | null>(null);
  const submitVadAudioTurnRef = useRef<
    (audio: Float32Array, source: RecordingSource, level: VadListenerLevel) => void
  >(() => undefined);
  const interruptionInProgressRef = useRef(false);
  const interruptionModeArmedRef = useRef(false);
  const interruptionArmPendingRef = useRef(false);
  const startRecordingRef = useRef<
    (source?: RecordingSource) => void
  >(() => undefined);
  const vadResumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interruptionSuppressionTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const localVoices = useMemo(
    () => voices.filter((voice) => voice.localService),
    [voices],
  );
  const selectedKokoroRuntime = useMemo(
    () =>
      KOKORO_RUNTIME_OPTIONS.find(
        (runtime) => runtime.id === selectedKokoroRuntimeId,
      ) ?? KOKORO_RUNTIME_OPTIONS[0],
    [selectedKokoroRuntimeId],
  );
  const canRecord = Boolean(
    capabilities?.hasMicrophoneApi &&
      capabilities.isSecureContext,
  );
  const isBusy =
    status === "warming" ||
    status === "transcribing" ||
    status === "thinking" ||
    status === "speaking";
  const isRecording = status === "recording";
  const visibleAssistantDraft =
    voiceTurn.assistantDraft?.status === "streaming"
      ? voiceTurn.assistantDraft.content
      : "";

  useEffect(() => {
    handsFreeEnabledRef.current = handsFreeEnabled;
  }, [handsFreeEnabled]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    bargeInEnabledRef.current = bargeInEnabled;
  }, [bargeInEnabled]);

  useEffect(() => {
    ttsPlaybackActiveRef.current = ttsPlaybackActive;
  }, [ttsPlaybackActive]);

  useEffect(() => {
    setCapabilities(getVoiceRuntimeCapabilities());
    setOnlineStatus(navigator.onLine);
    function handleOnlineStatusChange() {
      setOnlineStatus(navigator.onLine);
    }
    window.addEventListener("online", handleOnlineStatusChange);
    window.addEventListener("offline", handleOnlineStatusChange);

    const tts = createBrowserTextToSpeechEngine();
    browserTtsRef.current = tts;
    kokoroTtsRef.current = createKokoroTextToSpeechEngine(
      KOKORO_DEFAULT_RUNTIME_ID,
    );
    void tts.getVoices().then((nextVoices) => {
      setVoices(nextVoices);
      const defaultLocalVoice =
        nextVoices.find((voice) => voice.localService && voice.default) ??
        nextVoices.find(
          (voice) =>
            voice.localService && voice.lang.toLowerCase().startsWith("en"),
        );
      if (defaultLocalVoice) setSelectedVoiceURI(defaultLocalVoice.voiceURI);
    });

    const unsubscribeGemma = subscribeGemmaModelLoad(setGemmaState);
    const unsubscribeWhisper = subscribeWhisperLoad(setWhisperState);
    const unsubscribeKokoro = subscribeKokoroLoad(setKokoroState);
    return () => {
      window.removeEventListener("online", handleOnlineStatusChange);
      window.removeEventListener("offline", handleOnlineStatusChange);
      unsubscribeGemma();
      unsubscribeWhisper();
      unsubscribeKokoro();
      tts.stop();
      vadListenerRef.current?.stop();
      if (vadResumeTimerRef.current) {
        clearTimeout(vadResumeTimerRef.current);
      }
      if (interruptionSuppressionTimerRef.current) {
        clearTimeout(interruptionSuppressionTimerRef.current);
      }
      clearTtsPlaybackActive();
      kokoroTtsRef.current?.stop();
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    kokoroTtsRef.current?.stop();
    kokoroTtsRef.current = createKokoroTextToSpeechEngine(
      selectedKokoroRuntimeId,
    );
    setKokoroVoices([]);
    clearTtsPlaybackActive();
    setStreamingTtsStatus("idle");
    setStreamingTtsMode("idle");
  }, [selectedKokoroRuntimeId]);

  useEffect(() => {
    if (
      capabilities?.hasWebGpu === false &&
      selectedKokoroRuntime.device === "webgpu"
    ) {
      setSelectedKokoroRuntimeId(KOKORO_DEFAULT_RUNTIME_ID);
      setWarningMessage(
        "WebGPU is unavailable in this browser, so Kokoro was switched back to WASM.",
      );
    }
  }, [capabilities?.hasWebGpu, selectedKokoroRuntime.device]);

  useEffect(() => {
    if (!handsFreeEnabled || !vadListenerRef.current) return;

    if (status === "recording") {
      clearVadResumeTimer();
      interruptionModeArmedRef.current = false;
      interruptionArmPendingRef.current = false;
      setInterruptionDebug((current) =>
        current.status === "detected" ? current : INITIAL_INTERRUPTION_DEBUG,
      );
      if (activeRecordingSourceRef.current === "interruption") {
        return;
      }
      vadListenerRef.current.resume("normal");
      return;
    }

    if (status === "idle") {
      clearVadResumeTimer();
      interruptionModeArmedRef.current = false;
      interruptionArmPendingRef.current = false;
      setInterruptionDebug(INITIAL_INTERRUPTION_DEBUG);
      vadResumeTimerRef.current = setTimeout(() => {
        if (handsFreeEnabledRef.current && statusRef.current === "idle") {
          vadListenerRef.current?.resume("normal");
        }
      }, 500);
      return;
    }

    const ttsCanBeInterrupted = status === "speaking" || ttsPlaybackActive;

    if (ttsCanBeInterrupted && bargeInEnabled) {
      if (!interruptionModeArmedRef.current && !interruptionArmPendingRef.current) {
        setInterruptionDebug((current) => ({
          status: current.status === "detected" ? "detected" : "suppressed",
          confidence: current.confidence,
          lastIgnoredReason: current.lastIgnoredReason,
          lastEvent: "waiting for TTS grace period",
        }));
        scheduleInterruptionRearm(600, "TTS grace period elapsed");
      } else {
        setInterruptionDebug((current) => ({
          status:
            current.status === "detected"
              ? "detected"
              : interruptionModeArmedRef.current
                ? "armed"
                : "suppressed",
          confidence: current.confidence,
          lastIgnoredReason: current.lastIgnoredReason,
          lastEvent: interruptionModeArmedRef.current
            ? "listening for sustained barge-in"
            : "waiting for TTS grace period",
        }));
      }
      return;
    }

    clearVadResumeTimer();
    interruptionModeArmedRef.current = false;
    interruptionArmPendingRef.current = false;
    setInterruptionDebug(INITIAL_INTERRUPTION_DEBUG);
    vadListenerRef.current.pause();
  }, [handsFreeEnabled, status, bargeInEnabled, ttsPlaybackActive]);

  async function handleHandsFreeChange(enabled: boolean): Promise<void> {
    if (!enabled) {
      handsFreeEnabledRef.current = false;
      vadListenerRef.current?.pause();
      if (vadResumeTimerRef.current) {
        clearTimeout(vadResumeTimerRef.current);
        vadResumeTimerRef.current = null;
      }
      if (interruptionSuppressionTimerRef.current) {
        clearTimeout(interruptionSuppressionTimerRef.current);
        interruptionSuppressionTimerRef.current = null;
      }
      setHandsFreeEnabled(false);
      setVadState("idle");
      setVadLevel(INITIAL_VAD_LEVEL);
      setInterruptionDebug(INITIAL_INTERRUPTION_DEBUG);
      interruptionInProgressRef.current = false;
      interruptionModeArmedRef.current = false;
      interruptionArmPendingRef.current = false;
      logVoiceEvent("hands_free_stop", "hands-free disabled");
      if (activeRecordingSourceRef.current === "hands-free") {
        activeRecordingSourceRef.current = null;
        setVoicePhase("idle", "turn_idle", "hands-free stopped");
      }
      return;
    }

    if (!canRecord) {
      setErrorMessage(
        "Voice capture needs HTTPS or localhost plus microphone support.",
      );
      setVoicePhase("error", "turn_failed", "microphone unavailable");
      return;
    }

    setErrorMessage(null);
    setWarningMessage("Hands-free mode is listening for your next voice turn.");
    handsFreeEnabledRef.current = true;
    try {
      const listener = await ensureVadListener();
      setHandsFreeEnabled(true);
      setVoicePhase("listening", "hands_free_start", "hands-free listening");
      listener.resume("normal");
    } catch (err) {
      handsFreeEnabledRef.current = false;
      setHandsFreeEnabled(false);
      setVadState("error");
      setErrorMessage(toErrorMessage(err));
      setVoicePhase("error", "turn_failed", toErrorMessage(err));
    }
  }

  async function ensureVadListener(): Promise<VadListenerController> {
    if (vadListenerRef.current) return vadListenerRef.current;

    const listener = await createVadListener({
      onLevel: handleVadLevel,
      onStateChange: setVadState,
      onSpeechStart: () => {
        const source = activeRecordingSourceRef.current;
        if (source) {
          setVoicePhase(
            source === "interruption" ? "interrupting" : "capturing",
            "vad_speech_start",
            formatVoiceDebugDetail({ source }),
          );
          return;
        }

        if (handsFreeEnabledRef.current && statusRef.current === "idle") {
          beginVadCapture("hands-free");
          setVoicePhase(
            "capturing",
            "vad_speech_start",
            formatVoiceDebugDetail({ source: "hands-free" }),
          );
        }
      },
      onSpeechEnd: (audio, nextVadLevel) => {
        const source =
          activeRecordingSourceRef.current ??
          (handsFreeEnabledRef.current ? "hands-free" : "manual");
        submitVadAudioTurnRef.current(audio, source, nextVadLevel);
      },
      onSpeechMisfire: (nextVadLevel, mode) => {
        logVoiceEvent(
          "vad_misfire",
          formatVoiceDebugDetail({
            source: activeRecordingSourceRef.current ?? mode,
            text: `peak ${nextVadLevel.peak.toFixed(3)}`,
          }),
        );
        if (activeRecordingSourceRef.current && statusRef.current === "recording") {
          activeRecordingSourceRef.current = null;
          setWarningMessage("Speech was too short for Silero to submit.");
          setVoicePhase("idle", "turn_idle", "VAD misfire");
        }
      },
      onInterruptionStart: (nextVadLevel) => {
        if (
          !handsFreeEnabledRef.current ||
          !bargeInEnabledRef.current ||
          (statusRef.current !== "speaking" && !ttsPlaybackActiveRef.current)
        ) {
          return;
        }

        setInterruptionDebug({
          status: "detected",
          confidence: nextVadLevel.confidence,
          lastIgnoredReason: null,
          lastEvent: "interruption detected",
        });
        interruptionInProgressRef.current = true;
        interruptionModeArmedRef.current = false;
        interruptionArmPendingRef.current = false;
        beginVadInterruptionRecording(nextVadLevel);
      },
      onInterruptionEnd: (audio, nextVadLevel) => {
        submitVadAudioTurnRef.current(audio, "interruption", nextVadLevel);
      },
      onInterruptionIgnored: (reason, nextVadLevel) => {
        setInterruptionDebug((current) => ({
          status: "ignored",
          confidence: nextVadLevel.confidence,
          lastIgnoredReason: reason,
          lastEvent: `ignored: ${formatIgnoredReason(reason)}`,
        }));
      },
    });

    vadListenerRef.current = listener;
    return listener;
  }

  function handleVadLevel(nextVadLevel: VadListenerLevel): void {
    setVadLevel(nextVadLevel);
    if (activeRecordingSourceRef.current) {
      setLevel({
        rms: nextVadLevel.rms,
        peak: nextVadLevel.peak,
        speaking: nextVadLevel.speaking,
      });
    }
    setInterruptionDebug((current) => {
      if (current.status === "idle") return current;
      return {
        ...current,
        confidence: nextVadLevel.confidence,
      };
    });
  }

  function setVoicePhase(
    phase: VoiceTurnPhase,
    eventName?: VoiceDebugEventName,
    detail = "phase changed",
  ): void {
    voicePhaseRef.current = phase;
    dispatchVoiceTurn({ type: "PHASE_CHANGED", phase });
    const nextStatus = voicePhaseToLoopStatus(phase);
    statusRef.current = nextStatus;
    setStatus(nextStatus);
    if (eventName) logVoiceEvent(eventName, detail, phase);
  }

  function logVoiceEvent(
    name: VoiceDebugEventName,
    detail = "event",
    phase = voicePhaseRef.current,
  ): void {
    dispatchVoiceTurn({
      type: "EVENT_LOGGED",
      event: {
        id: createTurnId(),
        name,
        detail,
        phase,
        timestamp: performance.now(),
      },
    });
  }

  function setAssistantDraft(nextDraft: AssistantDraft | null): void {
    assistantDraftRef.current = nextDraft;
    dispatchVoiceTurn({
      type: "ASSISTANT_DRAFT_CHANGED",
      draft: nextDraft,
    });
  }

  function beginVadInterruptionRecording(nextVadLevel: VadListenerLevel): void {
    if (activeRecordingSourceRef.current === "interruption") return;
    cancelActiveAssistantTurn("interruption");
    beginVadCapture("interruption", nextVadLevel);
    setVoicePhase(
      "interrupting",
      "interrupt_detected",
      formatVoiceDebugDetail({
        source: "interruption",
        text: formatProbability(nextVadLevel.confidence),
      }),
    );
    setWarningMessage("Interruption detected; recording your barge-in.");
  }

  function beginVadCapture(
    source: RecordingSource,
    nextVadLevel: VadListenerLevel = vadLevel,
  ): void {
    setLevel({
      rms: nextVadLevel.rms,
      peak: nextVadLevel.peak,
      speaking: true,
    });
    pendingVadAudioRef.current = null;
    activeRecordingSourceRef.current = source;
  }

  function cancelActiveAssistantTurn(reason: "interruption" | "cancel"): void {
    generationRunIdRef.current += 1;
    const controller = abortRef.current;
    abortRef.current = null;
    textChunkStreamRef.current?.close();
    textChunkStreamRef.current = null;
    controller?.abort();
    stopTtsPlayback();

    const activeDraft = assistantDraftRef.current;
    const interruptedDraft =
      reason === "interruption" && activeDraft?.status === "streaming"
        ? activeDraft.content.trim()
        : "";
    if (activeDraft) {
      setAssistantDraft({
        ...activeDraft,
        status: reason === "interruption" ? "interrupted" : "discarded",
      });
    }
    setAssistantDraft(null);
    setStreamingTtsStatus("idle");
    setStreamingTtsMode("idle");
    stoppingRef.current = false;
    logVoiceEvent(
      reason === "interruption" ? "gemma_abort" : "turn_cancelled",
      reason,
    );

    if (reason !== "interruption" || interruptedDraft.length === 0) return;

    historyRef.current = [
      ...historyRef.current,
      { role: "assistant", content: interruptedDraft },
    ];
    appendTranscript({
      role: "assistant",
      content: interruptedDraft,
      meta: "interrupted local Gemma draft",
    });
  }

  function clearVadResumeTimer(): void {
    if (!vadResumeTimerRef.current) return;
    clearTimeout(vadResumeTimerRef.current);
    vadResumeTimerRef.current = null;
  }

  function scheduleInterruptionRearm(delayMs: number, detail: string): void {
    clearVadResumeTimer();
    interruptionArmPendingRef.current = true;
    logVoiceEvent("interrupt_rearm", `scheduled: ${detail}`);
    vadResumeTimerRef.current = setTimeout(() => {
      interruptionArmPendingRef.current = false;
      if (
        handsFreeEnabledRef.current &&
        (statusRef.current === "speaking" || ttsPlaybackActiveRef.current) &&
        bargeInEnabledRef.current
      ) {
        interruptionModeArmedRef.current = true;
        vadListenerRef.current?.resume("interruption");
        logVoiceEvent("interrupt_rearm", detail);
        setInterruptionDebug((current) => ({
          status: current.status === "detected" ? "detected" : "armed",
          confidence: current.confidence,
          lastIgnoredReason: current.lastIgnoredReason,
          lastEvent: "listening for sustained barge-in",
        }));
      }
    }, delayMs);
  }

  async function handleWarmModels() {
    setVoicePhase("warming", "turn_idle", "warming models");
    setErrorMessage(null);
    setWarningMessage("Warming local Whisper, Gemma, and Kokoro models.");

    try {
      await createWhisperSpeechToTextEngine(selectedModelId);
      await preloadLocalGemma();
      if (ttsBackend === "kokoro") {
        await preloadKokoroTextToSpeech(selectedKokoroRuntimeId);
        await ensureKokoroVoices();
      }
      setVoicePhase("idle", "turn_idle", "models ready");
      setWarningMessage("Local voice models are ready.");
    } catch (err) {
      setVoicePhase("error", "turn_failed", toErrorMessage(err));
      setErrorMessage(toErrorMessage(err));
    }
  }

  async function handleStartRecording(
    source: RecordingSource = "manual",
  ): Promise<void> {
    if (!canRecord) {
      setErrorMessage(
        "Voice capture needs HTTPS or localhost plus microphone support.",
      );
      setVoicePhase("error", "turn_failed", "microphone unavailable");
      return;
    }

    const canInterruptPlayback =
      statusRef.current === "speaking" || ttsPlaybackActiveRef.current;

    if (canInterruptPlayback && (bargeInEnabled || source === "interruption")) {
      cancelActiveAssistantTurn("interruption");
      setWarningMessage(
        source === "interruption"
          ? "Interruption detected; recording your barge-in."
          : source === "hands-free"
            ? "Hands-free barge-in stopped TTS playback."
            : "Barge-in stopped TTS playback.",
      );
    }

    if (isBusy && !canInterruptPlayback) return;

    setErrorMessage(null);
    setLevel({ rms: 0, peak: 0, speaking: false });

    try {
      const listener = await ensureVadListener();
      beginVadCapture(source, vadLevel);
      setVoicePhase(
        "listening",
        source === "manual" ? "manual_start" : "hands_free_start",
        formatVoiceDebugDetail({ source }),
      );
      setWarningMessage(
        source === "manual"
          ? "Listening with Silero. Speak naturally; stop can flush the active segment."
          : "Hands-free mode is listening for your next voice turn.",
      );
      listener.resume("normal");
    } catch (err) {
      setVoicePhase("error", "turn_failed", toErrorMessage(err));
      setErrorMessage(toErrorMessage(err));
    }
  }

  async function handleStopRecording() {
    if (!activeRecordingSourceRef.current || stoppingRef.current) return;
    const source = activeRecordingSourceRef.current;
    logVoiceEvent(
      source === "manual" ? "manual_stop" : "hands_free_stop",
      formatVoiceDebugDetail({ source }),
    );
    setWarningMessage("Asking Silero to finish the active speech segment.");
    vadListenerRef.current?.pause({ submitSpeech: true });
  }

  function submitVadAudioTurn(
    audio: Float32Array,
    recordingSource: RecordingSource,
    nextVadLevel: VadListenerLevel,
  ): void {
    if (stoppingRef.current) return;
    const audioResult = createVadAudioResult(audio);
    pendingVadAudioRef.current = {
      audioResult,
      source: recordingSource,
      level: nextVadLevel,
    };
    void processVadAudioTurn(audioResult, recordingSource, nextVadLevel);
  }

  async function processVadAudioTurn(
    audioResult: AudioCaptureResult,
    recordingSource: RecordingSource,
    nextVadLevel: VadListenerLevel,
  ) {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    const loopStartedAt = performance.now();
    activeRecordingSourceRef.current = null;
    pendingVadAudioRef.current = null;
    setVoicePhase(
      "transcribing",
      "vad_speech_end",
      formatVoiceDebugDetail({
        source: recordingSource,
        ms: audioResult.durationMs,
      }),
    );
    setLevel({
      rms: nextVadLevel.rms,
      peak: Math.max(nextVadLevel.peak, audioResult.peakLevel),
      speaking: false,
    });
    setWarningMessage(
      recordingSource === "interruption"
        ? "Interruption speech ended; transcribing your barge-in."
        : "Silero detected speech end; transcribing your turn.",
    );
    setErrorMessage(null);
    let streamingPromise: Promise<TextToSpeechResult> | null = null;
    let generationController: AbortController | null = null;
    let generationRunId: number | null = null;

    try {
      logVoiceEvent(
        "stt_start",
        formatVoiceDebugDetail({
          source: recordingSource,
          ms: audioResult.durationMs,
        }),
      );
      const sttEngine = await createWhisperSpeechToTextEngine(selectedModelId);
      const sttResult = await sttEngine.transcribe(
        audioResult.audio,
        audioResult.sampleRate,
      );
      const userText = sttResult.text.trim();
      logVoiceEvent(
        "stt_done",
        formatVoiceDebugDetail({
          source: recordingSource,
          text: userText || "empty",
          ms: sttResult.elapsedMs,
        }),
      );

      setMetrics({
        ...INITIAL_METRICS,
        audioMs: audioResult.durationMs,
        sttMs: sttResult.elapsedMs,
        playbackMode,
      });

      if (userText.length === 0) {
        setVoicePhase("idle", "turn_idle", "empty transcript");
        if (recordingSource === "interruption") {
          interruptionInProgressRef.current = false;
          setInterruptionDebug((current) => ({
            ...current,
            status: "ignored",
            lastEvent: "interruption recording was too short or empty",
          }));
          setWarningMessage(
            "Interruption recording was too short or Whisper returned no text.",
          );
        } else {
          setWarningMessage("Whisper returned an empty transcript.");
        }
        return;
      }

      appendTranscript({
        role: "user",
        content: userText,
        meta: formatSttMeta(sttResult),
      });

      const nextHistory = [
        ...historyRef.current,
        { role: "user" as const, content: userText },
      ];
      historyRef.current = nextHistory;

      setVoicePhase(
        "generating",
        "gemma_delta",
        formatVoiceDebugDetail({ source: recordingSource, text: "start" }),
      );
      generationRunId = generationRunIdRef.current + 1;
      generationRunIdRef.current = generationRunId;
      generationController = new AbortController();
      abortRef.current = generationController;
      const gemmaStartedAt = performance.now();
      let firstTokenMs: number | null = null;
      let lastStreamText = "";
      let textChunkStream: AsyncTextChunkStream | null = null;
      const canStreamTts =
        playbackMode === "streaming-sentence" && ttsBackend === "kokoro";

      if (canStreamTts) {
        await ensureKokoroVoices();
        const kokoroTts = getKokoroTtsEngine();
        textChunkStream = new AsyncTextChunkStream();
        textChunkStreamRef.current = textChunkStream;
        setStreamingTtsStatus("buffering");
        setStreamingTtsMode("native-kokoro-stream");
        streamingPromise = kokoroTts.speakStream(
          textChunkStream,
          selectedKokoroVoiceId,
          {
            onEvent: (event) => {
              setStreamingTtsMode(event.mode);
              setStreamingTtsStatus(
                event.status === "finished"
                  ? "finished"
                  : `${formatStreamMode(event.mode)}: ${event.status} chunk ${event.chunkIndex}`,
              );
            },
            onPlaybackEvent: handleTtsPlaybackEvent,
          },
        );
        void streamingPromise.catch(() => undefined);
      }

      const gemmaResult = await generateVoiceTestReply({
        history: nextHistory,
        signal: generationController.signal,
        onDelta: (accumulated) => {
          if (!isActiveGeneration(generationRunId, generationController)) {
            logVoiceEvent("gemma_delta_ignored", "stale generation delta");
            return;
          }
          const currentGenerationRunId = generationRunId;
          if (currentGenerationRunId === null) return;
          setAssistantDraft({
            status: "streaming",
            content: accumulated,
            turnId: `assistant-${currentGenerationRunId}`,
            generationRunId: currentGenerationRunId,
            startedAt: gemmaStartedAt,
          });
          if (firstTokenMs === null && accumulated.trim().length > 0) {
            firstTokenMs = Math.round(performance.now() - gemmaStartedAt);
            logVoiceEvent(
              "gemma_delta",
              formatVoiceDebugDetail({
                source: recordingSource,
                ms: firstTokenMs,
              }),
            );
          }

          if (!textChunkStream) return;
          const delta = accumulated.startsWith(lastStreamText)
            ? accumulated.slice(lastStreamText.length)
            : accumulated;
          lastStreamText = accumulated;
          textChunkStream.enqueue(delta);
        },
      });
      if (!isActiveGeneration(generationRunId, generationController)) {
        throw new DOMException("Generation superseded.", "AbortError");
      }
      setAssistantDraft(null);

      if (textChunkStream) {
        const remainder = gemmaResult.text.startsWith(lastStreamText)
          ? gemmaResult.text.slice(lastStreamText.length)
          : lastStreamText.length === 0
            ? gemmaResult.text
            : "";
        if (remainder.length > 0) {
          textChunkStream.enqueue(remainder);
        }
        textChunkStream.close();
        textChunkStreamRef.current = null;
      }

      if (!isActiveGeneration(generationRunId, generationController)) {
        throw new DOMException("Generation superseded.", "AbortError");
      }
      if (!ttsPlaybackActiveRef.current) {
        setVoicePhase("speaking", "tts_chunk_start", "assistant ready");
      }
      const assistantTurn = {
        role: "assistant" as const,
        content: gemmaResult.text,
      };
      historyRef.current = [...nextHistory, assistantTurn];
      appendTranscript({
        role: "assistant",
        content: gemmaResult.text,
        meta: formatGemmaMeta(gemmaResult),
      });

      interruptionInProgressRef.current = false;
      const ttsResult = streamingPromise
        ? await settleStreamingTts(streamingPromise, gemmaResult.text)
        : await speakFullAssistantReply(gemmaResult.text);
      if (!isActiveGeneration(generationRunId, generationController)) {
        throw new DOMException("Generation superseded.", "AbortError");
      }
      setMetrics({
        audioMs: audioResult.durationMs,
        sttMs: sttResult.elapsedMs,
        firstTokenMs,
        firstAudioMs: ttsResult.firstAudioMs,
        gemmaMs: gemmaResult.elapsedMs,
        ttsMs: ttsResult.elapsedMs,
        totalMs: Math.round(performance.now() - loopStartedAt),
        chunkCount: ttsResult.chunkCount,
        playbackMode: ttsResult.playbackMode,
        streamMode: ttsResult.streamMode ?? null,
        fallbackUsed: gemmaResult.source === "fallback" || Boolean(ttsResult.warning),
      });

      if (ttsResult.warning) setWarningMessage(ttsResult.warning);
      if (gemmaResult.errorMessage) setWarningMessage(gemmaResult.errorMessage);
      clearTtsPlaybackActive();
      setStreamingTtsStatus("idle");
      setStreamingTtsMode("idle");
      setAssistantDraft(null);
      setVoicePhase("idle", "turn_idle", "assistant playback complete");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        void streamingPromise?.catch(() => undefined);
        textChunkStreamRef.current?.close();
        textChunkStreamRef.current = null;
        if (!isActiveGeneration(generationRunId, generationController)) {
          return;
        }
        setAssistantDraft(null);
        if (interruptionInProgressRef.current) {
          setWarningMessage("Interruption detected; recording your barge-in.");
        } else {
          setWarningMessage("Voice turn cancelled.");
          setVoicePhase("idle", "turn_cancelled", "AbortError");
        }
        setStreamingTtsMode("idle");
      } else {
        if (
          generationRunId !== null &&
          !isActiveGeneration(generationRunId, generationController)
        ) {
          return;
        }
        clearTtsPlaybackActive();
        setStreamingTtsStatus("idle");
        setStreamingTtsMode("idle");
        setVoicePhase("error", "turn_failed", toErrorMessage(err));
        setErrorMessage(toErrorMessage(err));
      }
    } finally {
      if (generationController && abortRef.current === generationController) {
        abortRef.current = null;
      }
      stoppingRef.current = false;
    }
  }

  function handleCancel() {
    vadListenerRef.current?.pause();
    cancelActiveAssistantTurn("cancel");
    stoppingRef.current = false;
    activeRecordingSourceRef.current = null;
    pendingVadAudioRef.current = null;
    interruptionInProgressRef.current = false;
    if (interruptionSuppressionTimerRef.current) {
      clearTimeout(interruptionSuppressionTimerRef.current);
      interruptionSuppressionTimerRef.current = null;
    }
    clearTtsPlaybackActive();
    setStreamingTtsStatus("idle");
    setStreamingTtsMode("idle");
    setInterruptionDebug(INITIAL_INTERRUPTION_DEBUG);
    setVoicePhase("cancelled", "turn_cancelled", "cancel button");
    setWarningMessage("Current voice turn cancelled.");
  }

  function handleResetConversation() {
    cancelActiveAssistantTurn("cancel");
    historyRef.current = createInitialHistory();
    setTranscript(createInitialTranscript());
    setAssistantDraft(null);
    setStreamingTtsStatus("idle");
    setStreamingTtsMode("idle");
    setMetrics(INITIAL_METRICS);
    setInterruptionDebug(INITIAL_INTERRUPTION_DEBUG);
    clearTtsPlaybackActive();
    interruptionInProgressRef.current = false;
    activeRecordingSourceRef.current = null;
    pendingVadAudioRef.current = null;
    dispatchVoiceTurn({ type: "RESET" });
    voicePhaseRef.current = "idle";
    statusRef.current = "idle";
    setStatus("idle");
    setErrorMessage(null);
    setWarningMessage(null);
  }

  async function settleStreamingTts(
    streamingPromise: Promise<TextToSpeechResult>,
    finalText: string,
  ): Promise<TextToSpeechResult> {
    try {
      const result = await streamingPromise;
      if (result.warning && result.firstAudioMs === null) {
        return speakFullAssistantReply(finalText);
      }
      return result;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      return speakFullAssistantReply(finalText, `Streaming Kokoro failed: ${toErrorMessage(err)}`);
    }
  }

  async function speakFullAssistantReply(
    text: string,
    warningPrefix?: string,
  ): Promise<TextToSpeechResult> {
    const result =
      ttsBackend === "kokoro"
        ? await speakWithKokoroTts(text)
        : await speakWithBrowserTts(text);

    return warningPrefix
      ? {
          ...result,
          warning: `${warningPrefix}. ${
            result.warning ?? "Used full-response playback fallback."
          }`,
        }
      : result;
  }

  async function speakWithKokoroTts(text: string): Promise<TextToSpeechResult> {
    const kokoroTts = getKokoroTtsEngine();

    try {
      await ensureKokoroVoices();
      return await kokoroTts.speak(text, selectedKokoroVoiceId, {
        onPlaybackEvent: handleTtsPlaybackEvent,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      const browserResult = await speakWithBrowserTts(text);
      return {
        ...browserResult,
        warning: `Kokoro failed: ${toErrorMessage(err)} ${
          browserResult.warning ?? "Used browser TTS fallback."
        }`,
      };
    }
  }

  async function speakWithBrowserTts(text: string): Promise<TextToSpeechResult> {
    const tts = browserTtsRef.current ?? createBrowserTextToSpeechEngine();
    browserTtsRef.current = tts;
    return tts.speak(text, selectedVoiceURI || undefined, {
      onPlaybackEvent: handleTtsPlaybackEvent,
    });
  }

  function handleTtsPlaybackEvent(event: TtsPlaybackLifecycleEvent): void {
    if (event.status === "end") {
      logVoiceEvent(
        "tts_chunk_end",
        formatVoiceDebugDetail({ chunkIndex: event.chunkIndex }),
      );
      activeTtsPlaybackCountRef.current = Math.max(
        0,
        activeTtsPlaybackCountRef.current - 1,
      );
      if (activeTtsPlaybackCountRef.current === 0) {
        ttsPlaybackActiveRef.current = false;
        setTtsPlaybackActive(false);
      }
      return;
    }

    activeTtsPlaybackCountRef.current += 1;
    ttsPlaybackActiveRef.current = true;
    setTtsPlaybackActive(true);
    logVoiceEvent(
      "tts_chunk_start",
      formatVoiceDebugDetail({ chunkIndex: event.chunkIndex }),
    );

    if (statusRef.current === "thinking") {
      setVoicePhase("speaking", "tts_chunk_start", "playback started");
    }

    if (
      !handsFreeEnabledRef.current ||
      !bargeInEnabledRef.current ||
      (statusRef.current !== "speaking" && !ttsPlaybackActiveRef.current)
    ) {
      return;
    }

    vadListenerRef.current?.markAudioOutput();
    logVoiceEvent("interrupt_rearm", "suppressed after TTS audio output");
    setInterruptionDebug((current) => ({
      status: current.status === "detected" ? "detected" : "suppressed",
      confidence: current.confidence,
      lastIgnoredReason: current.lastIgnoredReason,
      lastEvent: "suppressed after TTS audio output",
    }));

    if (interruptionSuppressionTimerRef.current) {
      clearTimeout(interruptionSuppressionTimerRef.current);
    }
    interruptionSuppressionTimerRef.current = setTimeout(() => {
      if (
        handsFreeEnabledRef.current &&
        bargeInEnabledRef.current &&
        statusRef.current === "speaking"
      ) {
        setInterruptionDebug((current) => ({
          status: current.status === "detected" ? "detected" : "armed",
          confidence: current.confidence,
          lastIgnoredReason: current.lastIgnoredReason,
          lastEvent: "listening for sustained barge-in",
        }));
        logVoiceEvent("interrupt_rearm", "TTS suppression elapsed");
      }
    }, 260);
  }

  function clearTtsPlaybackActive(): void {
    activeTtsPlaybackCountRef.current = 0;
    ttsPlaybackActiveRef.current = false;
    setTtsPlaybackActive(false);
  }

  async function ensureKokoroVoices(): Promise<KokoroVoiceInfo[]> {
    if (kokoroVoices.length > 0) return kokoroVoices;
    const kokoroTts = getKokoroTtsEngine();
    const nextVoices = await kokoroTts.getVoices();
    setKokoroVoices(nextVoices);
    if (!nextVoices.some((voice) => voice.id === selectedKokoroVoiceId)) {
      const defaultVoice =
        nextVoices.find((voice) => voice.id === KOKORO_DEFAULT_VOICE_ID) ??
        nextVoices[0];
      if (defaultVoice) setSelectedKokoroVoiceId(defaultVoice.id);
    }
    return nextVoices;
  }

  function getKokoroTtsEngine(): KokoroTextToSpeechEngine {
    const currentEngine = kokoroTtsRef.current;
    if (currentEngine?.runtime.id === selectedKokoroRuntimeId) {
      return currentEngine;
    }

    const nextEngine = createKokoroTextToSpeechEngine(selectedKokoroRuntimeId);
    kokoroTtsRef.current = nextEngine;
    return nextEngine;
  }

  function stopTtsPlayback(): void {
    browserTtsRef.current?.stop();
    kokoroTtsRef.current?.stop();
    clearTtsPlaybackActive();
    logVoiceEvent("tts_stop", "playback stopped");
  }

  function isActiveGeneration(
    generationRunId: number | null,
    controller: AbortController | null,
  ): boolean {
    return (
      generationRunId !== null &&
      controller !== null &&
      generationRunIdRef.current === generationRunId &&
      abortRef.current === controller &&
      !controller.signal.aborted
    );
  }

  function appendTranscript(turn: Omit<TranscriptTurn, "id">) {
    setTranscript((current) => [
      ...current,
      {
        ...turn,
        id: createTurnId(),
      },
    ]);
  }

  startRecordingRef.current = handleStartRecording;
  submitVadAudioTurnRef.current = submitVadAudioTurn;

  return (
    <div className="space-y-8">
      <section className="rounded-3xl border border-border bg-surface p-6 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-foreground/50">
              Developer-only voice loop
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">
              On-device mock check-in test
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-foreground/70">
              This page tests mic capture, Whisper STT, the local Gemma runtime,
              and local TTS inside a mocked WAVE check-in. It is not linked from
              the patient app and does not modify the clinical session flow.
            </p>
          </div>
          <StatusPill status={status} />
        </div>

        <MockCheckInCard />

        <ModelWarmupStrip
          loopStatus={status}
          gemmaState={gemmaState}
          whisperState={whisperState}
          kokoroState={kokoroState}
          ttsBackend={ttsBackend}
        />

        <div className="mt-6 grid gap-3 md:grid-cols-4">
          <Capability label="WebGPU" value={capabilities?.hasWebGpu} />
          <Capability label="Secure context" value={capabilities?.isSecureContext} />
          <Capability label="Microphone" value={capabilities?.hasMicrophoneApi} />
          <Capability label="Local TTS voices" value={localVoices.length > 0} />
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-3xl border border-border bg-surface p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">
                Conversation
              </h2>
              <p className="mt-1 text-sm text-foreground/60">
                Press start, speak a normal sentence, then stop. VAD can stop
                automatically after silence.
              </p>
            </div>
            <button
              type="button"
              onClick={handleResetConversation}
              className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground/70 hover:border-accent hover:text-accent"
            >
              Reset
            </button>
          </div>

          <div className="mt-6 min-h-[360px] space-y-4 rounded-2xl border border-border bg-background p-4">
            {transcript.map((turn) => (
              <TranscriptBubble key={turn.id} turn={turn} />
            ))}
            {visibleAssistantDraft ? (
              <TranscriptBubble
                turn={{
                  id: "streaming",
                  role: "assistant",
                  content: visibleAssistantDraft,
                  meta: "streaming from local Gemma",
                }}
              />
            ) : null}
          </div>

          <div className="mt-6 flex flex-col gap-4 rounded-2xl border border-border bg-surface-muted p-4">
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleWarmModels}
                disabled={status === "warming" || isRecording}
                aria-busy={status === "warming"}
                className="rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium hover:border-accent hover:text-accent disabled:opacity-50"
              >
                {status === "warming" ? "Warming models..." : "Warm models"}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (isRecording) {
                    void handleStopRecording();
                  } else {
                    void handleStartRecording();
                  }
                }}
                disabled={!canRecord || (isBusy && status !== "speaking")}
                className="rounded-full bg-accent px-5 py-2 text-sm font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-50"
                aria-pressed={isRecording}
              >
                {isRecording ? "Stop and transcribe" : "Start talking"}
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleHandsFreeChange(!handsFreeEnabled);
                }}
                disabled={!canRecord || isRecording || status === "warming"}
                className={`rounded-full border px-5 py-2 text-sm font-semibold disabled:opacity-50 ${
                  handsFreeEnabled
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-border bg-surface text-foreground/75 hover:border-accent hover:text-accent"
                }`}
                aria-pressed={handsFreeEnabled}
              >
                {handsFreeEnabled ? "Stop hands-free" : "Start hands-free"}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground/70 hover:border-danger hover:text-danger"
              >
                Cancel turn
              </button>
            </div>

            <LevelMeter level={level} isRecording={isRecording} />
          </div>

          {errorMessage ? (
            <Notice tone="danger" title="Voice test error" body={errorMessage} />
          ) : null}
          {warningMessage ? (
            <Notice tone="warn" title="Voice test note" body={warningMessage} />
          ) : null}
        </div>

        <aside className="space-y-4">
          <ConfigPanel
            selectedModelId={selectedModelId}
            onModelChange={setSelectedModelId}
            ttsBackend={ttsBackend}
            onTtsBackendChange={setTtsBackend}
            playbackMode={playbackMode}
            onPlaybackModeChange={setPlaybackMode}
            voices={localVoices}
            selectedVoiceURI={selectedVoiceURI}
            onVoiceChange={setSelectedVoiceURI}
            kokoroVoices={kokoroVoices}
            selectedKokoroVoiceId={selectedKokoroVoiceId}
            onKokoroVoiceChange={setSelectedKokoroVoiceId}
            selectedKokoroRuntimeId={selectedKokoroRuntimeId}
            onKokoroRuntimeChange={setSelectedKokoroRuntimeId}
            hasWebGpu={capabilities?.hasWebGpu}
            bargeInEnabled={bargeInEnabled}
            onBargeInChange={setBargeInEnabled}
          />
          <RuntimePanel
            gemmaState={gemmaState}
            whisperState={whisperState}
            kokoroState={kokoroState}
            ttsBackend={ttsBackend}
            playbackMode={playbackMode}
            selectedKokoroRuntime={selectedKokoroRuntime}
            selectedKokoroVoiceId={selectedKokoroVoiceId}
            streamingTtsStatus={streamingTtsStatus}
            streamingTtsMode={streamingTtsMode}
            ttsPlaybackActive={ttsPlaybackActive}
            handsFreeEnabled={handsFreeEnabled}
            vadState={vadState}
            vadLevel={vadLevel}
            interruptionDebug={interruptionDebug}
            voicePhase={voiceTurn.phase}
            events={voiceTurn.events}
            capabilities={capabilities}
            onlineStatus={onlineStatus}
            metrics={metrics}
          />
        </aside>
      </section>
    </div>
  );
}

function StatusPill({ status }: { status: VoiceLoopStatus }) {
  const label = status.replace("-", " ");
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent-soft px-3 py-1 text-sm font-medium text-accent">
      <span
        aria-hidden
        className={`h-2 w-2 rounded-full ${
          status === "error" ? "bg-danger" : "bg-accent"
        } ${status !== "idle" && status !== "error" ? "animate-shimmer" : ""}`}
      />
      {label}
    </div>
  );
}

function ModelWarmupStrip({
  loopStatus,
  gemmaState,
  whisperState,
  kokoroState,
  ttsBackend,
}: {
  loopStatus: VoiceLoopStatus;
  gemmaState: GemmaModelLoadState;
  whisperState: VoiceModelLoadState;
  kokoroState: VoiceModelLoadState;
  ttsBackend: TextToSpeechBackendId;
}) {
  const items: MainModelStatusSummary[] = [
    {
      label: "Whisper",
      phase: whisperState.phase,
      progress: whisperState.progress,
      detail: whisperState.message,
    },
    {
      label: "Gemma",
      phase: gemmaState.phase,
      progress: gemmaState.progress,
      detail: gemmaState.message,
    },
    {
      label: "Kokoro",
      phase: ttsBackend === "kokoro" ? kokoroState.phase : "skipped",
      progress: ttsBackend === "kokoro" ? kokoroState.progress : null,
      detail:
        ttsBackend === "kokoro"
          ? kokoroState.message
          : "Browser speech fallback selected.",
    },
  ];
  const hasActiveWarmup =
    loopStatus === "warming" ||
    items.some((item) => item.phase === "loading" || item.phase === "error");
  const allReady = items.every(
    (item) => item.phase === "ready" || item.phase === "skipped",
  );

  return (
    <section
      className={`mt-6 rounded-2xl border p-4 ${
        hasActiveWarmup
          ? "border-accent/40 bg-accent-soft/50"
          : allReady
            ? "border-accent/20 bg-surface-muted"
            : "border-border bg-surface-muted"
      }`}
      aria-label="Model warm-up status"
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-foreground/45">
            Model warm-up
          </p>
          <h2 className="text-sm font-semibold">
            {hasActiveWarmup
              ? "Loading local voice models"
              : allReady
                ? "Local voice models are ready"
                : "Local voice models are not warmed yet"}
          </h2>
        </div>
        <p className="font-mono text-xs text-foreground/55">
          {loopStatus === "warming" ? "warming" : allReady ? "ready" : "idle"}
        </p>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {items.map((item) => (
          <ModelWarmupCard key={item.label} item={item} />
        ))}
      </div>
    </section>
  );
}

function ModelWarmupCard({ item }: { item: MainModelStatusSummary }) {
  const progressWidth =
    item.progress === null ? 0 : Math.max(0, Math.min(100, item.progress));
  return (
    <article className="rounded-2xl border border-border bg-background p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{item.label}</p>
          <p className="mt-1 font-mono text-xs text-foreground/60">
            {formatMainModelPhase(item)}
          </p>
        </div>
        <span
          className={`mt-0.5 h-2.5 w-2.5 rounded-full ${
            item.phase === "ready"
              ? "bg-accent"
              : item.phase === "loading"
                ? "animate-shimmer bg-warn"
                : item.phase === "error"
                  ? "bg-danger"
                  : "bg-foreground/25"
          }`}
          aria-hidden
        />
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-muted">
        <div
          className="h-full bg-accent"
          style={{
            width:
              item.phase === "ready"
                ? "100%"
                : item.progress === null
                  ? "0%"
                  : `${progressWidth}%`,
          }}
        />
      </div>
      <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-foreground/55">
        {item.detail}
      </p>
    </article>
  );
}

function Capability({ label, value }: { label: string; value?: boolean }) {
  const text = value === undefined ? "checking" : value ? "yes" : "no";
  return (
    <div className="rounded-2xl border border-border bg-background p-3">
      <p className="text-xs uppercase tracking-wide text-foreground/45">
        {label}
      </p>
      <p className="mt-1 font-mono text-sm">{text}</p>
    </div>
  );
}

function MockCheckInCard() {
  const mock = MOCK_VOICE_CHECK_IN_SESSION;
  return (
    <div className="mt-6 rounded-2xl border border-accent/20 bg-accent-soft/40 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-accent">
            Mock session
          </p>
          <h2 className="mt-1 font-semibold">{mock.title}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-foreground/70">
            The assistant starts with "{mock.opener}" and the next spoken turn
            is treated as the patient's reply. Gemma gets the mocked intake,
            medication, trigger, prior chunk, and next phase as prompt context.
          </p>
        </div>
        <div className="grid min-w-64 gap-2 text-xs sm:grid-cols-2 lg:grid-cols-1">
          <DebugRow
            label="Intake"
            value={`${mock.intakeIntensity}/10, current about ${mock.currentScore}/10`}
          />
          <DebugRow
            label="Medication"
            value={`${mock.matType}, ${mock.medicationStatus}`}
          />
          <DebugRow label="Trigger" value={mock.trigger} />
          <DebugRow label="Next phase" value={mock.nextPhase} />
        </div>
      </div>
    </div>
  );
}

function TranscriptBubble({ turn }: { turn: TranscriptTurn }) {
  const isUser = turn.role === "user";
  const isSystem = turn.role === "system";
  return (
    <article
      className={`max-w-[85%] rounded-2xl border p-4 ${
        isUser
          ? "ml-auto border-accent/30 bg-accent-soft/70"
          : isSystem
            ? "border-border bg-surface-muted"
            : "border-border bg-surface"
      }`}
    >
      <p className="text-xs uppercase tracking-wide text-foreground/45">
        {turn.role}
      </p>
      <p className="mt-2 text-sm leading-relaxed">{turn.content}</p>
      <p className="mt-3 font-mono text-xs text-foreground/45">{turn.meta}</p>
    </article>
  );
}

function LevelMeter({
  level,
  isRecording,
}: {
  level: AudioCaptureLevel;
  isRecording: boolean;
}) {
  const width = Math.min(100, Math.round(level.rms * 500));
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-foreground/55">
        <span>Input level</span>
        <span>{isRecording ? (level.speaking ? "speech" : "listening") : "idle"}</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-background">
        <div className="h-full bg-accent" style={{ width: `${width}%` }} />
      </div>
      <p className="mt-2 font-mono text-xs text-foreground/45">
        rms {level.rms.toFixed(3)} / peak {level.peak.toFixed(3)}
      </p>
    </div>
  );
}

function ConfigPanel({
  selectedModelId,
  onModelChange,
  ttsBackend,
  onTtsBackendChange,
  playbackMode,
  onPlaybackModeChange,
  voices,
  selectedVoiceURI,
  onVoiceChange,
  kokoroVoices,
  selectedKokoroVoiceId,
  onKokoroVoiceChange,
  selectedKokoroRuntimeId,
  onKokoroRuntimeChange,
  hasWebGpu,
  bargeInEnabled,
  onBargeInChange,
}: {
  selectedModelId: WhisperModelId;
  onModelChange: (modelId: WhisperModelId) => void;
  ttsBackend: TextToSpeechBackendId;
  onTtsBackendChange: (backend: TextToSpeechBackendId) => void;
  playbackMode: TtsPlaybackMode;
  onPlaybackModeChange: (mode: TtsPlaybackMode) => void;
  voices: readonly BrowserVoiceInfo[];
  selectedVoiceURI: string;
  onVoiceChange: (voiceURI: string) => void;
  kokoroVoices: readonly KokoroVoiceInfo[];
  selectedKokoroVoiceId: string;
  onKokoroVoiceChange: (voiceId: string) => void;
  selectedKokoroRuntimeId: KokoroRuntimeId;
  onKokoroRuntimeChange: (runtimeId: KokoroRuntimeId) => void;
  hasWebGpu?: boolean;
  bargeInEnabled: boolean;
  onBargeInChange: (enabled: boolean) => void;
}) {
  return (
    <section className="rounded-3xl border border-border bg-surface p-5">
      <h2 className="font-semibold">Stack settings</h2>
      <label className="mt-4 block text-sm font-medium">
        Whisper model
        <select
          value={selectedModelId}
          onChange={(event) =>
            onModelChange(event.target.value as WhisperModelId)
          }
          className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
        >
          {WHISPER_MODEL_IDS.map((modelId) => (
            <option key={modelId} value={modelId}>
              {modelId}
            </option>
          ))}
        </select>
      </label>

      <label className="mt-4 block text-sm font-medium">
        TTS backend
        <select
          value={ttsBackend}
          onChange={(event) =>
            onTtsBackendChange(event.target.value as TextToSpeechBackendId)
          }
          className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
        >
          <option value="kokoro">Kokoro local TTS</option>
          <option value="browser-speech">Browser local voice fallback</option>
        </select>
      </label>

      <label className="mt-4 block text-sm font-medium">
        Playback mode
        <select
          value={playbackMode}
          onChange={(event) =>
            onPlaybackModeChange(event.target.value as TtsPlaybackMode)
          }
          className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
        >
          <option value="full-response">Full response, then TTS</option>
          <option value="streaming-sentence">Stream Gemma text into Kokoro</option>
        </select>
        <p className="mt-2 text-xs leading-relaxed text-foreground/55">
          Streaming mode pushes Gemma deltas into Kokoro's native splitter when
          available, then falls back to manual sentence chunks if needed.
        </p>
      </label>

      {ttsBackend === "kokoro" ? (
        <>
          <label className="mt-4 block text-sm font-medium">
            Kokoro runtime
            <select
              value={selectedKokoroRuntimeId}
              onChange={(event) =>
                onKokoroRuntimeChange(event.target.value as KokoroRuntimeId)
              }
              className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
            >
              {KOKORO_RUNTIME_OPTIONS.map((runtime) => (
                <option
                  key={runtime.id}
                  value={runtime.id}
                  disabled={runtime.device === "webgpu" && hasWebGpu === false}
                >
                  {runtime.label}
                  {runtime.device === "webgpu" && hasWebGpu === false
                    ? " (WebGPU unavailable)"
                    : ""}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs leading-relaxed text-foreground/55">
              WebGPU uses fp32 and can reduce Kokoro generation gaps on supported
              browsers. WASM stays available as the compatibility fallback.
            </p>
          </label>

          <label className="mt-4 block text-sm font-medium">
            Kokoro voice
            <select
              value={selectedKokoroVoiceId}
              onChange={(event) => onKokoroVoiceChange(event.target.value)}
              className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
            >
              {kokoroVoices.length === 0 ? (
                <option value={KOKORO_DEFAULT_VOICE_ID}>
                  {KOKORO_DEFAULT_VOICE_ID} (default, load to list voices)
                </option>
              ) : null}
              {kokoroVoices.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.id} · {voice.name}
                  {voice.overallGrade ? ` · grade ${voice.overallGrade}` : ""}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs leading-relaxed text-foreground/55">
              First use may download model files; later runs use browser cache.
            </p>
          </label>
        </>
      ) : null}

      <label className="mt-4 block text-sm font-medium">
        Local TTS voice
        <select
          value={selectedVoiceURI}
          onChange={(event) => onVoiceChange(event.target.value)}
          className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
        >
          <option value="">Auto-select local voice</option>
          {voices.map((voice) => (
            <option key={voice.voiceURI} value={voice.voiceURI}>
              {voice.name} ({voice.lang})
            </option>
          ))}
        </select>
        <p className="mt-2 text-xs leading-relaxed text-foreground/55">
          Browser voices are only used when they report local service support.
        </p>
      </label>

      <p className="mt-5 rounded-2xl border border-border bg-background p-3 text-xs leading-relaxed text-foreground/60">
        Speech capture is handled by Silero VAD. Completed speech segments are
        submitted to Whisper as 16 kHz PCM audio; no MediaRecorder capture path
        is used on this page.
      </p>
      <label className="mt-3 flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={bargeInEnabled}
          onChange={(event) => onBargeInChange(event.target.checked)}
          className="mt-1"
        />
        <span>Let the next talk turn interrupt TTS playback.</span>
      </label>
    </section>
  );
}

function RuntimePanel({
  gemmaState,
  whisperState,
  kokoroState,
  ttsBackend,
  playbackMode,
  selectedKokoroRuntime,
  selectedKokoroVoiceId,
  streamingTtsStatus,
  streamingTtsMode,
  ttsPlaybackActive,
  handsFreeEnabled,
  vadState,
  vadLevel,
  interruptionDebug,
  voicePhase,
  events,
  capabilities,
  onlineStatus,
  metrics,
}: {
  gemmaState: GemmaModelLoadState;
  whisperState: VoiceModelLoadState;
  kokoroState: VoiceModelLoadState;
  ttsBackend: TextToSpeechBackendId;
  playbackMode: TtsPlaybackMode;
  selectedKokoroRuntime: KokoroRuntimeOption;
  selectedKokoroVoiceId: string;
  streamingTtsStatus: string;
  streamingTtsMode: KokoroStreamMode | "idle";
  ttsPlaybackActive: boolean;
  handsFreeEnabled: boolean;
  vadState: VadListenerState;
  vadLevel: VadListenerLevel;
  interruptionDebug: InterruptionDebugState;
  voicePhase: VoiceTurnPhase;
  events: readonly VoiceDebugEvent[];
  capabilities: VoiceRuntimeCapabilities | null;
  onlineStatus: boolean | null;
  metrics: LastRunMetrics;
}) {
  return (
    <section className="rounded-3xl border border-border bg-surface p-5">
      <h2 className="font-semibold">Runtime debug</h2>
      <dl className="mt-4 space-y-3 text-sm">
        <DebugRow label="Gemma" value={`${gemmaState.phase} / ${gemmaState.device ?? "unknown"}`} />
        <DebugRow label="Gemma detail" value={gemmaState.message} />
        <DebugRow label="Whisper" value={`${whisperState.phase} / ${whisperState.device}`} />
        <DebugRow label="Whisper detail" value={whisperState.message} />
        <DebugRow label="TTS backend" value={ttsBackend} />
        <DebugRow label="Playback mode" value={playbackMode} />
        <DebugRow label="TTS playback" value={ttsPlaybackActive ? "active" : "idle"} />
        <DebugRow label="Hands-free" value={handsFreeEnabled ? "on" : "off"} />
        <DebugRow label="Voice phase" value={voicePhase} />
        <DebugRow label="VAD state" value={vadState} />
        <DebugRow
          label="VAD level"
          value={`rms ${vadLevel.rms.toFixed(3)} / Silero threshold ${vadLevel.threshold.toFixed(2)}`}
        />
        <DebugRow
          label="Silero speech probability"
          value={`${formatProbability(vadLevel.confidence)} / noise rms ${vadLevel.noiseFloor.toFixed(3)}`}
        />
        <DebugRow label="Interruption" value={interruptionDebug.status} />
        <DebugRow
          label="Interruption probability"
          value={
            interruptionDebug.confidence === null
              ? "-"
              : formatProbability(interruptionDebug.confidence)
          }
        />
        <DebugRow
          label="Interruption ignored"
          value={
            interruptionDebug.lastIgnoredReason
              ? formatIgnoredReason(interruptionDebug.lastIgnoredReason)
              : "-"
          }
        />
        <DebugRow label="Interruption detail" value={interruptionDebug.lastEvent} />
        <DebugRow
          label="Stream mode"
          value={
            streamingTtsMode === "idle"
              ? "idle"
              : formatStreamMode(streamingTtsMode)
          }
        />
        <DebugRow label="Streaming TTS" value={streamingTtsStatus} />
        <DebugRow
          label="Kokoro"
          value={`${kokoroState.phase} / ${selectedKokoroRuntime.dtype} / ${selectedKokoroRuntime.device}`}
        />
        <DebugRow label="Kokoro runtime" value={selectedKokoroRuntime.label} />
        <DebugRow label="Kokoro model" value={KOKORO_MODEL_ID} />
        <DebugRow label="Kokoro voice" value={selectedKokoroVoiceId} />
        <DebugRow label="Kokoro detail" value={kokoroState.message} />
        <DebugRow
          label="Cache mode"
          value="first run may download Gemma, Whisper, and Kokoro; later runs use browser cache"
        />
        <DebugRow
          label="Offline indicator"
          value={
            onlineStatus === null
              ? "checking"
              : onlineStatus
                ? "browser reports online"
                : "browser reports offline"
          }
        />
        <DebugRow
          label="Cross-origin isolated"
          value={capabilities?.crossOriginIsolated ? "yes" : "no"}
        />
      </dl>

      <div className="mt-5 rounded-2xl border border-border bg-background p-4">
        <h3 className="text-sm font-semibold">Last turn timing</h3>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <DebugRow label="Audio" value={formatMs(metrics.audioMs)} />
          <DebugRow label="STT" value={formatMs(metrics.sttMs)} />
          <DebugRow label="First token" value={formatMs(metrics.firstTokenMs)} />
          <DebugRow label="First audio" value={formatMs(metrics.firstAudioMs)} />
          <DebugRow label="Gemma" value={formatMs(metrics.gemmaMs)} />
          <DebugRow label="TTS" value={formatMs(metrics.ttsMs)} />
          <DebugRow label="Total" value={formatMs(metrics.totalMs)} />
          <DebugRow label="Chunks" value={String(metrics.chunkCount)} />
          <DebugRow label="Mode" value={metrics.playbackMode} />
          <DebugRow
            label="Stream"
            value={
              metrics.streamMode ? formatStreamMode(metrics.streamMode) : "n/a"
            }
          />
          <DebugRow label="Fallback" value={metrics.fallbackUsed ? "yes" : "no"} />
        </dl>
      </div>
      <div className="mt-5 rounded-2xl border border-border bg-background p-4">
        <h3 className="text-sm font-semibold">Voice event log</h3>
        <div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">
          {events.length === 0 ? (
            <p className="text-xs text-foreground/45">No voice events yet.</p>
          ) : (
            events
              .slice()
              .reverse()
              .map((event) => (
                <div key={event.id} className="rounded-xl bg-surface-muted p-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-mono text-xs text-foreground/80">
                      {event.name}
                    </p>
                    <p className="font-mono text-[10px] text-foreground/45">
                      {Math.round(event.timestamp)}ms
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-foreground/55">
                    {event.phase} · {event.detail}
                  </p>
                </div>
              ))
          )}
        </div>
      </div>
    </section>
  );
}

function DebugRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-foreground/45">
        {label}
      </dt>
      <dd className="mt-1 break-words font-mono text-xs text-foreground/75">
        {value}
      </dd>
    </div>
  );
}

function Notice({
  tone,
  title,
  body,
}: {
  tone: "warn" | "danger";
  title: string;
  body: string;
}) {
  const classes =
    tone === "danger"
      ? "border-danger/40 bg-danger-soft text-danger"
      : "border-warn/40 bg-warn-soft text-warn";
  return (
    <div role="alert" className={`mt-4 rounded-2xl border p-4 text-sm ${classes}`}>
      <p className="font-semibold">{title}</p>
      <p className="mt-1 opacity-85">{body}</p>
    </div>
  );
}

function formatSttMeta(result: SpeechToTextResult): string {
  return `${result.modelId} / ${result.device} / audio ${formatMs(
    result.audioDurationMs,
  )} / stt ${formatMs(result.elapsedMs)}`;
}

function formatGemmaMeta(result: GenerateVoiceTestReplyResult): string {
  return `Gemma ${result.source} / ${formatMs(result.elapsedMs)}`;
}

function formatMs(value: number | null): string {
  if (value === null) return "-";
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(1)} s`;
}

function formatMainModelPhase(item: MainModelStatusSummary): string {
  if (item.phase === "skipped") return "not used";
  if (item.progress === null || item.phase !== "loading") return item.phase;
  return `${item.phase} ${item.progress.toFixed(0)}%`;
}

function formatStreamMode(mode: KokoroStreamMode): string {
  return mode === "native-kokoro-stream"
    ? "native Kokoro stream"
    : "manual sentence chunks";
}

function formatIgnoredReason(reason: VadInterruptionIgnoredReason): string {
  switch (reason) {
    case "audio-output-suppression":
      return "audio output suppression";
    case "low-peak":
      return "low peak";
    case "no-recent-rise":
      return "no recent rise";
  }
}

function formatProbability(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function computePeakLevel(audio: Float32Array): number {
  let peakLevel = 0;
  for (const sample of audio) {
    peakLevel = Math.max(peakLevel, Math.abs(sample));
  }
  return peakLevel;
}

function createVadAudioResult(audio: Float32Array): AudioCaptureResult {
  return {
    audio,
    sampleRate: 16_000,
    durationMs: Math.round((audio.length / 16_000) * 1000),
    peakLevel: computePeakLevel(audio),
  };
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown voice test error.";
}

function createTurnId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
