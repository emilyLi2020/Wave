"use client";

import { useCallback, useRef, useState } from "react";
import {
  CreateMLCEngine,
  type MLCEngineInterface,
  type AppConfig,
  type InitProgressReport,
} from "@mlc-ai/web-llm";
import {
  pipeline,
  type TextGenerationPipeline,
} from "@huggingface/transformers";

// Two runtimes, same prompts. Mac/desktop only — loading both is ~6 GB total.

const MLC_MODEL_ID = "wave-r32-q4f16_1";
const ONNX_UPSTREAM_ID = "onnx-community/gemma-4-E2B-it-ONNX";

const MLC_APP_CONFIG: AppConfig = {
  model_list: [
    {
      model:
        typeof window === "undefined"
          ? "/mlc-export/"
          : new URL("/mlc-export/", window.location.origin).toString(),
      model_id: MLC_MODEL_ID,
      model_lib:
        typeof window === "undefined"
          ? "/mlc-export/wave-r32-q4f16_1-webgpu.wasm"
          : new URL(
              "/mlc-export/wave-r32-q4f16_1-webgpu.wasm",
              window.location.origin,
            ).toString(),
      overrides: { context_window_size: 4096, sliding_window_size: -1 },
    },
  ],
};

const PROMPTS = [
  {
    label: "anxiety",
    text: "I'm feeling anxious right now. What's one small thing I can do in the next minute?",
  },
  {
    label: "breathing",
    text: "Walk me through a 30-second breathing exercise. Keep it concrete.",
  },
  {
    label: "factual",
    text: "What is the capital of France? Answer in one sentence.",
  },
  { label: "haiku", text: "Write a haiku about ocean waves." },
];

const MAX_NEW_TOKENS = 80;

type Runtime = "onnx-upstream" | "mlc-finetune";

interface Trial {
  runtime: Runtime;
  prompt: string;
  output: string;
  prefillMs: number;
  decodeMs: number;
  tokensGenerated: number;
  tokensPerSecond: number;
  error?: string;
}

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

