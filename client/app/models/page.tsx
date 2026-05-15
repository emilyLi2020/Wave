import Link from "next/link";

import { assertModelsEnabled } from "@/lib/models/guard";

export const dynamic = "force-dynamic";

interface TestPage {
  href: string;
  title: string;
  blurb: string;
  details: string;
  badge?: string;
}

const WLLAMA_PAGES: TestPage[] = [
  {
    href: "/models/wllama-test",
    title: "wllama · fine-tune GGUF (shipping path)",
    blurb:
      "Loads Maelstrome/lora-wave-session-r32/gguf/gemma-4-e2b-it-peft.Q4_K_M (5-shard split, ~3.2 GB) via @wllama/wllama and runs the production WAVE prompts on WebGPU. Bypasses onnxruntime-web's fp16 overflow bug entirely.",
    details:
      "WebGPU enabled by default (V3.1+), WASM SIMD fallback. Smoke / Phase / Check-in / Reflection buttons. Defaults to HF Hub; append ?local=1 to fetch from a local-hf mirror at localhost:8765/gguf/ for fast iteration. See docs/wllama.md.",
    badge: "primary",
  },
  {
    href: "/models/wllama-schema-probe",
    title: "wllama · structured-output + tool-calling probe",
    blurb:
      "Empirical check for whether response_format json_schema (strict) and tools/tool_choice actually work with our Gemma fine-tune GGUF in wllama 3.1.1. Four buttons: chunk schema, reflection schema, batch tool call, streamed tool call.",
    details:
      "Use this before refactoring the production chunk/reflection/check-in generators. Each probe surfaces the raw model output + parsed result + pass/fail verdict.",
  },
];

const ONNX_PAGES: TestPage[] = [
  {
    href: "/models/onnx-test/benchmark",
    title: "Runtime benchmark · ONNX base vs wllama fine-tune",
    blurb:
      "Same three scenarios (phase / multi-turn check-in / reflection) on both browser runtimes. Reports TTFT, decode tok/s, and total latency per turn; runs accumulate in one comparison table.",
    details:
      "ONNX upstream base via @huggingface/transformers + onnxruntime-web (TextStreamer per-token timestamps). wllama WAVE fine-tune via @wllama/wllama + llama.cpp WebGPU (StreamParams.onData per-token timestamps). Same q4 quantization class, greedy decoding, identical prompts. Single-active runtime — loading one disposes the other.",
  },
  {
    href: "/models/onnx-test/compare",
    title: "ONNX A/B · upstream vs our fine-tune",
    blurb:
      "Side-by-side comparison on the real WAVE prompts: phase narration (chunk 2), a 4-turn check-in, and end-of-session reflection. Load one model at a time; outputs accumulate across switches.",
    details:
      "Historical: the fine-tune column emits len=0 here on WebGPU (onnxruntime-web fp16 bug). The wllama path above supersedes this for the fine-tune; kept for upstream-base benchmarking.",
  },
];

const MLC_PAGES: TestPage[] = [
  {
    href: "/models/mlc-test",
    title: "MLC chat · our fine-tune",
    blurb:
      "Browser chat against Maelstrome/lora-wave-session-r32 merged onto unsloth/gemma-4-E2B-it via @mlc-ai/web-llm and the PR #3485 conv_template patch.",
    details:
      "Engine reloads per turn to work around the web-llm state-leak bug. See memory: wave-mlc-pr3485-broken.",
  },
  {
    href: "/models/mlc-test/base",
    title: "MLC chat · unsloth base",
    blurb:
      "Same MLC pipeline against unsloth/gemma-4-E2B-it (no fine-tune). Diagnostic for isolating PR #3485 vs merge-artifact bugs.",
    details:
      "If this is coherent, PR #3485 is fine and the fine-tune merge is the problem. If gibberish, PR #3485 has a numerical bug.",
  },
  {
    href: "/models/mlc-test/google",
    title: "MLC chat · google official IT",
    blurb:
      "Same MLC pipeline against google/gemma-4-E2B-it (upstream weights). Cross-check vs unsloth port.",
    details:
      "Distinguishes \"unsloth port bug\" from \"PR #3485 bug\". Both base models should produce equally coherent text on PR #3485.",
  },
  {
    href: "/models/mlc-test/compare",
    title: "MLC fine-tune vs ONNX upstream (A/B)",
    blurb:
      "Two runtimes, one screen. Loads MLC fine-tune and ONNX upstream side-by-side on the same prompts.",
    details:
      "Mac/desktop only — ~6 GB combined VRAM. Designed to isolate runtime differences from model differences.",
  },
  {
    href: "/models/mlc-test/compare-all",
    title: "MLC 3-way · finetune / unsloth / google",
    blurb:
      "All three Gemma 4 E2B variants through identical MLC engine settings (temp=0, same prompts).",
    details:
      "Loads one model at a time to avoid WebGPU exhaustion; terminates engine before loading the next. Isolates PR vs merge vs port-specific failures.",
  },
];

