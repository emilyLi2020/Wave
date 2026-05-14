"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CreateMLCEngine,
  type MLCEngineInterface,
  type AppConfig,
  type InitProgressReport,
} from "@mlc-ai/web-llm";

const MODEL_ID = "wave-r32-q4f16_1";

const MLC_APP_CONFIG: AppConfig = {
  model_list: [
    {
      model: typeof window === "undefined"
        ? "/mlc-export/"
        : new URL("/mlc-export/", window.location.origin).toString(),
      model_id: MODEL_ID,
      model_lib:
        typeof window === "undefined"
          ? "/mlc-export/wave-r32-q4f16_1-webgpu.wasm"
          : new URL(
              "/mlc-export/wave-r32-q4f16_1-webgpu.wasm",
              window.location.origin,
            ).toString(),
      overrides: {
        context_window_size: 4096,
        sliding_window_size: -1,
      },
    },
  ],
};

const TEST_PROMPTS = [
  "I'm feeling anxious right now. What's one small thing I can do in the next minute?",
  "Walk me through a 30-second breathing exercise. Keep it concrete.",
  "What is the capital of France? Answer in one sentence.",
  "Write a haiku about ocean waves.",
];

type Phase = "idle" | "loading" | "ready" | "generating" | "error";

interface TrialResult {
  prompt: string;
  output: string;
  prefillMs: number;
  decodeMs: number;
  tokensGenerated: number;
  tokensPerSecond: number;
}

export function MlcTestClient() {
  const engineRef = useRef<MLCEngineInterface | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progressText, setProgressText] = useState<string>("Press Load to start.");
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [streamingOutput, setStreamingOutput] = useState<string>("");
  const [trials, setTrials] = useState<TrialResult[]>([]);
  const [hasWebGPU, setHasWebGPU] = useState<boolean>(false);

  useEffect(() => {
    setHasWebGPU(typeof navigator !== "undefined" && "gpu" in navigator);
  }, []);

  const load = useCallback(async () => {
    setPhase("loading");
    setErrorMessage(null);
    setProgressText("Starting MLC engine init...");
    setProgressPercent(0);
    try {
      const engine = await CreateMLCEngine(MODEL_ID, {
        appConfig: MLC_APP_CONFIG,
        initProgressCallback: (report: InitProgressReport) => {
          setProgressText(report.text);
          setProgressPercent(Math.round(report.progress * 100));
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
    setTrials([]);
    setStreamingOutput("");
    const results: TrialResult[] = [];

    for (const prompt of TEST_PROMPTS) {
      setStreamingOutput(`\n=== ${prompt}\n`);
      const startedAt = performance.now();
      let firstTokenAt: number | null = null;
      let tokenCount = 0;
      let output = "";

      try {
        const stream = await engineRef.current.chat.completions.create({
          messages: [{ role: "user", content: prompt }],
          temperature: 0,
          max_tokens: 80,
          stream: true,
        });
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content ?? "";
          if (delta.length === 0) continue;
          if (firstTokenAt === null) firstTokenAt = performance.now();
          tokenCount += 1;
          output += delta;
          setStreamingOutput((prev) => prev + delta);
        }
      } catch (err) {
        results.push({
          prompt,
          output: `[error] ${err instanceof Error ? err.message : String(err)}`,
          prefillMs: 0,
          decodeMs: 0,
          tokensGenerated: 0,
          tokensPerSecond: 0,
        });
        continue;
      }

      const endedAt = performance.now();
      const prefillMs = firstTokenAt !== null ? firstTokenAt - startedAt : 0;
      const decodeMs = firstTokenAt !== null ? endedAt - firstTokenAt : endedAt - startedAt;
      const tokensPerSecond = decodeMs > 0 ? (tokenCount / decodeMs) * 1000 : 0;
      results.push({
        prompt,
        output,
        prefillMs,
        decodeMs,
        tokensGenerated: tokenCount,
        tokensPerSecond,
      });
    }

    setTrials(results);
    setPhase("ready");
  }, []);

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif", maxWidth: 900 }}>
      <h1>MLC WebGPU Test — Fine-tuned Gemma 4 E2B</h1>
      <p style={{ color: "#666" }}>
        Loads <code>{MODEL_ID}</code> from <code>/mlc-export/</code> via
        @mlc-ai/web-llm.{" "}
        {hasWebGPU ? (
          <span style={{ color: "green" }}>✅ WebGPU available</span>
        ) : (
          <span style={{ color: "red" }}>❌ WebGPU not available — use Chrome/Safari 18+</span>
        )}
      </p>

      <div style={{ marginTop: 16 }}>
        <button
          onClick={load}
          disabled={phase === "loading" || phase === "generating" || phase === "ready"}
          style={{ padding: "8px 16px", fontSize: 16 }}
        >
          {phase === "loading" ? "Loading..." : "1. Load engine"}
        </button>
        <button
          onClick={runTrials}
          disabled={phase !== "ready"}
          style={{ padding: "8px 16px", fontSize: 16, marginLeft: 8 }}
        >
          2. Run {TEST_PROMPTS.length} test prompts
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
          <h3>Live output</h3>
          <pre
            style={{
              background: "#fafafa",
              border: "1px solid #ddd",
              padding: 12,
              whiteSpace: "pre-wrap",
              maxHeight: 320,
              overflow: "auto",
            }}
          >
            {streamingOutput}
          </pre>
        </div>
      )}

      {trials.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h3>Results summary</h3>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f0f0f0" }}>
                <th style={{ textAlign: "left", padding: 6, border: "1px solid #ddd" }}>Prompt</th>
                <th style={{ textAlign: "right", padding: 6, border: "1px solid #ddd" }}>TTFT</th>
                <th style={{ textAlign: "right", padding: 6, border: "1px solid #ddd" }}>Tokens</th>
                <th style={{ textAlign: "right", padding: 6, border: "1px solid #ddd" }}>tok/s</th>
              </tr>
            </thead>
            <tbody>
              {trials.map((t, i) => (
                <tr key={i}>
                  <td style={{ padding: 6, border: "1px solid #ddd" }}>
                    <div style={{ fontWeight: 500, marginBottom: 4 }}>{t.prompt}</div>
                    <div style={{ color: "#666" }}>{t.output.slice(0, 200)}</div>
                  </td>
                  <td style={{ textAlign: "right", padding: 6, border: "1px solid #ddd" }}>
                    {t.prefillMs.toFixed(0)}ms
                  </td>
                  <td style={{ textAlign: "right", padding: 6, border: "1px solid #ddd" }}>
                    {t.tokensGenerated}
                  </td>
                  <td style={{ textAlign: "right", padding: 6, border: "1px solid #ddd" }}>
                    {t.tokensPerSecond.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
