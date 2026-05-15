"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  pipeline,
  env,
  type TextGenerationPipeline,
} from "@huggingface/transformers";

import { buildChunkPrompt } from "@/lib/prompts/chunk-generator";
import { buildCheckInPrompt } from "@/lib/prompts/check-in";
import { buildReflectionPrompt } from "@/lib/prompts/reflection";
import type {
  CheckInContextPayload,
  ChunkGenerationContextPayload,
  ReflectionContext,
  SessionHistoryEntry,
} from "@/lib/prompts/schemas";

const UPSTREAM_ID = "onnx-community/gemma-4-E2B-it-ONNX";
// v4-fused: decoder has 70 FastGelu contrib ops instead of decomposed Tanh-based
// gelu (the suspected NaN source on WebGPU for long-context prompts). CPU bench
// 2x faster than v3 and still coherent. Upload to HF first:
//   hf upload Maelstrome/lora-wave-session-r32-onnx-fused models/runs/onnx-export-v4-fused .
// If the upload hasn't run yet, swap back to "Maelstrome/lora-wave-session-r32-onnx"
// (v3, decomposed decoder; empty output on WebGPU for WAVE prompts).
const FINETUNE_LOCAL_ID = "Maelstrome/lora-wave-session-r32-onnx-fused";

type Slot = "upstream" | "finetune";
type TaskKey = "phase" | "checkin" | "reflection";

const SLOT_META: Record<
  Slot,
  { title: string; subtitle: string; accent: string }
> = {
  upstream: {
    title: "Upstream base",
    subtitle: "onnx-community/gemma-4-E2B-it-ONNX",
    accent: "#3b82f6",
  },
  finetune: {
    title: "Our fine-tune (v4 fused)",
    subtitle: "Maelstrome/lora-wave-session-r32-onnx-fused",
    accent: "#a855f7",
  },
};

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

const CHECK_IN_PATIENT_SCRIPT: readonly string[] = [
  "It's around a 7. It's been building for a couple hours.",
  "Honestly probably stress from work. Long day.",
  "I noticed my chest got tight, kind of holding my breath.",
  "Yeah, I think I'm ready to keep going.",
];

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

interface LoadState {
  phase: "idle" | "loading" | "ready" | "error";
  message: string;
  percent: number;
}

const INITIAL_LOAD: LoadState = {
  phase: "idle",
  message: "Not loaded.",
  percent: 0,
};

interface SimpleResult {
  text: string;
  elapsedMs: number;
  approxTokens: number;
  tokensPerSecond: number;
  error?: string;
}

interface CheckInTurnRecord {
  patient: string;
  agent: SimpleResult;
}

interface CheckInResult {
  turns: CheckInTurnRecord[];
  totalElapsedMs: number;
}

type TaskResults = {
  phase?: SimpleResult;
  checkin?: CheckInResult;
  reflection?: SimpleResult;
  smoke?: SimpleResult;
};

const MAX_TOKENS_BY_TASK: Record<TaskKey, number> = {
  phase: 320,
  checkin: 220,
  reflection: 320,
};

const SMOKE_PROMPT = "What is the capital of France? Answer in one sentence.";

