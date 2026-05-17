/**
 * WaveEvalScreen — Layer 3 on-device eval suite (issue #1 §6 Layer 3).
 *
 * Self-contained: its own useModel for the WAVE bundle. Reproduces the
 * verified Layer 1 methodology on real hardware through the public wrapper API
 * (downloadModel → loadModel → resetConversation → sendMessageAsync), greedy
 * (temperature 0, topK 1), combined system+user prompt, then scores each
 * surface with the same gates as eval/run.mjs and logs perf + peak memory.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useModel, GEMMA_4_E2B_IT } from "react-native-litert-lm";
import promptsJson from "./wave-prompts.json";
import outputsJson from "./wave-outputs.json";
import {
  combinedPrompt,
  scoreOutput,
  type WavePrompt,
  type WaveRef,
  type WaveScore,
} from "./score";

// Device-memory test: the 5 GB mediapipe bundle OOM-kills the app on device
// (signal 9). The ~2.56 GB litert-lm-v3 variant ~halves resident memory.
// (mediapipe 5 GB original kept here for reference.)
// const WAVE_URL = "https://huggingface.co/Maelstrome/lora-wave-session-r32/resolve/main/mediapipe/model.litertlm";
const WAVE_URL =
  "https://huggingface.co/Maelstrome/lora-wave-session-r32/resolve/main/litert-lm-v3/model.litertlm";

// Headless reproducibility: when EXPO_PUBLIC_WAVE_AUTORUN=1 is set at build
// time, the app lands directly on this screen and runs the suite on mount,
// emitting one grep-able structured line ("WAVE_EVAL_RESULT::{…}") to the
// device log so a simulator/CI run is captured without manual taps.
export const WAVE_AUTORUN = process.env.EXPO_PUBLIC_WAVE_AUTORUN === "1";
// A1b discriminator: load stock litert-community Gemma instead of the WAVE
// bundle on the (patched) iOS framework, and just report engine-create
// success/failure. Splits "iOS build generically broken" vs "this MediaPipe
// bundle on iOS".
const STOCK_TEST = process.env.EXPO_PUBLIC_WAVE_STOCKTEST === "1";
// Quick mode (reviewer #3): prove load + ONE short generation before the full
// 3-prompt suite. `reflection` only — smallest input (~624 tok), the fastest
// on-device proof that loadModel + generation actually work. The env var only
// SEEDS the initial state (headless autorun back-compat); there is also an
// explicit in-UI toggle, so it no longer depends on build-time env inlining
// being reliable.
const QUICK_ENV = process.env.EXPO_PUBLIC_WAVE_QUICK === "1";
const RESULT_MARKER = "WAVE_EVAL_RESULT::";

const ALL_PROMPTS = promptsJson as WavePrompt[];
const REFLECTION_ONLY = ALL_PROMPTS.filter((p) => p.key === "reflection");

// Human-facing identity of the bundle under test, derived from WAVE_URL so the
// UI never shows a stale hard-coded size. The cache filename mirrors
// modelFactory's generic-basename disambiguation
// (".../<variant>/model.litertlm" → "<variant>-model.litertlm").
const WAVE_SEGMENTS = WAVE_URL.split("/").filter(Boolean);
const WAVE_VARIANT = WAVE_SEGMENTS[WAVE_SEGMENTS.length - 2] ?? "wave";
const WAVE_BASENAME = WAVE_SEGMENTS[WAVE_SEGMENTS.length - 1];
const WAVE_CACHE_FILE = /^model\.(litertlm|task|bin|tflite)$/i.test(WAVE_BASENAME)
  ? `${WAVE_VARIANT}-${WAVE_BASENAME}`
  : WAVE_BASENAME;
const REFS = outputsJson as WaveRef[];
const REF_BY_KEY: Record<string, WaveRef> = Object.fromEntries(
  REFS.map((r) => [r.key, r]),
);

type Row = WaveScore & {
  elapsedMs: number;
  tokensPerSecond: number | null;
  output: string;
};

const C = {
  bg: "#08080C",
  card: "#16161F",
  border: "#23232F",
  text: "#F1F1F4",
  dim: "#6B7280",
  accent: "#6366F1",
  ok: "#34D399",
  bad: "#F87171",
  warn: "#FBBF24",
};
const MONO = "Menlo";

function fmtBytes(b?: number): string {
  if (!b) return "—";
  const u = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return `${(b / Math.pow(1024, i)).toFixed(i > 1 ? 2 : 0)} ${u[i]}`;
}

export function WaveEvalScreen({ onBack }: { onBack: () => void }) {
  const [backend, setBackend] = useState<"cpu" | "gpu">("cpu");
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<string>("Idle");
  const [rows, setRows] = useState<Row[]>([]);
  const [fatal, setFatal] = useState<string | null>(null);
  const [quick, setQuick] = useState(QUICK_ENV);

  // Prompt set is reactive to the in-UI Quick toggle (not build-time env).
  const prompts = useMemo<WavePrompt[]>(
    () => (quick ? REFLECTION_ONLY : ALL_PROMPTS),
    [quick],
  );

  const config = useMemo(
    () => ({
      backend,
      systemPrompt: "",
      // Unconflated (Wave#14): engine cache must hold checkin's ~3.2k-token
      // prompt; output cap must stay within the bundle's compiled decode
      // chunk (WAVE reference outputs were ≤223 tokens — 256 is safe). The
      // old single `maxTokens: 4096` conflated both → over the decode chunk
      // → "failed to invoke the compiled model" (= finding #3).
      engineMaxTokens: 4096,
      outputMaxTokens: 256,
      temperature: 0,
      topK: 1,
      autoLoad: false,
      enableMemoryTracking: true,
      maxMemorySnapshots: 64,
    }),
    [backend],
  );

  const { model, isReady, downloadProgress, error, load, memorySummary } =
    useModel(STOCK_TEST ? GEMMA_4_E2B_IT : WAVE_URL, config);

  const runOnce = useCallback(
    (message: string) =>
      new Promise<{ text: string; ms: number }>((resolve, reject) => {
        const t0 = Date.now();
        let full = "";
        try {
          model!.sendMessageAsync(message, (token: string, done: boolean) => {
            if (!done) {
              full += token;
            } else {
              resolve({ text: full, ms: Date.now() - t0 });
            }
          });
        } catch (e: any) {
          reject(e);
        }
      }),
    [model],
  );

  const runSuite = useCallback(async () => {
    setRunning(true);
    setFatal(null);
    setRows([]);
    try {
      setPhase(
        STOCK_TEST
          ? "A1b: loading STOCK litert-community Gemma…"
          : `Downloading / loading WAVE bundle "${WAVE_VARIANT}" (cache: ${WAVE_CACHE_FILE})…`,
      );
      await load();
      if (!model) throw new Error("model not available after load()");

      if (STOCK_TEST) {
        // Discriminator only: did the engine create for the stock model on
        // the patched iOS framework? (no generation needed)
        setPhase("✅ A1b: STOCK model loaded — engine created OK");
        // eslint-disable-next-line no-console
        console.log(
          RESULT_MARKER +
            JSON.stringify({ stockTest: true, stockLoaded: true }),
        );
        return;
      }

      const out: Row[] = [];
      for (const p of prompts) {
        setPhase(`Running "${p.key}"…`);
        try {
          model.resetConversation();
        } catch {}
        const { text, ms } = await runOnce(combinedPrompt(p));
        let tps: number | null = null;
        try {
          tps = model.getStats()?.tokensPerSecond ?? null;
        } catch {}
        const score = scoreOutput(p.key, text, REF_BY_KEY[p.key]);
        out.push({ ...score, elapsedMs: ms, tokensPerSecond: tps, output: text });
        setRows([...out]);
      }
      const allOk = out.every((r) => r.pass);
      setPhase(
        allOk
          ? "✅ Suite complete — all surfaces PASS"
          : "❌ Suite complete — see failures",
      );
      // eslint-disable-next-line no-console
      console.log(
        RESULT_MARKER +
          JSON.stringify({
            allPass: allOk,
            backend,
            rows: out.map((r) => ({
              key: r.key,
              pass: r.pass,
              cosine: +r.cosine.toFixed(3),
              chars: r.chars,
              ms: r.elapsedMs,
              tps: r.tokensPerSecond,
              padToken: r.padToken,
              unicodeLoop: r.unicodeLoop,
              structureOk: r.structureOk,
            })),
          }),
      );
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setFatal(msg);
      setPhase("Error");
      // eslint-disable-next-line no-console
      console.log(RESULT_MARKER + JSON.stringify({ error: msg }));
    } finally {
      setRunning(false);
    }
  }, [load, model, runOnce, backend, prompts]);

  // One-shot headless autorun (EXPO_PUBLIC_WAVE_AUTORUN=1).
  const autoRan = useRef(false);
  useEffect(() => {
    if (WAVE_AUTORUN && !autoRan.current) {
      autoRan.current = true;
      void runSuite();
    }
  }, [runSuite]);

  const allPass = rows.length === prompts.length && rows.every((r) => r.pass);
  const peakRss = memorySummary?.peakResidentBytes;

  return (
    <ScrollView style={st.root} contentContainerStyle={{ padding: 16 }}>
      <View style={st.headerRow}>
        <TouchableOpacity onPress={onBack} style={st.backBtn}>
          <Text style={st.backText}>‹ Chat</Text>
        </TouchableOpacity>
        <Text style={st.title}>🌊 Wave eval suite</Text>
        <View style={{ width: 56 }} />
      </View>
      <Text style={st.sub}>
        Layer 3 · downloadModel → loadModel → sendMessageAsync · greedy
        (temp 0, topK 1) · {prompts.length} WAVE surface
        {prompts.length === 1 ? "" : "s"} vs LiteRT reference
      </Text>

      <View style={st.pillRow}>
        {(["cpu", "gpu"] as const).map((b) => (
          <TouchableOpacity
            key={b}
            disabled={running}
            onPress={() => setBackend(b)}
            style={[st.pill, backend === b && st.pillOn, running && { opacity: 0.5 }]}
          >
            <Text style={[st.pillTxt, backend === b && st.pillTxtOn]}>
              {b.toUpperCase()}
            </Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          disabled={running}
          onPress={() => setQuick((q) => !q)}
          style={[st.pill, quick && st.pillOn, running && { opacity: 0.5 }]}
        >
          <Text style={[st.pillTxt, quick && st.pillTxtOn]}>QUICK</Text>
        </TouchableOpacity>
        <TouchableOpacity
          disabled={running}
          onPress={runSuite}
          style={[st.runBtn, running && { opacity: 0.5 }]}
        >
          {running ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={st.runTxt}>
              {quick ? "Run quick (reflection)" : "Run Wave eval suite"}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      <View style={st.statusCard}>
        <Text style={st.statusTxt}>{phase}</Text>
        {downloadProgress > 0 && downloadProgress < 1 && (
          <Text style={st.statusSub}>
            download {(downloadProgress * 100).toFixed(0)}%
          </Text>
        )}
        {!!error && <Text style={[st.statusSub, { color: C.bad }]}>{error}</Text>}
        {!!fatal && <Text style={[st.statusSub, { color: C.bad }]}>{fatal}</Text>}
        <Text style={st.statusSub}>
          {isReady ? "engine ready" : "engine not loaded"} · peak RSS{" "}
          {fmtBytes(peakRss)}
          {peakRss && peakRss > 6 * 1024 ** 3 ? " ⚠️ >6GB" : ""}
        </Text>
        <Text style={st.statusSub} numberOfLines={2}>
          bundle: {STOCK_TEST ? "STOCK litert-community Gemma" : WAVE_VARIANT} ·
          cache: {STOCK_TEST ? "—" : WAVE_CACHE_FILE} · {prompts.length} surface
          {prompts.length === 1 ? "" : "s"}
        </Text>
      </View>

      {rows.length > 0 && (
        <View style={st.matrix}>
          <View style={[st.tr, st.trHead]}>
            <Text style={[st.cell, st.k]}>surface</Text>
            <Text style={[st.cell, st.n]}>cosine</Text>
            <Text style={[st.cell, st.n]}>chars</Text>
            <Text style={[st.cell, st.n]}>ms</Text>
            <Text style={[st.cell, st.n]}>tok/s</Text>
            <Text style={[st.cell, st.p]}>pass</Text>
          </View>
          {rows.map((r) => (
            <View key={r.key} style={st.trWrap}>
              <View style={st.tr}>
                <Text style={[st.cell, st.k]}>{r.key}</Text>
                <Text style={[st.cell, st.n]}>{r.cosine.toFixed(3)}</Text>
                <Text style={[st.cell, st.n]}>{r.chars}</Text>
                <Text style={[st.cell, st.n]}>{r.elapsedMs}</Text>
                <Text style={[st.cell, st.n]}>
                  {r.tokensPerSecond ? r.tokensPerSecond.toFixed(1) : "—"}
                </Text>
                <Text
                  style={[
                    st.cell,
                    st.p,
                    { color: r.pass ? C.ok : C.bad, fontWeight: "800" },
                  ]}
                >
                  {r.pass ? "PASS" : "FAIL"}
                </Text>
              </View>
              {(r.padToken || r.unicodeLoop || !r.structureOk) && (
                <Text style={st.flag}>
                  {r.padToken ? "pad-token spew  " : ""}
                  {r.unicodeLoop ? "unicode-loop  " : ""}
                  {!r.structureOk ? "structure-bad  " : ""}
                </Text>
              )}
              {r.notes.map((n, i) => (
                <Text key={i} style={st.note}>
                  · {n}
                </Text>
              ))}
              <Text style={st.outPreview} numberOfLines={6}>
                {r.output.trim().slice(0, 600) || "(empty)"}
              </Text>
            </View>
          ))}
          <Text
            style={[
              st.verdict,
              { color: allPass ? C.ok : C.bad },
            ]}
          >
            {allPass
              ? "✅ All surfaces PASS — fine-tune intact on-device via the wrapper API"
              : "❌ One or more surfaces failed — see notes"}
          </Text>
          <Text style={st.fineprint}>
            toolTok is informational (reference has none — turn #1 is text-only
            by design). cosine gate: prose ≥ 0.45, reflection JSON char-dist
            &lt; 0.4 &amp; cosine ≥ 0.55. Same gates as eval/run.mjs.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  backBtn: { paddingVertical: 6, paddingRight: 10 },
  backText: { color: C.accent, fontSize: 15, fontWeight: "700" },
  title: { color: C.text, fontSize: 18, fontWeight: "900" },
  sub: { color: C.dim, fontSize: 12, lineHeight: 17, marginBottom: 14 },
  pillRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  pill: {
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
  },
  pillOn: { borderColor: C.accent, backgroundColor: "rgba(99,102,241,0.12)" },
  pillTxt: { color: C.dim, fontWeight: "700", fontSize: 13 },
  pillTxtOn: { color: C.accent },
  runBtn: {
    flex: 1,
    backgroundColor: C.accent,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
  },
  runTxt: { color: "#fff", fontWeight: "800", fontSize: 14 },
  statusCard: {
    backgroundColor: C.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    marginBottom: 14,
  },
  statusTxt: { color: C.text, fontSize: 14, fontWeight: "700" },
  statusSub: { color: C.dim, fontSize: 12, marginTop: 4 },
  matrix: {
    backgroundColor: C.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    padding: 12,
  },
  trWrap: {
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingTop: 8,
    marginTop: 8,
  },
  tr: { flexDirection: "row", alignItems: "center" },
  trHead: { paddingBottom: 4 },
  cell: { color: C.text, fontSize: 12, fontFamily: MONO },
  k: { flex: 2 },
  n: { flex: 1.4, textAlign: "right" },
  p: { flex: 1.2, textAlign: "right" },
  flag: { color: C.bad, fontSize: 11, marginTop: 4, fontFamily: MONO },
  note: { color: C.warn, fontSize: 11, marginTop: 2 },
  outPreview: {
    color: C.dim,
    fontSize: 11,
    fontFamily: MONO,
    marginTop: 6,
    lineHeight: 15,
  },
  verdict: {
    fontSize: 13,
    fontWeight: "800",
    marginTop: 14,
    textAlign: "center",
  },
  fineprint: {
    color: C.dim,
    fontSize: 10,
    marginTop: 8,
    lineHeight: 14,
    textAlign: "center",
  },
});
