// Kokoro TTS test page — text → streaming audio via react-native-sherpa-onnx.
//
// Pinned to kokoro-en-v0_19 (fp32, 304 MB) — the empirical winner on
// iPhone across TTFB, RTF, and audio cleanliness. CoreML EP on Apple
// Silicon has no general int8 fast-path for arbitrary ops, so fp32
// actually outperforms int8 here; v0.19 int8 also has a known
// high-pitch quantization artifact.
//
// Playback uses sherpa's built-in native PCM player (startPcmPlayer +
// writePcmChunk + stopPcmPlayer). Sherpa splits the input into sentences
// internally; each sentence emits an onChunk as soon as it's synthesized,
// and we hand the float samples straight to the native audio queue —
// no temp WAV files, no expo-audio round-trip. Streaming is
// sentence-granularity, not within-sentence (Kokoro generates a sentence
// in one forward pass), so for multi-sentence text TTFB drops to
// per-sentence latency instead of total-paragraph latency.

import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { setAudioModeAsync } from "expo-audio";

// Lazy-import — react-native-sherpa-onnx pulls in native bindings only
// resolved on device. Keeps Metro from crashing on web/dev imports.
type StreamingTtsEngine = {
  generateSpeechStream: (
    text: string,
    opts: unknown,
    handlers: {
      onChunk?: (c: { samples: number[]; sampleRate: number; isFinal: boolean }) => void;
      onEnd?: (e: { cancelled: boolean }) => void;
      onError?: (e: { message: string }) => void;
    }
  ) => Promise<{ cancel: () => Promise<void> }>;
  cancelSpeechStream: () => Promise<void>;
  startPcmPlayer: (sampleRate: number, channels: number) => Promise<void>;
  writePcmChunk: (samples: number[]) => Promise<void>;
  stopPcmPlayer: () => Promise<void>;
  destroy: () => Promise<void>;
};

const DEFAULT_TEXT =
  "Welcome back. Take a breath. We're going to surf this together. " +
  "Notice the air moving in, and the air moving out. Nothing else needs to happen right now.";

// Asset id in the k2-fsa/sherpa-onnx 'tts-models' release.
const KOKORO_MODEL_ID = "kokoro-en-v0_19";

type Phase =
  | "idle"
  | "downloading"
  | "extracting"
  | "loading"
  | "ready"
  | "speaking"
  | "played"
  | "error";

type ChunkStats = {
  count: number;
  totalSamples: number;
  ttfbMs: number;
  totalMs: number;
  sampleRate: number;
};

const EMPTY_STATS: ChunkStats = {
  count: 0,
  totalSamples: 0,
  ttfbMs: 0,
  totalMs: 0,
  sampleRate: 0,
};

