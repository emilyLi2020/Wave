// Whisper STT test page — isolated mic → transcript path.
//
// Flow:
//   1. Download ggml-tiny.en.bin (~78 MB) from HF on first launch, cache in
//      documentDirectory + 'wave-models/whisper/'.
//   2. initWhisper({ filePath, useGpu: true }) — Metal on iOS.
//   3. expo-audio's useAudioRecorder captures mic audio to a WAV file.
//   4. whisper.rn's transcribe(filePath, { language: 'en' }) on stop.
//   5. Report transcript + recording duration + transcription wall time.
//
// CoreML encoder is deferred. CoreML requires a separate bundled model
// directory (weights/weight.bin, model.mil, coremldata.bin) that the
// example app pulls via require(); plain ggml on Metal is faster to wire
// for the first smoke. CoreML can drop in later via the coreMLModelAsset
// option and the encoder will move from GPU to ANE.

import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  AudioModule,
  RecordingPresets,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { initWhisper, type WhisperContext } from "whisper.rn";

import { ensureModel } from "@/runtime/model-cache";

type Phase =
  | "idle"
  | "downloading"
  | "loading"
  | "ready"
  | "recording"
  | "transcribing"
  | "done"
  | "error";

function fmtMs(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(0)}ms`;
}

export default function WhisperTestScreen() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [downloadPct, setDownloadPct] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [recDurationMs, setRecDurationMs] = useState(0);
  const [transcribeMs, setTranscribeMs] = useState(0);

  const ctxRef = useRef<WhisperContext | null>(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recState = useAudioRecorderState(recorder);

  // Cleanup whisper context on unmount.
  useEffect(() => {
    return () => {
      ctxRef.current?.release().catch(() => {});
    };
  }, []);

  const ensurePermission = async (): Promise<boolean> => {
    const status = await AudioModule.requestRecordingPermissionsAsync();
    if (!status.granted) {
      Alert.alert(
        "Microphone permission required",
        "Wave needs the mic to test on-device STT. Grant it in Settings.",
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
      localPath = await ensureModel("whisper-tiny-en", {
        onProgress: (p) => {
          setDownloadPct(p);
          if (p >= 1) setPhase("loading");
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
      return;
    }

    setPhase("loading");
    try {
      ctxRef.current = await initWhisper({
        filePath: localPath,
        useGpu: true,
      });
      setPhase("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  };

  const onRecord = async () => {
    setError(null);
    setTranscript("");
    if (!(await ensurePermission())) return;
    try {
      await recorder.prepareToRecordAsync();
      recorder.record();
      setPhase("recording");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  };

  const onStopAndTranscribe = async () => {
    if (!ctxRef.current) {
      setError("Whisper not loaded yet");
      setPhase("error");
      return;
    }
    try {
      const startedAt = Date.now();
      await recorder.stop();
      const stopAt = Date.now();
      const rec = recState.durationMillis ?? stopAt - startedAt;
      setRecDurationMs(rec);
      const uri = recorder.uri;
      if (!uri) {
        setError("recorder produced no uri");
        setPhase("error");
        return;
      }

      setPhase("transcribing");
      const t0 = Date.now();
      const { promise } = ctxRef.current.transcribe(uri, { language: "en" });
      const { result } = await promise;
      const t1 = Date.now();
      setTranscript(result);
      setTranscribeMs(t1 - t0);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  };

  const isBusy =
    phase === "downloading" ||
    phase === "loading" ||
    phase === "recording" ||
    phase === "transcribing";

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    >
      <Text style={styles.sub} selectable>
        whisper.rn + ggml-tiny.en + Metal GPU. Mic → transcript end-to-end on iPhone.
      </Text>

      <View style={styles.statusRow}>
        <Text style={styles.statusLabel}>Phase:</Text>
        <Text style={[styles.statusValue, phaseStyle(phase)]}>{phase}</Text>
        {isBusy && <ActivityIndicator size="small" style={{ marginLeft: 8 }} />}
      </View>

      {phase === "downloading" && (
        <Text style={styles.kv}>Download: {(downloadPct * 100).toFixed(1)}%</Text>
      )}

      {recState.isRecording && (
        <Text style={styles.kv}>
          Recording: {((recState.durationMillis ?? 0) / 1000).toFixed(1)}s
        </Text>
      )}

      {phase === "done" && (
        <View style={styles.panel}>
          <Text style={styles.panelHead}>Timing</Text>
          <Text selectable style={styles.kv}>Recording length: {fmtMs(recDurationMs)}</Text>
          <Text selectable style={styles.kv}>Transcription wall: {fmtMs(transcribeMs)}</Text>
          <Text selectable style={styles.kv}>
            RTF: {recDurationMs > 0 ? (transcribeMs / recDurationMs).toFixed(2) : "—"}
          </Text>
        </View>
      )}

      {error && (
        <View style={[styles.panel, styles.errorPanel]}>
          <Text style={styles.panelHead}>Error</Text>
          <Text selectable style={styles.errorText}>{error}</Text>
        </View>
      )}

      <View style={styles.buttonRow}>
        <Pressable
          style={[styles.button, isBusy && styles.buttonDisabled]}
          disabled={isBusy}
          onPress={onLoad}
        >
          <Text style={styles.buttonText}>1. Download + Load model</Text>
        </Pressable>

        <Pressable
          style={[
            styles.button,
            (phase !== "ready" && phase !== "done") && styles.buttonDisabled,
          ]}
          disabled={phase !== "ready" && phase !== "done"}
          onPress={onRecord}
        >
          <Text style={styles.buttonText}>2. Record</Text>
        </Pressable>

        <Pressable
          style={[
            styles.button,
            phase !== "recording" && styles.buttonDisabled,
          ]}
          disabled={phase !== "recording"}
          onPress={onStopAndTranscribe}
        >
          <Text style={styles.buttonText}>3. Stop + transcribe</Text>
        </Pressable>
      </View>

      {transcript.length > 0 && (
        <View style={styles.panel}>
          <Text style={styles.panelHead}>Transcript</Text>
          <Text selectable style={styles.outputText}>
            {transcript}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

function phaseStyle(p: Phase) {
  switch (p) {
    case "done":
      return { color: "#34D399" };
    case "error":
      return { color: "#F87171" };
    case "ready":
      return { color: "#22D3EE" };
    case "recording":
    case "transcribing":
    case "loading":
    case "downloading":
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
  outputText: { color: "#F1F1F4", fontSize: 14, lineHeight: 20 },
  errorText: { color: "#F87171", fontSize: 13, fontFamily: "Menlo" },
  buttonRow: { gap: 8 },
  button: {
    backgroundColor: "#6366F1",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 6,
    borderCurve: "continuous",
  },
  buttonDisabled: { backgroundColor: "#3F3F50", opacity: 0.5 },
  buttonText: { color: "#F1F1F4", fontWeight: "600", fontSize: 14, textAlign: "center" },
});
