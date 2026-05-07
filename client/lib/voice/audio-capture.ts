import type { VoiceRuntimeCapabilities } from "@/lib/voice/types";

export interface AudioCaptureLevel {
  rms: number;
  peak: number;
  speaking: boolean;
}

export function getVoiceRuntimeCapabilities(): VoiceRuntimeCapabilities {
  const hasWindow = typeof window !== "undefined";
  const hasNavigator = typeof navigator !== "undefined";
  return {
    hasWindow,
    hasNavigator,
    hasMicrophoneApi: Boolean(
      hasNavigator && navigator.mediaDevices?.getUserMedia,
    ),
    hasSpeechSynthesis: hasWindow && "speechSynthesis" in window,
    hasWebGpu: hasNavigator && "gpu" in navigator,
    isSecureContext: hasWindow && window.isSecureContext,
    crossOriginIsolated:
      typeof globalThis !== "undefined" && globalThis.crossOriginIsolated,
  };
}
