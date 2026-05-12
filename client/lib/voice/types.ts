export const WHISPER_MODEL_IDS = [
  "onnx-community/whisper-tiny.en",
  "onnx-community/whisper-base.en",
] as const;

export type WhisperModelId = (typeof WHISPER_MODEL_IDS)[number];

export type VoiceRuntimeDevice = "webgpu" | "wasm" | "cpu" | "unknown";

export type VoiceLoadPhase = "idle" | "loading" | "ready" | "error";

export type TextToSpeechBackendId = "browser-speech" | "kokoro";

export type TtsPlaybackMode = "full-response" | "streaming-sentence";
export type KokoroStreamMode = "native-kokoro-stream" | "manual-sentence-chunks";
export type TtsPlaybackLifecycleStatus = "start" | "end";

export const KOKORO_MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
export const KOKORO_DEFAULT_VOICE_ID = "af_heart";
export const KOKORO_RUNTIME_OPTIONS = [
  {
    id: "fp16-webgpu",
    label: "fp16 + WebGPU (default)",
    dtype: "fp16",
    device: "webgpu",
  },
  {
    id: "fp32-webgpu",
    label: "fp32 + WebGPU (fidelity)",
    dtype: "fp32",
    device: "webgpu",
  },
  {
    id: "q8-webgpu",
    label: "q8 + WebGPU (experimental)",
    dtype: "q8",
    device: "webgpu",
  },
  {
    id: "q4f16-webgpu",
    label: "q4f16 + WebGPU (experimental)",
    dtype: "q4f16",
    device: "webgpu",
  },
  {
    id: "q4-webgpu",
    label: "q4 + WebGPU (experimental, audible artifacts)",
    dtype: "q4",
    device: "webgpu",
  },
  {
    id: "q8-wasm",
    label: "q8 + WASM (fallback)",
    dtype: "q8",
    device: "wasm",
  },
] as const;
export type KokoroRuntimeOption = (typeof KOKORO_RUNTIME_OPTIONS)[number];
export type KokoroRuntimeId = KokoroRuntimeOption["id"];
export type KokoroDtype = KokoroRuntimeOption["dtype"];
export type KokoroDevice = KokoroRuntimeOption["device"];
export const KOKORO_DEFAULT_RUNTIME_ID: KokoroRuntimeId = "fp16-webgpu";
export const KOKORO_DTYPE: KokoroDtype = "fp16";
export const KOKORO_DEVICE: KokoroDevice = "webgpu";

export interface VoiceModelLoadState {
  phase: VoiceLoadPhase;
  status: string;
  progress: number | null;
  message: string;
  modelId: string | null;
  device: VoiceRuntimeDevice;
}

export interface SpeechToTextResult {
  text: string;
  elapsedMs: number;
  modelId: WhisperModelId;
  device: VoiceRuntimeDevice;
  audioDurationMs: number;
}

export interface SpeechToTextEngine {
  readonly modelId: WhisperModelId;
  readonly device: VoiceRuntimeDevice;
  transcribe(audio: Float32Array, sampleRate: number): Promise<SpeechToTextResult>;
}

export interface BrowserVoiceInfo {
  name: string;
  lang: string;
  voiceURI: string;
  localService: boolean;
  default: boolean;
}

export interface KokoroVoiceInfo {
  id: string;
  name: string;
  language: string;
  gender: string;
  traits: string | null;
  targetQuality: string | null;
  overallGrade: string | null;
}

export interface TextToSpeechResult {
  elapsedMs: number;
  backend: TextToSpeechBackendId;
  playbackMode: TtsPlaybackMode;
  voice: BrowserVoiceInfo | null;
  kokoroVoice: KokoroVoiceInfo | null;
  usedLocalVoice: boolean;
  warning: string | null;
  firstAudioMs: number | null;
  chunkCount: number;
  streamMode?: KokoroStreamMode;
}

export interface KokoroStreamPlaybackEvent {
  status: "buffering" | "generating" | "playing" | "finished";
  chunkIndex: number;
  text: string;
  mode: KokoroStreamMode;
}

export interface TtsPlaybackLifecycleEvent {
  status: TtsPlaybackLifecycleStatus;
  backend: TextToSpeechBackendId;
  chunkIndex: number;
  text: string;
}

export interface TextToSpeechOptions {
  onPlaybackEvent?: (event: TtsPlaybackLifecycleEvent) => void;
}

export interface TextToSpeechEngine {
  getVoices(): Promise<BrowserVoiceInfo[]>;
  speak(
    text: string,
    preferredVoiceURI?: string,
    options?: TextToSpeechOptions,
  ): Promise<TextToSpeechResult>;
  stop(): void;
}

export interface KokoroTextToSpeechEngine {
  readonly runtime: KokoroRuntimeOption;
  getVoices(): Promise<KokoroVoiceInfo[]>;
  speak(
    text: string,
    preferredVoiceId?: string,
    options?: TextToSpeechOptions,
  ): Promise<TextToSpeechResult>;
  speakStream(
    chunks: AsyncIterable<string>,
    preferredVoiceId?: string,
    options?: {
      onEvent?: (event: KokoroStreamPlaybackEvent) => void;
      onPlaybackEvent?: (event: TtsPlaybackLifecycleEvent) => void;
    },
  ): Promise<TextToSpeechResult>;
  stop(): void;
}

export interface AudioCaptureResult {
  audio: Float32Array;
  sampleRate: number;
  durationMs: number;
  peakLevel: number;
}

export interface VoiceRuntimeCapabilities {
  hasWindow: boolean;
  hasNavigator: boolean;
  hasMicrophoneApi: boolean;
  hasSpeechSynthesis: boolean;
  hasWebGpu: boolean;
  isSecureContext: boolean;
  crossOriginIsolated: boolean;
}