export default function KokoroTestScreen() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [text, setText] = useState(DEFAULT_TEXT);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<ChunkStats>(EMPTY_STATS);
  const [percent, setPercent] = useState(0);
  const [bytesDownloaded, setBytesDownloaded] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const engineRef = useRef<StreamingTtsEngine | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pcmPlayerActiveRef = useRef(false);

  // Configure the audio session so playback works even with the silent
  // switch on (sherpa's PCM player honors the app's AVAudioSession).
  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      const engine = engineRef.current;
      if (engine) {
        (async () => {
          try {
            if (pcmPlayerActiveRef.current) {
              await engine.stopPcmPlayer();
            }
          } catch {}
          try {
            await engine.destroy();
          } catch {}
        })();
      }
    };
  }, []);

  const onLoad = async () => {
    setError(null);
    setPercent(0);
    setBytesDownloaded(0);
    setTotalBytes(0);
    setPhase("downloading");
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const sherpaDownload: any = await import(
        "react-native-sherpa-onnx/download"
      );
      const sherpaTts: any = await import("react-native-sherpa-onnx/tts");

      // ensureModelByCategory only reads the on-disk registry cache; on a
      // fresh install it's empty and every id is "unknown". refresh first.
      await sherpaDownload.refreshModelsByCategory(
        sherpaDownload.ModelCategory.Tts,
        { signal: controller.signal }
      );

      const result = await sherpaDownload.ensureModelByCategory(
        sherpaDownload.ModelCategory.Tts,
        KOKORO_MODEL_ID,
        {
          signal: controller.signal,
          onProgress: (p: {
            percent: number;
            bytesDownloaded: number;
            totalBytes: number;
            phase?: "downloading" | "extracting";
          }) => {
            setPercent(p.percent);
            setBytesDownloaded(p.bytesDownloaded);
            setTotalBytes(p.totalBytes);
            if (p.phase === "extracting") setPhase("extracting");
            else if (p.phase === "downloading") setPhase("downloading");
          },
        }
      );

      setPhase("loading");
      const tts = (await sherpaTts.createStreamingTTS({
        modelPath: { type: "file", path: result.localPath },
        modelType: "kokoro",
        providers: ["CoreMLExecutionProvider"],
      })) as StreamingTtsEngine;
      engineRef.current = tts;
      setPhase("ready");
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onCancelDownload = () => {
    abortRef.current?.abort();
    setPhase("idle");
  };

  const onSpeak = async () => {
    const engine = engineRef.current;
    if (!engine) {
      setError("Kokoro not loaded yet");
      setPhase("error");
      return;
    }
    setError(null);
    setStats(EMPTY_STATS);
    setPhase("speaking");

    const t0 = Date.now();
    let firstChunkAt = 0;
    let chunkCount = 0;
    let totalSamples = 0;
    let playerSampleRate = 0;

    try {
      await new Promise<void>((resolve, reject) => {
        engine
          .generateSpeechStream(text, undefined, {
            onChunk: (c) => {
              // Lazy-start the player with the chunk's actual sample rate.
              // getSampleRate() can disagree with what the model emits per
              // chunk; trusting the chunk avoids resampling artifacts.
              if (firstChunkAt === 0) {
                firstChunkAt = Date.now();
                playerSampleRate = c.sampleRate;
                setStats((s) => ({
                  ...s,
                  ttfbMs: firstChunkAt - t0,
                  sampleRate: c.sampleRate,
                }));
                engine
                  .startPcmPlayer(c.sampleRate, 1)
                  .then(() => {
                    pcmPlayerActiveRef.current = true;
                    return engine.writePcmChunk(c.samples);
                  })
                  .catch(() => {});
              } else {
                if (c.sampleRate !== playerSampleRate) {
                  console.warn(
                    `[Kokoro] chunk sampleRate ${c.sampleRate} != player ${playerSampleRate}`
                  );
                }
                engine.writePcmChunk(c.samples).catch(() => {});
              }
              chunkCount += 1;
              totalSamples += c.samples.length;
              setStats((s) => ({
                ...s,
                count: chunkCount,
                totalSamples,
              }));
            },
            onEnd: (e) => {
              if (e.cancelled) {
                reject(new Error("Generation cancelled"));
              } else {
                resolve();
              }
            },
            onError: (e) => reject(new Error(e.message)),
          })
          .catch(reject);
      });

      const totalMs = Date.now() - t0;
      setStats((s) => ({
        ...s,
        count: chunkCount,
        totalSamples,
        totalMs,
        sampleRate: playerSampleRate || 24_000,
      }));
      setPhase("played");

      // Wait for the scheduled audio queue to drain before stopping;
      // [player stop] discards unplayed buffers otherwise.
      const audioMs =
        (totalSamples / (playerSampleRate || 24_000)) * 1000;
      const elapsedSinceFirstChunk = Date.now() - firstChunkAt;
      const drainMs = Math.max(0, audioMs - elapsedSinceFirstChunk) + 200;
      setTimeout(() => {
        engine.stopPcmPlayer().catch(() => {});
        pcmPlayerActiveRef.current = false;
      }, drainMs);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
      try {
        await engine.stopPcmPlayer();
      } catch {}
      pcmPlayerActiveRef.current = false;
    }
  };

  const onCancelSpeak = async () => {
    const engine = engineRef.current;
    if (!engine) return;
    try {
      await engine.cancelSpeechStream();
    } catch {}
  };

  const isDownloading = phase === "downloading" || phase === "extracting";
  const isBusy = isDownloading || phase === "loading" || phase === "speaking";

  const fmtMb = (b: number) => (b / 1024 / 1024).toFixed(1);
  const audioSec =
    stats.totalSamples > 0 && stats.sampleRate > 0
      ? stats.totalSamples / stats.sampleRate
      : 0;
  const rtf =
    audioSec > 0 && stats.totalMs > 0 ? stats.totalMs / 1000 / audioSec : 0;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    >
      <Text style={styles.sub} selectable>
        Kokoro {KOKORO_MODEL_ID} (fp32, CoreML EP). Sentence-streaming
        playback via sherpa's native PCM queue.
      </Text>

      <View style={styles.statusRow}>
        <Text style={styles.statusLabel}>Phase:</Text>
        <Text style={[styles.statusValue, phaseStyle(phase)]}>{phase}</Text>
        {isBusy && <ActivityIndicator size="small" style={{ marginLeft: 8 }} />}
      </View>

      {isDownloading && (
        <View style={styles.panel}>
          <Text style={styles.panelHead}>
            {phase === "extracting" ? "Extracting" : "Downloading"} {KOKORO_MODEL_ID}
          </Text>
          <Text style={styles.bodyText}>
            {percent.toFixed(1)}%
            {totalBytes > 0
              ? ` — ${fmtMb(bytesDownloaded)} / ${fmtMb(totalBytes)} MB`
              : ""}
          </Text>
          <Text style={[styles.bodyText, styles.subtle, { marginTop: 4 }]}>
            Saved to Documents/sherpa-onnx/models/tts/{KOKORO_MODEL_ID}/. Resumes
            on relaunch if interrupted.
          </Text>
          <Pressable
            style={[styles.button, styles.cancelButton, { marginTop: 8 }]}
            onPress={onCancelDownload}
          >
            <Text style={styles.buttonText}>Cancel</Text>
          </Pressable>
        </View>
      )}

      {(phase === "speaking" || phase === "played") && (
        <View style={styles.panel}>
          <Text style={styles.panelHead}>Streaming stats</Text>
          <Text selectable style={styles.kv}>
            Time to first chunk: {stats.ttfbMs > 0 ? `${stats.ttfbMs} ms` : "—"}
          </Text>
          <Text selectable style={styles.kv}>
            Chunks: {stats.count}
          </Text>
          <Text selectable style={styles.kv}>
            Audio: {audioSec > 0 ? `${audioSec.toFixed(2)} s @ ${stats.sampleRate} Hz` : "—"}
          </Text>
          <Text selectable style={styles.kv}>
            Total gen: {stats.totalMs > 0 ? `${stats.totalMs} ms` : "—"}
          </Text>
          <Text selectable style={styles.kv}>
            RTF: {rtf > 0 ? `${rtf.toFixed(3)} (${(1 / rtf).toFixed(2)}× real-time)` : "—"}
          </Text>
        </View>
      )}

      {error && (
        <View style={[styles.panel, styles.errorPanel]}>
          <Text style={styles.panelHead}>Error</Text>
          <Text selectable style={styles.errorText}>{error}</Text>
        </View>
      )}

      <Text style={styles.label}>Text to synthesize</Text>
      <TextInput
        style={styles.textInput}
        multiline
        value={text}
        onChangeText={setText}
        placeholder="Type something Kokoro should speak…"
        placeholderTextColor="#6B7280"
      />

      <View style={styles.buttonRow}>
        <Pressable
          style={[styles.button, isBusy && styles.buttonDisabled]}
          disabled={isBusy}
          onPress={onLoad}
        >
          <Text style={styles.buttonText}>1. Download + Load Kokoro</Text>
        </Pressable>

        <Pressable
          style={[
            styles.button,
            phase !== "ready" && phase !== "played" && styles.buttonDisabled,
          ]}
          disabled={phase !== "ready" && phase !== "played"}
          onPress={onSpeak}
        >
          <Text style={styles.buttonText}>2. Speak (streaming)</Text>
        </Pressable>

        {phase === "speaking" && (
          <Pressable
            style={[styles.button, styles.cancelButton]}
            onPress={onCancelSpeak}
          >
            <Text style={styles.buttonText}>Stop</Text>
          </Pressable>
        )}
      </View>
    </ScrollView>
  );
}

