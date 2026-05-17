// Wave#15 Phase 0 — adaptive LiteRT context-envelope probe screen.
//
// "Run adaptive sweep" binary-searches the SAFE band (E≤4096, seeded by
// the on-device 4096/512 pass): E-ceiling via the heaviest prompt, then
// O-ceiling upward from 512, then one rich pass over every surface×variant
// at the winner + a CPU sanity. ~5–8 model loads, not a grid.
//
// "Outlier E=N" runs ONE load + heaviest prompt at a >4096 value (the
// #6765 ceiling was E4B/CPU/older — may not bind E2B/GPU/new). One-shot &
// streamed so a SIGSEGV only loses that probe. Drive the upward bisect by
// reading outcomes.
//
// Every result is console.log'd (captured live by idevicesyslog -m
// litert-sweep) so a crash never loses completed probes. promptTokens is
// not reported by the wrapper (always 0) — judge by outcome, not input
// size; see docs/plans/litert-cache-reexport-plan.md.

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
  HEAVY_PROBE,
  OUTLIER_LADDER,
  runAdaptiveSafe,
  runProbe,
  SWEEP_TIMEOUT_MS,
  type ProbeResult,
} from "@/runtime/litert-sweep";

type Phase = "idle" | "downloading" | "running" | "done" | "error";

const COLOR: Record<string, string> = {
  ok: "#3FB950",
  truncated: "#D29922",
  invalid_json: "#D29922",
  empty: "#D29922",
  hang: "#F85149",
  load_error: "#F85149",
  gen_error: "#F85149",
};

