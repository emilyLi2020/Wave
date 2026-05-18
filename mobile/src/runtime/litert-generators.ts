// LiteRT-LM-backed implementations of the four generator functions the
// lib/gemma wrappers consume. Same shapes as
// client/lib/gemma/wllama-generators.ts so swapping is a one-line import
// change downstream.
//
// Strategy notes for the LiteRT port (carry from wllama):
//   - The wrapper's LLMConfig has no response_format / grammar option.
//     We rely on the existing <output_contract> prompt blocks +
//     extractFirstJsonObject + Zod at the call site instead of engine-enforced
//     JSON schema. Per plan: "Drop json_schema for check-in, keep a strict
//     JSON <output_contract> in the prompt, and parse the trailing
//     endConversation field after stream end via parseCheckInJson."
//   - The wrapper's chat surface treats systemPrompt as load-time config and
//     per-call messages as user-only. Each WAVE flow has its own composed
//     system prompt, so we load with NO system prompt and pass the full
//     composed prompt as one user message after resetConversation(). If
//     output quality on the fine-tune degrades vs. wllama, fall back to per
//     -flow reloads or bypass via applyGemmaTemplate.
//   - sendMessageAsync has no AbortSignal. Aborting from JS stops the
//     accumulator but the native generator keeps running until done. For
//     step 5c barge-in we'll either close() and reload, or upstream a cancel
//     PR.
//   - Check-in's onDelta semantics mirror wllama: fire ONCE at stream end
//     with the sanitized reply. Streaming the raw JSON-in-progress to the
//     voice loop would leak `{"reply": "...` fragments into the sentence
//     buffer, which Kokoro would then speak. A future step (5c polish) can
//     add a JSON-aware streaming state machine that emits chars only from
//     inside the `reply` string.

import { createLLM } from "react-native-litert-lm";
import type { LiteRTLMInstance } from "react-native-litert-lm";

import { ensureModel, type ModelId } from "@/runtime/model-cache";
import { buildCheckInPrompt } from "@/lib/prompts/check-in";
import { buildChunkPrompt } from "@/lib/prompts/chunk-generator";
import { buildInsightsPrompt } from "@/lib/prompts/insights";
import { buildReflectionPrompt } from "@/lib/prompts/reflection";
import type {
  CheckInContextPayload,
  ChunkGenerationContextPayload,
  ReflectionContext,
} from "@/lib/prompts/schemas";
import type {
  CheckInChatTurnPayload,
  EndConversationSignal,
} from "@/lib/gemma/checkin";
import type { ObstacleCategory } from "@/types/session";
import type { Session } from "@/types/models";

// Model URL + manifest entry live in src/runtime/model-cache.ts (id:
// 'litert-wave'). We download via ensureModel + pass the local path to
// loadModel; that way the cache panel in the dev menu can inspect/clear
// LiteRT alongside the other models, instead of being hidden inside the
// wrapper's Library/Caches/litert_models/ directory.

interface GenerateOptions {
  maxNewTokens: number;
  signal?: AbortSignal;
  onDelta?: (accumulated: string) => void;
}

export interface LocalChunkResult {
  text: string;
}

export interface LocalCheckInResult {
  text: string;
  endConversation: EndConversationSignal | null;
}

const CHECK_IN_TOOL_NONE_OBSTACLE = "none" as const;
const ALLOWED_OBSTACLES: readonly ObstacleCategory[] = [
  "cannot_visualize",
  "mind_wandering",
  "urge_overwhelming",
  "breath_tight",
  "breath_anxiety",
  "gave_in",
  "guilt_failure",
  "physical_discomfort",
  "sleepiness",
];
const CHECK_IN_TOOL_OBSTACLES = [
  CHECK_IN_TOOL_NONE_OBSTACLE,
  ...ALLOWED_OBSTACLES,
] as const;

