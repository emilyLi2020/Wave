// Stock Gemma 4 on LiteRT-LM — sibling to LiteRTSmokeScreen.
//
// Why this exists alongside LiteRTSmokeScreen.tsx: the WAVE fine-tune bundle
// path is blocked behind the wrapper version-skew issue tracked in #13. Stock
// `litert-community/gemma-4-E2B-it.litertlm` *does* load on the bundled
// react-native-litert-lm@0.3.6 framework, so this page is the prize-eligible
// "we shipped on LiteRT" demo while the fine-tune path stays parked. WAVE
// system prompts run as user-message preamble so output stays on-brand even
// without the LoRA fine-tune.
//
// Goals:
//   1. Download gemma-4-E2B-it.litertlm from litert-community (~2.59 GB,
//      first-launch only) via the unified cache layer.
//   2. Load it on the GPU backend with the increased-memory entitlement.
//   3. Run a short WAVE-flavored prompt that fits the bundle's 1024-token
//      total budget (the full chunk-1 prompt is ~1.8 K tokens, too big).
//   4. Report RSS, tok/s, TTFT live.

import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { ensureModel } from "@/runtime/model-cache";
import { createLLM, type LiteRTLMInstance } from "react-native-litert-lm";

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

export default function LiteRTStockScreen() {
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
      const fileUri = await ensureModel("litert-stock-gemma4", {
        onProgress: (p) => {
          setDownloadPct(p);
          if (p >= 1) setPhase("loading");
        },
      });
      // Strip file:// — LiteRT-LM C++ wants raw POSIX paths (commit 2b6fdc6).
      const nativePath = fileUri.replace(/^file:\/\//, "");
      const llm = createLLM({ enableMemoryTracking: true });
      await llm.loadModel(nativePath, {
        backend: "gpu",
        // Path A fix (react-native-litert-lm-wave fork): upstream collapsed
        // the engine KV budget and the per-call decode cap into one
        // `maxTokens`, so no single value could run the ~1846-token WAVE
        // chunk-1 prompt (256 → "input too long, 1846 > 256"; 2048 →
        // "failed to invoke compiled model" because the decode batch
        // exceeded the bundle's compiled 256-token chunk). The fork splits
        // them:
        //  - engineMaxTokens 2048 → matches the stock litert-community
        //    Gemma 4 E2B bundle's compiled cache_length; holds the
        //    1846-token input plus ~200 output.
        //  - outputMaxTokens 200 → within the bundle's compiled 256-token
        //    decode chunk.
        systemPrompt: "You are WAVE, a calm voice guiding someone through urge surfing. Reply in 1-2 short sentences.",
        engineMaxTokens: 2048,
        outputMaxTokens: 200,
        temperature: 0,
        topK: 1,
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
    const llm = llmRef.current;
    if (!llm) {
      setError("Model not loaded — tap Download + Load first.");
      setPhase("error");
      return;
    }
    setPhase("generating");
    setError(null);
    setOutput("");
    setStats(null);
    try {
      // Short demo prompt — the full WAVE chunk-1 prompt (~1800 tokens) is
      // too long for the stock bundle's 1024 total-token budget. The
      // system prompt at load time is the WAVE persona; here we just ask
      // for a single urge-surfing cue. Demonstrates Gemma 4 running on
      // LiteRT-LM end-to-end without overflowing the bundle's compiled
      // context. Fine-tune would replace this with the full chunk
      // contract; stock can't follow that schema.
      const prompt =
        "I'm feeling a 7-out-of-10 craving for buprenorphine right now. Give me one short urge-surfing cue to ride this out.";

      llm.resetConversation();
      let accumulated = "";
      await new Promise<void>((resolve, reject) => {
        try {
          llm.sendMessageAsync(prompt, (token, done) => {
            accumulated += token;
            setOutput(accumulated);
            if (done) resolve();
          });
        } catch (err) {
          reject(err as Error);
        }
      });

      const s = llm.getStats();
      setStats({
        ttftMs: s.timeToFirstToken,
        totalMs: s.totalTime,
        promptTokens: s.promptTokens,
        completionTokens: s.completionTokens,
        tokensPerSecond: s.tokensPerSecond,
      });
      setMemory(llm.getMemoryUsage());

      // No JSON validation — stock Gemma 4 generates prose for this prompt.
      // The fine-tune is what shapes output into the chunk schema. For the
      // prize demo, coherent prose is the win condition.
      if (accumulated.trim().length > 0) {
        setPhase("valid");
      } else {
        setError("Model returned empty output.");
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
    try {
      llmRef.current?.close();
    } catch {
      // best-effort
    }
    llmRef.current = null;
    setMemory(null);
    setStats(null);
    setOutput("");
    setPhase("idle");
  };

  const isBusy =
    phase === "downloading" || phase === "loading" || phase === "generating";

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    >
      <Text style={styles.sub} selectable>
        Loads the unmodified `litert-community/gemma-4-E2B-it.litertlm` bundle
        on react-native-litert-lm@0.3.6 and runs a WAVE chunk-1 prompt. Prize
        demo: stock Gemma 4 running fully on-device via LiteRT-LM.
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
            phase !== "ready" &&
              phase !== "valid" &&
              phase !== "invalid" &&
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
