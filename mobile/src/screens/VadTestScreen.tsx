// Live Silero VAD test page.
//
// Flow:
//   1. ensureModel('silero-vad') downloads the ~2.3 MB ONNX into the cache.
//   2. createSileroVad(localPath) loads the model into onnxruntime-react-native.
//   3. sherpa-onnx's createPcmLiveStream gives us a continuous 16 kHz mono
//      Float32 mic stream — incoming chunks of arbitrary size go into a ring
//      buffer that we drain into 512-sample frames (32 ms each at 16 kHz).
//   4. Each frame runs through Silero. We apply hysteresis (high threshold to
//      enter speech, low threshold + redemption frames to leave) so the
//      indicator stays steady through the natural silences inside an
//      utterance.
//   5. UI: a big circle turns green when speaking, gray when silent. We also
//      show live probability, a rolling probability bar history, and a
//      counter of detected speech events.
//
// Note: we deliberately use sherpa-onnx's mic stream rather than expo-audio
// because expo-audio only writes to a file (no PCM callback). sherpa-onnx is
// already a dep (Kokoro TTS uses it) so this adds no new native module.

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { AudioModule, setAudioModeAsync } from "expo-audio";
import { createPcmLiveStream, type PcmLiveStreamHandle } from "react-native-sherpa-onnx/audio";

import {
  createSileroVad,
  VAD_FRAME_SAMPLES,
  VAD_SAMPLE_RATE,
  type SileroVad,
} from "@/voice/silero-vad";
import { ensureModel } from "@/runtime/model-cache";

// Hysteresis — keeps the indicator from flickering on the natural pauses
// inside an utterance. Matches the values used in the web vad-listener for
// the "normal" sensitivity mode.
const POSITIVE_THRESHOLD = 0.5;
const NEGATIVE_THRESHOLD = 0.35;
// 96 ms minimum sustained signal to call it speech, 700 ms of sub-threshold
// frames to end the segment. At 32 ms/frame: 3 frames / 22 frames.
const MIN_SPEECH_FRAMES = 3;
const REDEMPTION_FRAMES = 22;

// Rolling probability history rendered as a bar timeline.
const HISTORY_FRAMES = 96;  // ~3 seconds at 32 ms / frame

type Phase = "idle" | "downloading" | "loading" | "listening" | "stopping" | "error";

function stringifyErr(e: unknown): string {
  if (e instanceof Error) return e.message || e.name;
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const any = e as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof any.message === "string") parts.push(any.message);
    if (typeof any.code === "string" || typeof any.code === "number") {
      parts.push(`code=${any.code}`);
    }
    if (parts.length > 0) return parts.join(" · ");
    try { return JSON.stringify(e); } catch { return String(e); }
  }
  return String(e);
}

