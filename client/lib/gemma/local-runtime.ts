import type {
  DeviceType,
  ProgressInfo,
  TextGenerationPipeline,
} from "@huggingface/transformers";
import { transformersJS } from "@browser-ai/transformers-js";
import { jsonSchema, streamText, stepCountIs, tool } from "ai";
import { z } from "zod";

import { isAffirmative } from "@/lib/session/is-affirmative";
import { buildCheckInPrompt } from "@/lib/prompts/check-in";
import { buildChunkPrompt } from "@/lib/prompts/chunk-generator";
import { buildInsightsPrompt } from "@/lib/prompts/insights";
import { buildReflectionPrompt } from "@/lib/prompts/reflection";
import type {
  CheckInContextPayload,
  ChunkGenerationContextPayload,
  ReflectionContext,
} from "@/lib/prompts/schemas";
import type { Session } from "@/types/models";
import type {
  CheckInChatTurnPayload,
  EndConversationSignal,
} from "@/lib/gemma/checkin";
import type { ObstacleCategory } from "@/types/session";

export const GEMMA_MODEL_ID = "onnx-community/gemma-4-E2B-it-ONNX";
const GEMMA_CACHE_KEY = "wave-gemma4-cache";
const GEMMA_DTYPE = "q4f16";
const CHECK_IN_TOOL_NONE_OBSTACLE = "none";

type ChatRole = "system" | "user" | "assistant";

interface ChatMessage {
  role: ChatRole;
  content: string;
}

interface GenerateOptions {
  maxNewTokens: number;
  signal?: AbortSignal;
  onDelta?: (accumulated: string) => void;
}

export interface LocalCheckInResult {
  text: string;
  endConversation: EndConversationSignal | null;
}

export interface LocalChunkResult {
  text: string;
}

export interface LocalInsightsResult {
  text: string;
}

export type GemmaModelLoadPhase = "idle" | "loading" | "ready" | "error";

export interface GemmaModelFileLoadState {
  file: string;
  status: string;
  progress: number | null;
  loaded: number | null;
  total: number | null;
}

export interface GemmaModelLoadState {
  phase: GemmaModelLoadPhase;
  status: string;
  file: string | null;
  progress: number | null;
  device: DeviceType | null;
  message: string;
  files: readonly GemmaModelFileLoadState[];
}

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

const endConversationToolInputSchema = z.object({
  cravingScore: z.number().int().min(1).max(10),
  obstacleCategory: z.enum(CHECK_IN_TOOL_OBSTACLES).default(CHECK_IN_TOOL_NONE_OBSTACLE),
});

let generatorPromise: Promise<TextGenerationPipeline> | null = null;
let checkInModelPromise: Promise<ReturnType<typeof transformersJS>> | null = null;
let modelLoadState: GemmaModelLoadState = {
  phase: "idle",
  status: "idle",
  file: null,
  progress: null,
  device: null,
  message: "Waiting to prepare Gemma.",
  files: [],
};

const modelLoadListeners = new Set<(state: GemmaModelLoadState) => void>();
const MODEL_LOAD_NOTIFY_INTERVAL_MS = 300;
const MODEL_LOAD_LOG_PROGRESS_STEP = 10;
let lastModelLoadPublishedAt = 0;
let pendingModelLoadPublish: ReturnType<typeof setTimeout> | null = null;
const modelLoadLogProgressByFile = new Map<string, number>();

export function isLocalGemmaAvailable(): boolean {
  return typeof window !== "undefined" || typeof process !== "undefined";
}

export function getGemmaModelLoadState(): GemmaModelLoadState {
  return modelLoadState;
}

export function subscribeGemmaModelLoad(
  listener: (state: GemmaModelLoadState) => void,
): () => void {
  modelLoadListeners.add(listener);
  listener(modelLoadState);
  return () => {
    modelLoadListeners.delete(listener);
  };
}

export async function preloadLocalGemma(): Promise<void> {
  await getGenerator();
}

export async function generateGemmaReflection(
  input: ReflectionContext,
  options: GenerateOptions,
): Promise<LocalChunkResult> {
  const prompt = buildReflectionPrompt(input);
  const text = await generateChatText(
    [
      { role: "system", content: prompt.systemPrompt },
      { role: "user", content: prompt.userPrompt },
    ],
    options,
  );

  return { text: extractFirstJSONObject(text) };
}

