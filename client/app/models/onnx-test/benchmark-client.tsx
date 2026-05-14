"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  pipeline,
  env,
  TextStreamer,
  type TextGenerationPipeline,
} from "@huggingface/transformers";

const MODELS = {
  finetune: {
    id: "onnx-finetune-export",
    label: "Our fine-tune (Gather-quantized)",
    subtitle: "lora-wave-session-r32 ONNX • served from /onnx-finetune-export",
    color: "#a855f7",
  },
  upstream: {
    id: "onnx-community/gemma-4-E2B-it-ONNX",
    label: "Upstream base",
    subtitle: "onnx-community/gemma-4-E2B-it-ONNX • from HuggingFace",
    color: "#3b82f6",
  },
} as const;

type ModelKey = keyof typeof MODELS;

const PRESET_PROMPTS = [
  {
    label: "anxiety (short)",
    text: "I'm feeling anxious right now. What's one small thing I can do in the next minute?",
  },
  {
    label: "breathing (procedural)",
    text: "Walk me through a 30-second breathing exercise. Keep it concrete.",
  },
  {
    label: "factual (short)",
    text: "What is the capital of France? Answer in one sentence.",
  },
  {
    label: "haiku (creative)",
    text: "Write a haiku about ocean waves.",
  },
  {
    label: "long (paragraph)",
    text: "Explain to someone new to recovery what cravings are and why they pass. Three paragraphs.",
  },
];

const MAX_TOKEN_CHOICES = [32, 64, 128, 256] as const;
const RUN_COUNT_CHOICES = [1, 3, 5] as const;