export default function VadTestScreen() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [downloadPct, setDownloadPct] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [probability, setProbability] = useState(0);
  const [history, setHistory] = useState<number[]>([]);
  const [eventCount, setEventCount] = useState(0);
  // Diagnostics — helps tell apart "stream not delivering" / "stream delivers
  // but frames don't infer" / "frames infer but always 0" failure modes.
  const [diag, setDiag] = useState({
    chunks: 0,
    samples: 0,
    frames: 0,
    peakSample: 0,
    peakProb: 0,
  });

  const vadRef = useRef<SileroVad | null>(null);
  const streamRef = useRef<PcmLiveStreamHandle | null>(null);
  // Subscriptions for the stream's onData / onError event emitters.
  const dataSubRef = useRef<(() => void) | null>(null);
  const errorSubRef = useRef<(() => void) | null>(null);
  // Ring buffer for samples that arrived but don't fill a complete 512-frame.
  const tailRef = useRef<Float32Array>(new Float32Array(0));
  // Inference is async — guard against concurrent processFrame calls so we
  // don't interleave state updates inside the wrapper.
  const inFlightRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const consecutiveSpeechRef = useRef(0);
  const consecutiveSilenceRef = useRef(0);

  const cleanupStream = useCallback(() => {
    dataSubRef.current?.();
    errorSubRef.current?.();
    dataSubRef.current = null;
    errorSubRef.current = null;
  }, []);

  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      allowsRecording: true,
    }).catch(() => {});
  }, []);

  // Unmount cleanup — stop stream and release VAD session.
  useEffect(() => {
    return () => {
      cleanupStream();
      streamRef.current?.stop().catch(() => {});
      vadRef.current?.release().catch(() => {});
    };
  }, [cleanupStream]);

  const ensurePermission = async (): Promise<boolean> => {
    const status = await AudioModule.requestRecordingPermissionsAsync();
    if (!status.granted) {
      Alert.alert(
        "Microphone permission required",
        "Wave needs the mic for live VAD detection. Grant it in Settings.",
      );
      return false;
    }
    return true;
  };

  const onLoad = async () => {
    setError(null);
    setPhase("downloading");
    setDownloadPct(0);

    let localPath: string;
    try {
      localPath = await ensureModel("silero-vad", {
        onProgress: (p) => {
          setDownloadPct(p);
          if (p >= 1) setPhase("loading");
        },
      });
    } catch (e) {
      setError(stringifyErr(e));
      setPhase("error");
      return;
    }

    setPhase("loading");
    try {
      vadRef.current = await createSileroVad(localPath);
      setPhase("idle");
    } catch (e) {
      setError(stringifyErr(e));
      setPhase("error");
    }
  };

  // Hot path: pump one frame through Silero and update UI / hysteresis state.
  const processOneFrame = useCallback(async (frame: Float32Array) => {
    const vad = vadRef.current;
    if (!vad) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      // Tensor copies its data, but be defensive: hand off an owned buffer in
      // case the subarray view's backing storage gets reused mid-flight.
      const owned = new Float32Array(frame);
      const { probability: p } = await vad.processFrame(owned);
      setProbability(p);
      setDiag((d) => ({
        ...d,
        frames: d.frames + 1,
        peakProb: Math.max(d.peakProb, p),
      }));
      setHistory((prev) => {
        const next = prev.length >= HISTORY_FRAMES ? prev.slice(1) : prev.slice();
        next.push(p);
        return next;
      });

      if (isSpeakingRef.current) {
        // Currently in speech — need REDEMPTION_FRAMES of sub-negative-threshold
        // frames to leave the state.
        if (p < NEGATIVE_THRESHOLD) {
          consecutiveSilenceRef.current += 1;
          if (consecutiveSilenceRef.current >= REDEMPTION_FRAMES) {
            isSpeakingRef.current = false;
            consecutiveSilenceRef.current = 0;
            consecutiveSpeechRef.current = 0;
            setIsSpeaking(false);
          }
        } else {
          consecutiveSilenceRef.current = 0;
        }
      } else {
        // Currently silent — need MIN_SPEECH_FRAMES of >= positive threshold
        // frames in a row to enter speech.
        if (p >= POSITIVE_THRESHOLD) {
          consecutiveSpeechRef.current += 1;
          if (consecutiveSpeechRef.current >= MIN_SPEECH_FRAMES) {
            isSpeakingRef.current = true;
            consecutiveSpeechRef.current = 0;
            consecutiveSilenceRef.current = 0;
            setIsSpeaking(true);
            setEventCount((c) => c + 1);
          }
        } else {
          consecutiveSpeechRef.current = 0;
        }
      }
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  // Each PCM callback may deliver an arbitrary number of samples. Concatenate
  // with the tail buffer, drain complete 512-sample frames, keep the remainder.
  //
  // Two pieces of housekeeping:
  //   - Compute the chunk's peak magnitude up front and surface it via diag so
  //     we can verify the mic is actually capturing audible audio.
  //   - Update tailRef *synchronously* (before any await) so concurrent
  //     callbacks see the consumed-then-remainder buffer, not the stale tail.
  const handlePcmChunk = useCallback(
    async (samples: Float32Array, sampleRate: number) => {
      if (sampleRate !== VAD_SAMPLE_RATE) {
        setError(`Stream sample rate ${sampleRate} != ${VAD_SAMPLE_RATE}`);
        return;
      }

      let peak = 0;
      for (let i = 0; i < samples.length; i++) {
        const mag = Math.abs(samples[i] ?? 0);
        if (mag > peak) peak = mag;
      }
      setDiag((d) => ({
        ...d,
        chunks: d.chunks + 1,
        samples: d.samples + samples.length,
        peakSample: Math.max(d.peakSample, peak),
      }));

      const tail = tailRef.current;
      const combined = new Float32Array(tail.length + samples.length);
      combined.set(tail, 0);
      combined.set(samples, tail.length);

      const total = combined.length;
      const fullFrames = Math.floor(total / VAD_FRAME_SAMPLES);
      const consumed = fullFrames * VAD_FRAME_SAMPLES;
      // Stash the remainder now, before any await — so concurrent callbacks
      // see the post-consume state instead of the stale pre-consume tail.
      tailRef.current = combined.slice(consumed);

      for (let i = 0; i < fullFrames; i++) {
        const frame = combined.subarray(
          i * VAD_FRAME_SAMPLES,
          (i + 1) * VAD_FRAME_SAMPLES,
        );
        // eslint-disable-next-line no-await-in-loop
        await processOneFrame(frame);
      }
    },
    [processOneFrame],
  );

  const onStart = async () => {
    if (!vadRef.current) {
      setError("VAD not loaded yet");
      setPhase("error");
      return;
    }
    setError(null);
    if (!(await ensurePermission())) return;

    // Reset per-session state.
    vadRef.current.reset();
    isSpeakingRef.current = false;
    consecutiveSpeechRef.current = 0;
    consecutiveSilenceRef.current = 0;
    tailRef.current = new Float32Array(0);
    setIsSpeaking(false);
    setProbability(0);
    setHistory([]);
    setEventCount(0);
    setDiag({ chunks: 0, samples: 0, frames: 0, peakSample: 0, peakProb: 0 });

    const stream = createPcmLiveStream({
      sampleRate: VAD_SAMPLE_RATE,
      channelCount: 1,
    });
    streamRef.current = stream;

    dataSubRef.current = stream.onData((s, sr) => {
      // Don't await — let the handler manage its own back-pressure via the
      // in-flight guard. Awaiting here would block the JS event loop.
      void handlePcmChunk(s, sr);
    });
    errorSubRef.current = stream.onError((msg) => {
      setError(`Mic stream: ${msg}`);
    });

    try {
      await stream.start();
      setPhase("listening");
    } catch (e) {
      cleanupStream();
      streamRef.current = null;
      setError(stringifyErr(e));
      setPhase("error");
    }
  };

  const onStop = async () => {
    setPhase("stopping");
    try {
      cleanupStream();
      await streamRef.current?.stop();
    } catch (e) {
      setError(stringifyErr(e));
    } finally {
      streamRef.current = null;
      isSpeakingRef.current = false;
      setIsSpeaking(false);
      setPhase("idle");
    }
  };

  const isBusy = phase === "downloading" || phase === "loading" || phase === "stopping";
  const modelLoaded = vadRef.current != null;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    >
      <Text style={styles.sub} selectable>
        onnxruntime-react-native + Silero v5 + sherpa-onnx live mic. Indicator
        turns green when speech is detected. Hysteresis: enter ≥{" "}
        {POSITIVE_THRESHOLD} for {MIN_SPEECH_FRAMES} frames; leave &lt;{" "}
        {NEGATIVE_THRESHOLD} for {REDEMPTION_FRAMES} frames.
      </Text>

      <View style={styles.statusRow}>
        <Text style={styles.statusLabel}>Phase:</Text>
        <Text style={[styles.statusValue, phaseStyle(phase)]}>{phase}</Text>
        {isBusy && <ActivityIndicator size="small" style={{ marginLeft: 8 }} />}
      </View>

      {phase === "downloading" && (
        <Text style={styles.kv}>Download: {(downloadPct * 100).toFixed(1)}%</Text>
      )}

      {error && (
        <View style={[styles.panel, styles.errorPanel]}>
          <Text style={styles.panelHead}>Error</Text>
          <Text selectable style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Live indicator */}
      <View style={styles.indicatorWrap}>
        <View
          style={[
            styles.indicator,
            { backgroundColor: isSpeaking ? "#34D399" : "#23232F" },
            phase === "listening" && {
              borderColor: isSpeaking ? "#10B981" : "#3F3F50",
            },
          ]}
        >
          <Text
            style={[
              styles.indicatorText,
              { color: isSpeaking ? "#0B3D2E" : "#6B7280" },
            ]}
          >
            {phase === "listening"
              ? isSpeaking
                ? "SPEECH"
                : "SILENT"
              : "—"}
          </Text>
          <Text
            style={[
              styles.indicatorProb,
              { color: isSpeaking ? "#0B3D2E" : "#9CA3AF" },
            ]}
          >
            p = {probability.toFixed(3)}
          </Text>
        </View>
      </View>

      {phase === "listening" && (
        <View style={styles.panel}>
          <Text style={styles.panelHead}>Rolling probability (32 ms / bar)</Text>
          <View style={styles.timeline}>
            {history.map((p, i) => (
              <View
                key={i}
                style={[
                  styles.bar,
                  {
                    height: 4 + Math.max(0, Math.min(1, p)) * 56,
                    backgroundColor: p >= POSITIVE_THRESHOLD ? "#34D399" : "#3F3F50",
                  },
                ]}
              />
            ))}
          </View>
          <Text style={styles.kv}>Speech events this session: {eventCount}</Text>
        </View>
      )}

      {vadRef.current && (
        <View style={styles.panel}>
          <Text style={styles.panelHead}>Model I/O</Text>
          {vadRef.current.inputs.map((io) => (
            <Text key={`in-${io.name}`} selectable style={styles.kv}>
              in  {io.name}: {io.type} [{io.shape.join(", ") || "scalar"}]
            </Text>
          ))}
          {vadRef.current.outputs.map((io) => (
            <Text key={`out-${io.name}`} selectable style={styles.kv}>
              out {io.name}: {io.type} [{io.shape.join(", ") || "scalar"}]
            </Text>
          ))}
        </View>
      )}

      {phase === "listening" && (
        <View style={styles.panel}>
          <Text style={styles.panelHead}>Diagnostics</Text>
          <Text selectable style={styles.kv}>
            PCM chunks received: {diag.chunks}
          </Text>
          <Text selectable style={styles.kv}>
            Samples received: {diag.samples}{" "}
            ({(diag.samples / VAD_SAMPLE_RATE).toFixed(2)}s)
          </Text>
          <Text selectable style={styles.kv}>
            Frames inferred: {diag.frames}
          </Text>
          <Text selectable style={styles.kv}>
            Peak audio magnitude: {diag.peakSample.toFixed(4)}{" "}
            {diag.peakSample < 0.001 ? "← LIKELY SILENT" : ""}
          </Text>
          <Text selectable style={styles.kv}>
            Peak speech probability: {diag.peakProb.toFixed(3)}
          </Text>
        </View>
      )}

      <View style={styles.buttonRow}>
        <Pressable
          style={[
            styles.button,
            (isBusy || modelLoaded) && styles.buttonDisabled,
          ]}
          disabled={isBusy || modelLoaded}
          onPress={onLoad}
        >
          <Text style={styles.buttonText}>
            {modelLoaded ? "VAD loaded ✓" : "1. Download + load VAD"}
          </Text>
        </Pressable>

        {phase === "listening" ? (
          <Pressable
            style={[styles.button, styles.stopButton]}
            onPress={onStop}
          >
            <Text style={styles.buttonText}>Stop listening</Text>
          </Pressable>
        ) : (
          <Pressable
            style={[
              styles.button,
              (!modelLoaded || isBusy) && styles.buttonDisabled,
            ]}
            disabled={!modelLoaded || isBusy}
            onPress={onStart}
          >
            <Text style={styles.buttonText}>2. Start listening</Text>
          </Pressable>
        )}
      </View>
    </ScrollView>
  );
}

function phaseStyle(p: Phase) {
  switch (p) {
    case "error":
      return { color: "#F87171" };
    case "listening":
      return { color: "#34D399" };
    case "downloading":
    case "loading":
    case "stopping":
      return { color: "#FBBF24" };
    default:
      return { color: "#9CA3AF" };
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#08080C" },
  content: { padding: 16, gap: 12 },
  sub: { color: "#9CA3AF", fontSize: 13 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  statusLabel: { color: "#9CA3AF", fontSize: 14 },
  statusValue: { fontSize: 14, fontWeight: "600" },
  panel: {
    backgroundColor: "#16161F",
    padding: 12,
    borderRadius: 8,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: "#23232F",
    gap: 4,
  },
  errorPanel: { borderColor: "#7F1D1D" },
  panelHead: {
    color: "#6B7280",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 4,
  },
  kv: { color: "#F1F1F4", fontSize: 13, fontFamily: "Menlo" },
  errorText: { color: "#F87171", fontSize: 13, fontFamily: "Menlo" },
  indicatorWrap: {
    alignItems: "center",
    marginVertical: 16,
  },
  indicator: {
    width: 200,
    height: 200,
    borderRadius: 100,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 4,
    borderColor: "#3F3F50",
  },
  indicatorText: {
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: 2,
  },
  indicatorProb: {
    fontSize: 14,
    fontFamily: "Menlo",
    marginTop: 6,
  },
  timeline: {
    flexDirection: "row",
    alignItems: "flex-end",
    flexWrap: "wrap",
    gap: 1,
    paddingVertical: 6,
  },
  bar: {
    width: 3,
    borderRadius: 1,
  },
  buttonRow: { gap: 8 },
  button: {
    backgroundColor: "#6366F1",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 6,
    borderCurve: "continuous",
  },
  stopButton: { backgroundColor: "#DC2626" },
  buttonDisabled: { backgroundColor: "#3F3F50", opacity: 0.5 },
  buttonText: { color: "#F1F1F4", fontWeight: "600", fontSize: 14, textAlign: "center" },
});