export async function generateGemmaCheckIn(
  history: readonly CheckInChatTurnPayload[],
  context: CheckInContextPayload,
  options: GenerateOptions,
): Promise<LocalCheckInResult> {
  const agentTurnsInHistory = history.filter(
    (turn) => turn.role === "agent",
  ).length;
  const { systemPrompt, contextBlock } = buildCheckInPrompt(context, {
    agentTurnsInHistory,
  });

  const messages: ChatMessage[] = [
    {
      role: "user",
      content: `${contextBlock}

<local_runtime_output_contract>
Stream patient-facing prose directly. Do not wrap the visible reply in JSON or markdown.
When the check-in is complete, call the endConversation tool after the brief closing hand-off.
Tool schema compatibility: use obstacleCategory "${CHECK_IN_TOOL_NONE_OBSTACLE}" when no obstacle is clearly present.
</local_runtime_output_contract>`,
    },
  ];

  for (const turn of history) {
    messages.push({
      role: turn.role === "agent" ? "assistant" : "user",
      content: turn.content,
    });
  }

  const model = await getCheckInLanguageModel();
  throwIfAborted(options.signal);

  let rawAccumulatedText = "";
  let endConversation: EndConversationSignal | null = null;

  const result = streamText({
    model,
    system: systemPrompt,
    messages,
    maxOutputTokens: Math.max(options.maxNewTokens, 220),
    temperature: 0,
    abortSignal: options.signal,
    tools: {
      endConversation: tool({
        description:
          "End the WAVE check-in after the patient is ready to continue.",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            cravingScore: {
              type: "integer",
              minimum: 1,
              maximum: 10,
            },
            obstacleCategory: {
              type: "string",
              enum: [...CHECK_IN_TOOL_OBSTACLES],
            },
          },
          required: ["cravingScore", "obstacleCategory"],
          additionalProperties: false,
        }),
        execute: async (input) => {
          const parsed = endConversationToolInputSchema.parse(input);
          endConversation = {
            cravingScore: parsed.cravingScore,
            obstacleCategory:
              parsed.obstacleCategory === CHECK_IN_TOOL_NONE_OBSTACLE
                ? null
                : parsed.obstacleCategory,
          };
          return { ended: true };
        },
      }),
    },
    stopWhen: stepCountIs(1),
  });

  for await (const part of result.fullStream) {
    throwIfAborted(options.signal);
    if (part.type !== "text-delta") continue;

    rawAccumulatedText += getTextDelta(part);
    options.onDelta?.(sanitizeCheckInModelText(rawAccumulatedText));
  }

  const reply = sanitizeCheckInModelText(rawAccumulatedText);
  return {
    text: reply,
    endConversation:
      endConversation ?? inferEndConversationFromHistory(history, context, reply),
  };
}

export async function generateGemmaChunk(
  context: ChunkGenerationContextPayload,
  options: GenerateOptions,
): Promise<LocalChunkResult> {
  const prompt = buildChunkPrompt(context);
  const text = await generateChatText(
    [
      { role: "system", content: prompt.systemPrompt },
      { role: "user", content: prompt.userPrompt },
    ],
    options,
  );

  return { text: extractFirstJSONObject(text) };
}

export async function generateGemmaInsights(
  sessions: readonly Session[],
  options: GenerateOptions,
): Promise<LocalInsightsResult> {
  const prompt = buildInsightsPrompt([...sessions]);
  const text = await generateChatText(
    [
      { role: "system", content: prompt.systemPrompt },
      { role: "user", content: prompt.userPrompt },
    ],
    options,
  );

  return { text: extractFirstJSONObject(text) };
}

async function generateChatText(
  messages: readonly ChatMessage[],
  options: GenerateOptions,
): Promise<string> {
  throwIfAborted(options.signal);
  const generator = await getGenerator();
  throwIfAborted(options.signal);

  const { TextStreamer } = await import("@huggingface/transformers");
  let accumulated = "";
  const streamer = new TextStreamer(generator.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (chunk: string) => {
      accumulated += chunk;
      options.onDelta?.(accumulated);
    },
  });

  const output = await generator([...messages], {
    max_new_tokens: options.maxNewTokens,
    do_sample: false,
    return_full_text: false,
    streamer,
  });

  throwIfAborted(options.signal);
  const finalText = extractGeneratedText(output).trim();
  return finalText.length > 0 ? finalText : accumulated.trim();
}

