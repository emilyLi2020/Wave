// Stock Gemma 4 on LiteRT-LM — prize demo, three real WAVE surfaces.
//
// Loads the unmodified `litert-community/gemma-4-E2B-it.litertlm` on the
// react-native-litert-lm-wave fork and runs the three production WAVE
// surfaces back-to-back, each with its own metrics:
//   1. Phase narration  — buildChunkPrompt (chunk 3, post-corner-cut)
//   2. Check-in          — 3-turn exchange ending in the endConversation
//                          tool call (the WAVE readiness signal)
//   3. Reflection        — buildReflectionPrompt
//
// Config = the Wave#15-verified envelope: eng2048 / out512 / gpu, with
// the chunk-generator corner-cuts already in place. systemPrompt goes in
// LLMConfig (production-faithful; the system-in-message path hangs — see
// Wave#15). One model load per surface (systemPrompt is load-time).
//
// This is the shared harness. Which engine binary actually runs is a
// build-time swap inside the LiteRTLM xcframework — there is no runtime
// switch — so the two callers (`LiteRTStockScreen` for PhoneClaw's
// CLiteRTLM, `LiteRTStockCustomScreen` for the from-source v0.11.0 dylib)
// share this code verbatim and differ only in the intro copy.

import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { File } from "expo-file-system";

import { buildChunkPrompt } from "@/prompts/chunk-generator";
import { buildReflectionPrompt } from "@/prompts/reflection";
import type {
  ChunkGenerationContextPayload,
  ReflectionContext,
  SessionHistoryEntry,
} from "@/prompts/schemas";
// Check-in (#25): single-shot JSON output-contract with a self-contained,
// JSON-native check-in prompt (see ciSystemJson). The shared
// WAVE_SYSTEM_PROMPT* prompts say "no JSON / next agent turn only", which
// contradicted the contract and stopped endConversation ever firing — so
// we no longer prefix them here. Phase/reflection use their own builders.
import { ensureModel, getModelDir } from "@/runtime/model-cache";
import { createLLM, type LiteRTLMInstance } from "react-native-litert-lm";

const REQUESTED_BACKEND = "gpu" as const;
export const ENGINE_MAX_TOKENS = 2048;
export const OUTPUT_MAX_TOKENS = 512;

const TOOL_OBSTACLES =
  "none, cannot_visualize, mind_wandering, urge_overwhelming, breath_tight, breath_anxiety, gave_in, guilt_failure, physical_discomfort, sleepiness";

const PROFILE: ChunkGenerationContextPayload["profile"] = {
  matType: "buprenorphine",
  medicationStatus: "on_time",
  trigger: "stress",
  triggerOther: null,
  usedSubstanceToday: false,
};

// One realistic prior check-in. Post-corner-cut, chunk-generator's
// renderHistoryBlock only reads the most recent check-in entry.
const PRIOR_CHECKIN: SessionHistoryEntry = {
  kind: "checkIn",
  chunkNumber: 2,
  cravingScore: 6,
  obstacleCategory: null,
  turns: [
    { role: "agent", content: "Where is the craving on a scale of 1 to 10 right now?" },
    { role: "patient", content: "About a six, it eased a little but it's still in my chest." },
    { role: "agent", content: "A six, and you noticed it ease — that's worth naming. What was happening in your body during that last stretch?" },
    { role: "patient", content: "My jaw was tight and I kept wanting to check my phone." },
    { role: "agent", content: "That pull to distract is the wave working — and you stayed. Ready to keep going?" },
    { role: "patient", content: "Yeah." },
  ],
};

type Phase = "idle" | "downloading" | "running" | "done" | "error";

interface SurfaceStats {
  ttftMs: number;
  totalMs: number;
  promptTokens: number;
  completionTokens: number;
  tokensPerSecond: number;
  residentBytes: number;
}

interface SurfaceResult {
  label: string;
  text: string;
  toolCall: string | null;
  stats: SurfaceStats | null;
  error: string | null;
}

