// Combined voice loop test page — wires VAD-eventually + STT + LLM + TTS
// in a single screen so we can verify the integration before pulling the
// loop into the production CheckInScreen.
//
// Scope of this first pass:
//   - PUSH-TO-TALK only. No VAD-driven auto-listen, no barge-in.
//     VAD comes in step 5a after this screen confirms the three subsystems
//     pipe into each other cleanly.
//   - Single-turn round-trip: record → STT → LLM → TTS → play.
//     Multi-turn history threading is a follow-up.
//   - Generic chat system prompt — NOT the WAVE check-in prompt. We're
//     proving the wiring; clinical correctness happens when this gets
//     pulled into CheckInScreen with buildCheckInPrompt() in step 5c.
//
// Pipeline state machine:
//   idle → recording → transcribing → generating → speaking → idle
//                                                    ^
//   Errors at any step return to idle with the error surfaced.

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
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioRecorder,
} from "expo-audio";
import { Paths } from "expo-file-system";
import { initWhisper, type WhisperContext } from "whisper.rn";

import { preloadWaveLiteRT } from "@/runtime/litert-generators";
import { ensureModel } from "@/runtime/model-cache";

const KOKORO_ASSET_PATH = "kokoro";

// A short, friendly system prompt — keeps responses tight so the round-trip
// finishes fast enough to feel conversational. Real WAVE prompts plug in
// when this loop gets wired into the production CheckInScreen.
const SYSTEM_PROMPT =
  "You are a friendly assistant. Reply in one or two short sentences. Plain prose only — no markdown, no lists, no emoji.";

type Phase =
  | "idle"
  | "loading"
  | "ready"
  | "recording"
  | "transcribing"
  | "generating"
  | "speaking"
  | "error";

interface SubsystemState {
  litert: "missing" | "loading" | "ready" | "error";
  whisper: "missing" | "loading" | "ready" | "error";
  kokoro: "missing" | "loading" | "ready" | "error";
}