async function getCheckInLanguageModel(): Promise<ReturnType<typeof transformersJS>> {
  if (checkInModelPromise) return checkInModelPromise;

  checkInModelPromise = (async () => {
    const { env, LogLevel } = await import("@huggingface/transformers");
    configureTransformersEnvironment(env, LogLevel);
    const model = transformersJS(GEMMA_MODEL_ID, {
      dtype: GEMMA_DTYPE,
      device: getTransformersJsDevice(),
      rawInitProgressCallback: logProgress,
      ...(typeof window === "undefined"
        ? { cacheDir: "./.cache/transformers" }
        : {}),
    });

    await model.createSessionWithProgress();
    return model;
  })().catch((err) => {
    checkInModelPromise = null;
    throw err;
  });

  return checkInModelPromise;
}

function configureTransformersEnvironment(
  env: {
    logLevel: unknown;
    allowRemoteModels: boolean;
    allowLocalModels: boolean;
    useBrowserCache?: boolean;
    useWasmCache?: boolean;
    cacheKey?: string;
    useFSCache?: boolean;
    cacheDir?: string | null;
  },
  logLevel: { WARNING: unknown },
): void {
  env.logLevel = logLevel.WARNING;
  env.allowRemoteModels = true;
  env.allowLocalModels = false;

  if (typeof window !== "undefined") {
    env.useBrowserCache = true;
    env.useWasmCache = true;
    env.cacheKey = GEMMA_CACHE_KEY;
  } else {
    env.useFSCache = true;
    env.useBrowserCache = false;
    env.cacheDir = "./.cache/transformers";
  }

  if (typeof globalThis !== "undefined") {
    (
      globalThis as typeof globalThis & { AI_SDK_LOG_WARNINGS?: boolean }
    ).AI_SDK_LOG_WARNINGS = false;
  }
}

function getTransformersJsDevice(): "webgpu" | "cpu" {
  if (typeof navigator !== "undefined" && "gpu" in navigator) return "webgpu";
  return "cpu";
}

function getTextDelta(part: unknown): string {
  const record = part as Record<string, unknown>;
  const text = record.text;
  if (typeof text === "string") return text;
  const delta = record.delta;
  return typeof delta === "string" ? delta : "";
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

async function getGenerator(): Promise<TextGenerationPipeline> {
  if (generatorPromise) return generatorPromise;

  generatorPromise = (async () => {
    setModelLoadState({
      phase: "loading",
      status: "initializing",
      file: null,
      progress: null,
      message: "Preparing the local Gemma runtime.",
      files: [],
    });

    const { env, LogLevel, pipeline } = await import("@huggingface/transformers");
    env.logLevel = LogLevel.WARNING;
    env.allowRemoteModels = true;
    env.allowLocalModels = false;

    if (typeof navigator !== "undefined" && navigator.storage?.persist) {
      void navigator.storage.persist().catch(() => false);
    }

    const isBrowser = typeof window !== "undefined";
    if (isBrowser) {
      env.useBrowserCache = true;
      env.useWasmCache = true;
      env.cacheKey = GEMMA_CACHE_KEY;
    } else {
      // Node smoke tests use the same ignored cache directory as manual downloads.
      env.useFSCache = true;
      env.useBrowserCache = false;
      env.cacheDir = "./.cache/transformers";
    }

    const device: DeviceType = isBrowser
      ? "gpu" in navigator
        ? "webgpu"
        : "wasm"
      : "cpu";

    setModelLoadState({
      phase: "loading",
      status: "loading",
      device,
      message:
        device === "webgpu"
          ? "Downloading or reading Gemma from the browser cache with WebGPU enabled."
          : "Downloading or reading Gemma from the browser cache.",
    });

    const generator = await pipeline("text-generation", GEMMA_MODEL_ID, {
      dtype: GEMMA_DTYPE,
      device,
      progress_callback: logProgress,
    });

    setModelLoadState({
      phase: "ready",
      status: "ready",
      file: null,
      progress: 100,
      device,
      message: "Gemma is ready on this device.",
      files: modelLoadState.files.map((fileState) => ({
        ...fileState,
        status: "ready",
        progress: 100,
      })),
    });

    return generator;
  })().catch((err) => {
    generatorPromise = null;
    setModelLoadState({
      phase: "error",
      status: "error",
      file: null,
      progress: null,
      message:
        err instanceof Error
          ? err.message
          : "Gemma could not be prepared on this device.",
    });
    throw err;
  });

  return generatorPromise;
}

function parseCheckInPayload(text: string): {
  reply: string;
  endConversation: EndConversationSignal | null;
} {
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Gemma returned non-object check-in payload");
  }

  const payload = parsed as {
    reply?: unknown;
    endConversation?: unknown;
  };
  if (typeof payload.reply !== "string" || payload.reply.trim().length === 0) {
    throw new Error("Gemma check-in payload missing reply");
  }

  return {
    reply: payload.reply.trim(),
    endConversation: parseEndConversation(payload.endConversation),
  };
}