function fmtBytes(b: number): string {
  if (!b || !Number.isFinite(b)) return "—";
  const u = ["B", "KB", "MB", "GB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  return `${(b / Math.pow(1024, i)).toFixed(i > 1 ? 2 : 0)} ${u[i]}`;
}

/**
 * Parse the native Gemma-4 tool-call shape (the fine-tune-dataset shape,
 * base-reliable): a plain reply followed by a literal
 * `endConversation{cravingScore:N,obstacleCategory:CAT}`. Reply = the text
 * with that literal stripped. No JSON wrapper.
 */
function extractToolCall(raw: string): { reply: string; tool: string | null } {
  const norm = (
    args: string,
    consumed: string,
  ): { reply: string; tool: string } => {
    const score = args.match(/cravingScore\s*[:=]\s*"?(\d+)"?/i)?.[1] ?? "?";
    const obst =
      args.match(/obstacleCategory\s*[:=]\s*"?([a-zA-Z_]+)"?/i)?.[1] ?? "none";
    return {
      reply: raw.replace(consumed, "").trim(),
      tool: `endConversation{cravingScore:${score},obstacleCategory:${obst}}`,
    };
  };
  // JSON output-contract (the working path): a single object
  // {"reply": "...", "endConversation": null | {cravingScore,obstacleCategory}}.
  const jStart = raw.indexOf("{");
  const jEnd = raw.lastIndexOf("}");
  if (jStart !== -1 && jEnd > jStart) {
    try {
      const o = JSON.parse(raw.slice(jStart, jEnd + 1)) as {
        reply?: unknown;
        endConversation?: { cravingScore?: unknown; obstacleCategory?: unknown } | null;
      };
      if (o && typeof o === "object" && "endConversation" in o) {
        const reply =
          typeof o.reply === "string" && o.reply.trim()
            ? o.reply.trim()
            : raw.trim();
        const ec = o.endConversation;
        if (ec && typeof ec === "object") {
          const score = String(ec.cravingScore ?? "?");
          const obst = String(ec.obstacleCategory ?? "none");
          return {
            reply,
            tool: `endConversation{cravingScore:${score},obstacleCategory:${obst}}`,
          };
        }
        return { reply, tool: null };
      }
    } catch {
      /* not valid JSON — fall through to literal forms */
    }
  }
  // Gemma documented function-call: a ```tool_code``` fenced Python call.
  const fenced = raw.match(/```tool_code\s*([\s\S]*?)```/i);
  const inner = fenced
    ? fenced[1].match(/endConversation\s*\(([^)]*)\)/i)
    : null;
  if (fenced && inner) return norm(inner[1] ?? "", fenced[0]);
  // Bare Python-style paren call (no fence).
  const paren = raw.match(/endConversation\s*\(([^)]*)\)/i);
  if (paren) return norm(paren[1] ?? "", paren[0]);
  // Legacy ad-hoc brace literal.
  const brace = raw.match(/endConversation\s*\{([^}]*)\}/i);
  if (brace) return norm(brace[1] ?? "", brace[0]);
  return { reply: raw.trim(), tool: null };
}

export interface LiteRTStockHarnessProps {
  /**
   * Intro paragraph rendered above the status row. The two callers pass
   * different copy describing which engine binary the build carries; the
   * run logic below is identical for both.
   */
  intro: React.ReactNode;
}

