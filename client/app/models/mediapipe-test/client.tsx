"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { buildChunkPrompt } from "@/lib/prompts/chunk-generator";
import { buildCheckInPrompt } from "@/lib/prompts/check-in";
import { buildReflectionPrompt } from "@/lib/prompts/reflection";
import type {
  CheckInContextPayload,
  ChunkGenerationContextPayload,
  ReflectionContext,
  SessionHistoryEntry,
} from "@/lib/prompts/schemas";

// Default URL points at the local-hf static-file server (serve-local-hf.ts).
// Run it with: MEDIAPIPE_FILE=models/mediapipe/gemma-4-E2B-it-web.task pnpm exec tsx scripts/serve-local-hf.ts
// Or override the model URL via ?model=https://... on the page.
const DEFAULT_MODEL_URL = "http://localhost:8765/mediapipe/gemma-4-E2B-it-web.task";
const WASM_BASE_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai@latest/wasm";

type TaskKey = "phase" | "checkin" | "reflection";

const PATIENT_PROFILE = {
  matType: "buprenorphine",
  medicationStatus: "on_time",
  trigger: "stress",
  triggerOther: null,
  usedSubstanceToday: false,
} as const;

const SESSION_HISTORY: SessionHistoryEntry[] = [
  {
    kind: "chunk",
    chunkNumber: 1,
    lines: [
      "Welcome back. You showing up for this is the practice.",
      "Find a position your body can rest in for a few minutes.",
      "Urges arrive like waves. They build, they crest, and they fall.",
      "Notice what is already here in the body, without trying to fix anything.",
      "Let your breath be ordinary for one slow round.",
      "When you are ready, we will move into the body together.",
    ],
  },
];

const PHASE_CONTEXT: ChunkGenerationContextPayload = {
  chunkNumber: 2,
  intakeIntensity: 7,
  profile: PATIENT_PROFILE,
  sessionHistory: SESSION_HISTORY,
};

const CHECK_IN_CONTEXT: CheckInContextPayload = {
  chunkNumber: 1,
  cravingScore: 7,
  scoreHistory: [],
  obstacleHint: null,
  profile: PATIENT_PROFILE,
  intakeIntensity: 7,
  sessionHistory: SESSION_HISTORY,
  demoMode: false,
};

