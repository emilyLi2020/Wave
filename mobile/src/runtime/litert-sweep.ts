/**
 * Wave#15 Phase 0 — on-device LiteRT context-envelope sweep.
 *
 * Measures the REAL usable (engineMaxTokens × outputMaxTokens × backend ×
 * system-prompt-variant × WAVE surface) envelope of the stock
 * `gemma-4-E2B-it.litertlm` bundle on device via the
 * react-native-litert-lm-wave fork — because the "hard 2048/256" framing
 * was disproven (see docs/plans/litert-cache-reexport-plan.md).
 *
 * Honest scope: this is a measurement harness, not a guarantee. It records
 * real tokenizer counts (GenerationStats.promptTokens), JSON validity,
 * truncation, RAM, TTFT, tok/s, and — critically, per upstream
 * LiteRT-LM#2202 — silent-hang behaviour with a hard per-cell timeout and
 * conversation/engine teardown so one wedged cell can't poison the rest.
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
export type SurfaceId =
  | "chunk1"
  | "chunk3"
  | "chunk5"
  | "reflection";

export interface SweepCell {
  surface: SurfaceId;
  variant: PromptVariant;
  backend: Backend;
  engineMaxTokens: number;
  outputMaxTokens: number;
}

export type SweepOutcome =
  | "ok"
  | "truncated"
  | "invalid_json"
  | "hang"
  | "load_error"
  | "gen_error";

export interface SweepResult {
  cell: SweepCell;
  outcome: SweepOutcome;
  /** Real tokenizer prompt count from the engine (not chars/4). */
  promptTokens: number | null;
  completionTokens: number | null;
  ttftMs: number | null;
  tokensPerSecond: number | null;
  residentBytes: number | null;
  isLowMemory: boolean | null;
  /** First ~200 chars of output, for eyeballing coherence. */
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

/** One realistic ~6-line prior chunk (~90–110 tokens) for history inflation. */
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
 * Build {systemPrompt,userPrompt} for a surface. For `compact`, swap the
 * canonical WAVE_SYSTEM_PROMPT embedded by the chunk builder for the
 * compact variant (string replace — the production builders are
 * untouched). Reflection has its own system prompt (no WAVE_SYSTEM_PROMPT
 * inside) so canonical === compact there; flagged by caller.
 */
export function buildSurfacePrompt(
  surface: SurfaceId,
  variant: PromptVariant,
): { systemPrompt: string; userPrompt: string; variantApplies: boolean } {
  if (surface === "reflection") {
    const p = buildReflectionPrompt(REFLECTION_CTX);
    return { ...p, variantApplies: false };
  }
  const chunkNumber = (
    surface === "chunk1" ? 1 : surface === "chunk3" ? 3 : 5
  ) as 1 | 3 | 5;
  const ctx: ChunkGenerationContextPayload = {
    chunkNumber,
    intakeIntensity: 7,
    profile: PROFILE,
    sessionHistory: historyUpTo(chunkNumber),
  };
  const p = buildChunkPrompt(ctx);
  if (variant === "canonical") return { ...p, variantApplies: true };
  const swapped = p.systemPrompt.includes(WAVE_SYSTEM_PROMPT)
    ? p.systemPrompt.replace(
        WAVE_SYSTEM_PROMPT,
        WAVE_SYSTEM_PROMPT_STOCK_COMPACT,
      )
    : p.systemPrompt;
  return {
    systemPrompt: swapped,
    userPrompt: p.userPrompt,
    variantApplies: swapped !== p.systemPrompt,
  };
}

function looksLikeValidJson(surface: SurfaceId, text: string): boolean {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return false;
  try {
    const obj = JSON.parse(m[0]);
    if (surface === "reflection") {
      return (
        typeof obj.insight === "string" &&
        obj.nextSteps &&
        typeof obj.nextSteps === "object"
      );
    }
    return Array.isArray(obj.lines) && obj.lines.length > 0;
  } catch {
    return false;
  }
}

/**
 * Run one cell. Loads a fresh engine (config is load-time), sends the
 * user prompt with a hard timeout, classifies the outcome, and ALWAYS
 * tears the engine down — a hung cell never reuses its conversation.
 */
