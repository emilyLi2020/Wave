// Kokoro TTS service — one shared streaming engine + PCM player, reused
// across the chunk player, the check-in voice loop, and reflection.
//
// Lifted verbatim from the proven KokoroTestScreen path (kokoro-en-v0_19
// fp32, CoreML, sherpa's native PCM player). Lazy-imported so Metro
// never resolves the native bindings on web/dev.
//
// IMPORTANT (deploy.md audio pitfall): never call
// setAudioModeAsync({ allowsRecording: true }) while a phrase is
// playing — sherpa's startPcmPlayer owns the session during playback.

import { setAudioModeAsync } from "expo-audio";

type StreamingTtsEngine = {
  generateSpeechStream: (
    text: string,
    opts: unknown,
    handlers: {
      onChunk?: (c: { samples: number[]; sampleRate: number; isFinal: boolean }) => void;
      onEnd?: (e: { cancelled: boolean }) => void;
      onError?: (e: { message: string }) => void;
    },
  ) => Promise<{ cancel: () => Promise<void> }>;
  cancelSpeechStream: () => Promise<void>;
  startPcmPlayer: (sampleRate: number, channels: number) => Promise<void>;
  writePcmChunk: (samples: number[]) => Promise<void>;
  stopPcmPlayer: () => Promise<void>;
  destroy: () => Promise<void>;
};

const KOKORO_MODEL_ID = "kokoro-en-v0_19";

let enginePromise: Promise<StreamingTtsEngine> | null = null;
let playerActive = false;
let speaking = false;

export type TtsProgress = (pct: number) => void;

export function ensureKokoro(onProgress?: TtsProgress): Promise<StreamingTtsEngine> {
  if (enginePromise) return enginePromise;
  enginePromise = (async () => {
    const tag = "[wave][kokoro]";
    try {
      await setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
      const dl: any = await import("react-native-sherpa-onnx/download");
      const ttsMod: any = await import("react-native-sherpa-onnx/tts");
      console.log(`${tag} ensure model ${KOKORO_MODEL_ID}`);
      await dl.refreshModelsByCategory(dl.ModelCategory.Tts);
      const res = await dl.ensureModelByCategory(dl.ModelCategory.Tts, KOKORO_MODEL_ID, {
        onProgress: (p: { percent: number }) => {
          console.log(`${tag} download ${Math.round(p.percent)}%`);
          onProgress?.(p.percent / 100);
        },
      });
      console.log(`${tag} createStreamingTTS`);
      const tts = (await ttsMod.createStreamingTTS({
        modelPath: { type: "file", path: res.localPath },
        modelType: "kokoro",
        providers: ["CoreMLExecutionProvider"],
      })) as StreamingTtsEngine;
      console.log(`${tag} ready`);
      return tts;
    } catch (err) {
      enginePromise = null;
      console.error("[wave][kokoro] init failed:", err instanceof Error ? err.message : err);
      throw err;
    }
  })();
  return enginePromise;
}

/**
 * Speak one phrase. Resolves when synthesis ends (a short tail covers
 * the final buffer still draining through the native player). The PCM
 * player stays resident across calls — call stopSpeaking() when leaving
 * the surface to release it. Rejects on engine error; callers fall back
 * to a timed beat so a TTS failure never strands the flow.
 */
export async function speak(text: string): Promise<void> {
  const phrase = text.trim();
  if (!phrase) return;
  const engine = await ensureKokoro();
  speaking = true;
  await new Promise<void>((resolve, reject) => {
    let firstChunk = true;
    let chain: Promise<unknown> = Promise.resolve();
    let totalSamples = 0;
    let sr = 24_000;
    let playbackStartedAt = 0;
    engine
      .generateSpeechStream(phrase, undefined, {
        onChunk: (c) => {
          if (firstChunk) {
            firstChunk = false;
            sr = c.sampleRate;
            if (!playerActive) {
              // First phrase of the session: startPcmPlayer is async and
              // lags the first chunk ~100-300ms. Stamp playbackStartedAt
              // when it RESOLVES (true playback start), not at chunk
              // arrival — stamping early over-counts `elapsed`, shrinks
              // drainMs, and resolves speak() before audio finishes
              // (issue #26, Step 1 interim JS fix).
              playerActive = true;
              chain = engine
                .startPcmPlayer(c.sampleRate, 1)
                .then(() => {
                  playbackStartedAt = Date.now();
                  return engine.writePcmChunk(c.samples);
                })
                .catch(() => {});
              totalSamples += c.samples.length;
              return;
            }
            // Player already resident from a prior phrase — audio begins
            // as soon as this chunk is written, so "now" is accurate.
            playbackStartedAt = Date.now();
          }
          totalSamples += c.samples.length;
          chain = chain.then(() => engine.writePcmChunk(c.samples).catch(() => {}));
        },
        onEnd: () => {
          // onEnd = SYNTHESIS done (fast); the PCM player is still
          // draining real-time audio. Wait for the write chain to flush
          // (all chunks queued) THEN for the real remaining audio
          // duration measured from true playback start, + a generous
          // interim margin. The authoritative fix is a native
          // scheduleBuffer completionHandler (issue #26 Step 1 native);
          // this JS estimate is the documented interim mitigation.
          chain
            .then(() => {
              const audioMs = (totalSamples / (sr || 24_000)) * 1000;
              const elapsed = playbackStartedAt
                ? Date.now() - playbackStartedAt
                : 0;
              const drainMs = Math.max(0, audioMs - elapsed) + 900;
              setTimeout(resolve, drainMs);
            })
            .catch(() => setTimeout(resolve, 900));
        },
        onError: (e) => reject(new Error(e.message)),
      })
      .catch(reject);
  }).finally(() => {
    speaking = false;
  });
}

export function isSpeaking(): boolean {
  return speaking;
}

/** Stop playback + cancel any in-flight synthesis and release the player. */
export async function stopSpeaking(): Promise<void> {
  const engine = enginePromise ? await enginePromise.catch(() => null) : null;
  if (!engine) return;
  try {
    await engine.cancelSpeechStream();
  } catch {
    /* nothing in flight */
  }
  if (playerActive) {
    playerActive = false;
    try {
      await engine.stopPcmPlayer();
    } catch {
      /* already stopped */
    }
  }
  speaking = false;
}
