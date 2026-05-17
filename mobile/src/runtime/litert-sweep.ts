/**
 * Wave#15 Phase 0 — adaptive, load-amortized LiteRT context-envelope probe.
 *
 * Replaces the O(n²) grid. Two facts drive the design:
 *  1. Model load (~2.6 GB) is the only expensive step. engineMaxTokens /
 *     outputMaxTokens / backend are load-time, but the *prompt* sent is
 *     free — so ONE loaded engine runs every surface × variant as cheap
 *     inner sends. The whole surface dimension is an inner loop, not
 *     reloads.
 *  2. The constraints are monotonic with known-ish ceilings, so we
 *     binary-search the ceiling instead of gridding it, seeded by what
 *     already passed on device (4096 / 512 on E2B/GPU/iPhone17Pro).
 *
 * Crash-resilience: every probe console.log's its result the instant it
 * completes (captured live by idevicesyslog), BEFORE the next load — so a
 * SIGSEGV on a risky >4096 outlier only loses the in-flight probe.
 *
 * To keep the system prompt out of the (load-time) LLMConfig so a single
 * load can A/B canonical vs compact, the surface's system text is folded
 * into the user message. Token counts stay truthful — we record the
 * engine's GenerationStats.promptTokens. Chat-template channel shift is an
 * accepted fidelity caveat for envelope mapping (see the plan doc).
 */

import { createLLM, type LiteRTLMInstance } from "react-native-litert-lm";

import { buildChunkPrompt } from "@/prompts/chunk-generator";
import { buildReflectionPrompt } from "@/prompts/reflection";
import type {
  ChunkGenerationContextPayload,
  ReflectionContext,
  SessionHistoryEntry,
} from "@/prompts/schemas";
import {
  WAVE_SYSTEM_PROMPT,
  WAVE_SYSTEM_PROMPT_STOCK_COMPACT,
} from "@/prompts/wave-system";

export type Backend = "gpu" | "cpu";
export type PromptVariant = "canonical" | "compact";
export type SurfaceId = "chunk1" | "chunk3" | "chunk5" | "reflection";

export interface Probe {
  surface: SurfaceId;
  variant: PromptVariant;
}

export type ProbeOutcome =
  | "ok"
  | "truncated"
  | "invalid_json"
  | "hang"
  | "empty"
  | "load_error"
  | "gen_error";

export interface ProbeResult {
  engineMaxTokens: number;
  outputMaxTokens: number;
  backend: Backend;
  surface: SurfaceId;
  variant: PromptVariant;
  outcome: ProbeOutcome;
  promptTokens: number | null;
  completionTokens: number | null;
  ttftMs: number | null;
  tokensPerSecond: number | null;
  residentBytes: number | null;
  isLowMemory: boolean | null;
  sample: string;
  error: string | null;
  wallMs: number;
}

const PROFILE: ChunkGenerationContextPayload["profile"] = {
  matType: "buprenorphine",
  medicationStatus: "on_time",
  trigger: "stress",
  triggerOther: null,
  usedSubstanceToday: false,
};

function priorChunk(n: 1 | 2 | 3 | 4 | 5): SessionHistoryEntry {
  return {
    kind: "chunk",
    chunkNumber: n,
    lines: [
      "Let your shoulders drop a little, and notice the weight of your body where it meets the chair.",
      "There is nothing to fix in this breath. Just let it arrive and leave on its own.",
      "If the urge is here, you do not have to push it away. You can let it sit beside you.",
      "Notice one place that feels even slightly more settled than a moment ago.",
      "You are not behind. You are exactly where this practice begins.",
      "When you are ready, let your attention widen back out to the room.",
    ],
  };
}

function historyUpTo(chunk: number): SessionHistoryEntry[] {
  const h: SessionHistoryEntry[] = [];
  for (let n = 1; n < chunk; n++) h.push(priorChunk(n as 1 | 2 | 3 | 4 | 5));
  return h;
}

const REFLECTION_CTX: ReflectionContext = {
  intakeIntensity: 7,
  matType: "buprenorphine",
  medicationStatus: "on_time",
  trigger: "stress",
  usedSubstanceToday: false,
  bodyLocation: "chest",
  currentIntensity: 4,
  endingIntensity: 3,
  durationSeconds: 600,
};

/**
 * Production-faithful: returns {systemPrompt,userPrompt} separately so the
 * system prompt goes into loadModel's LLMConfig (exactly how the WAVE
 * generators call it) and only the user turn is sent via sendMessage.
 *
 * The earlier "fold system into the message + empty systemPrompt" trick
 * (to amortize one load over many surfaces) hit a pathological wrapper
 * path that hung even on the ~700-token reflection prompt — so it's gone.
 * One load per probe; correctness over cleverness.
 */
