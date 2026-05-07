import type { AudioCaptureLevel } from "@/lib/voice/audio-capture";

const VAD_ASSET_PATH = "/vendor/vad/";
const NORMAL_POSITIVE_SPEECH_THRESHOLD = 0.3;
const BARGE_IN_POSITIVE_SPEECH_THRESHOLD = 0.45;
const INTERRUPTION_POSITIVE_SPEECH_THRESHOLD = 0.45;
const NEGATIVE_THRESHOLD_OFFSET = 0.15;
const NORMAL_MIN_SPEECH_MS = 240;
const BARGE_IN_MIN_SPEECH_MS = 280;
const INTERRUPTION_HOLD_MS = 380;
const END_SILENCE_MS = 700;
const PRE_SPEECH_PAD_MS = 400;
const INTERRUPTION_MIN_PEAK = 0.035;
const INTERRUPTION_RECENT_RISE_MULTIPLIER = 1.45;
const AUDIO_OUTPUT_SUPPRESSION_MS = 240;
const RECENT_LEVEL_WINDOW = 12;

export type VadListenerState =
  | "idle"
  | "calibrating"
  | "listening"
  | "speech"
  | "interruption"
  | "paused"
  | "error";

export type VadSensitivityMode = "normal" | "barge-in" | "interruption";

export interface VadPauseOptions {
  submitSpeech?: boolean;
}

export type VadInterruptionIgnoredReason =
  | "audio-output-suppression"
  | "low-peak"
  | "no-recent-rise";

export interface VadListenerLevel extends AudioCaptureLevel {
  noiseFloor: number;
  threshold: number;
  confidence: number;
}

export interface VadListenerOptions {
  onLevel?: (level: VadListenerLevel) => void;
  onSpeechStart?: () => void;
  onSpeechEnd?: (audio: Float32Array, level: VadListenerLevel) => void;
  onSpeechMisfire?: (level: VadListenerLevel, mode: VadSensitivityMode) => void;
  onInterruptionStart?: (level: VadListenerLevel) => void;
  onInterruptionEnd?: (audio: Float32Array, level: VadListenerLevel) => void;
  onInterruptionIgnored?: (
    reason: VadInterruptionIgnoredReason,
    level: VadListenerLevel,
  ) => void;
  onStateChange?: (state: VadListenerState) => void;
}

export interface VadListenerController {
  pause(options?: VadPauseOptions): void;
  resume(mode?: VadSensitivityMode): void;
  markAudioOutput(suppressionMs?: number): void;
  stop(): void;
}