export default function LiteRTStockScreenBase({
  intro,
}: LiteRTStockHarnessProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [downloadPct, setDownloadPct] = useState(0);
  const [results, setResults] = useState<SurfaceResult[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mldrift, setMldrift] = useState<string | null>(null);
  const modelPathRef = React.useRef<string | null>(null);
  const busyRef = React.useRef(false);

  const ensurePath = async (): Promise<string> => {
    if (modelPathRef.current) return modelPathRef.current;
    setPhase("downloading");
    const uri = await ensureModel("litert-stock-gemma4", {
      onProgress: (p) => {
        setDownloadPct(p);
        if (p >= 1) setPhase("running");
      },
    });
    const path = uri.replace(/^file:\/\//, "");
    modelPathRef.current = path;
    return path;
  };

  // MLDrift GPU program-cache probe: present/growing ⇒ GPU actually ran.
  const probeMlDrift = () => {
    try {
      const entries = getModelDir("litert-stock-gemma4").list();
      const hits = entries
        .filter(
          (e): e is File =>
            e instanceof File && e.name.toLowerCase().includes("mldrift"),
        )
        .map((f) => `${f.name} (${fmtBytes(f.exists ? (f.size ?? 0) : 0)})`);
      setMldrift(hits.length ? hits.join(", ") : "none (likely CPU fallback)");
    } catch {
      setMldrift("none yet");
    }
  };

  /** One surface = one fresh load (systemPrompt is load-time) + sends. */
  const runSurface = async (
    modelPath: string,
    label: string,
    systemPrompt: string,
    userTurns: string[],
  ): Promise<SurfaceResult> => {
    let llm: LiteRTLMInstance | null = null;
    try {
      llm = createLLM({ enableMemoryTracking: true });
      await llm.loadModel(modelPath, {
        backend: REQUESTED_BACKEND,
        engineMaxTokens: ENGINE_MAX_TOKENS,
        outputMaxTokens: OUTPUT_MAX_TOKENS,
        systemPrompt,
        temperature: 0,
        topK: 1,
      });
      // Reset ONCE, then send each turn as a real user message so the
      // wrapper's chat template manages user/assistant turns. (Per-turn
      // resetConversation made every turn a fresh conversation with a
      // forged transcript — that's what collapsed the check-in into a
      // stray </start_of_turn>.) Single-turn surfaces are unaffected.
      let last = "";
      llm.resetConversation();
      for (const turn of userTurns) {
        last = await llm.sendMessage(turn);
      }
      const s = llm.getStats();
      const mem = llm.getMemoryUsage();
      const { reply, tool } = extractToolCall(last);
      return {
        label,
        text: reply,
        toolCall: tool,
        stats: {
          ttftMs: s.timeToFirstToken,
          totalMs: s.totalTime,
          promptTokens: s.promptTokens,
          completionTokens: s.completionTokens,
          tokensPerSecond: s.tokensPerSecond,
          residentBytes: mem.residentBytes,
        },
        error: null,
      };
    } catch (e) {
      return {
        label,
        text: "",
        toolCall: null,
        stats: null,
        error: e instanceof Error ? e.message : String(e),
      };
    } finally {
      try {
        llm?.close();
      } catch {
        /* best-effort */
      }
    }
  };

  // Single-shot check-in — mirrors production generateWllamaCheckIn.
  // NO load-time system prompt: each turn we resetConversation() and send
  // ONE message = systemJson + the flattened transcript-so-far + "WAVE:".
  // Single-shot keeps the JSON output-contract dominant; multi-turn chat
  // makes stock Gemma default to prose (phase/reflection prove single
  // shot emits JSON fine). extractToolCall is JSON-first.
  const runCheckInSingleShot = async (
    modelPath: string,
    label: string,
    systemJson: string,
    patientTurns: string[],
  ): Promise<SurfaceResult> => {
    let llm: LiteRTLMInstance | null = null;
    try {
      llm = createLLM({ enableMemoryTracking: true });
      await llm.loadModel(modelPath, {
        backend: REQUESTED_BACKEND,
        engineMaxTokens: ENGINE_MAX_TOKENS,
        outputMaxTokens: OUTPUT_MAX_TOKENS,
        temperature: 0,
        topK: 1,
      });
      const history: { role: "WAVE" | "Patient"; content: string }[] = [];
      let last = "";
      let lastTool: string | null = null;
      for (const pt of patientTurns) {
        history.push({ role: "Patient", content: pt });
        const transcript = history
          .map((h) => `${h.role}: ${h.content}`)
          .join("\n");
        const combined = `${systemJson}\n\n${transcript}\n\nWAVE:`;
        llm.resetConversation();
        console.log(
          `[citrace] turn ${history.length}/${patientTurns.length} ` +
            `promptLen=${combined.length}\n` +
            `===== PROMPT SENT TO LLM (sendMessage) =====\n${combined}\n` +
            `===== END PROMPT =====`,
        );
        const raw = await llm.sendMessage(combined);
        console.log(
          `[citrace] turn ${history.length} rawLen=${raw.length}\n` +
            `===== RAW LLM OUTPUT =====\n${raw}\n===== END RAW =====`,
        );
        const { reply, tool } = extractToolCall(raw);
        console.log(
          `[citrace] turn ${history.length} parsed: tool=${
            tool ?? "null"
          } replyLen=${reply.length} replyHead=${JSON.stringify(
            reply.slice(0, 100),
          )}`,
        );
        last = reply;
        lastTool = tool;
        history.push({ role: "WAVE", content: reply });
      }
      const s = llm.getStats();
      const mem = llm.getMemoryUsage();
      return {
        label,
        text: last,
        toolCall: lastTool,
        stats: {
          ttftMs: s.timeToFirstToken,
          totalMs: s.totalTime,
          promptTokens: s.promptTokens,
          completionTokens: s.completionTokens,
          tokensPerSecond: s.tokensPerSecond,
          residentBytes: mem.residentBytes,
        },
        error: null,
      };
    } catch (e) {
      return {
        label,
        text: "",
        toolCall: null,
        stats: null,
        error: e instanceof Error ? e.message : String(e),
      };
    } finally {
      try {
        llm?.close();
      } catch {
        /* best-effort */
      }
    }
  };

  const onRunDemo = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    setResults([]);
    try {
      const modelPath = await ensurePath();
      setPhase("running");
      const acc: SurfaceResult[] = [];

      // ── 1. Phase narration (chunk 3, post-corner-cut: 1 prior check-in)
      setNote("1/4 · phase narration…");
      const chunk = buildChunkPrompt({
        chunkNumber: 3,
        intakeIntensity: 7,
        profile: PROFILE,
        sessionHistory: [PRIOR_CHECKIN],
      } satisfies ChunkGenerationContextPayload);
      acc.push(
        await runSurface(
          modelPath,
          "Phase narration (chunk 3)",
          chunk.systemPrompt,
          [chunk.userPrompt],
        ),
      );
      setResults([...acc]);

      // ── 2/3. Check-in via the JSON output-contract — the documented
      // working path (issue #10: native tool-call attempts failed, JSON
      // path works). Compact persona + a strict JSON envelope; the tool
      // signal is the parsed `endConversation` field, not a literal.
      // Both check-in surfaces share this prompt; they differ only by
      // turn count (#2 quick 3-turn vs #3 full 5-turn arc → ending).
      setNote("2/4 · check-in JSON (3 quick turns)…");
      // Self-contained JSON-native check-in prompt. We deliberately do
      // NOT prefix WAVE_SYSTEM_PROMPT_STOCK_COMPACT: its OUTPUT line says
      // "the next agent turn only ... no JSON", which directly contradicts
      // this contract and made the model keep asking questions forever
      // (endConversation never fired — see [citrace]). Persona/tone/arc
      // kept; the end trigger is now blunt and unmissable.
      const ciSystemJson = `You are WAVE, a trauma-informed, calm, concrete urge-surfing companion for people in substance-use recovery, running a short post-chunk check-in. Warm, unhurried, nonjudgmental. Never lecture, minimize, or rush.

The patient's first message is their craving score (1-10). Each turn: briefly validate what they just said, then (unless ending) ask exactly one open question. 1-3 short plain sentences. Track the craving score.

ENDING — read this every turn, it is the most important rule:
- If the patient's LATEST message clearly signals they are ready to continue (e.g. "I'm ready", "let's keep going", "yeah, go on", "I'm good to continue"), you MUST end now. Set "endConversation" to an object with their latest craving score and the obstacle. "reply" is a brief warm hand-off that closes the check-in — the app moves on to the next part right after, so do NOT ask a question, do NOT raise a new topic, do NOT invite them to say more. For example: "Thanks for letting me know. We will move on now." or "Got it, thank you. Let us keep going."
- In every other case "endConversation" MUST be null and "reply" ends with exactly one question.

obstacleCategory is one of: ${TOOL_OBSTACLES}. Use "none" if no clear obstacle was reported.

Respond with ONLY a single JSON object, nothing else, exactly this shape:
{"reply": "<patient-facing prose, 1-3 short plain sentences, no markdown/lists/emoji>", "endConversation": null | {"cravingScore": <integer 1-10>, "obstacleCategory": "<one category>"}}
Output nothing outside the JSON object — no preamble, no code fences, no extra keys.`;
      // Real multi-turn: just the patient utterances, sent sequentially.
      const ciTurns = [
        "6",
        "My chest was tight but it loosened a bit near the end.",
        "Yeah, I'm ready, let's keep going.",
      ];
      acc.push(
        await runCheckInSingleShot(
          modelPath,
          "Check-in JSON single-shot (3 turns)",
          ciSystemJson,
          ciTurns,
        ),
      );
      setResults([...acc]);

      // ── 3. Full-arc check-in → ending turn, SAME JSON contract.
      // Drives the real WAVE 5-turn arc (score → body → obstacle →
      // technique landed → readiness confirmed) so the model is AT the
      // genuine ending point — the real test of whether the parsed
      // `endConversation` JSON field fires at the end on stock Gemma.
      setNote("3/4 · check-in JSON (full arc → ending)…");
      const ciTurnsFullArc = [
        "It's about a seven.",
        "It's mostly in my chest, tight, but it eased a little near the end.",
        "Honestly I kept wanting to check my phone — it was hard to stay with it.",
        "Yeah, that actually helped, the urge backed off a bit.",
        "Yeah, I'm ready to keep going.",
      ];
      acc.push(
        await runCheckInSingleShot(
          modelPath,
          "Check-in JSON single-shot (full arc → ending)",
          ciSystemJson,
          ciTurnsFullArc,
        ),
      );
      setResults([...acc]);

      // ── 4. Reflection
      setNote("4/4 · reflection…");
      const refl = buildReflectionPrompt({
        intakeIntensity: 7,
        matType: "buprenorphine",
        medicationStatus: "on_time",
        trigger: "stress",
        usedSubstanceToday: false,
        bodyLocation: "chest",
        currentIntensity: 4,
        endingIntensity: 3,
        durationSeconds: 600,
      } satisfies ReflectionContext);
      acc.push(
        await runSurface(modelPath, "Reflection", refl.systemPrompt, [
          refl.userPrompt,
        ]),
      );
      setResults([...acc]);

      probeMlDrift();
      setNote("Done — 4 surfaces.");
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    } finally {
      busyRef.current = false;
    }
  };

  const busy = phase === "downloading" || phase === "running";

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    >
      <Text style={styles.sub} selectable>
        {intro}
      </Text>

      <View style={styles.statusRow}>
        <Text style={styles.statusLabel}>Phase:</Text>
        <Text style={[styles.statusValue, phaseStyle(phase)]}>{phase}</Text>
        {busy && <ActivityIndicator size="small" style={{ marginLeft: 8 }} />}
      </View>
      {phase === "downloading" && (
        <Text style={styles.kv}>Download: {(downloadPct * 100).toFixed(1)}%</Text>
      )}
      {!!note && <Text style={styles.noteText}>{note}</Text>}
      {mldrift && <Text style={styles.kv}>MLDrift GPU cache: {mldrift}</Text>}

      {error && (
        <View style={[styles.panel, styles.errorPanel]}>
          <Text style={styles.panelHead}>Error</Text>
          <Text selectable style={styles.errorText}>{error}</Text>
        </View>
      )}

      <View style={styles.buttonRow}>
        <Pressable
          style={[styles.button, busy && styles.buttonDisabled]}
          disabled={busy}
          onPress={onRunDemo}
        >
          <Text style={styles.buttonText}>
            {phase === "done" || phase === "error"
              ? "Re-run 3-surface demo"
              : "Run 3-surface demo"}
          </Text>
        </Pressable>
      </View>

      {results.map((r, i) => (
        <View key={i} style={styles.panel}>
          <Text style={styles.panelHead}>{r.label}</Text>
          {r.error ? (
            <Text selectable style={styles.errorText}>{r.error}</Text>
          ) : (
            <>
              {r.toolCall && (
                <Text selectable style={styles.toolCall}>
                  🛠 {r.toolCall}
                </Text>
              )}
              <Text selectable style={styles.outputText}>{r.text}</Text>
              {r.stats && (
                <Text selectable style={styles.metrics}>
                  {r.stats.completionTokens} tok ·{" "}
                  {r.stats.tokensPerSecond.toFixed(1)} tok/s · TTFT{" "}
                  {r.stats.ttftMs.toFixed(0)} ms · total{" "}
                  {(r.stats.totalMs / 1000).toFixed(1)} s · RSS{" "}
                  {fmtBytes(r.stats.residentBytes)}
                </Text>
              )}
            </>
          )}
        </View>
      ))}
    </ScrollView>
  );
}