export function buildSurfacePrompt(p: Probe): {
  systemPrompt: string;
  userPrompt: string;
} {
  if (p.surface === "reflection") {
    return buildReflectionPrompt(REFLECTION_CTX);
  }
  const chunkNumber = (
    p.surface === "chunk1" ? 1 : p.surface === "chunk3" ? 3 : 5
  ) as 1 | 3 | 5;
  const ctx: ChunkGenerationContextPayload = {
    chunkNumber,
    intakeIntensity: 7,
    profile: PROFILE,
    sessionHistory: historyUpTo(chunkNumber),
  };
  const c = buildChunkPrompt(ctx);
  const systemPrompt =
    p.variant === "compact" && c.systemPrompt.includes(WAVE_SYSTEM_PROMPT)
      ? c.systemPrompt.replace(
          WAVE_SYSTEM_PROMPT,
          WAVE_SYSTEM_PROMPT_STOCK_COMPACT,
        )
      : c.systemPrompt;
  return { systemPrompt, userPrompt: c.userPrompt };
}

/** chunk5/canonical = the heaviest input; used to probe ceilings honestly. */
export const HEAVY_PROBE: Probe = { surface: "chunk5", variant: "canonical" };
/** A surface whose schema wants the most output, for the O-ceiling search. */
export const LONG_OUTPUT_PROBE: Probe = {
  surface: "chunk1",
  variant: "compact",
};

function classify(
  surface: SurfaceId,
  text: string,
  completion: number,
  outputMaxTokens: number,
): ProbeOutcome {
  if (!text) return "empty";
  const m = text.match(/\{[\s\S]*\}/);
  let valid = false;
  if (m) {
    try {
      const o = JSON.parse(m[0]);
      valid =
        surface === "reflection"
          ? typeof o.insight === "string" && !!o.nextSteps
          : Array.isArray(o.lines) && o.lines.length > 0;
    } catch {
      valid = false;
    }
  }
  if (valid) return completion >= outputMaxTokens ? "truncated" : "ok";
  return completion >= outputMaxTokens ? "truncated" : "invalid_json";
}

const blank = (
  cfg: { engineMaxTokens: number; outputMaxTokens: number; backend: Backend },
  p: Probe,
): Omit<ProbeResult, "outcome" | "wallMs"> => ({
  ...cfg,
  surface: p.surface,
  variant: p.variant,
  promptTokens: null,
  completionTokens: null,
  ttftMs: null,
  tokensPerSecond: null,
  residentBytes: null,
  isLowMemory: null,
  sample: "",
  error: null,
});

function emit(r: ProbeResult) {
  // Streamed live by idevicesyslog -m litert-sweep — crash-safe checkpoint.
  // eslint-disable-next-line no-console
  console.log("[litert-sweep]", JSON.stringify(r));
}

/**
 * One probe = one model load (systemPrompt in LLMConfig, exactly like the
 * WAVE generators) + one sendMessage(userPrompt). Production-faithful.
 * Result is emit()'d immediately (idevicesyslog crash-safe checkpoint).
 * On hang the wedged native call cannot be cancelled and close() on it
 * crashes the app — so we DON'T close; the caller must stop (process is
 * effectively dead) and prior probes are already streamed.
 */
