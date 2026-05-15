"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  pipeline,
  env,
  TextStreamer,
  type TextGenerationPipeline,
} from "@huggingface/transformers";

import {
  loadWaveWllama,
  WAVE_GGUF_FILE,
  WAVE_GGUF_REPO,
  type WllamaInstance,
} from "@/lib/wllama";

// Runtime benchmark: ONNX upstream base vs wllama WAVE fine-tune.
// - ONNX: onnx-community/gemma-4-E2B-it-ONNX via @huggingface/transformers
//         (onnxruntime-web, q4f16, WebGPU)
// - wllama: Maelstrome/lora-wave-session-r32/gguf/...-Q4_K_M-00001-of-00005.gguf
//         via @wllama/wllama (llama.cpp WASM/WebGPU)
//
// Not an apples-to-apples model comparison — these are different fine-tunes.
// It IS an apples-to-apples runtime comparison on browser inference: TTFT,
// decode throughput, total wall-clock — answering "is the shipping path
// (wllama GGUF) faster, slower, or comparable to the previously-shipping
// path (ONNX base)?".

type RuntimeKey = "onnx" | "wllama";

const RUNTIMES: Record<
  RuntimeKey,
  { label: string; subtitle: string; color: string; backend: string }
> = {
  onnx: {
    label: "ONNX · @huggingface/transformers (base)",
    subtitle:
      "onnx-community/gemma-4-E2B-it-ONNX · onnxruntime-web · q4f16 · WebGPU",
    color: "#3b82f6",
    backend: "transformers.js v4 + onnxruntime-web",
  },
  wllama: {
    label: "wllama · @wllama/wllama (WAVE fine-tune)",
    subtitle: `${WAVE_GGUF_REPO}/${WAVE_GGUF_FILE} · llama.cpp WASM/WebGPU · Q4_K_M`,
    color: "#10b981",
    backend: "wllama v3.1 + llama.cpp WebGPU",
  },
};

const ONNX_MODEL_ID = "onnx-community/gemma-4-E2B-it-ONNX";

// Three WAVE inference scenarios. Each is a sequence of user turns played in
// order; for multi-turn scenarios the conversation history accumulates between
// turns so we can measure prefill on a growing context.
type ScenarioKey = "phase" | "checkin" | "reflection";

// Prompts are kept simple and conversational. Earlier versions tried to stuff
// a persona / system instruction into the user role; the upstream Gemma 4
// E2B IT base can't follow long instruction-style user turns and falls into
// "please clarify" loops, and splitting into a separate system role made it
// worse (Gemma 4's chat template doesn't support a distinct system role
// cleanly across all loaders). For pure runtime/throughput numbers, simple
// prompts that we know elicit coherent output from both models are
// sufficient — this is a runtime benchmark, not a quality benchmark.
const SCENARIOS: Record<
  ScenarioKey,
  {
    label: string;
    description: string;
    userTurns: string[];
    suggestedMaxTokens: number;
  }
> = {
  phase: {
    label: "Phase narration",
    description:
      "Single-turn long-form. Stresses sustained decode throughput on one open-ended prompt.",
    suggestedMaxTokens: 200,
    userTurns: [
      "Write a calming six-line guided meditation for someone feeling anxious. Use simple, concrete sentences in second person.",
    ],
  },
  checkin: {
    label: "Check-in (multi-turn)",
    description:
      "Three user turns of back-and-forth, history accumulates each turn. Stresses prefill on growing context.",
    suggestedMaxTokens: 96,
    userTurns: [
      "I'm feeling anxious right now. What's one small thing I can do in the next minute?",
      "Okay, I tried that. My chest still feels tight and warm.",
      "It started about twenty minutes ago after I saw a beer ad on my phone.",
    ],
  },
  reflection: {
    label: "Reflection",
    description:
      "Single-turn long-form summary. Stresses sustained decode throughput.",
    suggestedMaxTokens: 200,
    userTurns: [
      "Write a two-paragraph reflection on finishing a short meditation session. The breathing exercise helped most, the body scan was harder. Address the reader in second person.",
    ],
  },
};

const RUN_COUNT_CHOICES = [1, 3, 5] as const;

interface RunResult {
  runtime: RuntimeKey;
  scenario: ScenarioKey;
  runIndex: number; // 1-based; warmup uses 0 and is not stored
  turnIndex: number; // 1-based turn within the scenario
  totalTurns: number;
  ttftMs: number;
  decodeMs: number;
  totalMs: number;
  tokenCount: number;
  decodeTokensPerSec: number;
  output: string;
  error?: string;
}

type ChatMessage = { role: "user" | "assistant"; content: string };

type LoadState = {
  phase: "idle" | "loading" | "ready" | "error";
  message: string;
  percent: number;
};

const INITIAL_LOAD: LoadState = {
  phase: "idle",
  message: "Not loaded.",
  percent: 0,
};

