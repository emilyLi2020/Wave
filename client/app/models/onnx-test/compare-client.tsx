"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  pipeline,
  env,
  type TextGenerationPipeline,
} from "@huggingface/transformers";

const UPSTREAM_ID = "onnx-community/gemma-4-E2B-it-ONNX";
const FINETUNE_LOCAL_ID = "onnx-finetune-export";

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

type Slot = "upstream" | "finetune";

interface Trial {
  slot: Slot;
  prompt: string;
  output: string;
  elapsedMs: number;
  approxTokens: number;
  tokensPerSecond: number;
  error?: string;
}

type LoadState = {
  phase: "idle" | "loading" | "ready" | "error";
  message: string;
  percent: number;
};

const INITIAL: LoadState = {
  phase: "idle",
  message: "Not loaded.",
  percent: 0,
};

const SLOT_META: Record<
  Slot,
  { title: string; subtitle: string; color: string; backend: string }
> = {
  upstream: {
    title: "Upstream base",
    subtitle: "onnx-community/gemma-4-E2B-it-ONNX • ~3 GB • from HuggingFace",
    color: "#3b82f6",
    backend: "WebGPU",
  },
  finetune: {
    title: "Our fine-tune (Gather-quantized)",
    subtitle:
      "lora-wave-session-r32 ONNX • ~2.8 GB after PLE quant • served locally",
    color: "#a855f7",
    backend: "WebGPU",
  },
};

export function OnnxCompareClient() {
  const pipeRef = useRef<TextGenerationPipeline | null>(null);
  const [upstreamState, setUpstreamState] = useState<LoadState>(INITIAL);
  const [finetuneState, setFinetuneState] = useState<LoadState>(INITIAL);
  const [trials, setTrials] = useState<Trial[]>([]);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);

  // Single source of truth: whichever card is ready is the active slot.
  const activeSlot: Slot | null =
    upstreamState.phase === "ready"
      ? "upstream"
      : finetuneState.phase === "ready"
        ? "finetune"
        : null;

  useEffect(() => {
    env.allowLocalModels = true;
    env.allowRemoteModels = true;
    if (typeof window !== "undefined") {
      env.localModelPath = `${window.location.origin}/`;
    }
    env.useBrowserCache = true;
  }, []);

  const setSlotState = useCallback((slot: Slot, state: LoadState) => {
    if (slot === "upstream") setUpstreamState(state);
    else setFinetuneState(state);
  }, []);

  const loadSlot = useCallback(
    async (slot: Slot) => {
      if (busy) return;
      setBusy(true);

      // Unload prior pipeline (any non-target slot's "ready" state means it's loaded).
      if (pipeRef.current) {
        try {
          await (pipeRef.current as unknown as { dispose?: () => Promise<void> }).dispose?.();
        } catch {
          /* ignore */
        }
        pipeRef.current = null;
        if (slot === "upstream") setFinetuneState(INITIAL);
        else setUpstreamState(INITIAL);
      }

      const modelId = slot === "upstream" ? UPSTREAM_ID : FINETUNE_LOCAL_ID;
      // Both models now use com.microsoft.GatherBlockQuantized after our
      // post-export gather quantization → both need WebGPU (no WASM kernel
      // for the op). If WebGPU + external data hits MountedFiles, we'll need
      // to address that separately.
      const device: "webgpu" | "wasm" = "webgpu";
      setSlotState(slot, {
        phase: "loading",
        message: `Initializing on ${device.toUpperCase()}…`,
        percent: 0,
      });

      try {
        const pipe = (await pipeline("text-generation", modelId, {
          dtype: "q4f16",
          device,
          progress_callback: (info: unknown) => {
            const i = info as { status?: string; file?: string; progress?: number };
            if (i.status === "progress" && i.file && typeof i.progress === "number") {
              setSlotState(slot, {
                phase: "loading",
                message: `${i.file} ${i.progress.toFixed(0)}%`,
                percent: Math.round(i.progress),
              });
            }
          },
        })) as TextGenerationPipeline;
        pipeRef.current = pipe;
        setSlotState(slot, { phase: "ready", message: "Loaded and ready.", percent: 100 });
      } catch (err) {
        setSlotState(slot, {
          phase: "error",
          message: err instanceof Error ? err.message : String(err),
          percent: 0,
        });
      } finally {
        setBusy(false);
      }
    },
    [busy, setSlotState],
  );

  const runOne = useCallback(
    async (slot: Slot, prompt: string): Promise<Trial> => {
      const pipe = pipeRef.current;
      if (!pipe) {
        return {
          slot,
          prompt,
          output: "",
          elapsedMs: 0,
          approxTokens: 0,
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
        const elapsedMs = performance.now() - startedAt;
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
        const approxTokens = Math.max(1, Math.round(output.length / 4));
        return {
          slot,
          prompt,
          output,
          elapsedMs,
          approxTokens,
          tokensPerSecond: elapsedMs > 0 ? (approxTokens / elapsedMs) * 1000 : 0,
        };
      } catch (err) {
        return {
          slot,
          prompt,
          output: "",
          elapsedMs: 0,
          approxTokens: 0,
          tokensPerSecond: 0,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    [],
  );

  const runActive = useCallback(async () => {
    if (!activeSlot) return;
    setRunning(true);
    const results = [...trials];
    for (const p of PROMPTS) {
      const trial = await runOne(activeSlot, p.text);
      results.push(trial);
      setTrials([...results]);
    }
    setRunning(false);
  }, [activeSlot, trials, runOne]);

  const canRun = activeSlot !== null && !busy && !running;

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
          ONNX A/B: Upstream Base vs Our Fine-tune
        </h1>
        <p style={{ color: "#6b7280", marginTop: 8, lineHeight: 1.5, fontSize: 14 }}>
          Both run through <code>@huggingface/transformers</code> with the WASM (CPU)
          backend. Only one model can be active at a time — switching unloads the other.
          Results accumulate across switches so you can compare prompt-by-prompt.
        </p>
        <div
          style={{
            background: "#dcfce7",
            border: "1px solid #86efac",
            color: "#166534",
            padding: "10px 14px",
            borderRadius: 6,
            fontSize: 13,
            marginTop: 12,
            lineHeight: 1.5,
          }}
        >
          ✅ <strong>Both run on WebGPU after the post-export Gather quantization.</strong>{" "}
          Apples-to-apples comparison: same backend, same architecture, same precision
          (q4f16 with int4 Gather/PLE). If you see <code>MountedFiles</code> errors,
          that's a known transformers.js v4 issue with external data on WebGPU; can
          retry or fall back to per-model device override.
        </div>
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          marginBottom: 20,
        }}
      >
        <RuntimeCard
          slot="upstream"
          state={upstreamState}
          isActive={activeSlot === "upstream"}
          busy={busy}
          onLoad={() => loadSlot("upstream")}
        />
        <RuntimeCard
          slot="finetune"
          state={finetuneState}
          isActive={activeSlot === "finetune"}
          busy={busy}
          onLoad={() => loadSlot("finetune")}
        />
      </div>

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
          onClick={runActive}
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
            ? `Running on ${activeSlot}…`
            : activeSlot
              ? `▶ Run ${PROMPTS.length} prompts on ${SLOT_META[activeSlot].title}`
              : "Load a model first"}
        </button>
        <button
          onClick={() => setTrials([])}
          disabled={trials.length === 0 || running}
          style={{
            padding: "10px 16px",
            fontSize: 14,
            background: "transparent",
            color: trials.length === 0 || running ? "#9ca3af" : "#6b7280",
            border: "1px solid #e5e7eb",
            borderRadius: 6,
            cursor: trials.length === 0 || running ? "not-allowed" : "pointer",
          }}
        >
          Clear results
        </button>
        <div style={{ marginLeft: "auto", color: "#6b7280", fontSize: 13 }}>
          {trials.length > 0 && `${trials.length} trial${trials.length === 1 ? "" : "s"} recorded`}
        </div>
      </div>

      {trials.length > 0 ? (
        <ResultsTable trials={trials} />
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
          No trials yet. Load a model and click Run to begin.
        </div>
      )}
    </div>
  );
}