export default function LiteRTSweepScreen() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [dlPct, setDlPct] = useState(0);
  const [results, setResults] = useState<ProbeResult[]>([]);
  const [note, setNote] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const modelPathRef = useRef<string | null>(null);
  const busyRef = useRef(false);

  const ensurePath = async (): Promise<string> => {
    if (modelPathRef.current) return modelPathRef.current;
    setPhase("downloading");
    const uri = await ensureModel("litert-stock-gemma4", {
      onProgress: (p) => {
        setDlPct(p);
        if (p >= 1) setPhase("running");
      },
    });
    const path = uri.replace(/^file:\/\//, "");
    modelPathRef.current = path;
    return path;
  };

  const runAdaptive = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    setResults([]);
    setNote("");
    try {
      const path = await ensurePath();
      setPhase("running");
      const acc: ProbeResult[] = [];
      const { eStar, oStar } = await runAdaptiveSafe(
        path,
        SWEEP_TIMEOUT_MS,
        (r) => {
          acc.push(r);
          setResults([...acc]);
        },
      );
      setNote(`Adaptive winner: engineMaxTokens=${eStar}, outputMaxTokens=${oStar}`);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    } finally {
      busyRef.current = false;
    }
  };

  const runOutlier = async (E: number) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    setNote(`Outlier probe: engineMaxTokens=${E} (heavy prompt)…`);
    try {
      const path = await ensurePath();
      setPhase("running");
      const r = await runProbe(
        path,
        { engineMaxTokens: E, outputMaxTokens: 512, backend: "gpu" },
        HEAVY_PROBE,
        SWEEP_TIMEOUT_MS,
      );
      setResults((prev) => [...prev, r]);
      setNote(`Outlier E=${E} → ${r.outcome}`);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    } finally {
      busyRef.current = false;
    }
  };

  const summary = results.reduce<Record<string, number>>((m, r) => {
    m[r.outcome] = (m[r.outcome] ?? 0) + 1;
    return m;
  }, {});
  const running = phase === "running" || phase === "downloading";

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      <Text style={s.h1}>LiteRT context probe — Wave#15 Phase 0 (adaptive)</Text>
      <Text style={s.p}>
        Binary-search, not a grid. Each model load ≈ 70–85 s. Results stream
        to the device log live (crash-safe). Judge by outcome — the wrapper
        reports promptTokens=0.
      </Text>

      <Pressable
        style={[s.btn, running && s.btnDim]}
        disabled={running}
        onPress={runAdaptive}
      >
        <Text style={s.btnText}>Run adaptive sweep (safe band ≤4096)</Text>
      </Pressable>

      <Text style={s.h2}>Outlier probes ( &gt;4096 — one-shot, risky )</Text>
      <View style={s.ladder}>
        {OUTLIER_LADDER.map((E) => (
          <Pressable
            key={E}
            style={[s.chip, running && s.btnDim]}
            disabled={running}
            onPress={() => runOutlier(E)}
          >
            <Text style={s.chipText}>E={E}</Text>
          </Pressable>
        ))}
      </View>

      {phase === "downloading" && (
        <View style={s.row}>
          <ActivityIndicator color="#58A6FF" />
          <Text style={s.p}> Downloading model… {Math.round(dlPct * 100)}%</Text>
        </View>
      )}
      {phase === "running" && (
        <View style={s.row}>
          <ActivityIndicator color="#58A6FF" />
          <Text style={s.p}> Working… (one load in progress)</Text>
        </View>
      )}
      {!!note && <Text style={s.note}>{note}</Text>}
      {error && <Text style={s.err}>{error}</Text>}

      {results.length > 0 && (
        <Text style={s.summary}>
          {Object.entries(summary)
            .map(([k, v]) => `${k}: ${v}`)
            .join("  ·  ")}
        </Text>
      )}

      {results.map((r, i) => (
        <View key={i} style={s.card}>
          <Text style={s.cardHead}>
            <Text style={{ color: COLOR[r.outcome] ?? "#F1F1F4" }}>● </Text>
            {r.surface}/{r.variant}/{r.backend} · eng{r.engineMaxTokens} out
            {r.outputMaxTokens} → {r.outcome}
          </Text>
          <Text style={s.cardMeta}>
            out {r.completionTokens ?? "?"}tok ·{" "}
            {r.tokensPerSecond?.toFixed(1) ?? "?"}tps · ttft{" "}
            {r.ttftMs ? Math.round(r.ttftMs) : "?"}ms · {Math.round(r.wallMs / 1000)}s ·{" "}
            {r.residentBytes
              ? `${(r.residentBytes / 1073741824).toFixed(2)}GB`
              : "?"}
            {r.isLowMemory ? " ⚠LOWMEM" : ""}
          </Text>
          {r.error ? (
            <Text style={s.cardErr}>{r.error}</Text>
          ) : (
            <Text style={s.cardSample} numberOfLines={2}>
              {r.sample}
            </Text>
          )}
        </View>
      ))}

      {(phase === "done" || phase === "error") && results.length > 0 && (
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
  h1: { color: "#F1F1F4", fontSize: 17, fontWeight: "700", marginBottom: 8 },
  h2: { color: "#F1F1F4", fontSize: 14, fontWeight: "700", marginTop: 18, marginBottom: 8 },
  p: { color: "#9DA1A8", fontSize: 12, lineHeight: 17, marginBottom: 12 },
  row: { flexDirection: "row", alignItems: "center", marginVertical: 8 },
  btn: { backgroundColor: "#1F6FEB", borderRadius: 8, padding: 12, alignItems: "center" },
  btnDim: { opacity: 0.4 },
  btnText: { color: "#FFFFFF", fontWeight: "600" },
  ladder: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { backgroundColor: "#6E2A2A", borderRadius: 16, paddingVertical: 8, paddingHorizontal: 14 },
  chipText: { color: "#FFD9D9", fontWeight: "600", fontSize: 12 },
  note: { color: "#58A6FF", fontSize: 12, marginTop: 10, fontWeight: "600" },
  err: { color: "#F85149", fontSize: 12, marginTop: 8 },
  summary: { color: "#F1F1F4", fontSize: 12, fontWeight: "600", marginTop: 12, marginBottom: 8 },
  card: { backgroundColor: "#111218", borderRadius: 8, padding: 10, marginBottom: 8 },
  cardHead: { color: "#F1F1F4", fontSize: 12, fontWeight: "600" },
  cardMeta: { color: "#9DA1A8", fontSize: 10, marginTop: 4 },
  cardSample: { color: "#C9D1D9", fontSize: 10, marginTop: 6, fontStyle: "italic" },
  cardErr: { color: "#F85149", fontSize: 10, marginTop: 6 },
  json: { color: "#8B949E", fontSize: 9, fontFamily: "Courier" },
});