// ────────────────────────────────────────────────────────────────────────
// Keyed model lifecycle
//
// Review pass 1 (#1, issue #21): the old single `llmPromise` memoized the
// FIRST load and ignored every later `backend`/model — so a caller asking
// for stock-Gemma-on-GPU silently got whatever loaded first (litert-wave on
// CPU). The registry below memoizes per (modelId, backend, engine/output
// budget, systemPrompt) so the voice loop can hold a stock-GPU instance
// while the existing generators keep their litert-wave CPU instance.
// `preloadWaveLiteRT` is preserved as a thin wrapper so existing generator
// callers are byte-for-byte unchanged.
// ────────────────────────────────────────────────────────────────────────

export type LoadProgressCallback = (progressPct: number) => void;

export interface LiteRTLoadConfig {
  modelId: ModelId;
  backend: "gpu" | "cpu" | "npu";
  engineMaxTokens: number;
  outputMaxTokens: number;
  /** Load-time system prompt — the wrapper bakes it at loadModel(). */
  systemPrompt?: string;
  temperature?: number;
  topK?: number;
}

export interface LoadOptions {
  onProgress?: LoadProgressCallback;
  /**
   * @deprecated The single-singleton no-op trap. Prefer preloadLiteRT(config).
   * Kept so existing preloadWaveLiteRT(opts) call sites still compile.
   */
  backend?: "gpu" | "cpu" | "npu";
}

function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function cacheKey(c: LiteRTLoadConfig): string {
  return [
    c.modelId,
    c.backend,
    c.engineMaxTokens,
    c.outputMaxTokens,
    c.temperature ?? 0,
    c.topK ?? 1,
    c.systemPrompt ? `sp:${djb2(c.systemPrompt)}` : "sp:none",
  ].join("|");
}

const llmRegistry = new Map<string, Promise<LiteRTLMInstance>>();

/**
 * Load (or return the memoized) LiteRT-LM instance for an exact
 * (modelId, backend, token budget, systemPrompt) configuration. Distinct
 * configs get distinct resident instances — that's the whole point of the
 * refactor: the voice loop's stock-GPU instance and the generators'
 * litert-wave-CPU instance coexist instead of clobbering each other.
 */