interface RunResult {
  index: number;
  ttftMs: number;
  decodeMs: number;
  totalMs: number;
  tokenCount: number;
  decodeTokensPerSec: number;
  output: string;
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

export function OnnxBenchmarkClient() {
  const pipeRef = useRef<TextGenerationPipeline | null>(null);
  const loadedModelRef = useRef<ModelKey | null>(null);
  const [modelKey, setModelKey] = useState<ModelKey>("finetune");
  const [loadState, setLoadState] = useState<LoadState>(INITIAL_LOAD);
  const [prompt, setPrompt] = useState<string>(PRESET_PROMPTS[0].text);
  const [maxNewTokens, setMaxNewTokens] = useState<number>(128);
  const [runCount, setRunCount] = useState<number>(3);
  const [includeWarmup, setIncludeWarmup] = useState<boolean>(true);
  const [running, setRunning] = useState<boolean>(false);
  const [currentRunStatus, setCurrentRunStatus] = useState<string>("");
  const [results, setResults] = useState<RunResult[]>([]);

  useEffect(() => {
    env.allowLocalModels = true;
    env.allowRemoteModels = true;
    if (typeof window !== "undefined") {
      env.localModelPath = `${window.location.origin}/`;
    }
    env.useBrowserCache = true;
  }, []);

  const loadModel = useCallback(async () => {
    if (running) return;
    if (pipeRef.current) {
      try {
        await (pipeRef.current as unknown as { dispose?: () => Promise<void> }).dispose?.();
      } catch {
        /* ignore */
      }
      pipeRef.current = null;
      loadedModelRef.current = null;
    }
    setResults([]);
    setLoadState({ phase: "loading", message: "Initializing on WEBGPU…", percent: 0 });

    try {
      const pipe = (await pipeline("text-generation", MODELS[modelKey].id, {
        dtype: "q4f16",
        device: "webgpu",
        progress_callback: (info: unknown) => {
          const i = info as { status?: string; file?: string; progress?: number };
          if (i.status === "progress" && i.file && typeof i.progress === "number") {
            setLoadState({
              phase: "loading",
              message: `${i.file} ${i.progress.toFixed(0)}%`,
              percent: Math.round(i.progress),
            });
          }
        },
      })) as TextGenerationPipeline;
      pipeRef.current = pipe;
      loadedModelRef.current = modelKey;
      setLoadState({ phase: "ready", message: "Loaded and ready.", percent: 100 });
    } catch (err) {
      setLoadState({
        phase: "error",
        message: err instanceof Error ? err.message : String(err),
        percent: 0,
      });
    }
  }, [modelKey, running]);

  const runOne = useCallback(
    async (index: number, isWarmup: boolean): Promise<RunResult> => {
      const pipe = pipeRef.current;
      if (!pipe) {
        return {
          index,
          ttftMs: 0,
          decodeMs: 0,
          totalMs: 0,
          tokenCount: 0,
          decodeTokensPerSec: 0,
          output: "",
          error: "pipeline not loaded",
        };
      }

      let firstTokenTime = 0;
      let lastTokenTime = 0;
      let tokenCount = 0;
      const startedAt = performance.now();

      const streamer = new TextStreamer(
        (pipe as unknown as { tokenizer: ConstructorParameters<typeof TextStreamer>[0] }).tokenizer,
        {
          skip_prompt: true,
          skip_special_tokens: true,
          token_callback_function: (tokens: bigint[]) => {
            const now = performance.now();
            if (firstTokenTime === 0) firstTokenTime = now;
            lastTokenTime = now;
            tokenCount += tokens.length;
          },
        },
      );

      try {
        const result = (await pipe([{ role: "user", content: prompt }], {
          max_new_tokens: maxNewTokens,
          do_sample: false,
          return_full_text: false,
          streamer,
        } as Parameters<TextGenerationPipeline["_call"]>[1])) as unknown;
        const endedAt = performance.now();

        let output = "";
        const r = result as Array<{ generated_text?: unknown }>;
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

        const ttftMs = firstTokenTime > 0 ? firstTokenTime - startedAt : 0;
        const decodeMs = lastTokenTime > firstTokenTime ? lastTokenTime - firstTokenTime : 0;
        const totalMs = endedAt - startedAt;
        const decodeTokensPerSec =
          decodeMs > 0 && tokenCount > 1 ? ((tokenCount - 1) / decodeMs) * 1000 : 0;

        return {
          index,
          ttftMs,
          decodeMs,
          totalMs,
          tokenCount,
          decodeTokensPerSec,
          output: isWarmup ? "(warmup output discarded)" : output,
        };
      } catch (err) {
        return {
          index,
          ttftMs: 0,
          decodeMs: 0,
          totalMs: 0,
          tokenCount: 0,
          decodeTokensPerSec: 0,
          output: "",
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    [prompt, maxNewTokens],
  );

  const runBenchmark = useCallback(async () => {
    if (!pipeRef.current || running) return;
    setRunning(true);
    setResults([]);

    if (includeWarmup) {
      setCurrentRunStatus("Warmup run (excluded from results)…");
      await runOne(0, true);
    }

    const collected: RunResult[] = [];
    for (let i = 0; i < runCount; i++) {
      setCurrentRunStatus(`Run ${i + 1} of ${runCount}…`);
      const r = await runOne(i + 1, false);
      collected.push(r);
      setResults([...collected]);
    }

    setCurrentRunStatus("");
    setRunning(false);
  }, [includeWarmup, runCount, runOne, running]);

  const modelMeta = MODELS[modelKey];
  const isReady = loadState.phase === "ready" && loadedModelRef.current === modelKey;
  const canRun = isReady && !running && prompt.trim().length > 0;

  // Aggregates over non-error results.
  const ok = results.filter((r) => !r.error);
  const avg = (key: keyof RunResult): number => {
    if (ok.length === 0) return 0;
    const vals = ok.map((r) => Number(r[key])).filter((n) => Number.isFinite(n));
    return vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
  };
  const median = (key: keyof RunResult): number => {
    if (ok.length === 0) return 0;
    const vals = ok.map((r) => Number(r[key])).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
    if (vals.length === 0) return 0;
    const m = Math.floor(vals.length / 2);
    return vals.length % 2 ? vals[m] : (vals[m - 1] + vals[m]) / 2;
  };

  return (
    <div
      style={{
        padding: 32,
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        maxWidth: 1100,
        margin: "0 auto",
        color: "#1f2937",
      }}
    >
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 26, letterSpacing: -0.3 }}>
          ONNX runtime benchmark
        </h1>
        <p style={{ color: "#6b7280", marginTop: 8, lineHeight: 1.5, fontSize: 14 }}>
          Measures latency, decode throughput, and time-to-first-token (TTFT) on the
          local ONNX model via <code>@huggingface/transformers</code> (WebGPU, q4f16).
          Per-token timing uses a <code>TextStreamer</code> callback —{" "}
          <strong>TTFT</strong> is the wall time from generate-start until the first
          generated token; <strong>decode tok/s</strong> excludes that prefill window.
        </p>
      </header>

      {/* Model selector */}
      <div
        style={{
          padding: 16,
          background: "white",
          border: `2px solid ${isReady ? modelMeta.color : "#e5e7eb"}`,
          borderRadius: 8,
          marginBottom: 16,
        }}
      >
        <div style={{ display: "flex", gap: 16, marginBottom: 12 }}>
          {(Object.keys(MODELS) as ModelKey[]).map((k) => {
            const m = MODELS[k];
            const selected = modelKey === k;
            return (
              <label
                key={k}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  cursor: running ? "not-allowed" : "pointer",
                  opacity: running ? 0.6 : 1,
                  flex: 1,
                  padding: 10,
                  border: `1px solid ${selected ? m.color : "#e5e7eb"}`,
                  borderRadius: 6,
                  background: selected ? `${m.color}11` : "white",
                }}
              >
                <input
                  type="radio"
                  name="model"
                  checked={selected}
                  disabled={running}
                  onChange={() => setModelKey(k)}
                  style={{ marginTop: 2 }}
                />
                <div>
                  <div style={{ fontWeight: 600, color: m.color, fontSize: 14 }}>
                    {m.label}
                  </div>
                  <div style={{ color: "#6b7280", fontSize: 12, marginTop: 2 }}>
                    {m.subtitle}
                  </div>
                </div>
              </label>
            );
          })}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={loadModel}
            disabled={running || loadState.phase === "loading" || isReady}
            style={{
              padding: "8px 16px",
              fontSize: 14,
              fontWeight: 500,
              background: isReady ? "#e5e7eb" : modelMeta.color,
              color: isReady ? "#6b7280" : "white",
              border: "none",
              borderRadius: 6,
              cursor:
                running || loadState.phase === "loading" || isReady
                  ? "not-allowed"
                  : "pointer",
            }}
          >
            {isReady
              ? "✓ Loaded"
              : loadState.phase === "loading"
                ? "Loading…"
                : loadState.phase === "error"
                  ? "Retry load"
                  : "Load model"}
          </button>
          <div style={{ flex: 1 }}>
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
                  width: `${loadState.percent}%`,
                  background: loadState.phase === "error" ? "#ef4444" : modelMeta.color,
                  height: "100%",
                  transition: "width 0.2s",
                }}
              />
            </div>
            <div
              style={{
                fontSize: 12,
                color: loadState.phase === "error" ? "#b91c1c" : "#6b7280",
                marginTop: 4,
                wordBreak: "break-word",
              }}
            >
              {loadState.message}
            </div>
          </div>
        </div>
      </div>

      {/* Prompt + config */}
      <div
        style={{
          padding: 16,
          background: "#f9fafb",
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          marginBottom: 16,
        }}
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: "#6b7280", alignSelf: "center" }}>
            Presets:
          </span>
          {PRESET_PROMPTS.map((p) => (
            <button
              key={p.label}
              onClick={() => setPrompt(p.text)}
              disabled={running}
              style={{
                padding: "4px 10px",
                fontSize: 12,
                background: prompt === p.text ? "#1f2937" : "white",
                color: prompt === p.text ? "white" : "#374151",
                border: "1px solid #d1d5db",
                borderRadius: 999,
                cursor: running ? "not-allowed" : "pointer",
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={running}
          rows={3}
          style={{
            width: "100%",
            padding: 10,
            fontSize: 14,
            fontFamily: "inherit",
            border: "1px solid #d1d5db",
            borderRadius: 6,
            resize: "vertical",
            boxSizing: "border-box",
          }}
          placeholder="Enter a user prompt…"
        />

        <div
          style={{
            display: "flex",
            gap: 24,
            marginTop: 12,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <ConfigGroup label="max_new_tokens">
            {MAX_TOKEN_CHOICES.map((n) => (
              <Pill
                key={n}
                selected={maxNewTokens === n}
                disabled={running}
                onClick={() => setMaxNewTokens(n)}
              >
                {n}
              </Pill>
            ))}
          </ConfigGroup>
          <ConfigGroup label="runs">
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
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
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
          {running ? currentRunStatus || "Running…" : `▶ Benchmark (${runCount} run${runCount === 1 ? "" : "s"})`}
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
        <div style={{ marginLeft: "auto", color: "#6b7280", fontSize: 13 }}>
          {!isReady
            ? "Load a model first."
            : results.length > 0
              ? `${ok.length}/${results.length} successful`
              : "Ready to benchmark."}
        </div>
      </div>

      {results.length > 0 ? (
        <ResultsTable results={results} ok={ok} avg={avg} median={median} color={modelMeta.color} />
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
          No runs yet. Load a model and click Benchmark.
        </div>
      )}
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

function ResultsTable({
  results,
  ok,
  avg,
  median,
  color,
}: {
  results: RunResult[];
  ok: RunResult[];
  avg: (k: keyof RunResult) => number;
  median: (k: keyof RunResult) => number;
  color: string;
}) {
  const fmtMs = (n: number) => `${n.toFixed(0)} ms`;
  const fmtSec = (n: number) => `${(n / 1000).toFixed(2)} s`;
  const fmtTps = (n: number) => `${n.toFixed(1)} tok/s`;

  return (
    <div>
      {/* Summary */}
      <div
        style={{
          padding: 16,
          background: "white",
          border: `1px solid ${color}33`,
          borderLeft: `4px solid ${color}`,
          borderRadius: 8,
          marginBottom: 12,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 16,
          }}
        >
          <Metric label="TTFT (avg / median)" primary={fmtMs(avg("ttftMs"))} secondary={`${fmtMs(median("ttftMs"))} median`} />
          <Metric label="Decode rate (avg / median)" primary={fmtTps(avg("decodeTokensPerSec"))} secondary={`${fmtTps(median("decodeTokensPerSec"))} median`} />
          <Metric label="Total latency (avg / median)" primary={fmtSec(avg("totalMs"))} secondary={`${fmtSec(median("totalMs"))} median`} />
          <Metric label="Tokens generated (avg)" primary={`${avg("tokenCount").toFixed(0)} tok`} secondary={`${ok.length} successful runs`} />
        </div>
      </div>

      {/* Per-run table */}
      <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden", background: "white" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead style={{ background: "#f9fafb" }}>
            <tr>
              <Th>Run</Th>
              <Th align="right">TTFT</Th>
              <Th align="right">Decode</Th>
              <Th align="right">Decode rate</Th>
              <Th align="right">Total</Th>
              <Th align="right">Tokens</Th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.index} style={{ borderTop: "1px solid #e5e7eb" }}>
                <Td>#{r.index}</Td>
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
            ))}
          </tbody>
        </table>
      </div>

      {/* Outputs */}
      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: "pointer", fontSize: 13, color: "#6b7280", padding: 8 }}>
          Show generated outputs ({ok.length})
        </summary>
        <div style={{ marginTop: 8 }}>
          {ok.map((r) => (
            <div
              key={r.index}
              style={{
                padding: 12,
                background: "white",
                border: "1px solid #e5e7eb",
                borderRadius: 6,
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color,
                  marginBottom: 6,
                  letterSpacing: 0.4,
                  textTransform: "uppercase",
                }}
              >
                Run #{r.index} · {r.tokenCount} tok · {fmtTps(r.decodeTokensPerSec)}
              </div>
              <div style={{ fontSize: 14, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                {r.output}
              </div>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

function Metric({
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
          fontSize: 11,
          color: "#6b7280",
          textTransform: "uppercase",
          letterSpacing: 0.4,
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 600, marginTop: 4, color: "#1f2937" }}>
        {primary}
      </div>
      <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>{secondary}</div>
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
        fontFamily: align === "right" ? "ui-monospace, SFMono-Regular, monospace" : "inherit",
      }}
    >
      {children}
    </td>
  );
}