const REFLECTION_CONTEXT: ReflectionContext = {
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

const FIRST_PATIENT_TURN =
  "It's around a 7. It's been building for a couple hours.";

const MAX_TOKENS_BY_TASK: Record<TaskKey, number> = {
  phase: 512,
  checkin: 320,
  reflection: 512,
};

interface LoadState {
  phase: "idle" | "loading" | "ready" | "error";
  message: string;
}

const INITIAL_LOAD: LoadState = { phase: "idle", message: "Not loaded." };

interface TaskResult {
  prompt: string;
  output: string;
  elapsedMs: number;
  error?: string;
}

type Results = Partial<Record<TaskKey, TaskResult>>;

// Gemma chat template applied manually. MediaPipe's .task bundle typically
// auto-applies the template, but the API takes a raw string so we wrap it
// ourselves to mirror what the compare page sends through transformers.js.
function applyGemmaChatTemplate(system: string, user: string): string {
  return (
    `<bos><start_of_turn>user\n${system.trim()}\n\n${user.trim()}<end_of_turn>\n` +
    `<start_of_turn>model\n`
  );
}

export function MediaPipeTestClient() {
  type LlmInferenceLike = {
    generateResponse: (prompt: string) => Promise<string>;
    close?: () => void;
  };
  const llmRef = useRef<LlmInferenceLike | null>(null);
  const [load, setLoad] = useState<LoadState>(INITIAL_LOAD);
  const [running, setRunning] = useState<TaskKey | null>(null);
  const [results, setResults] = useState<Results>({});
  const [modelUrl, setModelUrl] = useState<string>(DEFAULT_MODEL_URL);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search);
      const m = p.get("model");
      if (m) setModelUrl(m);
    }
  }, []);

  const loadModel = useCallback(async () => {
    if (load.phase === "loading" || load.phase === "ready") return;
    setLoad({ phase: "loading", message: "Initializing MediaPipe genai wasm..." });
    try {
      const { FilesetResolver, LlmInference } = await import("@mediapipe/tasks-genai");
      const genai = await FilesetResolver.forGenAiTasks(WASM_BASE_URL);
      setLoad({
        phase: "loading",
        message: `Fetching model from ${modelUrl} (~1.9 GB; cached on subsequent loads)...`,
      });
      // Use modelAssetPath. MediaPipe will fetch + range-request the .task
      // file. Same-origin not required as long as CORS headers are correct
      // on the server (our serve-local-hf.ts sets Access-Control-Allow-Origin: *).
      const llm = await LlmInference.createFromOptions(genai, {
        baseOptions: { modelAssetPath: modelUrl },
        maxTokens: 4096,
        topK: 1,
        temperature: 0.0,
        randomSeed: 1,
      });
      llmRef.current = llm as unknown as LlmInferenceLike;
      setLoad({ phase: "ready", message: "Loaded. Ready to run tasks." });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[mediapipe-test] load error:", err);
      setLoad({ phase: "error", message: msg });
    }
  }, [load.phase, modelUrl]);

  const runOne = useCallback(
    async (key: TaskKey, system: string, user: string) => {
      const llm = llmRef.current;
      if (!llm) return;
      setRunning(key);
      const prompt = applyGemmaChatTemplate(system, user);
      const startedAt = performance.now();
      try {
        const output = await llm.generateResponse(prompt);
        const elapsedMs = performance.now() - startedAt;
        console.info(
          "[mediapipe-test] %s output (len=%d) in %d ms",
          key,
          output.length,
          Math.round(elapsedMs),
          output,
        );
        setResults((prev) => ({
          ...prev,
          [key]: { prompt, output, elapsedMs },
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[mediapipe-test] ${key} error:`, err);
        setResults((prev) => ({
          ...prev,
          [key]: { prompt, output: "", elapsedMs: 0, error: msg },
        }));
      } finally {
        setRunning(null);
      }
    },
    [],
  );

  const runPhase = useCallback(async () => {
    const built = buildChunkPrompt(PHASE_CONTEXT);
    await runOne("phase", built.systemPrompt, built.userPrompt);
  }, [runOne]);

  const runCheckIn = useCallback(async () => {
    const built = buildCheckInPrompt(CHECK_IN_CONTEXT, {
      agentTurnsInHistory: 0,
    });
    await runOne(
      "checkin",
      built.systemPrompt,
      `${built.contextBlock}\n\n${FIRST_PATIENT_TURN}`,
    );
  }, [runOne]);

  const runReflection = useCallback(async () => {
    const built = buildReflectionPrompt(REFLECTION_CONTEXT);
    await runOne("reflection", built.systemPrompt, built.userPrompt);
  }, [runOne]);

  const runAll = useCallback(async () => {
    await runPhase();
    await runCheckIn();
    await runReflection();
  }, [runPhase, runCheckIn, runReflection]);

  const canRun = load.phase === "ready" && running === null;
  void MAX_TOKENS_BY_TASK; // (informational; MediaPipe uses maxTokens from createFromOptions, not per-call)

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-8">
      <header>
        <p className="text-xs uppercase tracking-wide text-foreground/50">
          MediaPipe LLM Inference (WebGPU, LiteRT runtime)
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          MediaPipe · base Gemma 4 E2B (WAVE prompts)
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-foreground/70 leading-relaxed">
          Runs the 3 production WAVE prompts through Google&apos;s pre-converted{" "}
          <code className="font-mono">gemma-4-E2B-it-web.task</code> via{" "}
          <code className="font-mono">@mediapipe/tasks-genai</code>. This is a
          different runtime from <code>@huggingface/transformers</code> +{" "}
          <code>onnxruntime-web</code>: LiteRT-LM on top of TensorFlow Lite,
          with its own WebGPU compute shaders. If the WAVE prompts produce
          coherent output here when they don&apos;t in{" "}
          <a href="/models/onnx-test/compare" className="underline">
            /models/onnx-test/compare
          </a>
          , the bug is specifically in <code>onnxruntime-web</code>&apos;s
          fp16 kernel — not a fundamental WebGPU+Gemma-4 problem.
        </p>
      </header>

      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        <strong>This is the base model.</strong> MediaPipe does not yet have a
        public Gemma 4 PEFT-merged conversion path. We are validating only the
        runtime here; the fine-tune cannot ship through this path until Google
        adds Gemma 4 to their LiteRT converter (see
        <a
          href="https://github.com/google-ai-edge/litert-torch/issues/998"
          className="underline ml-1"
        >
          litert-torch#998
        </a>
        ).
      </div>

      <section className="rounded-2xl border border-border bg-surface p-5">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="font-semibold tracking-tight">Model</h3>
          <span className="text-[10px] uppercase tracking-wide text-foreground/50">
            {load.phase}
          </span>
        </div>
        <p className="mt-1 break-all text-xs text-foreground/55">{modelUrl}</p>
        <p className="mt-3 text-xs text-foreground/70">{load.message}</p>
        <button
          type="button"
          disabled={load.phase === "loading" || load.phase === "ready"}
          onClick={loadModel}
          className="mt-3 inline-flex items-center rounded-md border border-border bg-surface-muted px-3 py-1.5 text-xs font-medium text-foreground/80 disabled:cursor-not-allowed disabled:opacity-50 hover:border-accent/60 hover:text-foreground"
        >
          {load.phase === "loading"
            ? "Loading..."
            : load.phase === "ready"
              ? "Loaded"
              : load.phase === "error"
                ? "Retry"
                : "Load"}
        </button>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!canRun}
          onClick={runAll}
          className="inline-flex items-center rounded-md border border-accent bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50 hover:opacity-90"
        >
          {running !== null ? `Running ${running}...` : "Run all 3 tasks"}
        </button>
        <button
          type="button"
          disabled={!canRun}
          onClick={runPhase}
          className="inline-flex items-center rounded-md border border-border bg-surface-muted px-3 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
        >
          Phase only
        </button>
        <button
          type="button"
          disabled={!canRun}
          onClick={runCheckIn}
          className="inline-flex items-center rounded-md border border-border bg-surface-muted px-3 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
        >
          Check-in only
        </button>
        <button
          type="button"
          disabled={!canRun}
          onClick={runReflection}
          className="inline-flex items-center rounded-md border border-border bg-surface-muted px-3 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
        >
          Reflection only
        </button>
      </div>

      {(["phase", "checkin", "reflection"] as TaskKey[]).map((k) => (
        <TaskOutput key={k} label={k} result={results[k]} />
      ))}
    </div>
  );
}

function TaskOutput({ label, result }: { label: TaskKey; result?: TaskResult }) {
  return (
    <section className="rounded-2xl border border-border bg-surface-muted/30 p-5">
      <div className="mb-3">
        <h2 className="text-lg font-semibold tracking-tight capitalize">{label}</h2>
      </div>
      {result === undefined ? (
        <p className="text-xs italic text-foreground/45">Not run yet.</p>
      ) : result.error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
          {result.error}
        </p>
      ) : (
        <div>
          <div className="mb-2 text-[11px] text-foreground/55">
            {result.elapsedMs.toFixed(0)} ms · {result.output.length} chars
          </div>
          <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface px-3 py-2 text-xs leading-relaxed text-foreground/85">
            {result.output || "(empty output)"}
          </pre>
        </div>
      )}
    </section>
  );
}