function parseEndConversation(value: unknown): EndConversationSignal | null {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object") return null;

  const obj = value as {
    cravingScore?: unknown;
    obstacleCategory?: unknown;
  };
  const cravingScore = Number(obj.cravingScore);
  if (!Number.isInteger(cravingScore) || cravingScore < 1 || cravingScore > 10) {
    return null;
  }

  const obstacleCategory =
    typeof obj.obstacleCategory === "string" &&
    (ALLOWED_OBSTACLES as readonly string[]).includes(obj.obstacleCategory)
      ? (obj.obstacleCategory as ObstacleCategory)
      : null;

  return { cravingScore, obstacleCategory };
}

function inferEndConversationFromHistory(
  history: readonly CheckInChatTurnPayload[],
  context: CheckInContextPayload,
  reply: string,
): EndConversationSignal | null {
  if (context.demoMode) return null;

  const patientMessages = history.filter((turn) => turn.role === "patient");
  if (patientMessages.length < 4) return null;

  const lastPatient = patientMessages[patientMessages.length - 1];
  const lastAgent = [...history].reverse().find((turn) => turn.role === "agent");
  if (!lastPatient || !lastAgent) return null;

  if (
    isAffirmative(lastPatient.content) &&
    isReadinessQuestion(lastAgent.content) &&
    !reply.trim().endsWith("?")
  ) {
    return { cravingScore: context.cravingScore, obstacleCategory: null };
  }

  return null;
}

function isReadinessQuestion(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    normalized.includes("ready to continue") ||
    normalized.includes("ready to keep going") ||
    normalized.includes("willing to try") ||
    normalized.includes("before we continue") ||
    normalized.includes("before continuing")
  );
}

function extractGeneratedText(output: unknown): string {
  const first = Array.isArray(output) ? output[0] : output;
  if (!first || typeof first !== "object") return "";

  const generatedText = (first as { generated_text?: unknown }).generated_text;
  if (typeof generatedText === "string") return generatedText;

  if (Array.isArray(generatedText)) {
    const assistant = [...generatedText].reverse().find((message) => {
      return (
        message &&
        typeof message === "object" &&
        (message as { role?: unknown }).role === "assistant" &&
        typeof (message as { content?: unknown }).content === "string"
      );
    });
    if (assistant) {
      return (assistant as { content: string }).content;
    }
  }

  return "";
}