export function preloadLiteRT(
  config: LiteRTLoadConfig,
  opts?: { onProgress?: LoadProgressCallback },
): Promise<LiteRTLMInstance> {
  const key = cacheKey(config);
  let entry = llmRegistry.get(key);
  if (!entry) {
    entry = (async () => {
      // ensureModel is idempotent — cheap on a cache hit.
      const fileUri = await ensureModel(config.modelId, {
        onProgress: opts?.onProgress,
      });
      // The LiteRT-LM C++ engine stat()s the raw path (HybridLiteRTLM.cpp
      // ~line 348/392); expo-file-system hands back file:// URIs which
      // fail stat() with errno 2. Strip the scheme before loadModel.
      const nativePath = fileUri.replace(/^file:\/\//, "");
      const llm = createLLM({ enableMemoryTracking: true });
      await llm.loadModel(nativePath, {
        backend: config.backend,
        engineMaxTokens: config.engineMaxTokens,
        outputMaxTokens: config.outputMaxTokens,
        ...(config.systemPrompt
          ? { systemPrompt: config.systemPrompt }
          : {}),
        temperature: config.temperature ?? 0,
        topK: config.topK ?? 1,
      });
      return llm;
    })();
    llmRegistry.set(key, entry);
    // Drop a rejected load so a retry actually re-loads instead of
    // re-returning the cached failure.
    entry.catch(() => {
      if (llmRegistry.get(key) === entry) llmRegistry.delete(key);
    });
  }
  return entry;
}

export async function unloadLiteRT(config: LiteRTLoadConfig): Promise<void> {
  const key = cacheKey(config);
  const entry = llmRegistry.get(key);
  if (!entry) return;
  llmRegistry.delete(key);
  try {
    (await entry).close();
  } catch {
    /* best-effort — a failed load has nothing to close */
  }
}

// litert-wave on CPU, no system prompt: the config every existing generator
// caller used implicitly. Behavior is unchanged from the old singleton.
const WAVE_CONFIG: LiteRTLoadConfig = {
  modelId: "litert-wave",
  backend: "cpu",
  // Fork split knobs. The litert-lm-v3 fine-tune bundle was exported with
  // --cache_length=4096 --prefill_lengths=[512,1024], so the KV budget can
  // be the full 4096 and the chunk-1/reflection prompts fit. outputMaxTokens
  // stays at the conservative 256-token decode-chunk default.
  engineMaxTokens: 4096,
  outputMaxTokens: 256,
  temperature: 0,
  topK: 1,
};

export function preloadWaveLiteRT(
  opts?: LoadOptions,
): Promise<LiteRTLMInstance> {
  return preloadLiteRT(
    { ...WAVE_CONFIG, backend: opts?.backend ?? WAVE_CONFIG.backend },
    { onProgress: opts?.onProgress },
  );
}

export async function unloadWaveLiteRT(): Promise<void> {
  // Unload whichever backend variants of the wave bundle got loaded.
  await Promise.all(
    (["cpu", "gpu", "npu"] as const).map((backend) =>
      unloadLiteRT({ ...WAVE_CONFIG, backend }),
    ),
  );
}

// ────────────────────────────────────────────────────────────────────────
// Generation primitive
// ────────────────────────────────────────────────────────────────────────

function streamOnce(
  llm: LiteRTLMInstance,
  prompt: string,
  options: GenerateOptions,
): Promise<string> {
  llm.resetConversation();
  return new Promise<string>((resolve, reject) => {
    let accumulated = "";
    let resolved = false;
    try {
      llm.sendMessageAsync(prompt, (token, done) => {
        if (resolved) return;
        if (options.signal?.aborted) {
          resolved = true;
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        accumulated += token;
        options.onDelta?.(accumulated);
        if (done) {
          resolved = true;
          resolve(accumulated);
        }
      });
    } catch (err) {
      reject(err as Error);
    }
  });
}

// ────────────────────────────────────────────────────────────────────────
// Chunk narration
// ────────────────────────────────────────────────────────────────────────

export async function generateWllamaChunk(
  context: ChunkGenerationContextPayload,
  options: GenerateOptions,
): Promise<LocalChunkResult> {
  throwIfAborted(options.signal);
  const llm = await preloadWaveLiteRT();
  throwIfAborted(options.signal);

  const prompt = buildChunkPrompt(context);
  const combined = `${prompt.systemPrompt}\n\n${prompt.userPrompt}`;

  const raw = await streamOnce(llm, combined, options);
  throwIfAborted(options.signal);
  return { text: extractFirstJsonObject(raw) };
}

// ────────────────────────────────────────────────────────────────────────
// Reflection (final structured card after check-in 5)
// ────────────────────────────────────────────────────────────────────────

export async function generateWllamaReflection(
  input: ReflectionContext,
  options: GenerateOptions,
): Promise<LocalChunkResult> {
  throwIfAborted(options.signal);
  const llm = await preloadWaveLiteRT();
  throwIfAborted(options.signal);

  const prompt = buildReflectionPrompt(input);
  const combined = `${prompt.systemPrompt}\n\n${prompt.userPrompt}`;

  const raw = await streamOnce(llm, combined, options);
  throwIfAborted(options.signal);
  return { text: extractFirstJsonObject(raw) };
}

// ────────────────────────────────────────────────────────────────────────
// Insights (cross-session patterns card, /insights page)
// ────────────────────────────────────────────────────────────────────────

export async function generateWllamaInsights(
  sessions: readonly Session[],
  options: GenerateOptions,
): Promise<LocalChunkResult> {
  throwIfAborted(options.signal);
  const llm = await preloadWaveLiteRT();
  throwIfAborted(options.signal);

  const prompt = buildInsightsPrompt([...sessions]);
  const combined = `${prompt.systemPrompt}\n\n${prompt.userPrompt}`;

  const raw = await streamOnce(llm, combined, options);
  throwIfAborted(options.signal);
  return { text: extractFirstJsonObject(raw) };
}

// ────────────────────────────────────────────────────────────────────────
// Multi-turn check-in
// ────────────────────────────────────────────────────────────────────────

export async function generateWllamaCheckIn(
  history: readonly CheckInChatTurnPayload[],
  context: CheckInContextPayload,
  options: GenerateOptions,
): Promise<LocalCheckInResult> {
  throwIfAborted(options.signal);
  const llm = await preloadWaveLiteRT();
  throwIfAborted(options.signal);

  const agentTurnsInHistory = history.filter((t) => t.role === "agent").length;
  const { systemPrompt, contextBlock } = buildCheckInPrompt(context, {
    agentTurnsInHistory,
  });

  // The wrapper does not expose a multi-turn injection API (no setHistory).
  // Flatten the alternating conversation into a single user message inside a
  // resetConversation()-bounded turn. This re-prefills the prompt every call
  // (slower than wllama's chat completion at higher turn counts) but matches
  // the wllama-generators semantics exactly: same context in, same JSON out.
  const composedSystem = `${systemPrompt}

<output_contract>
Respond with a JSON object matching this exact schema:

{
  "reply": "<patient-facing prose, 1-3 short sentences>",
  "endConversation": null | { "cravingScore": <integer 1-10>, "obstacleCategory": "<one of: ${CHECK_IN_TOOL_OBSTACLES.join(", ")}>" }
}

Rules:
- "reply" is the visible patient-facing text the speaker will hear. Plain prose, no markdown, no lists.
- "endConversation" is null UNLESS this check-in is complete and the patient is ready to continue.
- When ending, "obstacleCategory" is "${CHECK_IN_TOOL_NONE_OBSTACLE}" when no clear obstacle is present.
- Emit nothing outside the JSON object — no preamble, no analysis, no extra keys.
</output_contract>`;

  const historyText = history
    .map((t) => `${t.role === "agent" ? "WAVE" : "Patient"}: ${t.content}`)
    .join("\n");

  const combined = `${composedSystem}

${contextBlock}

${historyText}

WAVE:`;

  const raw = await streamOnce(llm, combined, {
    ...options,
    // Suppress incremental delta emission during check-in: the JSON wrapper
    // means mid-stream chars are useless to the caller. The voice loop in
    // step 5c relies on the final-fire semantic (see file header).
    onDelta: undefined,
  });
  throwIfAborted(options.signal);

  const parsed = parseCheckInJson(raw);
  const replyText = sanitizeCheckInModelText(parsed.reply);
  options.onDelta?.(replyText);

  const endConversation = normalizeEndConversation(parsed.endConversation);
  return { text: replyText, endConversation };
}

// ────────────────────────────────────────────────────────────────────────
// helpers (verbatim port from wllama-generators.ts)
// ────────────────────────────────────────────────────────────────────────

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

export function extractFirstJsonObject(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return text.trim();
  return text.slice(start, end + 1);
}

interface CheckInJsonOutput {
  reply: string;
  endConversation: {
    cravingScore: number;
    obstacleCategory: string;
  } | null;
}

export function parseCheckInJson(raw: string): CheckInJsonOutput {
  const candidate = extractFirstJsonObject(raw);
  try {
    const parsed = JSON.parse(candidate) as Partial<CheckInJsonOutput>;
    const reply = typeof parsed.reply === "string" ? parsed.reply : "";
    const endConversation =
      parsed.endConversation &&
      typeof parsed.endConversation === "object" &&
      "cravingScore" in parsed.endConversation
        ? parsed.endConversation
        : null;
    return { reply, endConversation };
  } catch {
    return { reply: raw.trim(), endConversation: null };
  }
}

export function normalizeEndConversation(
  signal: CheckInJsonOutput["endConversation"],
): EndConversationSignal | null {
  if (!signal) return null;
  const score = Math.round(signal.cravingScore);
  if (!Number.isFinite(score) || score < 1 || score > 10) return null;
  const obstacle = signal.obstacleCategory;
  if (obstacle === CHECK_IN_TOOL_NONE_OBSTACLE) {
    return { cravingScore: score, obstacleCategory: null };
  }
  if (ALLOWED_OBSTACLES.includes(obstacle as ObstacleCategory)) {
    return {
      cravingScore: score,
      obstacleCategory: obstacle as ObstacleCategory,
    };
  }
  return { cravingScore: score, obstacleCategory: null };
}

function sanitizeCheckInModelText(text: string): string {
  return text
    .replace(/\]\s*\[/g, " ")
    .replace(/[\[\]]/g, "")
    .replace(/[–—]/g, ",")
    .replace(/\s+([,.;:?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