function fmtMs(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(0)}ms`;
}

export default function CombinedVoiceTestScreen() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [subsystems, setSubsystems] = useState<SubsystemState>({
    litert: "missing",
    whisper: "missing",
    kokoro: "missing",
  });
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [llmReply, setLlmReply] = useState("");
  const [audioUri, setAudioUri] = useState<string | null>(null);
  const [stats, setStats] = useState({
    sttMs: 0,
    llmMs: 0,
    ttsMs: 0,
  });

  const whisperRef = useRef<WhisperContext | null>(null);
  const ttsRef = useRef<any>(null);
  const llmReadyRef = useRef(false);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const player = useAudioPlayer(audioUri);

  // Configure audio session for record + playback once the screen mounts.
  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      allowsRecording: true,
    }).catch(() => {});
    return () => {
      whisperRef.current?.release().catch(() => {});
      ttsRef.current?.destroy?.().catch(() => {});
    };
  }, []);

  // Auto-play when a new audio uri lands.
  useEffect(() => {
    if (!audioUri) return;
    try {
      player.seekTo(0);
      player.play();
    } catch {
      // ignore — happens if the player isn't initialized yet
    }
  }, [audioUri, player]);

  const allReady =
    subsystems.litert === "ready" &&
    subsystems.whisper === "ready" &&
    subsystems.kokoro === "ready";

  const ensurePermission = async (): Promise<boolean> => {
    const status = await AudioModule.requestRecordingPermissionsAsync();
    if (!status.granted) {
      Alert.alert(
        "Microphone permission required",
        "The combined voice loop needs the mic. Grant access in Settings.",
      );
      return false;
    }
    return true;
  };

  const initAll = useCallback(async () => {
    setError(null);
    setPhase("loading");

    // LiteRT
    setSubsystems((s) => ({ ...s, litert: "loading" }));
    try {
      await preloadWaveLiteRT();
      llmReadyRef.current = true;
      setSubsystems((s) => ({ ...s, litert: "ready" }));
    } catch (e) {
      setSubsystems((s) => ({ ...s, litert: "error" }));
      setError(`LiteRT: ${e instanceof Error ? e.message : String(e)}`);
      setPhase("error");
      return;
    }

    // Whisper
    setSubsystems((s) => ({ ...s, whisper: "loading" }));
    try {
      const whisperPath = await ensureModel("whisper-tiny-en");
      whisperRef.current = await initWhisper({
        filePath: whisperPath,
        useGpu: true,
      });
      setSubsystems((s) => ({ ...s, whisper: "ready" }));
    } catch (e) {
      setSubsystems((s) => ({ ...s, whisper: "error" }));
      setError(`Whisper: ${e instanceof Error ? e.message : String(e)}`);
      setPhase("error");
      return;
    }

    // Kokoro
    setSubsystems((s) => ({ ...s, kokoro: "loading" }));
    try {
      const sherpa: any = await import("react-native-sherpa-onnx/tts");
      ttsRef.current = await sherpa.createTTS({
        modelPath: { type: "asset", path: KOKORO_ASSET_PATH },
        modelType: "kokoro",
        providers: ["CoreMLExecutionProvider"],
      });
      setSubsystems((s) => ({ ...s, kokoro: "ready" }));
    } catch (e) {
      setSubsystems((s) => ({ ...s, kokoro: "error" }));
      setError(`Kokoro: ${e instanceof Error ? e.message : String(e)}`);
      setPhase("error");
      return;
    }

    setPhase("ready");
  }, []);

  const startRecording = useCallback(async () => {
    if (!allReady) return;
    if (!(await ensurePermission())) return;
    setError(null);
    setTranscript("");
    setLlmReply("");
    setAudioUri(null);
    try {
      await recorder.prepareToRecordAsync();
      recorder.record();
      setPhase("recording");
    } catch (e) {
      setError(`Record: ${e instanceof Error ? e.message : String(e)}`);
      setPhase("error");
    }
  }, [allReady, recorder]);

  const stopAndRun = useCallback(async () => {
    if (phase !== "recording") return;
    setPhase("transcribing");
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error("recorder produced no uri");

      // ── STT ────────────────────────────────────────────────────────
      const sttT0 = Date.now();
      const ctx = whisperRef.current;
      if (!ctx) throw new Error("Whisper not initialized");
      const { promise } = ctx.transcribe(uri, { language: "en" });
      const { result: rawTranscript } = await promise;
      const sttMs = Date.now() - sttT0;
      const cleanTranscript = rawTranscript.trim();
      setTranscript(cleanTranscript);
      setStats((s) => ({ ...s, sttMs }));

      if (!cleanTranscript) {
        setPhase("ready");
        return;
      }

      // ── LLM ────────────────────────────────────────────────────────
      setPhase("generating");
      const llmT0 = Date.now();
      const llm = await preloadWaveLiteRT();
      llm.resetConversation();
      const reply = await new Promise<string>((resolve, reject) => {
        let acc = "";
        try {
          llm.sendMessageAsync(
            `${SYSTEM_PROMPT}\n\nUser: ${cleanTranscript}\n\nAssistant:`,
            (token, done) => {
              acc += token;
              setLlmReply(acc);
              if (done) resolve(acc);
            },
          );
        } catch (err) {
          reject(err as Error);
        }
      });
      const llmMs = Date.now() - llmT0;
      setStats((s) => ({ ...s, llmMs }));

      // ── TTS ────────────────────────────────────────────────────────
      setPhase("speaking");
      const ttsT0 = Date.now();
      const tts: any = ttsRef.current;
      if (!tts) throw new Error("Kokoro not initialized");
      const audio = await tts.generateSpeech(reply.trim());

      // saveAudioToFile writes a WAV the audio player can read.
      const sherpa: any = await import("react-native-sherpa-onnx/tts");
      const wavPath = `${Paths.document.uri}wave-models/kokoro/last-${Date.now()}.wav`;
      const savedPath = await sherpa.saveAudioToFile(audio, wavPath);
      setAudioUri(savedPath ?? wavPath);
      const ttsMs = Date.now() - ttsT0;
      setStats((s) => ({ ...s, ttsMs }));

      setPhase("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }, [phase, recorder]);

  const isBusy =
    phase === "loading" ||
    phase === "transcribing" ||
    phase === "generating" ||
    phase === "speaking";

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    >
      <Text style={styles.sub} selectable>
        VAD-less push-to-talk MVP. Record → Whisper → LiteRT → Kokoro → play.
      </Text>

      <SubsystemRow label="LiteRT" status={subsystems.litert} />
      <SubsystemRow label="Whisper" status={subsystems.whisper} />
      <SubsystemRow label="Kokoro" status={subsystems.kokoro} />

      <View style={styles.statusRow}>
        <Text style={styles.statusLabel}>Phase:</Text>
        <Text style={[styles.statusValue, phaseStyle(phase)]}>{phase}</Text>
        {isBusy && <ActivityIndicator size="small" style={{ marginLeft: 8 }} />}
      </View>

      {!allReady && (
        <Pressable
          style={[styles.button, isBusy && styles.buttonDisabled]}
          disabled={isBusy}
          onPress={initAll}
        >
          <Text style={styles.buttonText}>1. Initialize all subsystems</Text>
        </Pressable>
      )}

      {allReady && (
        <View style={styles.talkButtonWrap}>
          <Pressable
            style={[
              styles.talkButton,
              phase === "recording" && styles.talkButtonHot,
              isBusy && styles.buttonDisabled,
            ]}
            onPressIn={startRecording}
            onPressOut={stopAndRun}
            disabled={isBusy}
          >
            <Text style={styles.talkButtonText}>
              {phase === "recording" ? "Listening…" : "Hold to talk"}
            </Text>
          </Pressable>
        </View>
      )}

      {error && (
        <View style={[styles.panel, styles.errorPanel]}>
          <Text style={styles.panelHead}>Error</Text>
          <Text selectable style={styles.errorText}>{error}</Text>
        </View>
      )}

      {transcript && (
        <View style={styles.panel}>
          <Text style={styles.panelHead}>You said ({fmtMs(stats.sttMs)})</Text>
          <Text selectable style={styles.outputText}>{transcript}</Text>
        </View>
      )}

      {llmReply && (
        <View style={styles.panel}>
          <Text style={styles.panelHead}>
            LiteRT reply ({fmtMs(stats.llmMs)})
          </Text>
          <Text selectable style={styles.outputText}>{llmReply}</Text>
        </View>
      )}

      {audioUri && (
        <View style={styles.panel}>
          <Text style={styles.panelHead}>Kokoro audio ({fmtMs(stats.ttsMs)})</Text>
          <Text selectable style={styles.kv}>{audioUri}</Text>
          <Pressable style={styles.smallButton} onPress={() => player.play()}>
            <Text style={styles.smallButtonText}>Replay</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

function SubsystemRow({
  label,
  status,
}: {
  label: string;
  status: SubsystemState[keyof SubsystemState];
}) {
  const color =
    status === "ready"
      ? "#34D399"
      : status === "loading"
      ? "#FBBF24"
      : status === "error"
      ? "#F87171"
      : "#6B7280";
  return (
    <View style={styles.subRow}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.subLabel}>{label}</Text>
      <Text style={[styles.subStatus, { color }]}>{status}</Text>
    </View>
  );
}

function phaseStyle(p: Phase) {
  switch (p) {
    case "ready":
      return { color: "#22D3EE" };
    case "recording":
      return { color: "#F87171" };
    case "transcribing":
    case "generating":
    case "speaking":
    case "loading":
      return { color: "#FBBF24" };
    case "error":
      return { color: "#F87171" };
    default:
      return { color: "#9CA3AF" };
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#08080C" },
  content: { padding: 16, gap: 12 },
  sub: { color: "#9CA3AF", fontSize: 13 },
  subRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  subLabel: { color: "#F1F1F4", fontSize: 13, flex: 1 },
  subStatus: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
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
  outputText: { color: "#F1F1F4", fontSize: 14, lineHeight: 20 },
  kv: { color: "#F1F1F4", fontSize: 12, fontFamily: "Menlo" },
  errorText: { color: "#F87171", fontSize: 13, fontFamily: "Menlo" },
  button: {
    backgroundColor: "#6366F1",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 6,
    borderCurve: "continuous",
  },
  buttonDisabled: { backgroundColor: "#3F3F50", opacity: 0.5 },
  buttonText: { color: "#F1F1F4", fontWeight: "600", fontSize: 14, textAlign: "center" },
  talkButtonWrap: { alignItems: "center", marginVertical: 12 },
  talkButton: {
    backgroundColor: "#6366F1",
    paddingVertical: 24,
    paddingHorizontal: 36,
    borderRadius: 100,
    minWidth: 220,
    // capsule shape; borderCurve: 'continuous' is unnecessary here
  },
  talkButtonHot: { backgroundColor: "#F87171" },
  talkButtonText: {
    color: "#F1F1F4",
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
  },
  smallButton: {
    marginTop: 6,
    alignSelf: "flex-start",
    backgroundColor: "#23232F",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
    borderCurve: "continuous",
  },
  smallButtonText: { color: "#F1F1F4", fontSize: 12, fontWeight: "600" },
});