function RuntimeCard({
  slot,
  state,
  isActive,
  busy,
  onLoad,
}: {
  slot: Slot;
  state: LoadState;
  isActive: boolean;
  busy: boolean;
  onLoad: () => void;
}) {
  const meta = SLOT_META[slot];
  const buttonLabel = isActive
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
        background: isActive ? "#f0fdf4" : "white",
        border: `2px solid ${isActive ? meta.color : "#e5e7eb"}`,
        borderRadius: 8,
        transition: "border-color 0.2s, background 0.2s",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 17, color: meta.color }}>{meta.title}</h3>
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
        disabled={busy || state.phase === "loading" || isActive}
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
        {buttonLabel}
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

function ResultsTable({ trials }: { trials: Trial[] }) {
  // Group by prompt
  const byPrompt = new Map<string, Trial[]>();
  for (const t of trials) {
    const arr = byPrompt.get(t.prompt) ?? [];
    arr.push(t);
    byPrompt.set(t.prompt, arr);
  }

  return (
    <div>
      {Array.from(byPrompt.entries()).map(([prompt, group]) => (
        <div
          key={prompt}
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            padding: 16,
            marginBottom: 12,
            background: "white",
          }}
        >
          <div
            style={{
              fontWeight: 600,
              fontSize: 14,
              marginBottom: 12,
              color: "#374151",
            }}
          >
            {prompt}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
            }}
          >
            {(["upstream", "finetune"] as Slot[]).map((slot) => {
              const trial = group.find((t) => t.slot === slot);
              const meta = SLOT_META[slot];
              return (
                <div
                  key={slot}
                  style={{
                    background: "#f9fafb",
                    border: `1px solid ${trial ? meta.color + "33" : "#f3f4f6"}`,
                    padding: 12,
                    borderRadius: 6,
                    minHeight: 80,
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: meta.color,
                      marginBottom: 6,
                      letterSpacing: 0.4,
                      textTransform: "uppercase",
                    }}
                  >
                    {meta.title}{" "}
                    {trial && !trial.error && (
                      <span style={{ color: "#9ca3af", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
                        · {(trial.elapsedMs / 1000).toFixed(1)}s · ~{trial.approxTokens} tok · {trial.tokensPerSecond.toFixed(1)} tok/s
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 14, whiteSpace: "pre-wrap", color: "#1f2937", lineHeight: 1.5 }}>
                    {!trial ? (
                      <span style={{ color: "#9ca3af", fontStyle: "italic" }}>(not yet run)</span>
                    ) : trial.error ? (
                      <span style={{ color: "#b91c1c" }}>{trial.error}</span>
                    ) : (
                      trial.output
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
