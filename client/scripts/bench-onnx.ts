// Two-way Gemma 4 E2B comparison: upstream onnx-community vs our fine-tuned export.
//
// Runs with the client's already-installed `@huggingface/transformers` v4 in Node
// (uses onnxruntime-node under the hood — real ONNX Runtime, native C++).
// Numbers are CPU-on-Mac, not iPhone WebGPU — but the relative gap between
// upstream and fine-tuned is what we're measuring.
//
// Usage (from repo root):
//   pnpm --filter ./client exec tsx ../models/runs/bench/bench.ts

import { pipeline, env, type TextGenerationPipeline } from "@huggingface/transformers";
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

env.allowRemoteModels = true;
env.allowLocalModels = true;
// __dirname = client/scripts/, so this resolves to models/runs/
env.localModelPath = resolve(__dirname, "../../models/runs/");

interface ModelSpec {
  label: string;
  modelId: string; // HF repo id OR local dir name (relative to env.localModelPath)
  dtype: "q4f16" | "q4" | "fp16" | "fp32";
}

const MODELS: ModelSpec[] = [
  {
    label: "upstream-base",
    modelId: "onnx-community/gemma-4-E2B-it-ONNX",
    dtype: "q4f16",
  },
  {
    label: "ours-finetuned",
    modelId: "onnx-export-v2", // local: models/runs/onnx-export-v2 (PEFT re-merge)
    dtype: "q4f16",
  },
];

const PROMPTS = [
  {
    label: "anxiety_short",
    text: "I'm feeling anxious right now. What's one small thing I can do in the next minute?",
  },
  {
    label: "breathing_guide",
    text: "Walk me through a 30-second breathing exercise. Keep it concrete.",
  },
  {
    label: "factual",
    text: "What is the capital of France? Answer in one sentence.",
  },
  {
    label: "haiku",
    text: "Write a haiku about ocean waves.",
  },
];

const MAX_NEW_TOKENS = 80;

interface Trial {
  prompt: string;
  output: string;
  prefillMs: number;
  decodeMs: number;
  tokensGenerated: number;
  tokensPerSecond: number;
}

async function benchModel(spec: ModelSpec): Promise<{ loadMs: number; trials: Trial[]; loadError?: string }> {
  console.log(`\n=== ${spec.label}: ${spec.modelId} (dtype=${spec.dtype}) ===`);
  let pipe: TextGenerationPipeline;
  const loadStart = performance.now();
  try {
    pipe = (await pipeline("text-generation", spec.modelId, {
      dtype: spec.dtype,
      progress_callback: (info: unknown) => {
        const i = info as { status?: string; file?: string; progress?: number };
        if (i.status === "progress" && i.file && typeof i.progress === "number") {
          if (Math.floor(i.progress) % 25 === 0) {
            process.stdout.write(`  load ${i.file} ${i.progress.toFixed(0)}%\n`);
          }
        }
      },
    })) as TextGenerationPipeline;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  LOAD FAILED: ${msg}`);
    return { loadMs: performance.now() - loadStart, trials: [], loadError: msg };
  }
  const loadMs = performance.now() - loadStart;
  console.log(`  loaded in ${(loadMs / 1000).toFixed(1)}s`);

  const trials: Trial[] = [];
  for (const p of PROMPTS) {
    console.log(`  prompt: ${p.label}`);
    const startTotal = performance.now();
    let firstTokenAt: number | null = null;
    let tokenCount = 0;
    const result = (await pipe([{ role: "user", content: p.text }], {
      max_new_tokens: MAX_NEW_TOKENS,
      do_sample: false,
      return_full_text: false,
    })) as unknown;
    const elapsed = performance.now() - startTotal;
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
    // Rough token estimate: 1 token ≈ 4 chars for English (Gemma tokenizer is close to this).
    tokenCount = Math.max(1, Math.round(output.length / 4));
    const tokensPerSecond = (tokenCount / elapsed) * 1000;
    trials.push({
      prompt: p.label,
      output: output.slice(0, 500),
      prefillMs: 0, // can't easily separate without streaming
      decodeMs: elapsed,
      tokensGenerated: tokenCount,
      tokensPerSecond,
    });
    console.log(`    ${tokensPerSecond.toFixed(2)} tok/s | ${tokenCount} tokens | ${(elapsed / 1000).toFixed(1)}s`);
    console.log(`    output: ${output.slice(0, 120).replace(/\n/g, " ")}${output.length > 120 ? "..." : ""}`);
  }
  return { loadMs, trials };
}

async function main(): Promise<void> {
  const results: Record<
    string,
    { loadMs: number; trials: Trial[]; loadError?: string }
  > = {};
  for (const spec of MODELS) {
    results[spec.label] = await benchModel(spec);
  }
  const summaryPath = resolve(__dirname, "bench-results.json");
  writeFileSync(summaryPath, JSON.stringify(results, null, 2));
  console.log(`\nWrote ${summaryPath}`);

  // Aggregate table.
  console.log("\n=== Summary ===");
  for (const [label, data] of Object.entries(results)) {
    if (data.loadError) {
      console.log(`${label}: LOAD FAILED — ${data.loadError}`);
      continue;
    }
    const avgTps =
      data.trials.reduce((acc, t) => acc + t.tokensPerSecond, 0) / data.trials.length;
    console.log(
      `${label}: load=${(data.loadMs / 1000).toFixed(1)}s | avg ${avgTps.toFixed(2)} tok/s across ${data.trials.length} prompts`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