function phaseStyle(p: Phase) {
  switch (p) {
    case "done":
      return { color: "#34D399" };
    case "error":
      return { color: "#F87171" };
    case "running":
    case "downloading":
      return { color: "#FBBF24" };
    default:
      return { color: "#9CA3AF" };
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#08080C" },
  content: { padding: 16, gap: 12 },
  sub: { color: "#9CA3AF", fontSize: 13, lineHeight: 18 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  statusLabel: { color: "#9CA3AF", fontSize: 14 },
  statusValue: { fontSize: 14, fontWeight: "600" },
  noteText: { color: "#58A6FF", fontSize: 13, fontWeight: "600" },
  panel: {
    backgroundColor: "#16161F",
    padding: 12,
    borderRadius: 8,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: "#23232F",
    gap: 6,
  },
  errorPanel: { borderColor: "#7F1D1D" },
  panelHead: {
    color: "#6B7280",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  kv: { color: "#F1F1F4", fontSize: 13, fontFamily: "Menlo" },
  outputText: { color: "#F1F1F4", fontSize: 13, lineHeight: 18 },
  toolCall: {
    color: "#34D399",
    fontSize: 13,
    fontFamily: "Menlo",
    fontWeight: "700",
  },
  metrics: { color: "#9CA3AF", fontSize: 11, fontFamily: "Menlo", marginTop: 4 },
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
});
