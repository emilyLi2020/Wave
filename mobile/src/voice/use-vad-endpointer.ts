// VAD endpointer — always-on mic → Silero v5 → speechStart / speechEnd.
//
// Extracted from VadTestScreen (issue #21 step 2). Same sherpa-onnx live
// PCM stream, same 512-sample framing, same hysteresis constants. Adds two
// things the test screen didn't need:
//
//   1. Utterance capture. While in speech we accumulate the raw Float32
//      frames (plus a short pre-roll ring so the first phoneme — which
//      lands during the MIN_SPEECH_FRAMES detection latency — isn't
//      clipped) and emit the concatenated buffer on speechEnd. That buffer
//      is what gets serialized to WAV for Whisper.
//   2. Muting. The combined loop only wants to listen during `listening`
//      and `speaking` (for barge-in); during transcribe/generate the mic
//      is muted so the loop can't recurse on itself. Muting also resets
//      in-progress speech + Silero recurrent state so the next utterance
//      is independent.

import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { AudioModule } from "expo-audio";
import {
  createPcmLiveStream,
  type PcmLiveStreamHandle,
} from "react-native-sherpa-onnx/audio";

import {
  VAD_FRAME_SAMPLES,
  VAD_SAMPLE_RATE,
  type SileroVad,
} from "@/voice/silero-vad";

// Hysteresis — identical to VadTestScreen ("normal" sensitivity). Enter
// speech on >= POSITIVE for MIN_SPEECH_FRAMES; leave on < NEGATIVE for
// REDEMPTION_FRAMES. At 32 ms/frame that's ~96 ms onset / ~700 ms hangover.
const POSITIVE_THRESHOLD = 0.5;
const NEGATIVE_THRESHOLD = 0.35;
const MIN_SPEECH_FRAMES = 3;
const REDEMPTION_FRAMES = 22;

// ~256 ms of frames kept before speechStart so the leading audio that
// arrives during the 3-frame detection latency survives into the utterance.
const PREROLL_FRAMES = 8;

export interface VadEndpointerOptions {
  vadRef: MutableRefObject<SileroVad | null>;
  /** Fires when sustained speech begins. Used for barge-in. */
  onSpeechStart?: () => void;
  /** Fires once speech ends, with the captured 16 kHz mono utterance. */
  onSpeechEnd?: (utterance: Float32Array) => void;
  onError?: (msg: string) => void;
}

export interface VadEndpointer {
  startListening: () => Promise<void>;
  stopListening: () => Promise<void>;
  /**
   * Drop mic frames without tearing down the stream. Muting resets
   * in-progress speech + Silero state so the next utterance is clean.
   */
  setMuted: (muted: boolean) => void;
  listening: boolean;
}