export async function createVadListener(
  options: VadListenerOptions = {},
): Promise<VadListenerController> {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    throw new Error("Silero VAD is only available in the browser.");
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone capture is not available in this browser.");
  }

  let state: VadListenerState = "idle";
  let mode: VadSensitivityMode = "normal";
  let stopped = false;
  let paused = true;
  let allowPauseSubmit = false;
  let hasStarted = false;
  let pendingInterruption: InterruptionCandidate | null = null;
  let interruptionFired = false;
  let noiseFloor = 0;
  let audioSuppressedUntil = 0;
  let lastIgnoredReason: VadInterruptionIgnoredReason | null = null;
  let latestLevel = buildVadLevel({ rms: 0, peak: 0 }, false, 0);
  const recentRmsLevels: number[] = [];

  publishState("calibrating");

  const { MicVAD } = await import("@ricky0123/vad-web");
  const micVad = await MicVAD.new({
    model: "v5",
    baseAssetPath: VAD_ASSET_PATH,
    onnxWASMBasePath: VAD_ASSET_PATH,
    startOnLoad: true,
    positiveSpeechThreshold: getPositiveSpeechThreshold(),
    negativeSpeechThreshold: getNegativeSpeechThreshold(),
    minSpeechMs: getMinSpeechMs(),
    redemptionMs: END_SILENCE_MS,
    preSpeechPadMs: PRE_SPEECH_PAD_MS,
    submitUserSpeechOnPause: false,
    onFrameProcessed: (probabilities, frame) => {
      if (stopped) return;
      const rawLevel = computeLevel(frame);
      const speechProbability = probabilities.isSpeech;
      const speaking = speechProbability >= getPositiveSpeechThreshold();
      latestLevel = buildVadLevel(rawLevel, speaking, speechProbability);

      if (pendingInterruption) {
        pendingInterruption = {
          ...pendingInterruption,
          level: {
            ...latestLevel,
            peak: Math.max(pendingInterruption.level.peak, latestLevel.peak),
            rms: Math.max(pendingInterruption.level.rms, latestLevel.rms),
            confidence: Math.max(
              pendingInterruption.level.confidence,
              latestLevel.confidence,
            ),
          },
        };
        tryAcceptInterruptionCandidate(performance.now());
      }

      if (!speaking) {
        updateRecentLevels(rawLevel.rms);
        if (!pendingInterruption) updateNoiseFloor(rawLevel.rms);
      }

      options.onLevel?.(latestLevel);
    },
    onSpeechStart: () => {
      if (stopped || (paused && !allowPauseSubmit)) return;
      if (mode === "interruption") {
        handleInterruptionCandidateStart();
        return;
      }

      publishState("speech");
      options.onSpeechStart?.();
    },
    onSpeechRealStart: () => {
      if (stopped || (paused && !allowPauseSubmit) || mode !== "interruption") return;
      tryAcceptInterruptionCandidate();
    },
    onSpeechEnd: (audio) => {
      if (stopped || (paused && !allowPauseSubmit)) return;
      const wasAcceptedInterruption = interruptionFired;
      const speechLevel = pendingInterruption?.level ?? latestLevel;
      resetSpeechState();
      publishState("listening");

      if (mode === "interruption") {
        if (wasAcceptedInterruption) {
          options.onInterruptionEnd?.(audio, speechLevel);
        }
        return;
      }

      if (!wasAcceptedInterruption) {
        options.onSpeechEnd?.(audio, speechLevel);
      }
    },
    onVADMisfire: () => {
      if (stopped || (paused && !allowPauseSubmit)) return;
      options.onSpeechMisfire?.(latestLevel, mode);
      if (mode !== "interruption") return;
      ignoreInterruption(
        latestLevel.peak < INTERRUPTION_MIN_PEAK
          ? "low-peak"
          : "no-recent-rise",
        latestLevel,
      );
      resetSpeechState();
      publishState("listening");
    },
  });
  hasStarted = true;
  await micVad.pause();
  publishState("paused");

  function pause(options: VadPauseOptions = {}): void {
    if (stopped) return;
    paused = true;
    allowPauseSubmit = options.submitSpeech ?? false;
    resetSpeechState();
    publishState("paused");
    void pauseMicVad(options.submitSpeech ?? false);
  }

  function resume(nextMode: VadSensitivityMode = "normal"): void {
    if (stopped) return;
    mode = nextMode;
    paused = false;
    resetSpeechState();
    micVad.setOptions(getVadOptions(false));
    publishState("listening");
    void micVad.start().catch(handleVadError);
  }

  function markAudioOutput(
    suppressionMs = AUDIO_OUTPUT_SUPPRESSION_MS,
  ): void {
    audioSuppressedUntil = performance.now() + suppressionMs;
    recentRmsLevels.length = 0;
  }

  function stop(): void {
    if (stopped) return;
    stopped = true;
    resetSpeechState();
    if (hasStarted) {
      void micVad.destroy().catch(() => undefined);
    }
    publishState("idle");
  }

  function publishState(nextState: VadListenerState): void {
    if (state === nextState) return;
    state = nextState;
    options.onStateChange?.(nextState);
  }

  function getPositiveSpeechThreshold(): number {
    if (mode === "interruption") return INTERRUPTION_POSITIVE_SPEECH_THRESHOLD;
    if (mode === "barge-in") return BARGE_IN_POSITIVE_SPEECH_THRESHOLD;
    return NORMAL_POSITIVE_SPEECH_THRESHOLD;
  }

  function getNegativeSpeechThreshold(): number {
    return Math.max(
      0.05,
      getPositiveSpeechThreshold() - NEGATIVE_THRESHOLD_OFFSET,
    );
  }

  function getMinSpeechMs(): number {
    if (mode === "interruption") return INTERRUPTION_HOLD_MS;
    if (mode === "barge-in") return BARGE_IN_MIN_SPEECH_MS;
    return NORMAL_MIN_SPEECH_MS;
  }

  function getVadOptions(submitUserSpeechOnPause: boolean) {
    return {
      positiveSpeechThreshold: getPositiveSpeechThreshold(),
      negativeSpeechThreshold: getNegativeSpeechThreshold(),
      minSpeechMs: getMinSpeechMs(),
      redemptionMs: END_SILENCE_MS,
      preSpeechPadMs: PRE_SPEECH_PAD_MS,
      submitUserSpeechOnPause,
    };
  }

  async function pauseMicVad(submitUserSpeechOnPause: boolean): Promise<void> {
    try {
      if (submitUserSpeechOnPause) {
        micVad.setOptions(getVadOptions(true));
      }
      await micVad.pause();
    } catch (error) {
      handleVadError(error);
    } finally {
      allowPauseSubmit = false;
      if (!stopped && submitUserSpeechOnPause) {
        micVad.setOptions(getVadOptions(false));
      }
    }
  }

  function buildVadLevel(
    level: { rms: number; peak: number },
    speaking: boolean,
    speechProbability: number,
  ): VadListenerLevel {
    return {
      ...level,
      speaking,
      noiseFloor,
      threshold: getPositiveSpeechThreshold(),
      confidence: clampSpeechProbability(speechProbability),
    };
  }

  function handleInterruptionCandidateStart(): void {
    const candidateLevel = latestLevel;
    const now = performance.now();

    pendingInterruption = {
      startedAt: now,
      level: candidateLevel,
    };
    interruptionFired = false;
    publishState("interruption");

    if (now < audioSuppressedUntil) {
      ignoreInterruption("audio-output-suppression", candidateLevel);
      return;
    }
  }

  function tryAcceptInterruptionCandidate(now = performance.now()): void {
    if (!pendingInterruption || interruptionFired) return;
    const candidateLevel = pendingInterruption.level;

    if (now - pendingInterruption.startedAt < INTERRUPTION_HOLD_MS) {
      return;
    }

    if (candidateLevel.confidence < getPositiveSpeechThreshold()) {
      return;
    }

    if (now < audioSuppressedUntil) {
      ignoreInterruption("audio-output-suppression", candidateLevel);
      return;
    }

    if (candidateLevel.peak < INTERRUPTION_MIN_PEAK) {
      ignoreInterruption("low-peak", candidateLevel);
      return;
    }

    if (!hasRecentRise(candidateLevel.rms)) {
      ignoreInterruption("no-recent-rise", candidateLevel);
      return;
    }

    interruptionFired = true;
    lastIgnoredReason = null;
    options.onInterruptionStart?.(candidateLevel);
  }

  function updateRecentLevels(rms: number): void {
    recentRmsLevels.push(rms);
    if (recentRmsLevels.length > RECENT_LEVEL_WINDOW) {
      recentRmsLevels.shift();
    }
  }

  function hasRecentRise(rms: number): boolean {
    if (recentRmsLevels.length < Math.max(4, RECENT_LEVEL_WINDOW / 2)) {
      return true;
    }

    const recentAverage =
      recentRmsLevels.reduce((sum, value) => sum + value, 0) /
      recentRmsLevels.length;
    return (
      rms >=
      Math.max(noiseFloor, recentAverage) * INTERRUPTION_RECENT_RISE_MULTIPLIER
    );
  }

  function ignoreInterruption(
    reason: VadInterruptionIgnoredReason,
    level: VadListenerLevel,
  ): void {
    if (lastIgnoredReason !== reason) {
      lastIgnoredReason = reason;
      options.onInterruptionIgnored?.(reason, level);
    }
  }

  function updateNoiseFloor(rms: number): void {
    noiseFloor = noiseFloor === 0 ? rms : noiseFloor * 0.96 + rms * 0.04;
  }

  function resetSpeechState(): void {
    pendingInterruption = null;
    interruptionFired = false;
  }

  function handleVadError(error: unknown): void {
    if (stopped) return;
    stopped = true;
    publishState("error");
    console.error("Silero VAD failed", error);
  }

  return { pause, resume, markAudioOutput, stop };
}

interface InterruptionCandidate {
  startedAt: number;
  level: VadListenerLevel;
}

function computeLevel(samples: Float32Array): { rms: number; peak: number } {
  let sumSquares = 0;
  let peak = 0;

  for (const sample of samples) {
    const magnitude = Math.abs(sample);
    peak = Math.max(peak, magnitude);
    sumSquares += sample * sample;
  }

  return {
    rms: Math.sqrt(sumSquares / samples.length),
    peak,
  };
}

function clampSpeechProbability(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