export function OnnxCompareClient() {
  const pipeRef = useRef<TextGenerationPipeline | null>(null);
  const [upstreamLoad, setUpstreamLoad] = useState<LoadState>(INITIAL_LOAD);
  const [finetuneLoad, setFinetuneLoad] = useState<LoadState>(INITIAL_LOAD);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState<TaskKey | null>(null);
  const [results, setResults] = useState<
    Record<Slot, TaskResults>
  >({ upstream: {}, finetune: {} });

  const activeSlot: Slot | null =
    upstreamLoad.phase === "ready"
      ? "upstream"
      : finetuneLoad.phase === "ready"
        ? "finetune"
        : null;

  // ?local=1 reroutes the FINETUNE_LOCAL_ID fetch from huggingface.co to a
  // localhost static-file server that mirrors HF's URL layout. Use this to
  // test a local v4 export under WebGPU without uploading to HF. Start the
  // server with `pnpm exec tsx scripts/serve-local-hf.ts` from client/.
  // ?local-host=http://localhost:PORT lets you override the port.
  const useLocal = useRef<{ enabled: boolean; host: string }>({
    enabled: false,
    host: "http://localhost:8765",
  });

  useEffect(() => {
    env.allowLocalModels = false;
    env.allowRemoteModels = true;
    env.useBrowserCache = true;
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      useLocal.current.enabled = params.get("local") === "1";
      const customHost = params.get("local-host");
      if (customHost) useLocal.current.host = customHost;
    }
  }, []);

  const setSlotLoad = useCallback((slot: Slot, state: LoadState) => {
    if (slot === "upstream") setUpstreamLoad(state);
    else setFinetuneLoad(state);
  }, []);

  const loadSlot = useCallback(
    async (slot: Slot) => {
      if (busy) return;
      setBusy(true);

      if (pipeRef.current) {
        try {
          await (
            pipeRef.current as unknown as { dispose?: () => Promise<void> }
          ).dispose?.();
        } catch {
          /* ignore */
        }
        pipeRef.current = null;
        if (slot === "upstream") setFinetuneLoad(INITIAL_LOAD);
        else setUpstreamLoad(INITIAL_LOAD);
      }

      const modelId = slot === "upstream" ? UPSTREAM_ID : FINETUNE_LOCAL_ID;
      // Both models load from HF Hub by default. When ?local=1 is set, swap
      // env.remoteHost to the localhost mirror for the FINETUNE slot only —
      // upstream stays on HF since it's already cached and not the model
      // under test. This works under WebGPU because env.remoteHost goes
      // through the same absolute-URL fetch path as HF Hub, sidestepping the
      // MountedFiles bug that hits env.allowLocalModels=true + localModelPath.
      env.allowLocalModels = false;
      env.allowRemoteModels = true;
      const isLocal = useLocal.current.enabled && slot === "finetune";
      const HF_HOST = "https://huggingface.co/";
      env.remoteHost = isLocal ? `${useLocal.current.host}/` : HF_HOST;
      env.remotePathTemplate = "{model}/resolve/{revision}/";
      setSlotLoad(slot, {
        phase: "loading",
        message: "Initializing on WebGPU…",
        percent: 0,
      });

      try {
        const pipe = (await pipeline("text-generation", modelId, {
          dtype: "q4f16",
          device: "webgpu",
          progress_callback: (info: unknown) => {
            const i = info as {
              status?: string;
              file?: string;
              progress?: number;
            };
            if (
              i.status === "progress" &&
              i.file &&
              typeof i.progress === "number"
            ) {
              setSlotLoad(slot, {
                phase: "loading",
                message: `${i.file} ${i.progress.toFixed(0)}%`,
                percent: Math.round(i.progress),
              });
            }
          },
        })) as TextGenerationPipeline;
        pipeRef.current = pipe;
        setSlotLoad(slot, {
          phase: "ready",
          message: "Loaded and ready.",
          percent: 100,
        });
      } catch (err) {
        setSlotLoad(slot, {
          phase: "error",
          message: err instanceof Error ? err.message : String(err),
          percent: 0,
        });
      } finally {
        setBusy(false);
      }
    },
    [busy, setSlotLoad],
  );

  const generateOne = useCallback(
    async (
      messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
      maxNewTokens: number,
    ): Promise<SimpleResult> => {
      const pipe = pipeRef.current;
      if (!pipe) {
        return {
          text: "",
          elapsedMs: 0,
          approxTokens: 0,
          tokensPerSecond: 0,
          error: "pipeline not loaded",
        };
      }
      const startedAt = performance.now();
      try {
        const out = (await pipe(messages, {
          max_new_tokens: maxNewTokens,
          do_sample: false,
          return_full_text: false,
        })) as unknown;
        const elapsedMs = performance.now() - startedAt;
        let text = "";
        const arr = out as Array<{ generated_text?: unknown }>;
        if (Array.isArray(arr) && arr.length > 0) {
          const gen = arr[0]?.generated_text;
          if (typeof gen === "string") text = gen;
          else if (Array.isArray(gen)) {
            const last = gen[gen.length - 1] as {
              role?: string;
              content?: string;
            };
            if (
              last?.role === "assistant" &&
              typeof last.content === "string"
            ) {
              text = last.content;
            }
          }
        }
        const cleaned = stripThinking(text).trim();
        // Fallback so the page never silently displays empty output: if
        // stripping removed everything, show the raw model text instead.
        const display = cleaned.length > 0 ? cleaned : text.trim();
        const approxTokens = Math.max(1, Math.round(display.length / 4));
        if (typeof console !== "undefined") {
          console.info(
            "[tasks-compare] raw output (len=%d) cleaned (len=%d):",
            text.length,
            cleaned.length,
            text,
          );
        }
        return {
          text: display,
          elapsedMs,
          approxTokens,
          tokensPerSecond:
            elapsedMs > 0 ? (approxTokens / elapsedMs) * 1000 : 0,
        };
      } catch (err) {
        return {
          text: "",
          elapsedMs: 0,
          approxTokens: 0,
          tokensPerSecond: 0,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    [],
  );

  const runPhase = useCallback(async () => {
    if (!activeSlot || running) return;
    setRunning("phase");
    const built = buildChunkPrompt(PHASE_CONTEXT);
    const result = await generateOne(
      [
        { role: "system", content: built.systemPrompt },
        { role: "user", content: built.userPrompt },
      ],
      MAX_TOKENS_BY_TASK.phase,
    );
    setResults((prev) => ({
      ...prev,
      [activeSlot]: { ...prev[activeSlot], phase: result },
    }));
    setRunning(null);
  }, [activeSlot, running, generateOne]);

  const runReflection = useCallback(async () => {
    if (!activeSlot || running) return;
    setRunning("reflection");
    const built = buildReflectionPrompt(REFLECTION_CONTEXT);
    const result = await generateOne(
      [
        { role: "system", content: built.systemPrompt },
        { role: "user", content: built.userPrompt },
      ],
      MAX_TOKENS_BY_TASK.reflection,
    );
    setResults((prev) => ({
      ...prev,
      [activeSlot]: { ...prev[activeSlot], reflection: result },
    }));
    setRunning(null);
  }, [activeSlot, running, generateOne]);

  const runCheckIn = useCallback(async () => {
    if (!activeSlot || running) return;
    setRunning("checkin");

    const turns: CheckInTurnRecord[] = [];
    const startedAt = performance.now();

    // Build the static framing once; agent-turn count grows per loop.
    // The contextBlock is per-conversation framing; the chat template
    // requires strict user/assistant/user/... alternation after the system
    // message, so we fold the contextBlock into the FIRST patient message
    // instead of sending it as its own user turn (which would duplicate the
    // user role on turn 1).
    let agentTurns = 0;
    for (const patientText of CHECK_IN_PATIENT_SCRIPT) {
      const built = buildCheckInPrompt(CHECK_IN_CONTEXT, {
        agentTurnsInHistory: agentTurns,
      });
      const messages: Array<{
        role: "system" | "user" | "assistant";
        content: string;
      }> = [{ role: "system", content: built.systemPrompt }];
      // First patient message carries the contextBlock as its prefix.
      const firstPatient = turns[0]?.patient ?? patientText;
      const firstPatientContent = `${built.contextBlock}\n\n${firstPatient}`;
      messages.push({ role: "user", content: firstPatientContent });
      // Replay remaining alternating turns (after the first patient turn).
      for (let i = 0; i < turns.length; i += 1) {
        messages.push({ role: "assistant", content: turns[i].agent.text });
        const nextPatient = turns[i + 1]?.patient;
        if (nextPatient !== undefined) {
          messages.push({ role: "user", content: nextPatient });
        }
      }
      // Add the new patient turn unless it's already in `turns` as the first.
      if (turns.length > 0) {
        messages.push({ role: "user", content: patientText });
      }

      const agent = await generateOne(messages, MAX_TOKENS_BY_TASK.checkin);
      turns.push({ patient: patientText, agent });
      agentTurns += 1;
      if (agent.error) break;
    }

    const totalElapsedMs = performance.now() - startedAt;
    setResults((prev) => ({
      ...prev,
      [activeSlot]: {
        ...prev[activeSlot],
        checkin: { turns, totalElapsedMs },
      },
    }));
    setRunning(null);
  }, [activeSlot, running, generateOne]);

  const runSmoke = useCallback(async () => {
    if (!activeSlot || running) return;
    setRunning("phase");
    const result = await generateOne(
      [{ role: "user", content: SMOKE_PROMPT }],
      64,
    );
    setResults((prev) => ({
      ...prev,
      [activeSlot]: { ...prev[activeSlot], smoke: result },
    }));
    setRunning(null);
  }, [activeSlot, running, generateOne]);

  const runAll = useCallback(async () => {
    if (!activeSlot || running) return;
    await runPhase();
    await runCheckIn();
    await runReflection();
  }, [activeSlot, running, runPhase, runCheckIn, runReflection]);

  const canRun = activeSlot !== null && !busy && running === null;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:space-y-8 sm:p-6 lg:p-8">
      <header>
        <p className="text-xs uppercase tracking-wide text-foreground/50">
          Browser-runtime task comparison
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          ONNX A/B · production tasks
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-foreground/70 leading-relaxed">
          Runs the actual WAVE prompts (
          <code className="font-mono">buildChunkPrompt</code>,{" "}
          <code className="font-mono">buildCheckInPrompt</code>,{" "}
          <code className="font-mono">buildReflectionPrompt</code>) against
          upstream and our fine-tune, side by side. One model is active at a
          time; load each, run the three tasks, compare. Outputs accumulate so
          you can switch models without losing the other column.
        </p>
      </header>

      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900 break-words">
        <strong>Backend = WebGPU only.</strong> Both models use{" "}
        <code>com.microsoft.GatherBlockQuantized</code> for the int4 embed/PLE
        tables, and onnxruntime-web has no CPU kernel for it — the WASM path
        fails with{" "}
        <code>Failed to find kernel for com.microsoft.GatherBlockQuantized</code>
        . So this page can't A/B WebGPU vs WASM. If WebGPU tok/s looks low on
        Windows-NVIDIA, the bottleneck is likely Dawn's shader for that op
        itself, not a CPU fallback.
      </div>

      {useLocal.current.enabled ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-relaxed text-emerald-900 break-words">
          <strong>?local=1 active.</strong> Fine-tune column will fetch from{" "}
          <code>{useLocal.current.host}</code> instead of huggingface.co.
          Start the server first: <code>cd client && pnpm exec tsx scripts/serve-local-hf.ts</code>.
          Upstream slot still uses HF.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <RuntimeCard
          slot="upstream"
          state={upstreamLoad}
          isActive={activeSlot === "upstream"}
          busy={busy}
          onLoad={() => loadSlot("upstream")}
        />
        <RuntimeCard
          slot="finetune"
          state={finetuneLoad}
          isActive={activeSlot === "finetune"}
          busy={busy}
          onLoad={() => loadSlot("finetune")}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!canRun}
          onClick={runAll}
          className="inline-flex items-center rounded-md border border-accent bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50 hover:opacity-90"
        >
          {running !== null
            ? `Running ${running}…`
            : "Run all 3 tasks on this model"}
        </button>
        <button
          type="button"
          disabled={!canRun}
          onClick={runSmoke}
          className="inline-flex items-center rounded-md border border-border bg-surface-muted px-3 py-2 text-xs font-medium text-foreground/80 disabled:cursor-not-allowed disabled:opacity-50 hover:border-accent/60 hover:text-foreground"
        >
          Smoke test (user-only)
        </button>
        {!activeSlot ? (
          <span className="text-xs text-foreground/55">
            Load a model above to run tasks.
          </span>
        ) : (
          <span className="text-xs text-foreground/55">
            Active: <strong>{SLOT_META[activeSlot].title}</strong>
            {" · "}phase → check-in ({CHECK_IN_PATIENT_SCRIPT.length} turns) →
            reflection
          </span>
        )}
      </div>

      <TaskRow
        title="Smoke test · user-only prompt (same shape as bench-onnx.ts)"
        description={`Sends just [{role:"user", content:"${SMOKE_PROMPT}"}]. If this produces text but the WAVE tasks don't, the system-message prompt shape is the issue, not the WebGPU backend.`}
        upstream={results.upstream.smoke}
        finetune={results.finetune.smoke}
        renderResult={(r) => <SimpleOutput result={r} />}
      />

      <TaskRow
        title="Phase · chunk 2 narration"
        description="Single call. Expected: strict JSON { lines: string[6] }."
        upstream={results.upstream.phase}
        finetune={results.finetune.phase}
        renderResult={(r) => <SimpleOutput result={r} />}
      />

      <TaskRow
        title="Check-in · 4 patient turns"
        description="Multi-turn. Script: craving 7 → stress → tight chest → ready."
        upstream={results.upstream.checkin}
        finetune={results.finetune.checkin}
        renderResult={(r) => <CheckInOutput result={r} />}
      />

      <TaskRow
        title="Reflection · end-of-session insight"
        description="Single call. Expected: strict JSON insight + nextSteps."
        upstream={results.upstream.reflection}
        finetune={results.finetune.reflection}
        renderResult={(r) => <SimpleOutput result={r} />}
      />
    </div>
  );
}

interface RuntimeCardProps {
  slot: Slot;
  state: LoadState;
  isActive: boolean;
  busy: boolean;
  onLoad: () => void;
}

function RuntimeCard({
  slot,
  state,
  isActive,
  busy,
  onLoad,
}: RuntimeCardProps) {
  const meta = SLOT_META[slot];
  const borderClass = isActive
    ? "border-accent"
    : state.phase === "error"
      ? "border-red-300"
      : "border-border";
  const buttonLabel =
    state.phase === "loading"
      ? `Loading… ${state.percent || 0}%`
      : state.phase === "ready"
        ? "Active"
        : state.phase === "error"
          ? "Retry"
          : "Load";

  return (
    <div className={`rounded-2xl border bg-surface p-4 sm:p-5 ${borderClass}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3
          className="font-semibold tracking-tight"
          style={{ color: meta.accent }}
        >
          {meta.title}
        </h3>
        <span className="text-[10px] uppercase tracking-wide text-foreground/50">
          {state.phase}
        </span>
      </div>
      <p className="mt-1 break-all text-xs text-foreground/55">
        {meta.subtitle}
      </p>
      <p className="mt-3 text-xs text-foreground/70">{state.message}</p>
      <button
        type="button"
        disabled={busy || state.phase === "ready"}
        onClick={onLoad}
        className="mt-3 inline-flex items-center rounded-md border border-border bg-surface-muted px-3 py-1.5 text-xs font-medium text-foreground/80 disabled:cursor-not-allowed disabled:opacity-50 hover:border-accent/60 hover:text-foreground"
      >
        {buttonLabel}
      </button>
    </div>
  );
}

interface TaskRowProps<T> {
  title: string;
  description: string;
  upstream?: T;
  finetune?: T;
  renderResult: (r: T) => React.ReactNode;
}

function TaskRow<T>({
  title,
  description,
  upstream,
  finetune,
  renderResult,
}: TaskRowProps<T>) {
  return (
    <section className="rounded-2xl border border-border bg-surface-muted/30 p-4 sm:p-5">
      <div className="mb-3">
        <h2 className="text-base font-semibold tracking-tight sm:text-lg">{title}</h2>
        <p className="mt-1 text-xs leading-relaxed text-foreground/55">{description}</p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Column slot="upstream" result={upstream} renderResult={renderResult} />
        <Column slot="finetune" result={finetune} renderResult={renderResult} />
      </div>
    </section>
  );
}

interface ColumnProps<T> {
  slot: Slot;
  result?: T;
  renderResult: (r: T) => React.ReactNode;
}

function Column<T>({ slot, result, renderResult }: ColumnProps<T>) {
  const meta = SLOT_META[slot];
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-2 flex items-center gap-2">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: meta.accent }}
        />
        <span className="text-xs font-medium uppercase tracking-wide text-foreground/60">
          {meta.title}
        </span>
      </div>
      {result === undefined ? (
        <p className="text-xs italic text-foreground/45">
          Not run on this model yet.
        </p>
      ) : (
        renderResult(result)
      )}
    </div>
  );
}

function SimpleOutput({ result }: { result: SimpleResult }) {
  if (result.error) {
    return (
      <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
        {result.error}
      </p>
    );
  }
  const pretty = tryPrettyJSON(result.text);
  return (
    <div>
      <div className="mb-2 text-[11px] text-foreground/55">
        {result.elapsedMs.toFixed(0)} ms · ~{result.approxTokens} tok ·{" "}
        {result.tokensPerSecond.toFixed(1)} tok/s
      </div>
      <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-muted/50 px-3 py-2 text-xs leading-relaxed text-foreground/85">
        {pretty}
      </pre>
    </div>
  );
}

function CheckInOutput({ result }: { result: CheckInResult }) {
  return (
    <div className="space-y-3">
      <div className="text-[11px] text-foreground/55">
        Total: {(result.totalElapsedMs / 1000).toFixed(1)}s ·{" "}
        {result.turns.length} agent turns
      </div>
      {result.turns.map((turn, i) => (
        <div key={i} className="space-y-1.5">
          <div className="rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-900">
            <span className="font-semibold">Patient:</span> {turn.patient}
          </div>
          {turn.agent.error ? (
            <div className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
              {turn.agent.error}
            </div>
          ) : (
            <div className="rounded-md bg-surface-muted/50 px-3 py-2 text-xs text-foreground/85">
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-foreground/55">
                  Agent
                </span>
                <span className="text-[10px] text-foreground/45">
                  {turn.agent.elapsedMs.toFixed(0)} ms ·{" "}
                  {turn.agent.tokensPerSecond.toFixed(1)} tok/s
                </span>
              </div>
              <div className="whitespace-pre-wrap break-words">
                {turn.agent.text}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const o = err as Record<string, unknown>;
    if (typeof o.message === "string") return o.message;
    if (typeof o.error === "string") return o.error;
    if (typeof o.stack === "string") return o.stack;
    try {
      return JSON.stringify(err);
    } catch {
      /* fall through */
    }
  }
  return String(err);
}

function stripThinking(text: string): string {
  // Gemma 4's chat template uses `<|channel>...<channel|>` for thinking
  // segments (asymmetric brace direction). The older `<|think|>...</|think|>`
  // markers don't apply here.
  let out = text.replace(/<\|channel>[\s\S]*?<channel\|>/g, "");
  out = out.replace(/<\|channel>[\s\S]*$/g, "");
  // Defensive: also strip the legacy <|think|>...</|think|> form, and any
  // stray turn/eos sentinels the model may include in its output.
  out = out.replace(/<\|think\|>[\s\S]*?<\/?\|think\|>/g, "");
  out = out.replace(/<\|think\|>[\s\S]*$/g, "");
  out = out.replace(/<turn\|>[\s\S]*$/g, "");
  return out;
}

function tryPrettyJSON(text: string): string {
  const start = text.indexOf("{");
  if (start === -1) return text;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (c === "\\") {
      escaped = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) {
        const candidate = text.slice(start, i + 1);
        try {
          return JSON.stringify(JSON.parse(candidate), null, 2);
        } catch {
          return text;
        }
      }
    }
  }
  return text;
}