export function useVadEndpointer(opts: VadEndpointerOptions): VadEndpointer {
  const { vadRef, onSpeechStart, onSpeechEnd, onError } = opts;

  const [listening, setListening] = useState(false);

  const streamRef = useRef<PcmLiveStreamHandle | null>(null);
  const dataSubRef = useRef<(() => void) | null>(null);
  const errorSubRef = useRef<(() => void) | null>(null);

  const tailRef = useRef<Float32Array>(new Float32Array(0));
  const inFlightRef = useRef(false);
  const mutedRef = useRef(false);

  const isSpeakingRef = useRef(false);
  const speechRunRef = useRef(0);
  const silenceRunRef = useRef(0);

  // Rolling pre-roll ring + the in-progress utterance frames.
  const prerollRef = useRef<Float32Array[]>([]);
  const utteranceRef = useRef<Float32Array[]>([]);

  // Keep the latest callbacks without re-subscribing the stream.
  const cbRef = useRef({ onSpeechStart, onSpeechEnd, onError });
  cbRef.current = { onSpeechStart, onSpeechEnd, onError };

  const resetSpeechState = useCallback(() => {
    isSpeakingRef.current = false;
    speechRunRef.current = 0;
    silenceRunRef.current = 0;
    utteranceRef.current = [];
    prerollRef.current = [];
    tailRef.current = new Float32Array(0);
  }, []);

  const setMuted = useCallback(
    (muted: boolean) => {
      if (mutedRef.current === muted) return;
      mutedRef.current = muted;
      // Abandon any half-captured utterance and clear Silero's recurrent
      // state so the next listening window starts fresh.
      resetSpeechState();
      if (muted) vadRef.current?.reset();
    },
    [resetSpeechState, vadRef],
  );

  const finishUtterance = useCallback(() => {
    const frames = utteranceRef.current;
    utteranceRef.current = [];
    if (frames.length === 0) return;
    let total = 0;
    for (const f of frames) total += f.length;
    const out = new Float32Array(total);
    let off = 0;
    for (const f of frames) {
      out.set(f, off);
      off += f.length;
    }
    cbRef.current.onSpeechEnd?.(out);
  }, []);

  const processOneFrame = useCallback(
    async (frame: Float32Array) => {
      const vad = vadRef.current;
      if (!vad || inFlightRef.current || mutedRef.current) return;
      inFlightRef.current = true;
      try {
        const owned = new Float32Array(frame);

        // Maintain the pre-roll ring every frame regardless of state.
        const ring = prerollRef.current;
        ring.push(owned);
        if (ring.length > PREROLL_FRAMES) ring.shift();

        const { probability: p } = await vad.processFrame(owned);

        if (isSpeakingRef.current) {
          // Capture every frame through the redemption hangover too.
          utteranceRef.current.push(owned);
          if (p < NEGATIVE_THRESHOLD) {
            silenceRunRef.current += 1;
            if (silenceRunRef.current >= REDEMPTION_FRAMES) {
              isSpeakingRef.current = false;
              silenceRunRef.current = 0;
              speechRunRef.current = 0;
              finishUtterance();
            }
          } else {
            silenceRunRef.current = 0;
          }
        } else {
          if (p >= POSITIVE_THRESHOLD) {
            speechRunRef.current += 1;
            if (speechRunRef.current >= MIN_SPEECH_FRAMES) {
              isSpeakingRef.current = true;
              speechRunRef.current = 0;
              silenceRunRef.current = 0;
              // Seed the utterance with the pre-roll so the onset that
              // happened during detection latency isn't clipped.
              utteranceRef.current = prerollRef.current.slice();
              cbRef.current.onSpeechStart?.();
            }
          } else {
            speechRunRef.current = 0;
          }
        }
      } catch (e) {
        cbRef.current.onError?.(
          e instanceof Error ? e.message : String(e),
        );
      } finally {
        inFlightRef.current = false;
      }
    },
    [vadRef, finishUtterance],
  );

  // Drain arbitrary-size PCM callbacks into exact 512-sample frames.
  // tailRef is updated synchronously (before any await) so concurrent
  // callbacks see post-consume state, not the stale tail.
  const handlePcmChunk = useCallback(
    async (samples: Float32Array, sampleRate: number) => {
      if (mutedRef.current) return;
      if (sampleRate !== VAD_SAMPLE_RATE) {
        cbRef.current.onError?.(
          `Stream sample rate ${sampleRate} != ${VAD_SAMPLE_RATE}`,
        );
        return;
      }
      const tail = tailRef.current;
      const combined = new Float32Array(tail.length + samples.length);
      combined.set(tail, 0);
      combined.set(samples, tail.length);

      const fullFrames = Math.floor(combined.length / VAD_FRAME_SAMPLES);
      const consumed = fullFrames * VAD_FRAME_SAMPLES;
      tailRef.current = combined.slice(consumed);

      for (let i = 0; i < fullFrames; i++) {
        const frame = combined.subarray(
          i * VAD_FRAME_SAMPLES,
          (i + 1) * VAD_FRAME_SAMPLES,
        );
        await processOneFrame(frame);
      }
    },
    [processOneFrame],
  );

  const teardownStream = useCallback(async () => {
    dataSubRef.current?.();
    errorSubRef.current?.();
    dataSubRef.current = null;
    errorSubRef.current = null;
    try {
      await streamRef.current?.stop();
    } catch {
      /* best-effort */
    }
    streamRef.current = null;
  }, []);

  const startListening = useCallback(async () => {
    if (streamRef.current) return;
    const perm = await AudioModule.requestRecordingPermissionsAsync();
    if (!perm.granted) {
      cbRef.current.onError?.("Microphone permission denied");
      return;
    }
    vadRef.current?.reset();
    resetSpeechState();
    mutedRef.current = false;

    const stream = createPcmLiveStream({
      sampleRate: VAD_SAMPLE_RATE,
      channelCount: 1,
    });
    streamRef.current = stream;
    dataSubRef.current = stream.onData((s, sr) => {
      void handlePcmChunk(s, sr);
    });
    errorSubRef.current = stream.onError((msg) => {
      cbRef.current.onError?.(`Mic stream: ${msg}`);
    });
    try {
      await stream.start();
      setListening(true);
    } catch (e) {
      await teardownStream();
      cbRef.current.onError?.(
        e instanceof Error ? e.message : String(e),
      );
    }
  }, [vadRef, resetSpeechState, handlePcmChunk, teardownStream]);

  const stopListening = useCallback(async () => {
    await teardownStream();
    resetSpeechState();
    setListening(false);
  }, [teardownStream, resetSpeechState]);

  // Safety net — never leave the mic stream open on unmount.
  useEffect(() => {
    return () => {
      void teardownStream();
    };
  }, [teardownStream]);

  return { startListening, stopListening, setMuted, listening };
}