function phaseStyle(p: Phase) {
  switch (p) {
    case "played":
      return { color: "#34D399" };
    case "error":
      return { color: "#F87171" };
    case "ready":
      return { color: "#22D3EE" };
    case "speaking":
    case "loading":
    case "downloading":
    case "extracting":
      return { color: "#FBBF24" };
    default:
      return { color: "#9CA3AF" };
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#08080C" },
  content: { padding: 16, gap: 12 },
  sub: { color: "#9CA3AF", fontSize: 13 },
  subtle: { fontSize: 12, color: "#9CA3AF" },
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
  bodyText: { color: "#F1F1F4", fontSize: 13, lineHeight: 18 },
  errorText: { color: "#F87171", fontSize: 13, fontFamily: "Menlo" },
  label: { color: "#9CA3AF", fontSize: 12, marginTop: 4 },
  textInput: {
    backgroundColor: "#16161F",
    borderWidth: 1,
    borderColor: "#23232F",
    borderRadius: 6,
    borderCurve: "continuous",
    padding: 10,
    color: "#F1F1F4",
    fontSize: 14,
    minHeight: 80,
    textAlignVertical: "top",
  },
  buttonRow: { gap: 8 },
  button: {
    backgroundColor: "#6366F1",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 6,
    borderCurve: "continuous",
  },
  buttonDisabled: { backgroundColor: "#3F3F50", opacity: 0.5 },
  cancelButton: { backgroundColor: "#7F1D1D" },
  buttonText: { color: "#F1F1F4", fontWeight: "600", fontSize: 14, textAlign: "center" },
});
