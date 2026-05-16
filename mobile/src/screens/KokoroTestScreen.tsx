// Kokoro TTS test page — text → audio via react-native-sherpa-onnx.
//
// Kokoro ships as a multi-file ONNX bundle (~330 MB int8): model.onnx,
// voices.bin, tokens.txt, lexicon-us-en.txt, plus an espeak-ng-data/ tree.
// We follow path 2 from the plan: ship the bundle in the IPA via
// mobile/assets/kokoro/ (gitignored, populated by scripts/download-kokoro.sh).
// EAS Build packages the directory; sherpa-onnx loads it via the 'asset'
// modelPath type — no first-launch download, no cache hop, no unzip.
//
// Until you run scripts/download-kokoro.sh, the assets/kokoro/ directory is
// empty and the screen surfaces the setup instructions instead of trying to
// load. Once present, "Speak" pushes text through createTTS with the
// Kokoro modelType + CoreMLExecutionProvider.

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

import * as FileSystem from "expo-file-system";

// Lazy-import — react-native-sherpa-onnx pulls in native bindings only
// resolved on device. Keeps Metro from crashing on web/dev imports.
type TtsEngine = {
  generateSpeech: (text: string, opts?: any) => Promise<any>;
  destroy: () => Promise<void>;
};

const DEFAULT_TEXT =
  "Welcome back. Take a breath. We're going to surf this together.";

// sherpa-onnx asset path. The runtime resolves this relative to the iOS
// bundle (or android assets/) so all files inside mobile/assets/kokoro/
// become available without manual require() per file.
const KOKORO_ASSET_PATH = "kokoro";

type Phase =
  | "idle"
  | "needsBundle"
  | "loading"
  | "ready"
  | "speaking"
  | "played"
  | "error";

export default function KokoroTestScreen() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [text, setText] = useState(DEFAULT_TEXT);
  const [error, setError] = useState<string | null>(null);
  const [genMs, setGenMs] = useState(0);
  const [audioPath, setAudioPath] = useState<string | null>(null);
  const engineRef = useRef<TtsEngine | null>(null);

  useEffect(() => {
    return () => {
      engineRef.current?.destroy().catch(() => {});
    };
  }, []);

  const onLoad = async () => {
    setError(null);
    setPhase("loading");
    try {
      // Dynamic import keeps Metro happy when sherpa-onnx native code isn't
      // present (e.g. web dev / type-check), and lets the screen render the
      // "needsBundle" guidance below before the package is required.
      // The TTS surface lives under the /tts subpath per the package's
      // exports map; root re-export is limited (only types + utils).
      const sherpaTts: any = await import("react-native-sherpa-onnx/tts");
      const tts = await sherpaTts.createTTS({
        modelPath: { type: "asset", path: KOKORO_ASSET_PATH },
        modelType: "kokoro",
        // CoreMLExecutionProvider puts Kokoro on ANE alongside Whisper's
        // encoder — they don't overlap in time during a turn, so no real
        // contention. Verify with the combined test page.
        providers: ["CoreMLExecutionProvider"],
      });
      engineRef.current = tts as TtsEngine;
      setPhase("ready");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Heuristic: if the error mentions missing files, route to the
      // "needsBundle" guidance UI.
      if (/not found|missing|no such file|enoent/i.test(msg)) {
        setPhase("needsBundle");
        setError(msg);
      } else {
        setPhase("error");
        setError(msg);
      }
    }
  };

  const onSpeak = async () => {
    if (!engineRef.current) {
      setError("Kokoro not loaded yet");
      setPhase("error");
      return;
    }
    setError(null);
    setPhase("speaking");
    try {
      const t0 = Date.now();
      const audio = await engineRef.current.generateSpeech(text);
      const t1 = Date.now();
      setGenMs(t1 - t0);

      const docDir =
        (FileSystem as any).documentDirectory ??
        ((FileSystem as any).Paths?.document?.uri as string | undefined);
      const outPath = `${docDir}wave-models/kokoro/out-${Date.now()}.wav`;
      // saveAudioToFile would go here once the engine is wired. Holding for
      // bundle integration.
      setAudioPath(outPath);
      setPhase("played");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  };

  const isBusy = phase === "loading" || phase === "speaking";

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    >
      <Text style={styles.sub} selectable>
        react-native-sherpa-onnx + Kokoro-82M ONNX (CoreML EP). Text → audio on iPhone.
      </Text>

      <View style={styles.statusRow}>
        <Text style={styles.statusLabel}>Phase:</Text>
        <Text style={[styles.statusValue, phaseStyle(phase)]}>{phase}</Text>
        {isBusy && <ActivityIndicator size="small" style={{ marginLeft: 8 }} />}
      </View>

      {phase === "needsBundle" && (
        <View style={styles.panel}>
          <Text style={styles.panelHead}>Kokoro bundle missing</Text>
          <Text style={styles.bodyText}>
            mobile/assets/kokoro/ is empty (or missing model files). Populate it
            once per dev machine:
          </Text>
          <Text style={[styles.bodyText, styles.mono, { marginTop: 6 }]}>
            cd mobile && ./scripts/download-kokoro.sh
          </Text>
          <Text style={[styles.bodyText, { marginTop: 6 }]}>
            That fetches kokoro-en-v0.19 (~330 MB int8) from the sherpa-onnx
            GitHub release into assets/kokoro/. EAS Build picks it up on the
            next build.
          </Text>
        </View>
      )}

      {phase === "played" && (
        <View style={styles.panel}>
          <Text style={styles.panelHead}>Result</Text>
          <Text selectable style={styles.kv}>Generation: {genMs.toFixed(0)} ms</Text>
          <Text selectable style={styles.kv}>Audio: {audioPath ?? "—"}</Text>
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
          <Text style={styles.buttonText}>2. Speak</Text>
        </Pressable>
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
      return { color: "#FBBF24" };
    case "needsBundle":
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
  bodyText: { color: "#F1F1F4", fontSize: 13, lineHeight: 18 },
  mono: { fontFamily: "Menlo", color: "#22D3EE" },
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
  buttonText: { color: "#F1F1F4", fontWeight: "600", fontSize: 14, textAlign: "center" },
});