function extractFirstJSONObject(text: string): string {
  const start = text.indexOf("{");
  if (start === -1) {
    throw new Error("Gemma output did not include a JSON object");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  throw new Error("Gemma output included incomplete JSON");
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw new DOMException("Generation aborted", "AbortError");
}

function logProgress(progress: ProgressInfo): void {
  const progressRecord = progress as Record<string, unknown>;
  const file =
    typeof progressRecord.file === "string" ? progressRecord.file : undefined;
  const fileProgress = getProgressPercent(progressRecord, progress.status);
  const percent = fileProgress !== null ? ` ${fileProgress}%` : "";
  const label = file ? `${progress.status}: ${file}${percent}` : progress.status;
  setModelLoadState({
    phase: "loading",
    status: progress.status,
    file: file ?? null,
    progress: fileProgress,
    files: updateModelFileLoadStates(progressRecord, progress.status),
    message: file
      ? `${progress.status} ${file}${percent}`
      : `Gemma model load ${progress.status}`,
  });

  if (
    typeof console !== "undefined" &&
    shouldLogModelLoadProgress(progress.status, file, fileProgress)
  ) {
    console.info(`[wave] Gemma model load ${label}`);
  }
}

function shouldLogModelLoadProgress(
  status: string,
  file: string | undefined,
  progress: number | null,
): boolean {
  if (status !== "progress") return true;
  if (!file || progress === null) return false;
  if (progress === 100) return true;

  const previous = modelLoadLogProgressByFile.get(file);
  if (
    previous !== undefined &&
    progress < previous + MODEL_LOAD_LOG_PROGRESS_STEP
  ) {
    return false;
  }

  modelLoadLogProgressByFile.set(file, progress);
  return true;
}

function updateModelFileLoadStates(
  progress: Record<string, unknown>,
  status: string,
): readonly GemmaModelFileLoadState[] {
  const file = typeof progress.file === "string" ? progress.file : null;
  if (!file) return modelLoadState.files;

  const existingFileState = modelLoadState.files.find(
    (fileState) => fileState.file === file,
  );
  const nextFileState: GemmaModelFileLoadState = {
    file,
    status,
    progress: getProgressPercent(progress, status),
    loaded: getNumber(progress.loaded) ?? existingFileState?.loaded ?? null,
    total: getNumber(progress.total) ?? existingFileState?.total ?? null,
  };

  const existingIndex = modelLoadState.files.findIndex(
    (fileState) => fileState.file === file,
  );
  if (existingIndex === -1) {
    return [...modelLoadState.files, nextFileState];
  }

  return modelLoadState.files.map((fileState, index) =>
    index === existingIndex ? nextFileState : fileState,
  );
}

function getProgressPercent(
  progress: Record<string, unknown>,
  status: string,
): number | null {
  const rawProgress = getNumber(progress.progress);
  if (rawProgress !== null) {
    return Math.min(100, Math.max(0, Math.round(rawProgress)));
  }

  const loaded = getNumber(progress.loaded);
  const total = getNumber(progress.total);
  if (loaded !== null && total !== null && total > 0) {
    return Math.min(100, Math.max(0, Math.round((loaded / total) * 100)));
  }

  const normalizedStatus = status.toLowerCase();
  if (normalizedStatus === "done" || normalizedStatus === "ready") {
    return 100;
  }

  return null;
}

function getNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function setModelLoadState(update: Partial<GemmaModelLoadState>): void {
  const nextState = { ...modelLoadState, ...update };
  if (isSameModelLoadState(modelLoadState, nextState)) return;

  modelLoadState = nextState;
  const shouldPublishImmediately =
    modelLoadState.phase === "ready" ||
    modelLoadState.phase === "error" ||
    modelLoadState.status === "initializing";

  if (shouldPublishImmediately) {
    publishModelLoadState();
    return;
  }

  const now = Date.now();
  const elapsed = now - lastModelLoadPublishedAt;
  if (elapsed >= MODEL_LOAD_NOTIFY_INTERVAL_MS) {
    publishModelLoadState();
    return;
  }

  if (pendingModelLoadPublish) return;
  pendingModelLoadPublish = setTimeout(() => {
    pendingModelLoadPublish = null;
    publishModelLoadState();
  }, MODEL_LOAD_NOTIFY_INTERVAL_MS - elapsed);
}

function publishModelLoadState(): void {
  if (pendingModelLoadPublish) {
    clearTimeout(pendingModelLoadPublish);
    pendingModelLoadPublish = null;
  }
  lastModelLoadPublishedAt = Date.now();
  for (const listener of modelLoadListeners) {
    listener(modelLoadState);
  }
}

function isSameModelLoadState(
  a: GemmaModelLoadState,
  b: GemmaModelLoadState,
): boolean {
  return (
    a.phase === b.phase &&
    a.status === b.status &&
    a.file === b.file &&
    a.progress === b.progress &&
    a.device === b.device &&
    a.message === b.message &&
    areSameModelLoadFiles(a.files, b.files)
  );
}

function areSameModelLoadFiles(
  a: readonly GemmaModelFileLoadState[],
  b: readonly GemmaModelFileLoadState[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every((fileState, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      fileState.file === other.file &&
      fileState.status === other.status &&
      fileState.progress === other.progress &&
      fileState.loaded === other.loaded &&
      fileState.total === other.total
    );
  });
}
