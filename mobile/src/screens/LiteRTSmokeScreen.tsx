// Step 2 smoke test screen — first deliverable of the LiteRT pivot.
//
// Goals:
//   1. Download model.litertlm from HF (~4.7 GB, first-launch only).
//   2. Load it on the GPU backend with the increased-memory entitlement.
//   3. Generate a chunk-1 prompt and stream the response.
//   4. Validate output against chunkLinesSchema (Zod).
//   5. Report RSS, tok/s, TTFT live.
//
// Exit gate per the plan: chunk-1 generates coherently on a physical iPhone,
// resident memory ≤ ~5 GB, streaming tokens emit incrementally. If this
// screen passes, the LiteRT track is viable.

import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { z } from "zod";

import {
  chunkLinesSchema,
  type ChunkGenerationContextPayload,
} from "@/prompts/schemas";
import {
  generateWllamaChunk,
  preloadWaveLiteRT,
  unloadWaveLiteRT,
} from "@/runtime/litert-generators";
import type { LiteRTLMInstance } from "react-native-litert-lm";

const SAMPLE_CONTEXT: ChunkGenerationContextPayload = {
  chunkNumber: 1,
  intakeIntensity: 7,
  profile: {
    matType: "buprenorphine",
    medicationStatus: "on_time",
    trigger: "stress",
    triggerOther: null,
    usedSubstanceToday: false,
  },
  sessionHistory: [],
};

type Phase =
  | "idle"
  | "downloading"
  | "loading"
  | "ready"
  | "generating"
  | "valid"
  | "invalid"
  | "error";

interface Stats {
  ttftMs: number;
  totalMs: number;
  promptTokens: number;
  completionTokens: number;
  tokensPerSecond: number;
}

interface Memory {
  residentBytes: number;
  nativeHeapBytes: number;
  availableMemoryBytes: number;
  isLowMemory: boolean;
}

function fmtBytes(b: number): string {
  if (!b || !Number.isFinite(b)) return "—";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  return `${(b / Math.pow(1024, i)).toFixed(i > 1 ? 2 : 0)} ${units[i]}`;
}

