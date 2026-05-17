// Wave#15 Phase 0 — LiteRT context-envelope sweep screen.
//
// Runs the curated cell matrix in src/runtime/litert-sweep.ts against the
// stock gemma-4-E2B-it.litertlm bundle, sequentially, with a hard per-cell
// timeout + engine teardown (no wedged-conversation reuse). Records real
// tokenizer counts, JSON validity, truncation, RAM, TTFT, tok/s, hangs.
//
// Results render on screen AND are console.log'd as one JSON blob (and
// shown in a selectable Text block) so a run survives without a file API.
// This is a measurement harness, not a guarantee — see
// docs/plans/litert-cache-reexport-plan.md.

import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { ensureModel } from "@/runtime/model-cache";
import {
  DEFAULT_CELLS,
  runCell,
  SWEEP_TIMEOUT_MS,
  type SweepResult,
} from "@/runtime/litert-sweep";

type Phase = "idle" | "downloading" | "running" | "done" | "error";

const OUTCOME_COLOR: Record<string, string> = {
  ok: "#3FB950",
  truncated: "#D29922",
  invalid_json: "#D29922",
  hang: "#F85149",
  load_error: "#F85149",
  gen_error: "#F85149",
};

export default function LiteRTSweepScreen() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [downloadPct, setDownloadPct] = useState(0);
  const [results, setResults] = useState<SweepResult[]>([]);
  const [progress, setProgress] = useState<{ i: number; n: number } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef(false);

  const run = async () => {
    setError(null);
    setResults([]);
    cancelRef.current = false;
    try {
      setPhase("downloading");
      const fileUri = await ensureModel("litert-stock-gemma4", {
        onProgress: (p) => {
          setDownloadPct(p);
          if (p >= 1) setPhase("running");
        },
      });
      // LiteRT-LM C++ wants raw POSIX paths (no file:// prefix).
      const modelPath = fileUri.replace(/^file:\/\//, "");
      setPhase("running");

      const acc: SweepResult[] = [];
      for (let i = 0; i < DEFAULT_CELLS.length; i++) {
        if (cancelRef.current) break;
        setProgress({ i: i + 1, n: DEFAULT_CELLS.length });
        const r = await runCell(modelPath, DEFAULT_CELLS[i], SWEEP_TIMEOUT_MS);
        acc.push(r);
        setResults([...acc]);
        // Stream each result to the JS console as it lands.
        // eslint-disable-next-line no-console
        console.log("[litert-sweep]", JSON.stringify(r));
      }
      // eslint-disable-next-line no-console
      console.log("[litert-sweep] FULL", JSON.stringify(acc));
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  };

  const summary = results.reduce<Record<string, number>>((m, r) => {
    m[r.outcome] = (m[r.outcome] ?? 0) + 1;
    return m;
  }, {});

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      <Text style={s.h1}>LiteRT context sweep — Wave#15 Phase 0</Text>
      <Text style={s.p}>
        {DEFAULT_CELLS.length} cells, sequential, {SWEEP_TIMEOUT_MS / 1000}s
        per-cell timeout. Each reloads the ~2.6 GB bundle — this is slow and
        long. Measures the real (engineMaxTokens × outputMaxTokens × backend
        × prompt-variant × surface) envelope. Not a guarantee.
      </Text>

      {phase === "idle" || phase === "error" || phase === "done" ? (
        <Pressable style={s.btn} onPress={run}>
          <Text style={s.btnText}>
            {phase === "done" || phase === "error" ? "Re-run sweep" : "Run sweep"}
          </Text>
        </Pressable>
      ) : (
        <Pressable
          style={[s.btn, s.btnCancel]}
          onPress={() => {
            cancelRef.current = true;
          }}
        >
          <Text style={s.btnText}>Stop after current cell</Text>
        </Pressable>
      )}

      {phase === "downloading" && (
        <View style={s.row}>
          <ActivityIndicator color="#58A6FF" />
          <Text style={s.p}> Downloading model… {Math.round(downloadPct * 100)}%</Text>
        </View>
      )}
      {phase === "running" && progress && (
        <View style={s.row}>
          <ActivityIndicator color="#58A6FF" />
          <Text style={s.p}>
            {" "}
            Cell {progress.i}/{progress.n}…
          </Text>
        </View>
      )}
      {error && <Text style={s.err}>{error}</Text>}

      {results.length > 0 && (
        <Text style={s.summary}>
          {Object.entries(summary)
            .map(([k, v]) => `${k}: ${v}`)
            .join("  ·  ")}
        </Text>
      )}

      {results.map((r, idx) => (
        <View key={idx} style={s.card}>
          <Text style={s.cardHead}>
            <Text style={{ color: OUTCOME_COLOR[r.outcome] ?? "#F1F1F4" }}>
              ●{" "}
            </Text>
            {r.cell.surface}/{r.cell.variant}/{r.cell.backend} · eng
            {r.cell.engineMaxTokens} out{r.cell.outputMaxTokens} →{" "}
            {r.outcome}
          </Text>
          <Text style={s.cardMeta}>
            in {r.promptTokens ?? "?"} tok · out {r.completionTokens ?? "?"} ·{" "}
            {r.tokensPerSecond?.toFixed(1) ?? "?"} tok/s · ttft{" "}
            {r.ttftMs ?? "?"}ms · {r.wallMs}ms wall ·{" "}
            {r.residentBytes
              ? `${(r.residentBytes / 1024 / 1024 / 1024).toFixed(2)} GB`
              : "?"}
            {r.isLowMemory ? " ⚠lowmem" : ""}
          </Text>
          {r.error ? (
            <Text style={s.cardErr}>{r.error}</Text>
          ) : (
            <Text style={s.cardSample} numberOfLines={3}>
              {r.sample}
            </Text>
          )}
        </View>
      ))}

      {phase === "done" && (
        <>
          <Text style={s.h2}>Full JSON (selectable)</Text>
          <Text selectable style={s.json}>
            {JSON.stringify(results, null, 2)}
          </Text>
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#08080C" },
  content: { padding: 16, paddingBottom: 64 },
  h1: { color: "#F1F1F4", fontSize: 18, fontWeight: "700", marginBottom: 8 },
  h2: { color: "#F1F1F4", fontSize: 15, fontWeight: "700", marginTop: 20, marginBottom: 6 },
  p: { color: "#9DA1A8", fontSize: 13, lineHeight: 18, marginBottom: 12 },
  row: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  btn: { backgroundColor: "#1F6FEB", borderRadius: 8, padding: 12, alignItems: "center", marginBottom: 14 },
  btnCancel: { backgroundColor: "#6E2A2A" },
  btnText: { color: "#FFFFFF", fontWeight: "600" },
  summary: { color: "#F1F1F4", fontSize: 13, fontWeight: "600", marginBottom: 10 },
  err: { color: "#F85149", fontSize: 13, marginBottom: 10 },
  card: { backgroundColor: "#111218", borderRadius: 8, padding: 10, marginBottom: 8 },
  cardHead: { color: "#F1F1F4", fontSize: 13, fontWeight: "600" },
  cardMeta: { color: "#9DA1A8", fontSize: 11, marginTop: 4 },
  cardSample: { color: "#C9D1D9", fontSize: 11, marginTop: 6, fontStyle: "italic" },
  cardErr: { color: "#F85149", fontSize: 11, marginTop: 6 },
  json: { color: "#8B949E", fontSize: 10, fontFamily: "Courier" },
});