export async function runCell(
  modelPath: string,
  cell: SweepCell,
  timeoutMs: number,
): Promise<SweepResult> {
  const t0 = Date.now();
  const base: Omit<SweepResult, "outcome" | "wallMs"> = {
    cell,
    promptTokens: null,
    completionTokens: null,
    ttftMs: null,
    tokensPerSecond: null,
    residentBytes: null,
    isLowMemory: null,
    sample: "",
    error: null,
  };
  let llm: LiteRTLMInstance | null = null;
  try {
    const { systemPrompt, userPrompt } = buildSurfacePrompt(
      cell.surface,
      cell.variant,
    );
    llm = createLLM({ enableMemoryTracking: true });
    try {
      await llm.loadModel(modelPath, {
        backend: cell.backend,
        engineMaxTokens: cell.engineMaxTokens,
        outputMaxTokens: cell.outputMaxTokens,
        systemPrompt,
        temperature: 0,
        topK: 1,
      });
    } catch (e) {
      return {
        ...base,
        outcome: "load_error",
        error: e instanceof Error ? e.message : String(e),
        wallMs: Date.now() - t0,
      };
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<{ hang: true }>((resolve) => {
      timer = setTimeout(() => resolve({ hang: true }), timeoutMs);
    });
    const gen = llm
      .sendMessage(userPrompt)
      .then((text) => ({ hang: false as const, text }));

    const race = await Promise.race([gen, timeout]);
    if (timer) clearTimeout(timer);

    if ("hang" in race && race.hang) {
      return { ...base, outcome: "hang", wallMs: Date.now() - t0 };
    }

    const text = (race as { text: string }).text ?? "";
    let stats: Partial<{
      promptTokens: number;
      completionTokens: number;
      timeToFirstToken: number;
      tokensPerSecond: number;
    }> = {};
    try {
      stats = llm.getStats() as typeof stats;
    } catch {
      /* stats best-effort */
    }
    let mem: Partial<{ residentBytes: number; isLowMemory: boolean }> = {};
    try {
      mem = llm.getMemoryUsage() as typeof mem;
    } catch {
      /* mem best-effort */
    }

    const completion = stats.completionTokens ?? 0;
    const truncated =
      completion >= cell.outputMaxTokens ||
      !looksLikeValidJson(cell.surface, text);
    const outcome: SweepOutcome = !text
      ? "gen_error"
      : !looksLikeValidJson(cell.surface, text)
        ? completion >= cell.outputMaxTokens
          ? "truncated"
          : "invalid_json"
        : truncated
          ? "truncated"
          : "ok";

    return {
      ...base,
      outcome,
      promptTokens: stats.promptTokens ?? null,
      completionTokens: stats.completionTokens ?? null,
      ttftMs: stats.timeToFirstToken ?? null,
      tokensPerSecond: stats.tokensPerSecond ?? null,
      residentBytes: mem.residentBytes ?? null,
      isLowMemory: mem.isLowMemory ?? null,
      sample: text.slice(0, 200),
      wallMs: Date.now() - t0,
    };
  } catch (e) {
    return {
      ...base,
      outcome: "gen_error",
      error: e instanceof Error ? e.message : String(e),
      wallMs: Date.now() - t0,
    };
  } finally {
    try {
      llm?.close();
    } catch {
      /* engine torn down regardless */
    }
  }
}

/**
 * Curated matrix (NOT full cartesian — each cell reloads the 2.6 GB
 * bundle, so this is ~25 cells, sequential). GPU is WAVE's real path; one
 * CPU sanity row because upstream behaviour differs sharply by backend
 * (#6765 was CPU-only). Edit freely between runs.
 */
export const DEFAULT_CELLS: SweepCell[] = (() => {
  const cells: SweepCell[] = [];
  const surfaces: SurfaceId[] = ["chunk1", "chunk3", "chunk5", "reflection"];
  const engineVals = [2048, 3072, 4096];
  const outVals = [256, 512];
  for (const surface of surfaces) {
    for (const variant of ["canonical", "compact"] as PromptVariant[]) {
      // reflection: variant doesn't change its prompt — run once.
      if (surface === "reflection" && variant === "compact") continue;
      for (const engineMaxTokens of engineVals) {
        for (const outputMaxTokens of outVals) {
          cells.push({
            surface,
            variant,
            backend: "gpu",
            engineMaxTokens,
            outputMaxTokens,
          });
        }
      }
    }
  }
  // CPU sanity: one mid cell.
  cells.push({
    surface: "chunk3",
    variant: "canonical",
    backend: "cpu",
    engineMaxTokens: 4096,
    outputMaxTokens: 256,
  });
  return cells;
})();

export const SWEEP_TIMEOUT_MS = 90_000;
