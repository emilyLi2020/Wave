"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CreateMLCEngine,
  type MLCEngineInterface,
  type AppConfig,
  type InitProgressReport,
} from "@mlc-ai/web-llm";

// Compares three Gemma 4 E2B variants through MLC PR #3485 with IDENTICAL
// engine settings (temperature=0, max_tokens=60, same prompts). Loads one
// model at a time to avoid WebGPU memory exhaustion (terminates the prior
// engine before loading the next). Designed to isolate whether observed
// failures are PR bugs, merge artifacts, or port-specific.

interface ModelSpec {
  key: "finetune" | "unsloth" | "google";
  label: string;
  description: string;
  publicPath: string;
  wasmName: string;
}

const MODELS: ModelSpec[] = [
  {
    key: "finetune",
    label: "Our fine-tune (PEFT-merged LoRA)",
    description: "Maelstrome/lora-wave-session-r32 merged onto unsloth/gemma-4-E2B-it",
    publicPath: "/mlc-export/",
    wasmName: "wave-r32-q4f16_1-webgpu.wasm",
  },
  {
    key: "unsloth",
    label: "unsloth/gemma-4-E2B-it",
    description: "Unsloth port of the official IT model",
    publicPath: "/mlc-base-export/",
    wasmName: "gemma-4-E2B-q4f16_1-webgpu.wasm",
  },
  {
    key: "google",
    label: "google/gemma-4-E2B-it",
    description: "Official upstream IT weights from Google",
    publicPath: "/mlc-google-it-export/",
    wasmName: "gemma-4-E2B-it-q4f16_1-webgpu.wasm",
  },
];

const TEST_PROMPTS = [
  "Count from 1 to 5.",
  "I'm feeling anxious. What's one small thing I can do?",
  "What is the capital of France? Answer in one sentence.",
  "Write a haiku about ocean waves.",
];

const ENGINE_SETTINGS = {
  temperature: 0,
  max_tokens: 60,
};

interface TrialResult {
  prompt: string;
  output: string;
  tokens: number;
  ms: number;
}

type Phase = "idle" | "loading" | "ready" | "generating";

function makeAppConfig(spec: ModelSpec): AppConfig {
  const modelId = `${spec.key}-q4f16_1`;
  return {
    model_list: [
      {
        model:
          typeof window === "undefined"
            ? spec.publicPath
            : new URL(spec.publicPath, window.location.origin).toString(),
        model_id: modelId,
        model_lib:
          typeof window === "undefined"
            ? `${spec.publicPath}${spec.wasmName}`
            : new URL(
                `${spec.publicPath}${spec.wasmName}`,
                window.location.origin,
              ).toString(),
        overrides: { context_window_size: 4096, sliding_window_size: -1 },
      },
    ],
  };
}

