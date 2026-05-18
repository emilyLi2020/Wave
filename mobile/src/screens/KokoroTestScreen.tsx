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

import {
  SentenceChunkBuffer,
  AsyncTextChunkStream,
} from "@/voice/sentence-buffer";

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

  // ── Streaming sandbox (issue #25): simulate an LLM token stream →
  // SentenceChunkBuffer → one generateSpeechStream per sentence into a
  // single shared PCM player. Also a back-to-back engine-reuse repro to
  // isolate the loop's "2nd turn no voice" (does call N>1 emit chunks?).
  const STREAM_DEFAULT =
    "Okay, a six. That tightness in your chest makes a lot of sense " +
    "right now. You stayed with it instead of reaching for something, " +
    "and that matters. What's the urge doing as you breathe? " +
    "Take your time. We can sit here as long as you need.";
  const [streamText, setStreamText] = useState(STREAM_DEFAULT);
  const [streamPhase, setStreamPhase] = useState<
    "idle" | "running" | "done" | "error"
  >("idle");
  const [streamLog, setStreamLog] = useState<
    { idx: number; text: string; chunks: number; ms: number }[]
  >([]);
  const [streamSummary, setStreamSummary] = useState<{
    mode: string;
    ttfaMs: number;
    totalMs: number;
    sentences: number;
    zeroChunkCalls: number;
  } | null>(null);
  const streamCancelRef = useRef(false);

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

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // One generateSpeechStream call into the shared player. Resolves on
  // onEnd; returns chunk/sample counts so a 0-chunk call is observable.
  const genOnce = (
    engine: StreamingTtsEngine,
    sentence: string,
    onFirstAudio: () => void,
  ): Promise<{ chunks: number; samples: number; ms: number; sr: number }> => {
    const g0 = Date.now();
    let chunks = 0;
    let samples = 0;
    let sr = 0;
    return new Promise((resolve) => {
      let settled = false;
      const fin = () => {
        if (settled) return;
        settled = true;
        resolve({ chunks, samples, ms: Date.now() - g0, sr });
      };
      engine
        .generateSpeechStream(sentence, undefined, {
          onChunk: (c) => {
            if (chunks === 0) {
              sr = c.sampleRate;
              onFirstAudio();
            }
            if (!pcmPlayerActiveRef.current) {
              pcmPlayerActiveRef.current = true;
              engine
                .startPcmPlayer(c.sampleRate, 1)
                .then(() => engine.writePcmChunk(c.samples))
                .catch(() => {});
            } else {
              engine.writePcmChunk(c.samples).catch(() => {});
            }
            chunks += 1;
            samples += c.samples.length;
          },
          onEnd: () => fin(),
          onError: () => fin(),
        })
        .catch(() => fin());
    });
  };

  const stopSharedPlayer = async (engine: StreamingTtsEngine) => {
    if (!pcmPlayerActiveRef.current) return;
    try {
      await engine.stopPcmPlayer();
    } catch {}
    pcmPlayerActiveRef.current = false;
  };

  // The LLM always streams word-by-word (45 ms/word ≈ 22 tok/s). What
  // changes between tests is the TTS chunk granularity:
  //   wordThreshold 12 → "sentence" stream (fewer, larger gen calls)
  //   wordThreshold 2  → "word-by-word" stream (many tiny gen calls,
  //                       lowest TTFA, tests choppiness + reuse stress)
  // Both pipeline: producer keeps streaming while audio of earlier
  // chunks plays.
  const runStream = async (wordThreshold: number, mode: string) => {
    const engine = engineRef.current;
    if (!engine) {
      setError("Kokoro not loaded yet");
      return;
    }
    setError(null);
    setStreamLog([]);
    setStreamSummary(null);
    setStreamPhase("running");
    streamCancelRef.current = false;

    const buf = new SentenceChunkBuffer(wordThreshold);
    const stream = new AsyncTextChunkStream();
    const words = streamText.trim().split(/\s+/);
    const t0 = Date.now();
    let ttfaMs = 0;
    let zeroChunkCalls = 0;
    const log: { idx: number; text: string; chunks: number; ms: number }[] = [];

    // Producer: 45 ms/word ≈ a ~22 tok/s LLM.
    (async () => {
      for (const w of words) {
        if (streamCancelRef.current) break;
        for (const s of buf.push(w + " ")) stream.enqueue(s);
        await sleep(45);
      }
      for (const s of buf.flush()) stream.enqueue(s);
      stream.close();
    })();

    try {
      let idx = 0;
      for await (const sentence of stream) {
        if (streamCancelRef.current) break;
        idx += 1;
        const r = await genOnce(engine, sentence, () => {
          if (ttfaMs === 0) ttfaMs = Date.now() - t0;
        });
        if (r.chunks === 0) zeroChunkCalls += 1;
        log.push({ idx, text: sentence, chunks: r.chunks, ms: r.ms });
        setStreamLog([...log]);
      }
      setStreamSummary({
        mode,
        ttfaMs,
        totalMs: Date.now() - t0,
        sentences: log.length,
        zeroChunkCalls,
      });
      setStreamPhase(streamCancelRef.current ? "idle" : "done");
      // let the last chunk's audio drain, then stop the shared player
      setTimeout(() => void stopSharedPlayer(engine), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStreamPhase("error");
      await stopSharedPlayer(engine);
    }
  };

  const onSentenceStream = () => runStream(12, "sentence");
  const onWordStream = () => runStream(2, "word-by-word");

  // Back-to-back reuse: does generateSpeechStream produce chunks on
  // call 2 and 3 on the same engine? Directly repros the loop's
  // "2nd turn no voice" in isolation from the LLM.
  const onReproReuse = async () => {
    const engine = engineRef.current;
    if (!engine) {
      setError("Kokoro not loaded yet");
      return;
    }
    setError(null);
    setStreamLog([]);
    setStreamSummary(null);
    setStreamPhase("running");
    streamCancelRef.current = false;
    const phrases = [
      "This is the first reply.",
      "This is the second reply.",
      "This is the third reply.",
    ];
    const t0 = Date.now();
    let zeroChunkCalls = 0;
    const log: { idx: number; text: string; chunks: number; ms: number }[] = [];
    try {
      for (let i = 0; i < phrases.length; i++) {
        if (streamCancelRef.current) break;
        const r = await genOnce(engine, phrases[i]!, () => {});
        if (r.chunks === 0) zeroChunkCalls += 1;
        log.push({ idx: i + 1, text: phrases[i]!, chunks: r.chunks, ms: r.ms });
        setStreamLog([...log]);
        await sleep(300);
      }
      setStreamSummary({
        mode: "engine-reuse",
        ttfaMs: 0,
        totalMs: Date.now() - t0,
        sentences: log.length,
        zeroChunkCalls,
      });
      setStreamPhase("done");
      setTimeout(() => void stopSharedPlayer(engine), 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStreamPhase("error");
      await stopSharedPlayer(engine);
    }
  };

  const onStopStream = async () => {
    streamCancelRef.current = true;
    const engine = engineRef.current;
    if (engine) {
      try {
        await engine.cancelSpeechStream();
      } catch {}
      await stopSharedPlayer(engine);
    }
    setStreamPhase("idle");
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
        playback via sherpa’s native PCM queue.
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

      {/* ── Streaming sandbox (issue #25) ───────────────────────────── */}
      <View style={styles.panel}>
        <Text style={styles.panelHead}>Streaming sandbox (#25)</Text>
        <Text style={[styles.bodyText, styles.subtle]}>
          The LLM streams word-by-word either way; the test varies TTS
          granularity. “Sentence” = chunk at sentence ends (fewer, larger
          gen calls). “Word-by-word” = ~2-word chunks (lowest TTFA, many
          tiny gen calls — tests choppiness + reuse stress). “Engine reuse
          ×3” isolates the loop’s 2nd-turn-no-voice: if call 2/3 show 0
          chunks, that’s the bug — independent of the LLM. Compare TTFA.
        </Text>
      </View>

      <TextInput
        style={styles.textInput}
        multiline
        value={streamText}
        onChangeText={setStreamText}
        placeholder="LLM reply to simulate streaming…"
        placeholderTextColor="#6B7280"
      />

      <View style={styles.buttonRow}>
        {(
          [
            ["Sentence stream", onSentenceStream],
            ["Word-by-word stream", onWordStream],
            ["Engine reuse ×3 (repro)", onReproReuse],
          ] as const
        ).map(([label, fn]) => {
          const disabled =
            (phase !== "ready" && phase !== "played") ||
            streamPhase === "running";
          return (
            <Pressable
              key={label}
              style={[styles.button, disabled && styles.buttonDisabled]}
              disabled={disabled}
              onPress={fn}
            >
              <Text style={styles.buttonText}>{label}</Text>
            </Pressable>
          );
        })}

        {streamPhase === "running" && (
          <Pressable
            style={[styles.button, styles.cancelButton]}
            onPress={onStopStream}
          >
            <Text style={styles.buttonText}>Stop streaming</Text>
          </Pressable>
        )}
      </View>

      {(streamLog.length > 0 || streamSummary) && (
        <View style={styles.panel}>
          <Text style={styles.panelHead}>
            Streaming result · {streamSummary?.mode ?? "—"} ({streamPhase})
          </Text>
          {streamSummary && (
            <Text
              selectable
              style={[
                styles.kv,
                streamSummary.zeroChunkCalls > 0 && { color: "#F87171" },
              ]}
            >
              {streamSummary.sentences} calls · TTFA{" "}
              {streamSummary.ttfaMs > 0 ? `${streamSummary.ttfaMs} ms` : "—"} ·
              total {streamSummary.totalMs} ms · zero-chunk calls{" "}
              {streamSummary.zeroChunkCalls}
              {streamSummary.zeroChunkCalls > 0
                ? "  ⚠ engine-reuse bug reproduced"
                : "  ✓ all calls produced audio"}
            </Text>
          )}
          {streamLog.map((r) => (
            <Text
              key={r.idx}
              selectable
              style={[styles.kv, r.chunks === 0 && { color: "#F87171" }]}
            >
              #{r.idx} · {r.chunks} chunks · {r.ms} ms ·{" "}
              {r.chunks === 0 ? "⚠ SILENT — " : ""}
              {r.text.length > 48 ? `${r.text.slice(0, 48)}…` : r.text}
            </Text>
          ))}
        </View>
      )}
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
