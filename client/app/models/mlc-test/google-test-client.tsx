"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CreateMLCEngine,
  type MLCEngineInterface,
  type AppConfig,
  type InitProgressReport,
} from "@mlc-ai/web-llm";

// Diagnostic: tests Google's official `google/gemma-4-E2B-it` through the same
// MLC pipeline as the fine-tune. If THIS produces coherent text but our
// fine-tune doesn't, the bug is somewhere LoRA/training-specific. If this also
// produces 0 tokens / gibberish, PR #3485 has a runtime-level bug that affects
// even the official upstream weights.

const MODEL_ID = "google-gemma-4-E2B-it-q4f16_1";

const MLC_APP_CONFIG: AppConfig = {
  model_list: [
    {
      model:
        typeof window === "undefined"
          ? "/mlc-google-it-export/"
          : new URL("/mlc-google-it-export/", window.location.origin).toString(),
      model_id: MODEL_ID,
      model_lib:
        typeof window === "undefined"
          ? "/mlc-google-it-export/gemma-4-E2B-it-q4f16_1-webgpu.wasm"
          : new URL(
              "/mlc-google-it-export/gemma-4-E2B-it-q4f16_1-webgpu.wasm",
              window.location.origin,
            ).toString(),
      overrides: { context_window_size: 4096, sliding_window_size: -1 },
    },
  ],
};

const TEST_PROMPTS = [
  "What is the capital of France? Answer in one sentence.",
  "Write a haiku about ocean waves.",
  "Count from 1 to 5.",
];

type Phase = "idle" | "loading" | "ready" | "generating" | "error";

export function GoogleTestClient() {
  const engineRef = useRef<MLCEngineInterface | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progressText, setProgressText] = useState("Press Load to start.");
  const [progressPercent, setProgressPercent] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [streamingOutput, setStreamingOutput] = useState("");
  const [hasWebGPU, setHasWebGPU] = useState(false);

  useEffect(() => {
    setHasWebGPU(typeof navigator !== "undefined" && "gpu" in navigator);
  }, []);

  const load = useCallback(async () => {
    setPhase("loading");
    setErrorMessage(null);
    try {
      const engine = await CreateMLCEngine(MODEL_ID, {
        appConfig: MLC_APP_CONFIG,
        initProgressCallback: (r: InitProgressReport) => {
          setProgressText(r.text);
          setProgressPercent(Math.round(r.progress * 100));
        },
      });
      engineRef.current = engine;
      setPhase("ready");
      setProgressText("Engine ready.");
      setProgressPercent(100);
    } catch (err) {
      setPhase("error");
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const runTrials = useCallback(async () => {
    if (!engineRef.current) return;
    setPhase("generating");
    setStreamingOutput("");
    for (const prompt of TEST_PROMPTS) {
      setStreamingOutput((s) => s + `\n\n=== ${prompt}\n`);
      try {
        const stream = await engineRef.current.chat.completions.create({
          messages: [{ role: "user", content: prompt }],
          temperature: 0,
          max_tokens: 60,
          stream: true,
        });
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content ?? "";
          if (delta) setStreamingOutput((s) => s + delta);
        }
      } catch (err) {
        setStreamingOutput(
          (s) => s + `\n[error] ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    setPhase("ready");
  }, []);

  return (
    <div
      className="mx-auto w-full max-w-3xl p-4 sm:p-6"
      style={{ fontFamily: "system-ui, sans-serif" }}
    >
      <h1 className="text-2xl font-semibold sm:text-3xl">
        google/gemma-4-E2B-it Diagnostic (official upstream, no fine-tune)
      </h1>
      <p style={{ color: "#666" }} className="text-sm sm:text-base break-words">
        Tests <code className="break-all">{MODEL_ID}</code> from{" "}
        <code>/mlc-google-it-export/</code>. If outputs here are coherent but
        our fine-tune isn't, the LoRA training has a subtle issue. If outputs
        here also break, PR #3485 itself has bugs independent of any custom
        weights.{" "}
        {hasWebGPU ? (
          <span style={{ color: "green" }}>✅ WebGPU</span>
        ) : (
          <span style={{ color: "red" }}>❌ No WebGPU</span>
        )}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          onClick={load}
          disabled={phase === "loading" || phase === "ready" || phase === "generating"}
          style={{ padding: "8px 16px", fontSize: 16 }}
        >
          {phase === "loading" ? "Loading..." : "1. Load google/gemma-4-E2B-it"}
        </button>
        <button
          onClick={runTrials}
          disabled={phase !== "ready"}
          style={{ padding: "8px 16px", fontSize: 16 }}
        >
          2. Run diagnostic prompts
        </button>
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={{ background: "#eee", height: 24, borderRadius: 4, overflow: "hidden" }}>
          <div
            style={{
              width: `${progressPercent}%`,
              background: "#4ade80",
              height: "100%",
              transition: "width 0.2s",
            }}
          />
        </div>
        <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>{progressText}</div>
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

      {streamingOutput && (
        <div style={{ marginTop: 16 }}>
          <h3>Output</h3>
          <pre
            style={{
              background: "#fafafa",
              border: "1px solid #ddd",
              padding: 12,
              whiteSpace: "pre-wrap",
              maxHeight: 480,
              overflow: "auto",
            }}
          >
            {streamingOutput}
          </pre>
        </div>
      )}
    </div>
  );
}
