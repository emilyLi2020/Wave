// Shared singleton wllama instance for the WAVE fine-tune. Owned here so the
// voice-test page, the clinical chunk/checkin/reflection generators, and any
// future surface all share one loaded model (the GGUF is ~3.2 GB — loading it
// twice would blow the WASM heap on mobile and waste GPU memory on desktop).
//
// Callers consume `preloadWaveWllama()` to get the instance (loads on first
// call, returns the cached promise on subsequent calls) and
// `subscribeWaveWllamaLoad()` to drive UI progress indicators.

import {
  describeWaveWllamaSource,
  loadWaveWllama,
  type WllamaInstance,
} from "@/lib/wllama";

export type WaveWllamaPhase = "idle" | "loading" | "ready" | "error";

export interface WaveWllamaLoadState {
  phase: WaveWllamaPhase;
  status: string;
  progress: number | null;
  device: string | null;
  message: string;
}

let wllamaPromise: Promise<WllamaInstance> | null = null;
let loadState: WaveWllamaLoadState = {
  phase: "idle",
  status: "idle",
  progress: null,
  device: null,
  message: "Waiting to load Gemma via wllama.",
};
const listeners = new Set<(state: WaveWllamaLoadState) => void>();

function publish(update: Partial<WaveWllamaLoadState>): void {
  const next: WaveWllamaLoadState = { ...loadState, ...update };
  if (
    next.phase === loadState.phase &&
    next.status === loadState.status &&
    next.progress === loadState.progress &&
    next.device === loadState.device &&
    next.message === loadState.message
  ) {
    return;
  }
  loadState = next;
  for (const listener of listeners) listener(loadState);
}

async function probeWebGpuDevice(): Promise<"webgpu" | "wasm"> {
  if (typeof navigator === "undefined") return "wasm";
  const gpu = (
    navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }
  ).gpu;
  if (!gpu) return "wasm";
  try {
    const adapter = await gpu.requestAdapter();
    return adapter ? "webgpu" : "wasm";
  } catch {
    return "wasm";
  }
}

export function getWaveWllamaLoadState(): WaveWllamaLoadState {
  return loadState;
}

export function subscribeWaveWllamaLoad(
  listener: (state: WaveWllamaLoadState) => void,
): () => void {
  listeners.add(listener);
  listener(loadState);
  return () => {
    listeners.delete(listener);
  };
}

export async function preloadWaveWllama(): Promise<WllamaInstance> {
  if (wllamaPromise) return wllamaPromise;

  const sourceLabel = describeWaveWllamaSource();
  const device = await probeWebGpuDevice();
  publish({
    phase: "loading",
    status: "loading",
    progress: 0,
    device,
    message: `Loading ${sourceLabel} via wllama (${device}).`,
  });

  wllamaPromise = loadWaveWllama({
    onProgress: ({ percent }) => {
      publish({
        phase: "loading",
        status: "loading",
        progress: percent,
        message: `Downloading Gemma GGUF ${percent}% (${device}).`,
      });
    },
  })
    .then((wllama) => {
      publish({
        phase: "ready",
        status: "ready",
        progress: 100,
        message: `Gemma ready via wllama (${device}).`,
      });
      return wllama;
    })
    .catch((err) => {
      wllamaPromise = null;
      const message = err instanceof Error ? err.message : String(err);
      publish({
        phase: "error",
        status: "error",
        message: `wllama load failed: ${message}`,
      });
      throw err;
    });

  return wllamaPromise;
}