export default function LiteRTSmokeScreen() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [downloadPct, setDownloadPct] = useState(0);
  const [output, setOutput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [memory, setMemory] = useState<Memory | null>(null);
  const memTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const llmRef = useRef<LiteRTLMInstance | null>(null);

  useEffect(() => {
    return () => {
      if (memTimerRef.current) clearInterval(memTimerRef.current);
    };
  }, []);

  const startMemoryPoll = (llm: LiteRTLMInstance) => {
    if (memTimerRef.current) clearInterval(memTimerRef.current);
    memTimerRef.current = setInterval(() => {
      try {
        setMemory(llm.getMemoryUsage());
      } catch {
        // ignore — wrapper may be torn down
      }
    }, 1000);
  };

  const onLoad = async () => {
    setPhase("downloading");
    setError(null);
    setDownloadPct(0);
    try {
      const llm = await preloadWaveLiteRT({
        onProgress: (p) => {
          setDownloadPct(p);
          if (p >= 1) setPhase("loading");
        },
      });
      llmRef.current = llm;
      setMemory(llm.getMemoryUsage());
      startMemoryPoll(llm);
      setPhase("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  };

  const onGenerate = async () => {
    setPhase("generating");
    setError(null);
    setOutput("");
    setStats(null);
    try {
      const result = await generateWllamaChunk(SAMPLE_CONTEXT, {
        maxNewTokens: 320,
        onDelta: (acc) => setOutput(acc),
      });

      const llm = llmRef.current ?? (await preloadWaveLiteRT());
      const s = llm.getStats();
      setStats({
        ttftMs: s.timeToFirstToken,
        totalMs: s.totalTime,
        promptTokens: s.promptTokens,
        completionTokens: s.completionTokens,
        tokensPerSecond: s.tokensPerSecond,
      });
      setMemory(llm.getMemoryUsage());

      try {
        const parsed = JSON.parse(result.text);
        chunkLinesSchema.parse(parsed);
        setPhase("valid");
      } catch (validationErr) {
        if (validationErr instanceof z.ZodError) {
          setError(
            `Zod: ${validationErr.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
          );
        } else {
          setError(
            `JSON parse: ${validationErr instanceof Error ? validationErr.message : String(validationErr)}`,
          );
        }
        setPhase("invalid");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  };

  const onUnload = async () => {
    if (memTimerRef.current) {
      clearInterval(memTimerRef.current);
      memTimerRef.current = null;
    }
    await unloadWaveLiteRT();
    llmRef.current = null;
    setMemory(null);
    setStats(null);
    setOutput("");
    setPhase("idle");
  };

  const isBusy = phase === "downloading" || phase === "loading" || phase === "generating";

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    >
      <Text style={styles.sub} selectable>
        Loads gemma-4-e2b WAVE fine-tune from HF, generates chunk 1, validates output.
      </Text>

      <View style={styles.statusRow}>
        <Text style={styles.statusLabel}>Phase:</Text>
        <Text style={[styles.statusValue, phaseStyle(phase)]}>{phase}</Text>
        {isBusy && <ActivityIndicator size="small" style={{ marginLeft: 8 }} />}
      </View>

      {phase === "downloading" && (
        <Text style={styles.kv}>
          Download: {(downloadPct * 100).toFixed(1)}%
        </Text>
      )}

      {memory && (
        <View style={styles.panel}>
          <Text style={styles.panelHead}>Memory (live)</Text>
          <Text selectable style={styles.kv}>RSS: {fmtBytes(memory.residentBytes)}</Text>
          <Text selectable style={styles.kv}>Native heap: {fmtBytes(memory.nativeHeapBytes)}</Text>
          <Text selectable style={styles.kv}>Available: {fmtBytes(memory.availableMemoryBytes)}</Text>
          {memory.isLowMemory && (
            <Text style={[styles.kv, { color: "#F87171" }]}>
              ⚠ System reports low memory
            </Text>
          )}
        </View>
      )}

      {stats && (
        <View style={styles.panel}>
          <Text style={styles.panelHead}>Generation stats</Text>
          <Text selectable style={styles.kv}>TTFT: {stats.ttftMs.toFixed(0)} ms</Text>
          <Text selectable style={styles.kv}>Total: {stats.totalMs.toFixed(0)} ms</Text>
          <Text selectable style={styles.kv}>
            Tokens: {stats.promptTokens} in / {stats.completionTokens} out
          </Text>
          <Text selectable style={styles.kv}>
            Decode: {stats.tokensPerSecond.toFixed(1)} tok/s
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
          <Text style={styles.buttonText}>1. Download + Load</Text>
        </Pressable>

        <Pressable
          style={[
            styles.button,
            (phase !== "ready" && phase !== "valid" && phase !== "invalid") &&
              styles.buttonDisabled,
          ]}
          disabled={
            phase !== "ready" && phase !== "valid" && phase !== "invalid"
          }
          onPress={onGenerate}
        >
          <Text style={styles.buttonText}>2. Generate Chunk 1</Text>
        </Pressable>

        <Pressable style={styles.buttonSecondary} onPress={onUnload}>
          <Text style={styles.buttonSecondaryText}>Unload</Text>
        </Pressable>
      </View>

      {output.length > 0 && (
        <View style={styles.panel}>
          <Text style={styles.panelHead}>Streaming output</Text>
          <Text selectable style={styles.outputText}>
            {output}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

function phaseStyle(p: Phase) {
  switch (p) {
    case "valid":
      return { color: "#34D399" };
    case "invalid":
    case "error":
      return { color: "#F87171" };
    case "ready":
      return { color: "#22D3EE" };
    case "generating":
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
  outputText: { color: "#F1F1F4", fontSize: 13, fontFamily: "Menlo", lineHeight: 18 },
  errorText: { color: "#F87171", fontSize: 13, fontFamily: "Menlo" },
  buttonRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  button: {
    backgroundColor: "#6366F1",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 6,
    borderCurve: "continuous",
  },
  buttonDisabled: { backgroundColor: "#3F3F50", opacity: 0.5 },
  buttonText: { color: "#F1F1F4", fontWeight: "600", fontSize: 13 },
  buttonSecondary: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 6,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: "#3F3F50",
  },
  buttonSecondaryText: { color: "#9CA3AF", fontWeight: "600", fontSize: 13 },
});