export async function runProbe(
  modelPath: string,
  cfg: { engineMaxTokens: number; outputMaxTokens: number; backend: Backend },
  p: Probe,
  timeoutMs: number,
): Promise<ProbeResult> {
  const t0 = Date.now();
  let llm: LiteRTLMInstance | null = null;
  let hung = false;
  try {
    const { systemPrompt, userPrompt } = buildSurfacePrompt(p);
    llm = createLLM({ enableMemoryTracking: true });
    try {
      await llm.loadModel(modelPath, {
        backend: cfg.backend,
        engineMaxTokens: cfg.engineMaxTokens,
        outputMaxTokens: cfg.outputMaxTokens,
        systemPrompt,
        temperature: 0,
        topK: 1,
      });
    } catch (e) {
      const r: ProbeResult = {
        ...blank(cfg, p),
        outcome: "load_error",
        error: e instanceof Error ? e.message : String(e),
        wallMs: Date.now() - t0,
      };
      emit(r);
      return r;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<{ hang: true }>((res) => {
      timer = setTimeout(() => res({ hang: true }), timeoutMs);
    });
    const gen = llm
      .sendMessage(userPrompt)
      .then((text) => ({ hang: false as const, text }));
    let race: { hang: true } | { hang: false; text: string };
    try {
      race = await Promise.race([gen, timeout]);
    } catch (e) {
      if (timer) clearTimeout(timer);
      const r: ProbeResult = {
        ...blank(cfg, p),
        outcome: "gen_error",
        error: e instanceof Error ? e.message : String(e),
        wallMs: Date.now() - t0,
      };
      emit(r);
      return r;
    }
    if (timer) clearTimeout(timer);

    if ("hang" in race && race.hang) {
      hung = true;
      const r: ProbeResult = {
        ...blank(cfg, p),
        outcome: "hang",
        wallMs: Date.now() - t0,
      };
      emit(r);
      return r;
    }

    const text = (race as { text: string }).text ?? "";
    let st: Partial<{
      promptTokens: number;
      completionTokens: number;
      timeToFirstToken: number;
      tokensPerSecond: number;
    }> = {};
    let mem: Partial<{ residentBytes: number; isLowMemory: boolean }> = {};
    try {
      st = llm.getStats() as typeof st;
    } catch {
      /* best-effort */
    }
    try {
      mem = llm.getMemoryUsage() as typeof mem;
    } catch {
      /* best-effort */
    }
    const completion = st.completionTokens ?? 0;
    const r: ProbeResult = {
      ...blank(cfg, p),
      outcome: classify(p.surface, text, completion, cfg.outputMaxTokens),
      promptTokens: st.promptTokens ?? null,
      completionTokens: st.completionTokens ?? null,
      ttftMs: st.timeToFirstToken ?? null,
      tokensPerSecond: st.tokensPerSecond ?? null,
      residentBytes: mem.residentBytes ?? null,
      isLowMemory: mem.isLowMemory ?? null,
      sample: text.slice(0, 160),
      wallMs: Date.now() - t0,
    };
    emit(r);
    return r;
  } finally {
    if (!hung) {
      try {
        llm?.close();
      } catch {
        /* torn down regardless */
      }
    }
  }
}

/**
 * Single-load, ASCENDING-input probe at the best known-safe config
 * (E=4096, O=512 — already shown on device to load & run chunk1; the
 * chunk1 data also showed output is naturally ~94 tok, so O is not the
 * constraint — input length is). One expensive load; every surface×variant
 * runs as a free inner send, ordered lightest→heaviest input so every
 * passing case is streamed BEFORE the one that hangs/crashes. The boundary
 * is wherever it flips ok→hang. A hang ends the pass (engine wedged) but
 * all prior results are already captured.
 *
 * This replaces the earlier ceiling-binary-search, which started with the
 * heaviest prompt and crashed the app before learning anything (the
 * observed `chunk5/canonical @4096 → hang` then SIGSEGV on close).
 * The >4096 ceiling question is handled separately by the one-shot
 * outlier probes in the screen.
 */
export const ASCENDING_PROBES: Probe[] = [
  // chunk1/canonical is the CONTROL: the v1 grid proved it ok at
  // 4096/512 (94 tok, ~30 s). If it's ok here too, the harness is sound
  // and any later "hang" is real (slow-to-cap or wedge), not a bug. With
  // the 300 s timeout below, a slow-but-completing gen now reports its
  // true completionTokens + tok/s instead of a false "hang".
  { surface: "chunk1", variant: "canonical" }, // CONTROL (known-good)
  { surface: "reflection", variant: "canonical" }, // ~700 tok in
  { surface: "chunk1", variant: "compact" },
  { surface: "chunk3", variant: "compact" },
  { surface: "chunk3", variant: "canonical" },
  { surface: "chunk5", variant: "compact" },
  { surface: "chunk5", variant: "canonical" }, // heaviest input
];

export async function runAdaptiveSafe(
  modelPath: string,
  timeoutMs: number,
  onResult: (r: ProbeResult) => void,
): Promise<{ eStar: number; oStar: number; results: ProbeResult[] }> {
  const all: ProbeResult[] = [];
  const cfg = {
    engineMaxTokens: 4096,
    outputMaxTokens: 512,
    backend: "gpu" as Backend,
  };
  // One load per probe (system in LLMConfig). Ascending input order, so a
  // hang/crash on the heavy end never costs the lighter results. Stop the
  // moment one hangs — the process is wedged; relaunch resumes from a
  // trimmed ASCENDING_PROBES if needed.
  for (const p of ASCENDING_PROBES) {
    const r = await runProbe(modelPath, cfg, p, timeoutMs);
    all.push(r);
    onResult(r);
    if (r.outcome === "hang") return { eStar: 4096, oStar: 512, results: all };
  }

  // Nothing hung — engine path is healthy. One CPU sanity (backend
  // behaviour differs sharply; #6765 was CPU-only).
  const cpu = await runProbe(
    modelPath,
    { engineMaxTokens: 4096, outputMaxTokens: 512, backend: "cpu" },
    { surface: "chunk3", variant: "canonical" },
    timeoutMs,
  );
  all.push(cpu);
  onResult(cpu);

  return { eStar: 4096, oStar: 512, results: all };
}

/** Suggested upward outlier ladder for the manual >4096 probe control. */
export const OUTLIER_LADDER = [6144, 8192, 12288, 16384, 24576, 32768];
// 300 s: at the stock bundle's ~3 tok/s, a near-cap generation
// (≈512 tok ≈ 170 s) must be allowed to finish so we capture
// valid-but-slow (the real throughput finding) instead of a false
// "hang". A true wedge still trips this; the distinction is the point.
export const SWEEP_TIMEOUT_MS = 300_000;