export function CompareAllClient() {
  const engineRef = useRef<MLCEngineInterface | null>(null);
  const loadedKeyRef = useRef<ModelSpec["key"] | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [activeKey, setActiveKey] = useState<ModelSpec["key"] | null>(null);
  const [progress, setProgress] = useState<{ text: string; pct: number }>({
    text: "",
    pct: 0,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [results, setResults] = useState<
    Record<ModelSpec["key"], TrialResult[]>
  >({ finetune: [], unsloth: [], google: [] });
  const [hasWebGPU, setHasWebGPU] = useState(false);

  useEffect(() => {
    setHasWebGPU(typeof navigator !== "undefined" && "gpu" in navigator);
  }, []);

  const loadModel = useCallback(async (spec: ModelSpec) => {
    setPhase("loading");
    setActiveKey(spec.key);
    setProgress({ text: `Initializing ${spec.label}...`, pct: 0 });
    setErrors((e) => ({ ...e, [spec.key]: "" }));

    // Terminate any prior engine first to free WebGPU memory.
    if (engineRef.current) {
      try {
        await engineRef.current.unload();
      } catch {
        /* ignore */
      }
      engineRef.current = null;
      loadedKeyRef.current = null;
    }

    try {
      const modelId = `${spec.key}-q4f16_1`;
      const engine = await CreateMLCEngine(modelId, {
        appConfig: makeAppConfig(spec),
        initProgressCallback: (r: InitProgressReport) => {
          setProgress({ text: r.text, pct: Math.round(r.progress * 100) });
        },
      });
      engineRef.current = engine;
      loadedKeyRef.current = spec.key;
      setPhase("ready");
      setProgress({ text: `${spec.label} ready.`, pct: 100 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrors((e) => ({ ...e, [spec.key]: msg }));
      setPhase("idle");
    }
  }, []);

  const runTrials = useCallback(async () => {
    if (!engineRef.current || !loadedKeyRef.current) return;
    const key = loadedKeyRef.current;
    const spec = MODELS.find((m) => m.key === key);
    if (!spec) return;
    setPhase("generating");
    setResults((r) => ({ ...r, [key]: [] }));

    for (const prompt of TEST_PROMPTS) {
      // Full engine reload between prompts — resetChat() didn't actually clear
      // state in our testing. Slow (~3-5s for re-init from OPFS cache) but
      // guaranteed clean. Diagnostic mode: confirms whether contamination is
      // KV-cache state leakage or genuine model behavior.
      try {
        if (engineRef.current) await engineRef.current.unload();
      } catch {
        /* ignore */
      }
      try {
        const modelId = `${spec.key}-q4f16_1`;
        const fresh = await CreateMLCEngine(modelId, {
          appConfig: makeAppConfig(spec),
          initProgressCallback: (r: InitProgressReport) => {
            setProgress({
              text: `Reloading for prompt: ${r.text}`,
              pct: Math.round(r.progress * 100),
            });
          },
        });
        engineRef.current = fresh;
      } catch (err) {
        console.error("engine reload failed:", err);
        break;
      }

      const startedAt = performance.now();
      let output = "";
      let tokens = 0;
      try {
        const stream = await engineRef.current.chat.completions.create({
          messages: [{ role: "user", content: prompt }],
          stream: true,
          ...ENGINE_SETTINGS,
        });
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content ?? "";
          if (delta) {
            output += delta;
            tokens += 1;
          }
        }
      } catch (err) {
        output = `[error] ${err instanceof Error ? err.message : String(err)}`;
      }
      const ms = Math.round(performance.now() - startedAt);
      setResults((r) => ({
        ...r,
        [key]: [...(r[key] ?? []), { prompt, output, tokens, ms }],
      }));
    }
    setPhase("ready");
  }, []);

  return (
    <div
      className="mx-auto w-full max-w-6xl p-4 sm:p-6"
      style={{ fontFamily: "system-ui, sans-serif" }}
    >
      <h1 className="text-2xl font-semibold sm:text-3xl">
        MLC PR #3485 — 3-way comparison
      </h1>
      <p
        className="text-sm sm:text-base"
        style={{ color: "#666", marginTop: 0 }}
      >
        All three models use the <strong>same WASM build state</strong> (PR
        #3485 + relax PR #346, no patches), <strong>same prompts</strong>, same
        engine settings (<code>temperature=0, max_tokens=60</code>). Loads one
        engine at a time — terminates the prior before loading the next.{" "}
        {hasWebGPU ? (
          <span style={{ color: "green" }}>✅ WebGPU available</span>
        ) : (
          <span style={{ color: "red" }}>❌ No WebGPU (use Chrome / Edge)</span>
        )}
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MODELS.map((spec) => (
          <div
            key={spec.key}
            style={{
              border:
                activeKey === spec.key
                  ? "2px solid #4ade80"
                  : "1px solid #ddd",
              borderRadius: 8,
              padding: 16,
              background: activeKey === spec.key ? "#f0fff4" : "white",
            }}
          >
            <h3 style={{ marginTop: 0, fontSize: 15 }}>{spec.label}</h3>
            <div style={{ fontSize: 12, color: "#666", minHeight: 32 }}>
              {spec.description}
            </div>
            <div style={{ marginTop: 8 }}>
              <button
                onClick={() => loadModel(spec)}
                disabled={
                  phase === "loading" || phase === "generating"
                }
                style={{
                  padding: "6px 12px",
                  fontSize: 13,
                  width: "100%",
                }}
              >
                {activeKey === spec.key && phase === "loading"
                  ? `Loading... ${progress.pct}%`
                  : activeKey === spec.key && phase === "ready"
                  ? "✓ Loaded"
                  : "Load"}
              </button>
            </div>
            {errors[spec.key] && (
              <pre
                style={{
                  fontSize: 11,
                  background: "#fee",
                  border: "1px solid #f99",
                  padding: 6,
                  marginTop: 8,
                  whiteSpace: "pre-wrap",
                }}
              >
                {errors[spec.key]}
              </pre>
            )}
            {results[spec.key]?.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 12 }}>
                <div style={{ color: "#666" }}>
                  Total tokens:{" "}
                  <strong>
                    {results[spec.key].reduce((s, t) => s + t.tokens, 0)}
                  </strong>{" "}
                  across {results[spec.key].length} prompts
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ marginTop: 24 }}>
        <button
          onClick={runTrials}
          disabled={phase !== "ready"}
          style={{
            padding: "10px 20px",
            fontSize: 15,
            background: phase === "ready" ? "#4ade80" : "#ddd",
            border: "none",
            borderRadius: 6,
            color: "white",
            cursor: phase === "ready" ? "pointer" : "not-allowed",
          }}
        >
          {phase === "generating"
            ? `Generating against ${
                MODELS.find((m) => m.key === activeKey)?.label
              }...`
            : `Run ${TEST_PROMPTS.length} prompts against currently-loaded model`}
        </button>
        <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>
          {progress.text}
        </div>
      </div>

      {/* Results table */}
      {TEST_PROMPTS.some((p) =>
        MODELS.some((m) => results[m.key]?.some((r) => r.prompt === p)),
      ) && (
        <div style={{ marginTop: 32 }} className="-mx-4 sm:mx-0 overflow-x-auto">
          <h2 style={{ fontSize: 18 }} className="mx-4 sm:mx-0">Results</h2>
          <table
            style={{
              borderCollapse: "collapse",
              fontSize: 13,
            }}
            className="mt-2 w-full min-w-[720px]"
          >
            <thead>
              <tr>
                <th
                  style={{
                    textAlign: "left",
                    padding: 8,
                    borderBottom: "2px solid #333",
                    width: "20%",
                  }}
                >
                  Prompt
                </th>
                {MODELS.map((m) => (
                  <th
                    key={m.key}
                    style={{
                      textAlign: "left",
                      padding: 8,
                      borderBottom: "2px solid #333",
                      width: "27%",
                    }}
                  >
                    {m.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TEST_PROMPTS.map((prompt) => (
                <tr key={prompt}>
                  <td
                    style={{
                      padding: 8,
                      verticalAlign: "top",
                      borderBottom: "1px solid #eee",
                      fontWeight: 500,
                    }}
                  >
                    {prompt}
                  </td>
                  {MODELS.map((m) => {
                    const r = results[m.key]?.find((x) => x.prompt === prompt);
                    return (
                      <td
                        key={m.key}
                        style={{
                          padding: 8,
                          verticalAlign: "top",
                          borderBottom: "1px solid #eee",
                          background:
                            r && r.tokens === 0 ? "#fff5f5" : undefined,
                        }}
                      >
                        {r ? (
                          <>
                            <div
                              style={{
                                whiteSpace: "pre-wrap",
                                color: r.tokens === 0 ? "#999" : "inherit",
                                fontStyle:
                                  r.tokens === 0 ? "italic" : "normal",
                              }}
                            >
                              {r.tokens === 0
                                ? "(0 tokens emitted)"
                                : r.output}
                            </div>
                            <div
                              style={{
                                fontSize: 11,
                                color: "#999",
                                marginTop: 4,
                              }}
                            >
                              {r.tokens} tok · {r.ms} ms
                            </div>
                          </>
                        ) : (
                          <span style={{ color: "#bbb" }}>—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