export function OnnxBenchmarkClient() {
  // Single-active runtime: only one engine in VRAM. Loading one disposes the
  // other. Results accumulate across switches so ONNX and wllama runs end up
  // in the same comparison table.
  const onnxRef = useRef<TextGenerationPipeline | null>(null);
  const wllamaRef = useRef<WllamaInstance | null>(null);
  const activeRef = useRef<RuntimeKey | null>(null);

  const [onnxState, setOnnxState] = useState<LoadState>(INITIAL_LOAD);
  const [wllamaState, setWllamaState] = useState<LoadState>(INITIAL_LOAD);
  const [runCount, setRunCount] = useState<number>(3);
  const [includeWarmup, setIncludeWarmup] = useState<boolean>(true);
  const [running, setRunning] = useState<boolean>(false);
  const [statusText, setStatusText] = useState<string>("");
  const [results, setResults] = useState<RunResult[]>([]);
  // Live preview of whatever turn is currently generating. Populated by the
  // per-runtime turn callbacks via setStreamingText(prev => prev + delta).
  // Title is set when a turn starts and cleared between scenarios + at the
  // end of the run. Lets you watch the model generate in real time —
  // particularly useful for the multi-turn check-in scenario.
  const [streamingText, setStreamingText] = useState<string>("");
  const [streamingTitle, setStreamingTitle] = useState<string>("");

  useEffect(() => {
    env.allowLocalModels = true;
    env.allowRemoteModels = true;
    if (typeof window !== "undefined") {
      env.localModelPath = `${window.location.origin}/`;
    }
    env.useBrowserCache = true;
  }, []);

  const disposeAll = useCallback(async () => {
    if (onnxRef.current) {
      try {
        await (
          onnxRef.current as unknown as { dispose?: () => Promise<void> }
        ).dispose?.();
      } catch {
        /* ignore */
      }
      onnxRef.current = null;
    }
    if (wllamaRef.current) {
      try {
        // wllama's exit() releases the WASM heap + GPU buffers.
        await (
          wllamaRef.current as unknown as { exit?: () => Promise<void> }
        ).exit?.();
      } catch {
        /* ignore */
      }
      wllamaRef.current = null;
    }
    activeRef.current = null;
  }, []);

  const loadOnnx = useCallback(async () => {
    if (running) return;
    await disposeAll();
    setWllamaState(INITIAL_LOAD);
    // Reassert env each time — other model-test routes may have toggled
    // these flags in this SPA session.
    env.allowLocalModels = false;
    env.allowRemoteModels = true;
    // Crank onnxruntime-web's log level to verbose so init prints which
    // execution providers (webgpu vs wasm) ORT actually selects. Without
    // this we get silent fallback to wasm and no visible signal.
    try {
      // ORT Env types: logLevel is "verbose" | "info" | "warning" | "error" | "fatal"
      (env.backends.onnx as { logLevel?: string }).logLevel = "verbose";
      (env.backends.onnx as { logLevelInternal?: string }).logLevelInternal =
        "verbose";
    } catch {
      /* ignore — older transformers.js builds may not expose this */
    }
    setOnnxState({ phase: "loading", message: "Initializing on WEBGPU…", percent: 0 });
    try {
      // Probe WebGPU adapter directly first so we know whether the browser
      // is the bottleneck or ORT is.
      if (typeof navigator !== "undefined" && "gpu" in navigator) {
        try {
          const adapter = await (
            navigator as { gpu: { requestAdapter: () => Promise<unknown> } }
          ).gpu.requestAdapter();
          console.log("[onnx-probe] navigator.gpu.requestAdapter →", adapter);
        } catch (err) {
          console.warn("[onnx-probe] navigator.gpu.requestAdapter threw:", err);
        }
      } else {
        console.warn(
          "[onnx-probe] navigator.gpu is missing — WebGPU not available in this browser",
        );
      }
      const pipe = (await pipeline("text-generation", ONNX_MODEL_ID, {
        dtype: "q4f16",
        device: "webgpu",
        progress_callback: (info: unknown) => {
          const i = info as { status?: string; file?: string; progress?: number };
          if (i.status === "progress" && i.file && typeof i.progress === "number") {
            setOnnxState({
              phase: "loading",
              message: `${i.file} ${i.progress.toFixed(0)}%`,
              percent: Math.round(i.progress),
            });
          }
        },
      })) as TextGenerationPipeline;
      onnxRef.current = pipe;
      activeRef.current = "onnx";
      // Introspect which execution provider ORT actually picked. transformers.js
      // hides the InferenceSession behind pipe.model.sessions; the session's
      // handler holds the provider used. Surfaces silent wasm fallbacks where
      // we asked for webgpu but ORT couldn't honor it for this model.
      try {
        const sessions = (
          pipe.model as unknown as { sessions?: Record<string, unknown> }
        ).sessions;
        if (sessions) {
          for (const [name, session] of Object.entries(sessions)) {
            const handler = (session as { handler?: unknown }).handler as
              | { _executionProviderInstances?: unknown[] }
              | undefined;
            const providers =
              handler && Array.isArray(handler._executionProviderInstances)
                ? handler._executionProviderInstances.map((p) =>
                    (p as { constructor?: { name?: string } }).constructor?.name ?? typeof p,
                  )
                : "unknown (no _executionProviderInstances)";
            console.log(`[onnx-probe] session "${name}" providers:`, providers);
          }
        } else {
          console.log("[onnx-probe] pipe.model.sessions not present:", pipe.model);
        }
      } catch (err) {
        console.warn("[onnx-probe] introspection failed:", err);
      }
      setOnnxState({ phase: "ready", message: "Loaded and ready.", percent: 100 });
    } catch (err) {
      setOnnxState({
        phase: "error",
        message: err instanceof Error ? err.message : String(err),
        percent: 0,
      });
    }
  }, [disposeAll, running]);

  const loadWllama = useCallback(async () => {
    if (running) return;
    await disposeAll();
    setOnnxState(INITIAL_LOAD);
    setWllamaState({
      phase: "loading",
      message: "Initializing wllama (WebGPU)…",
      percent: 0,
    });
    try {
      const wllama = await loadWaveWllama({
        onProgress: ({ percent }) => {
          setWllamaState({
            phase: "loading",
            message: `Downloading ${WAVE_GGUF_FILE} ${percent}%`,
            percent,
          });
        },
      });
      wllamaRef.current = wllama;
      activeRef.current = "wllama";
      setWllamaState({ phase: "ready", message: "Loaded and ready.", percent: 100 });
    } catch (err) {
      setWllamaState({
        phase: "error",
        message: err instanceof Error ? err.message : String(err),
        percent: 0,
      });
    }
  }, [disposeAll, running]);

  // --- One assistant turn through ONNX. Multi-turn = pass full `history`.
  //     `onPartial` is invoked with each text delta the streamer emits, so
  //     the page can render generation live. ---
  const runOnnxTurn = useCallback(
    async (
      history: ChatMessage[],
      maxTokens: number,
      onPartial?: (delta: string) => void,
    ): Promise<RawTurnTiming> => {
      const pipe = onnxRef.current;
      if (!pipe) return rawError("pipeline not loaded");
      let firstTokenTime = 0;
      let lastTokenTime = 0;
      let tokenCount = 0;
      let output = "";
      const startedAt = performance.now();

      const streamer = new TextStreamer(
        (pipe as unknown as { tokenizer: ConstructorParameters<typeof TextStreamer>[0] })
          .tokenizer,
        {
          skip_prompt: true,
          skip_special_tokens: true,
          // Capture output here AND silence the default stdout writer
          // (transformers.js falls back to `process.stdout.write` which is
          // undefined under Next/turbopack's partial `process` shim).
          callback_function: (text: string) => {
            output += text;
            onPartial?.(text);
          },
          token_callback_function: (tokens: bigint[]) => {
            const now = performance.now();
            if (firstTokenTime === 0) firstTokenTime = now;
            lastTokenTime = now;
            tokenCount += tokens.length;
          },
        },
      );

      try {
        await pipe(history, {
          max_new_tokens: maxTokens,
          do_sample: false,
          return_full_text: false,
          streamer,
        } as Parameters<TextGenerationPipeline["_call"]>[1]);
        const endedAt = performance.now();
        return {
          firstTokenTime,
          lastTokenTime,
          tokenCount,
          startedAt,
          endedAt,
          output,
        };
      } catch (err) {
        return rawError(err instanceof Error ? err.message : String(err));
      }
    },
    [],
  );

  // --- One assistant turn through wllama. Pass full `history` each call.
  //     wllama's createChatCompletion is stateless wrt conversational state —
  //     we pass the full message array each call. No engine reload needed
  //     between scenarios (unlike MLC); llama.cpp's KV cache handles cross-
  //     call reuse via its prompt-cache checkpoint system.
  //
  //     With `stream: true`, createChatCompletion returns an AsyncIterable
  //     immediately (after wiring the worker), NOT when generation finishes.
  //     The onData callback fires asynchronously in the background. To
  //     actually block until generation completes (and to collect tokens),
  //     we have to drain the iterator with for-await — otherwise the function
  //     returns with tokenCount=0 / output="" before any token arrives. ---
  const runWllamaTurn = useCallback(
    async (
      history: ChatMessage[],
      maxTokens: number,
      onPartial?: (delta: string) => void,
    ): Promise<RawTurnTiming> => {
      const wllama = wllamaRef.current;
      if (!wllama) return rawError("wllama not loaded");
      let firstTokenTime = 0;
      let lastTokenTime = 0;
      let tokenCount = 0;
      let output = "";
      const startedAt = performance.now();
      try {
        const stream = await wllama.createChatCompletion({
          messages: history,
          temperature: 0,
          top_k: 1,
          max_tokens: maxTokens,
          stream: true,
          onData: () => {
            /* consumed via for-await below; required by StreamParams type */
          },
        });
        for await (const chunk of stream) {
          const delta = chunk.choices?.[0]?.delta?.content ?? "";
          if (delta.length === 0) continue;
          const now = performance.now();
          if (firstTokenTime === 0) firstTokenTime = now;
          lastTokenTime = now;
          tokenCount += 1;
          output += delta;
          onPartial?.(delta);
        }
        const endedAt = performance.now();
        return {
          firstTokenTime,
          lastTokenTime,
          tokenCount,
          startedAt,
          endedAt,
          output,
        };
      } catch (err) {
        return rawError(err instanceof Error ? err.message : String(err));
      }
    },
    [],
  );

  // Play one scenario end-to-end on the active runtime. Each user turn
  // produces a RunResult; conversation history accumulates between turns.
  //
  // wllama exception: kept as a fresh single-turn call instead of
  // accumulating history. The original reason was the llama.cpp slot-manager
  // crash (PR #20277) on back-to-back calls with diverging prefixes — that
  // crash is now neutralized by `swa_full: true` in client/lib/wllama/client.ts.
  // The no-history behavior was kept on this pass to isolate the reload-vs-
  // swa_full change; if the benchmark runs clean without reloads we can
  // re-enable history accumulation in a follow-up to make check-in measure
  // prefill-on-growing-context, matching the ONNX path.
  const runScenarioOnce = useCallback(
    async (runIndex: number, scenario: ScenarioKey): Promise<RunResult[]> => {
      const active = activeRef.current;
      if (!active) return [];
      const spec = SCENARIOS[scenario];
      const runOne = active === "onnx" ? runOnnxTurn : runWllamaTurn;
      const accumulateHistory = active !== "wllama";
      const history: ChatMessage[] = [];
      const out: RunResult[] = [];

      for (let t = 0; t < spec.userTurns.length; t++) {
        const messages: ChatMessage[] = accumulateHistory
          ? [...history, { role: "user", content: spec.userTurns[t] }]
          : [{ role: "user", content: spec.userTurns[t] }];
        const turnLabel =
          runIndex === 0
            ? `${active.toUpperCase()} · ${spec.label} · warmup · turn ${t + 1}/${spec.userTurns.length}`
            : `${active.toUpperCase()} · ${spec.label} · run #${runIndex} · turn ${t + 1}/${spec.userTurns.length}`;
        setStreamingTitle(turnLabel);
        setStreamingText("");
        const raw = await runOne(messages, spec.suggestedMaxTokens, (delta) => {
          setStreamingText((prev) => prev + delta);
        });
        if (raw.error) {
          out.push({
            runtime: active,
            scenario,
            runIndex,
            turnIndex: t + 1,
            totalTurns: spec.userTurns.length,
            ttftMs: 0,
            decodeMs: 0,
            totalMs: 0,
            tokenCount: 0,
            decodeTokensPerSec: 0,
            output: "",
            error: raw.error,
          });
          break; // stop the scenario on first error
        }
        if (accumulateHistory) {
          history.push({ role: "user", content: spec.userTurns[t] });
          history.push({ role: "assistant", content: raw.output });
        }
        out.push(finalize(active, scenario, runIndex, t + 1, spec.userTurns.length, raw));
      }
      return out;
    },
    [runOnnxTurn, runWllamaTurn],
  );

  const runBenchmark = useCallback(async () => {
    const active = activeRef.current;
    if (!active || running) return;
    setRunning(true);

    const allScenarios = Object.keys(SCENARIOS) as ScenarioKey[];

    if (includeWarmup) {
      setStatusText(`Warmup on ${active.toUpperCase()}…`);
      await runScenarioOnce(0, "phase");
    }

    const collected: RunResult[] = [...results];
    let stepIndex = 0;
    const totalSteps = runCount * allScenarios.length;
    for (let i = 0; i < runCount; i++) {
      for (const sk of allScenarios) {
        stepIndex += 1;
        setStatusText(
          `${active.toUpperCase()} · ${SCENARIOS[sk].label} · step ${stepIndex}/${totalSteps}…`,
        );
        const batch = await runScenarioOnce(i + 1, sk);
        collected.push(...batch);
        setResults([...collected]);
      }
    }

    setStatusText("");
    setStreamingTitle("");
    setStreamingText("");
    setRunning(false);
  }, [includeWarmup, results, runCount, runScenarioOnce, running]);

  const onnxOk = results.filter((r) => r.runtime === "onnx" && !r.error);
  const wllamaOk = results.filter((r) => r.runtime === "wllama" && !r.error);
  const activeKey: RuntimeKey | null =
    onnxState.phase === "ready"
      ? "onnx"
      : wllamaState.phase === "ready"
        ? "wllama"
        : null;
  const canRun = activeKey !== null && !running;

  return (
    <div
      className="mx-auto w-full max-w-5xl p-4 sm:p-6 lg:p-8"
      style={{
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        color: "#1f2937",
      }}
    >
      <header style={{ marginBottom: 24 }}>
        <h1
          className="text-2xl sm:text-[26px]"
          style={{ margin: 0, letterSpacing: -0.3 }}
        >
          Runtime benchmark · ONNX base vs wllama fine-tune
        </h1>
        <p style={{ color: "#6b7280", marginTop: 8, lineHeight: 1.5, fontSize: 14 }}>
          Two different fine-tunes through two different browser runtimes — but
          both are Gemma 4 E2B at q4 quantization, so this measures runtime
          throughput on equivalent-size models. <strong>ONNX</strong> = upstream
          base via <code>onnxruntime-web</code> WebGPU. <strong>wllama</strong> =
          WAVE fine-tune via llama.cpp WebGPU. Same three scenarios — phase
          narration, multi-turn check-in, reflection — with the same prompts and
          greedy decoding (temperature 0). <strong>TTFT</strong> = prefill
          (start → first token); <strong>decode tok/s</strong> excludes prefill.
        </p>
        <div
          style={{
            background: "#fef3c7",
            border: "1px solid #fcd34d",
            color: "#78350f",
            padding: "10px 14px",
            borderRadius: 6,
            fontSize: 13,
            marginTop: 12,
            lineHeight: 1.5,
          }}
        >
          ⚠️ <strong>wllama caveat.</strong> Known llama.cpp WASM bug ({" "}
          <a
            href="https://github.com/ggml-org/llama.cpp/pull/20277"
            target="_blank"
            rel="noreferrer"
            style={{ color: "#78350f", textDecoration: "underline" }}
          >
            llama.cpp PR #20277
          </a>
          ): back-to-back <code>createChatCompletion</code> calls with diverging
          prefixes used to abort the server slot with{" "}
          <code>table index out of bounds</code>. Neutralized by setting{" "}
          <code>swa_full: true</code> at load time (covers the full SWA cache
          window instead of the buggy 512-token windowed rebuild). The check-in
          scenario still runs as three independent single-turn calls on wllama
          rather than one accumulating conversation, so wllama TTFT does not
          reflect prefill-on-growing-context the way ONNX TTFT does. ONNX keeps
          the original multi-turn behavior.
        </div>
      </header>

      {/* Runtime cards */}
      <div
        className="grid gap-4 sm:grid-cols-2"
        style={{ marginBottom: 16 }}
      >
        <RuntimeCard
          runtime="onnx"
          state={onnxState}
          isActive={activeKey === "onnx"}
          busy={
            running ||
            onnxState.phase === "loading" ||
            wllamaState.phase === "loading"
          }
          onLoad={loadOnnx}
        />
        <RuntimeCard
          runtime="wllama"
          state={wllamaState}
          isActive={activeKey === "wllama"}
          busy={
            running ||
            onnxState.phase === "loading" ||
            wllamaState.phase === "loading"
          }
          onLoad={loadWllama}
        />
      </div>

      {/* Scenarios (info-only — every Run benchmarks all three) + config */}
      <div
        style={{
          padding: 16,
          background: "#f9fafb",
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          marginBottom: 16,
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: "#6b7280",
            textTransform: "uppercase",
            letterSpacing: 0.4,
            fontWeight: 600,
            marginBottom: 8,
          }}
        >
          Scenarios benchmarked each run
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(Object.keys(SCENARIOS) as ScenarioKey[]).map((k) => {
            const s = SCENARIOS[k];
            return (
              <div
                key={k}
                style={{
                  textAlign: "left",
                  padding: 12,
                  background: "white",
                  color: "#1f2937",
                  border: "1px solid #d1d5db",
                  borderRadius: 6,
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
                  {s.label}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "#6b7280",
                    lineHeight: 1.4,
                    marginBottom: 6,
                  }}
                >
                  {s.description}
                </div>
                <div style={{ fontSize: 11, color: "#6b7280" }}>
                  {s.userTurns.length} turn{s.userTurns.length === 1 ? "" : "s"} ·
                  max {s.suggestedMaxTokens} tok/turn
                </div>
              </div>
            );
          })}
        </div>

        <div
          style={{
            display: "flex",
            gap: 24,
            marginTop: 12,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <ConfigGroup label="runs per scenario">
            {RUN_COUNT_CHOICES.map((n) => (
              <Pill
                key={n}
                selected={runCount === n}
                disabled={running}
                onClick={() => setRunCount(n)}
              >
                {n}
              </Pill>
            ))}
          </ConfigGroup>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              color: "#374151",
              cursor: running ? "not-allowed" : "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={includeWarmup}
              disabled={running}
              onChange={(e) => setIncludeWarmup(e.target.checked)}
            />
            warmup run (discarded)
          </label>
        </div>
      </div>

      {/* Run button + status */}
      <div
        className="flex flex-wrap items-center gap-3"
        style={{
          padding: 16,
          background: "#f9fafb",
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          marginBottom: 20,
        }}
      >
        <button
          onClick={runBenchmark}
          disabled={!canRun}
          style={{
            padding: "10px 20px",
            fontSize: 15,
            fontWeight: 500,
            background: canRun ? "#10b981" : "#d1d5db",
            color: "white",
            border: "none",
            borderRadius: 6,
            cursor: canRun ? "pointer" : "not-allowed",
          }}
        >
          {running
            ? statusText || "Running…"
            : activeKey
              ? `▶ Benchmark all 3 scenarios on ${activeKey.toUpperCase()} (${runCount}× each)`
              : "Load a runtime first"}
        </button>
        <button
          onClick={() => setResults([])}
          disabled={results.length === 0 || running}
          style={{
            padding: "10px 16px",
            fontSize: 14,
            background: "transparent",
            color: results.length === 0 || running ? "#9ca3af" : "#6b7280",
            border: "1px solid #e5e7eb",
            borderRadius: 6,
            cursor: results.length === 0 || running ? "not-allowed" : "pointer",
          }}
        >
          Clear results
        </button>
        <div
          className="sm:ml-auto"
          style={{ color: "#6b7280", fontSize: 13 }}
        >
          {results.length > 0
            ? `ONNX: ${onnxOk.length} ok · wllama: ${wllamaOk.length} ok`
            : "No runs yet."}
        </div>
      </div>

      {streamingTitle ? (
        <div
          style={{
            marginBottom: 20,
            padding: 16,
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderLeft: "4px solid #10b981",
            borderRadius: 8,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "#10b981",
              letterSpacing: 0.4,
              textTransform: "uppercase",
              marginBottom: 8,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>{streamingTitle}</span>
            <span style={{ color: "#9ca3af" }}>streaming…</span>
          </div>
          <div
            style={{
              fontSize: 14,
              whiteSpace: "pre-wrap",
              lineHeight: 1.5,
              maxHeight: 260,
              overflowY: "auto",
              color: "#1f2937",
            }}
          >
            {streamingText || (
              <span style={{ color: "#9ca3af" }}>Prefill in progress…</span>
            )}
          </div>
        </div>
      ) : null}

      {results.length > 0 ? (
        <ResultsView results={results} />
      ) : (
        <div
          style={{
            padding: 32,
            textAlign: "center",
            background: "#f9fafb",
            border: "1px dashed #d1d5db",
            borderRadius: 8,
            color: "#9ca3af",
            fontSize: 14,
          }}
        >
          No runs yet. Load a runtime, click Benchmark. Then load the other
          runtime and re-run to compare side-by-side.
        </div>
      )}
    </div>
  );
}

interface RawTurnTiming {
  firstTokenTime: number;
  lastTokenTime: number;
  tokenCount: number;
  startedAt: number;
  endedAt: number;
  output: string;
  error?: string;
}

function rawError(error: string): RawTurnTiming {
  return {
    firstTokenTime: 0,
    lastTokenTime: 0,
    tokenCount: 0,
    startedAt: 0,
    endedAt: 0,
    output: "",
    error,
  };
}

function finalize(
  runtime: RuntimeKey,
  scenario: ScenarioKey,
  runIndex: number,
  turnIndex: number,
  totalTurns: number,
  t: RawTurnTiming,
): RunResult {
  const ttftMs = t.firstTokenTime > 0 ? t.firstTokenTime - t.startedAt : 0;
  const decodeMs =
    t.lastTokenTime > t.firstTokenTime ? t.lastTokenTime - t.firstTokenTime : 0;
  const totalMs = t.endedAt - t.startedAt;
  const decodeTokensPerSec =
    decodeMs > 0 && t.tokenCount > 1 ? ((t.tokenCount - 1) / decodeMs) * 1000 : 0;
  return {
    runtime,
    scenario,
    runIndex,
    turnIndex,
    totalTurns,
    ttftMs,
    decodeMs,
    totalMs,
    tokenCount: t.tokenCount,
    decodeTokensPerSec,
    output: t.output,
  };
}

function RuntimeCard({
  runtime,
  state,
  isActive,
  busy,
  onLoad,
}: {
  runtime: RuntimeKey;
  state: LoadState;
  isActive: boolean;
  busy: boolean;
  onLoad: () => void;
}) {
  const meta = RUNTIMES[runtime];
  const label = isActive
    ? "✓ Active"
    : state.phase === "loading"
      ? "Loading…"
      : state.phase === "ready"
        ? "Switch to this"
        : state.phase === "error"
          ? "Retry"
          : "Load";
  return (
    <div
      style={{
        padding: 16,
        background: isActive ? `${meta.color}11` : "white",
        border: `2px solid ${isActive ? meta.color : "#e5e7eb"}`,
        borderRadius: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 17, color: meta.color }}>{meta.label}</h3>
        {isActive && (
          <span
            style={{
              fontSize: 11,
              padding: "2px 8px",
              background: meta.color,
              color: "white",
              borderRadius: 999,
              fontWeight: 600,
              letterSpacing: 0.5,
            }}
          >
            ACTIVE
          </span>
        )}
      </div>
      <div style={{ color: "#6b7280", fontSize: 12, marginTop: 4, lineHeight: 1.4 }}>
        {meta.subtitle}
      </div>
      <div
        style={{
          color: meta.color,
          fontSize: 11,
          marginTop: 4,
          fontWeight: 600,
          letterSpacing: 0.4,
        }}
      >
        Backend: {meta.backend}
      </div>

      <button
        onClick={onLoad}
        disabled={busy || isActive}
        style={{
          marginTop: 12,
          padding: "8px 14px",
          fontSize: 13,
          fontWeight: 500,
          background: isActive ? "#e5e7eb" : meta.color,
          color: isActive ? "#6b7280" : "white",
          border: "none",
          borderRadius: 6,
          cursor: busy || isActive ? "not-allowed" : "pointer",
          opacity: busy && !isActive ? 0.6 : 1,
        }}
      >
        {label}
      </button>

      <div style={{ marginTop: 12 }}>
        <div
          style={{
            background: "#f3f4f6",
            height: 6,
            borderRadius: 3,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${state.percent}%`,
              background: state.phase === "error" ? "#ef4444" : meta.color,
              height: "100%",
              transition: "width 0.2s",
            }}
          />
        </div>
        <div
          style={{
            fontSize: 12,
            color: state.phase === "error" ? "#b91c1c" : "#6b7280",
            marginTop: 6,
            wordBreak: "break-word",
          }}
        >
          {state.message}
        </div>
      </div>
    </div>
  );
}

function ConfigGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 12, color: "#6b7280" }}>{label}:</span>
      <div style={{ display: "flex", gap: 4 }}>{children}</div>
    </div>
  );
}

function Pill({
  selected,
  disabled,
  onClick,
  children,
}: {
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "4px 10px",
        fontSize: 12,
        background: selected ? "#1f2937" : "white",
        color: selected ? "white" : "#374151",
        border: "1px solid #d1d5db",
        borderRadius: 999,
        cursor: disabled ? "not-allowed" : "pointer",
        minWidth: 32,
      }}
    >
      {children}
    </button>
  );
}

function ResultsView({ results }: { results: RunResult[] }) {
  // Summary grid: rows = scenarios, columns = ONNX | wllama.
  const scenarios = Object.keys(SCENARIOS) as ScenarioKey[];

  return (
    <div>
      <div
        className="grid gap-3 sm:grid-cols-[140px_1fr_1fr] lg:grid-cols-[180px_1fr_1fr]"
        style={{
          marginBottom: 16,
          alignItems: "stretch",
        }}
      >
        <div className="hidden sm:block" /> {/* corner */}
        <div
          className="hidden sm:block"
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: RUNTIMES.onnx.color,
            textTransform: "uppercase",
            letterSpacing: 0.4,
            padding: "4px 8px",
          }}
        >
          ONNX (base)
        </div>
        <div
          className="hidden sm:block"
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: RUNTIMES.wllama.color,
            textTransform: "uppercase",
            letterSpacing: 0.4,
            padding: "4px 8px",
          }}
        >
          wllama (fine-tune)
        </div>
        {scenarios.map((s) => (
          <ScenarioRow
            key={s}
            scenario={s}
            onnxRows={results.filter(
              (r) => r.scenario === s && r.runtime === "onnx" && !r.error,
            )}
            wllamaRows={results.filter(
              (r) => r.scenario === s && r.runtime === "wllama" && !r.error,
            )}
          />
        ))}
      </div>

      {/* Per-turn detail table */}
      <div
        className="overflow-x-auto"
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          background: "white",
        }}
      >
        <table
          className="min-w-[720px]"
          style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
        >
          <thead style={{ background: "#f9fafb" }}>
            <tr>
              <Th>Runtime</Th>
              <Th>Scenario</Th>
              <Th>Run</Th>
              <Th>Turn</Th>
              <Th align="right">TTFT</Th>
              <Th align="right">Decode</Th>
              <Th align="right">Decode rate</Th>
              <Th align="right">Total</Th>
              <Th align="right">Tokens</Th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => {
              const meta = RUNTIMES[r.runtime];
              return (
                <tr key={i} style={{ borderTop: "1px solid #e5e7eb" }}>
                  <Td>
                    <span
                      style={{
                        display: "inline-block",
                        padding: "2px 8px",
                        fontSize: 11,
                        fontWeight: 600,
                        color: "white",
                        background: meta.color,
                        borderRadius: 4,
                        letterSpacing: 0.4,
                      }}
                    >
                      {r.runtime.toUpperCase()}
                    </span>
                  </Td>
                  <Td>{SCENARIOS[r.scenario].label}</Td>
                  <Td>#{r.runIndex}</Td>
                  <Td>
                    {r.turnIndex}/{r.totalTurns}
                  </Td>
                  {r.error ? (
                    <td colSpan={5} style={{ padding: 8, color: "#b91c1c" }}>
                      {r.error}
                    </td>
                  ) : (
                    <>
                      <Td align="right">{fmtMs(r.ttftMs)}</Td>
                      <Td align="right">{fmtMs(r.decodeMs)}</Td>
                      <Td align="right">{fmtTps(r.decodeTokensPerSec)}</Td>
                      <Td align="right">{fmtSec(r.totalMs)}</Td>
                      <Td align="right">{r.tokenCount}</Td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <details style={{ marginTop: 12 }}>
        <summary
          style={{ cursor: "pointer", fontSize: 13, color: "#6b7280", padding: 8 }}
        >
          Show generated outputs ({results.filter((r) => !r.error).length})
        </summary>
        <div style={{ marginTop: 8 }}>
          {results
            .filter((r) => !r.error)
            .map((r, i) => {
              const meta = RUNTIMES[r.runtime];
              return (
                <div
                  key={i}
                  style={{
                    padding: 12,
                    background: "white",
                    border: "1px solid #e5e7eb",
                    borderRadius: 6,
                    marginBottom: 8,
                  }}
                >
                  <div
                    className="break-words"
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: meta.color,
                      marginBottom: 6,
                      letterSpacing: 0.4,
                      textTransform: "uppercase",
                    }}
                  >
                    {r.runtime} · {SCENARIOS[r.scenario].label} · run #{r.runIndex}{" "}
                    · turn {r.turnIndex}/{r.totalTurns} · {r.tokenCount} tok ·{" "}
                    {fmtTps(r.decodeTokensPerSec)}
                  </div>
                  <div
                    className="break-words"
                    style={{ fontSize: 14, whiteSpace: "pre-wrap", lineHeight: 1.5 }}
                  >
                    {r.output}
                  </div>
                </div>
              );
            })}
        </div>
      </details>
    </div>
  );
}

function ScenarioRow({
  scenario,
  onnxRows,
  wllamaRows,
}: {
  scenario: ScenarioKey;
  onnxRows: RunResult[];
  wllamaRows: RunResult[];
}) {
  return (
    <>
      <div
        style={{
          padding: 12,
          background: "white",
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          fontSize: 13,
          fontWeight: 600,
          color: "#374151",
          display: "flex",
          alignItems: "center",
        }}
      >
        {SCENARIOS[scenario].label}
      </div>
      <SummaryBox runtime="onnx" rows={onnxRows} />
      <SummaryBox runtime="wllama" rows={wllamaRows} />
    </>
  );
}

function SummaryBox({ runtime, rows }: { runtime: RuntimeKey; rows: RunResult[] }) {
  const meta = RUNTIMES[runtime];
  const avg = (key: keyof RunResult): number => {
    if (rows.length === 0) return 0;
    const vals = rows.map((r) => Number(r[key])).filter((n) => Number.isFinite(n));
    return vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
  };
  const median = (key: keyof RunResult): number => {
    if (rows.length === 0) return 0;
    const vals = rows
      .map((r) => Number(r[key]))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    if (vals.length === 0) return 0;
    const m = Math.floor(vals.length / 2);
    return vals.length % 2 ? vals[m] : (vals[m - 1] + vals[m]) / 2;
  };

  return (
    <div
      style={{
        padding: 12,
        background: "white",
        border: `1px solid ${meta.color}33`,
        borderLeft: `4px solid ${meta.color}`,
        borderRadius: 8,
      }}
    >
      <div
        className="sm:hidden"
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: meta.color,
          textTransform: "uppercase",
          letterSpacing: 0.4,
          marginBottom: 6,
        }}
      >
        {runtime === "onnx" ? "ONNX (base)" : "wllama (fine-tune)"}
      </div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 12, color: "#9ca3af" }}>No runs yet.</div>
      ) : (
        <>
          <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 6 }}>
            {rows.length} turn{rows.length === 1 ? "" : "s"} measured
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 8,
            }}
          >
            <MetricMini
              label="TTFT"
              primary={fmtMs(avg("ttftMs"))}
              secondary={`${fmtMs(median("ttftMs"))} med`}
            />
            <MetricMini
              label="Decode"
              primary={fmtTps(avg("decodeTokensPerSec"))}
              secondary={`${fmtTps(median("decodeTokensPerSec"))} med`}
            />
            <MetricMini
              label="Total"
              primary={fmtSec(avg("totalMs"))}
              secondary={`${fmtSec(median("totalMs"))} med`}
            />
            <MetricMini
              label="Tokens"
              primary={`${avg("tokenCount").toFixed(0)} tok`}
              secondary="avg / turn"
            />
          </div>
        </>
      )}
    </div>
  );
}

function MetricMini({
  label,
  primary,
  secondary,
}: {
  label: string;
  primary: string;
  secondary: string;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          color: "#6b7280",
          textTransform: "uppercase",
          letterSpacing: 0.4,
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, marginTop: 2, color: "#1f2937" }}>
        {primary}
      </div>
      <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 1 }}>{secondary}</div>
    </div>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      style={{
        padding: "8px 12px",
        textAlign: align,
        fontSize: 11,
        fontWeight: 600,
        color: "#6b7280",
        textTransform: "uppercase",
        letterSpacing: 0.4,
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <td
      style={{
        padding: "8px 12px",
        textAlign: align,
        fontFamily:
          align === "right" ? "ui-monospace, SFMono-Regular, monospace" : "inherit",
      }}
    >
      {children}
    </td>
  );
}

function fmtMs(n: number): string {
  return `${n.toFixed(0)} ms`;
}
function fmtSec(n: number): string {
  return `${(n / 1000).toFixed(2)} s`;
}
function fmtTps(n: number): string {
  return `${n.toFixed(1)} tok/s`;
}