export function CompareClient() {
  const mlcRef = useRef<MLCEngineInterface | null>(null);
  const onnxRef = useRef<TextGenerationPipeline | null>(null);
  const [mlcLoad, setMlcLoad] = useState<LoadState>(INITIAL_LOAD);
  const [onnxLoad, setOnnxLoad] = useState<LoadState>(INITIAL_LOAD);
  const [trials, setTrials] = useState<Trial[]>([]);
  const [running, setRunning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadMlc = useCallback(async () => {
    setMlcLoad({ phase: "loading", message: "Init...", percent: 0 });
    try {
      const engine = await CreateMLCEngine(MLC_MODEL_ID, {
        appConfig: MLC_APP_CONFIG,
        initProgressCallback: (r: InitProgressReport) =>
          setMlcLoad({
            phase: "loading",
            message: r.text,
            percent: Math.round(r.progress * 100),
          }),
      });
      mlcRef.current = engine;
      setMlcLoad({ phase: "ready", message: "Ready.", percent: 100 });
    } catch (err) {
      setMlcLoad({
        phase: "error",
        message: err instanceof Error ? err.message : String(err),
        percent: 0,
      });
    }
  }, []);

  const loadOnnx = useCallback(async () => {
    setOnnxLoad({ phase: "loading", message: "Init...", percent: 0 });
    try {
      const pipe = (await pipeline("text-generation", ONNX_UPSTREAM_ID, {
        dtype: "q4f16",
        progress_callback: (info: unknown) => {
          const i = info as { status?: string; file?: string; progress?: number };
          if (i.status === "progress" && i.file && typeof i.progress === "number") {
            setOnnxLoad({
              phase: "loading",
              message: `${i.file} ${i.progress.toFixed(0)}%`,
              percent: Math.round(i.progress),
            });
          }
        },
      })) as TextGenerationPipeline;
      onnxRef.current = pipe;
      setOnnxLoad({ phase: "ready", message: "Ready.", percent: 100 });
    } catch (err) {
      setOnnxLoad({
        phase: "error",
        message: err instanceof Error ? err.message : String(err),
        percent: 0,
      });
    }
  }, []);

  const runMlcTrial = useCallback(async (prompt: string): Promise<Trial> => {
    const engine = mlcRef.current;
    if (!engine) {
      return {
        runtime: "mlc-finetune",
        prompt,
        output: "",
        prefillMs: 0,
        decodeMs: 0,
        tokensGenerated: 0,
        tokensPerSecond: 0,
        error: "engine not loaded",
      };
    }
    const startedAt = performance.now();
    let firstTokenAt: number | null = null;
    let tokenCount = 0;
    let output = "";
    try {
      const stream = await engine.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        max_tokens: MAX_NEW_TOKENS,
        stream: true,
      });
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? "";
        if (!delta) continue;
        if (firstTokenAt === null) firstTokenAt = performance.now();
        tokenCount += 1;
        output += delta;
      }
    } catch (err) {
      return {
        runtime: "mlc-finetune",
        prompt,
        output,
        prefillMs: 0,
        decodeMs: 0,
        tokensGenerated: tokenCount,
        tokensPerSecond: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
    const endedAt = performance.now();
    const prefillMs = firstTokenAt !== null ? firstTokenAt - startedAt : 0;
    const decodeMs =
      firstTokenAt !== null ? endedAt - firstTokenAt : endedAt - startedAt;
    return {
      runtime: "mlc-finetune",
      prompt,
      output,
      prefillMs,
      decodeMs,
      tokensGenerated: tokenCount,
      tokensPerSecond: decodeMs > 0 ? (tokenCount / decodeMs) * 1000 : 0,
    };
  }, []);

  const runOnnxTrial = useCallback(async (prompt: string): Promise<Trial> => {
    const pipe = onnxRef.current;
    if (!pipe) {
      return {
        runtime: "onnx-upstream",
        prompt,
        output: "",
        prefillMs: 0,
        decodeMs: 0,
        tokensGenerated: 0,
        tokensPerSecond: 0,
        error: "pipeline not loaded",
      };
    }
    const startedAt = performance.now();
    try {
      const result = (await pipe([{ role: "user", content: prompt }], {
        max_new_tokens: MAX_NEW_TOKENS,
        do_sample: false,
        return_full_text: false,
      })) as unknown;
      const endedAt = performance.now();
      const r = result as Array<{ generated_text?: unknown }>;
      let output = "";
      if (Array.isArray(r) && r.length > 0) {
        const gen = r[0]?.generated_text;
        if (typeof gen === "string") output = gen;
        else if (Array.isArray(gen)) {
          const last = gen[gen.length - 1] as { role?: string; content?: string };
          if (last?.role === "assistant" && typeof last.content === "string") {
            output = last.content;
          }
        }
      }
      const tokenCount = Math.max(1, Math.round(output.length / 4));
      const elapsed = endedAt - startedAt;
      return {
        runtime: "onnx-upstream",
        prompt,
        output,
        prefillMs: 0,
        decodeMs: elapsed,
        tokensGenerated: tokenCount,
        tokensPerSecond: elapsed > 0 ? (tokenCount / elapsed) * 1000 : 0,
      };
    } catch (err) {
      return {
        runtime: "onnx-upstream",
        prompt,
        output: "",
        prefillMs: 0,
        decodeMs: 0,
        tokensGenerated: 0,
        tokensPerSecond: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, []);

  const runAll = useCallback(async () => {
    setRunning(true);
    setTrials([]);
    setErrorMessage(null);
    try {
      const results: Trial[] = [];
      for (const p of PROMPTS) {
        if (mlcRef.current) results.push(await runMlcTrial(p.text));
        setTrials([...results]);
        if (onnxRef.current) results.push(await runOnnxTrial(p.text));
        setTrials([...results]);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }, [runMlcTrial, runOnnxTrial]);

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif", maxWidth: 1200 }}>
      <h1>Runtime Comparison — ONNX (upstream base) vs MLC (our fine-tune)</h1>
      <p style={{ color: "#666" }}>
        Same prompts, same temperature, same max_tokens. Load both engines, then
        run prompts to compare TTFT, tok/s, and output quality side-by-side.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
        <RuntimeCard
          title="ONNX upstream base"
          subtitle="onnx-community/gemma-4-E2B-it-ONNX via @huggingface/transformers"
          load={onnxLoad}
          onLoad={loadOnnx}
        />
        <RuntimeCard
          title="MLC fine-tune"
          subtitle="Maelstrome/lora-wave-session-r32-merged → MLC q4f16_1 → WebGPU"
          load={mlcLoad}
          onLoad={loadMlc}
        />
      </div>

      <div style={{ marginTop: 16 }}>
        <button
          onClick={runAll}
          disabled={
            running ||
            (mlcLoad.phase !== "ready" && onnxLoad.phase !== "ready")
          }
          style={{ padding: "10px 20px", fontSize: 16 }}
        >
          {running ? "Running..." : `Run ${PROMPTS.length} prompts on loaded engines`}
        </button>
      </div>

      {errorMessage && (
        <pre
          style={{
            background: "#fee",
            border: "1px solid #f99",
            padding: 12,
            marginTop: 12,
            whiteSpace: "pre-wrap",
          }}
        >
          {errorMessage}
        </pre>
      )}

      {trials.length > 0 && <ResultsTable trials={trials} />}
    </div>
  );
}

function RuntimeCard({
  title,
  subtitle,
  load,
  onLoad,
}: {
  title: string;
  subtitle: string;
  load: LoadState;
  onLoad: () => void;
}) {
  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 6, padding: 12 }}>
      <h3 style={{ margin: 0 }}>{title}</h3>
      <div style={{ color: "#777", fontSize: 13 }}>{subtitle}</div>
      <button
        onClick={onLoad}
        disabled={load.phase === "loading" || load.phase === "ready"}
        style={{ marginTop: 10, padding: "6px 14px" }}
      >
        {load.phase === "ready"
          ? "✅ Loaded"
          : load.phase === "loading"
            ? "Loading..."
            : load.phase === "error"
              ? "Retry load"
              : "Load"}
      </button>
      <div style={{ marginTop: 8 }}>
        <div
          style={{
            background: "#eee",
            height: 8,
            borderRadius: 4,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${load.percent}%`,
              background: load.phase === "error" ? "#f87171" : "#4ade80",
              height: "100%",
              transition: "width 0.2s",
            }}
          />
        </div>
        <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>{load.message}</div>
      </div>
    </div>
  );
}

function ResultsTable({ trials }: { trials: Trial[] }) {
  // Group by prompt for side-by-side comparison
  const byPrompt = new Map<string, Trial[]>();
  for (const t of trials) {
    const arr = byPrompt.get(t.prompt) ?? [];
    arr.push(t);
    byPrompt.set(t.prompt, arr);
  }

  return (
    <div style={{ marginTop: 24 }}>
      <h3>Results</h3>
      {Array.from(byPrompt.entries()).map(([prompt, group]) => (
        <div
          key={prompt}
          style={{ border: "1px solid #ddd", borderRadius: 6, padding: 12, marginTop: 12 }}
        >
          <div style={{ fontWeight: 500, marginBottom: 8 }}>{prompt}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {group.map((t, i) => (
              <div
                key={i}
                style={{
                  background: "#fafafa",
                  border: "1px solid #eee",
                  padding: 10,
                  borderRadius: 4,
                }}
              >
                <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>
                  {t.runtime} ·{" "}
                  {t.error ? (
                    <span style={{ color: "red" }}>error</span>
                  ) : (
                    <>
                      TTFT {t.prefillMs.toFixed(0)}ms · {t.tokensGenerated} tok ·{" "}
                      {t.tokensPerSecond.toFixed(1)} tok/s
                    </>
                  )}
                </div>
                <div style={{ fontSize: 14, whiteSpace: "pre-wrap" }}>
                  {t.error ? t.error : t.output}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