const VOICE_PAGES: TestPage[] = [
  {
    href: "/models/voice-test",
    title: "Voice loop · Whisper → Gemma (wllama) → Kokoro",
    blurb:
      "End-to-end voice round-trip: Whisper STT, WAVE fine-tune Gemma via wllama (GGUF), Kokoro TTS. Used to validate latency and audio quality of the full pipeline.",
    details:
      "VAD-driven turn detection via @ricky0123/vad-web. State machine in voice-turn-machine.ts.",
  },
];

export default function ModelsOverviewPage() {
  assertModelsEnabled();

  return (
    <div className="space-y-8 sm:space-y-10">
      <div>
        <p className="text-xs uppercase tracking-wide text-foreground/50">
          Browser-runtime test pages
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          Model tests.
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-foreground/70 leading-relaxed sm:text-base">
          Dev-only pages that load model runtimes in the browser to validate
          correctness, compare backends, and measure latency. Separate from{" "}
          <Link href="/training" className="text-accent hover:underline">
            /training
          </Link>{" "}
          (training data collection). All pages here render their own chrome and
          require <code className="break-all">NEXT_PUBLIC_MODELS_ENABLED=true</code>{" "}
          (or the older training flag).
        </p>
      </div>

      <Section title="wllama runtime (GGUF)" pages={WLLAMA_PAGES} />
      <Section title="ONNX runtime" pages={ONNX_PAGES} />
      <Section title="MLC runtime (PR #3485)" pages={MLC_PAGES} />
      <Section title="Voice loop" pages={VOICE_PAGES} />

      <div className="rounded-2xl border border-border bg-surface-muted/40 p-4 text-sm text-foreground/70 sm:p-6">
        <p>
          <strong>Heads up.</strong> These pages download large model assets
          (3–6 GB) and pin WebGPU memory. Reload between long sessions if your
          GPU is under pressure. Mac/desktop only for the A/B and 3-way compares.
        </p>
      </div>
    </div>
  );
}

function Section({ title, pages }: { title: string; pages: TestPage[] }) {
  return (
    <div>
      <h2 className="text-lg font-semibold tracking-tight sm:text-xl">{title}</h2>
      <ul className="mt-3 grid gap-3 md:grid-cols-2">
        {pages.map((p) => (
          <li
            key={p.href}
            className={`rounded-2xl border bg-surface p-4 transition hover:border-accent/60 sm:p-5 ${
              p.badge === "primary"
                ? "border-accent/40 bg-accent-soft/20"
                : "border-border"
            }`}
          >
            <Link href={p.href} className="block">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-semibold hover:text-accent">{p.title}</h3>
                {p.badge === "primary" ? (
                  <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-white">
                    primary
                  </span>
                ) : null}
              </div>
              <p className="mt-2 text-sm text-foreground/75 leading-relaxed">
                {p.blurb}
              </p>
              <p className="mt-2 text-xs text-foreground/55 leading-relaxed">
                {p.details}
              </p>
              <p className="mt-3 break-all text-xs font-mono text-foreground/50">
                {p.href}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
