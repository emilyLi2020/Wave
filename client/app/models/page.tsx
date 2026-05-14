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

const ONNX_PAGES: TestPage[] = [
  {
    href: "/models/onnx-test/benchmark",
    title: "ONNX benchmark · TTFT / tok/s",
    blurb:
      "Per-token timing on the local ONNX fine-tune (or upstream) via @huggingface/transformers + WebGPU. Reports TTFT, decode rate, total latency.",
    details:
      "TextStreamer.token_callback_function captures first-token wall time and per-token timestamps. Decode rate explicitly excludes the prefill window. Configurable max_new_tokens (32/64/128/256), runs (1/3/5), optional warmup.",
    badge: "primary",
  },
  {
    href: "/models/onnx-test/compare",
    title: "ONNX A/B · upstream vs our fine-tune",
    blurb:
      "Prompt-by-prompt comparison of onnx-community/gemma-4-E2B-it-ONNX vs the Gather-quantized fine-tune. One model active at a time.",
    details:
      "Both run on WebGPU at q4f16 with int4 Gather/PLE. Loads one pipeline at a time and accumulates trials across switches.",
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
    title: "Voice loop · STT → LLM → TTS",
    blurb:
      "End-to-end voice round-trip: Whisper STT, fine-tune LLM, Kokoro TTS. Used to validate latency and audio quality of the full pipeline.",
    details:
      "VAD-driven turn detection via @ricky0123/vad-web. State machine in voice-turn-machine.ts.",
  },
];

export default function ModelsOverviewPage() {
  assertModelsEnabled();

  return (
    <div className="space-y-10">
      <div>
        <p className="text-xs uppercase tracking-wide text-foreground/50">
          Browser-runtime test pages
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Model tests.
        </h1>
        <p className="mt-3 max-w-2xl text-foreground/70 leading-relaxed">
          Dev-only pages that load model runtimes in the browser to validate
          correctness, compare backends, and measure latency. Separate from{" "}
          <Link href="/training" className="text-accent hover:underline">
            /training
          </Link>{" "}
          (training data collection). All pages here render their own chrome and
          require <code>NEXT_PUBLIC_MODELS_ENABLED=true</code> (or the older
          training flag).
        </p>
      </div>

      <Section title="ONNX runtime" pages={ONNX_PAGES} />
      <Section title="MLC runtime (PR #3485)" pages={MLC_PAGES} />
      <Section title="Voice loop" pages={VOICE_PAGES} />

      <div className="rounded-2xl border border-border bg-surface-muted/40 p-6 text-sm text-foreground/70">
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
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <ul className="mt-3 grid gap-3 md:grid-cols-2">
        {pages.map((p) => (
          <li
            key={p.href}
            className={`rounded-2xl border bg-surface p-5 transition hover:border-accent/60 ${
              p.badge === "primary"
                ? "border-accent/40 bg-accent-soft/20"
                : "border-border"
            }`}
          >
            <Link href={p.href} className="block">
              <div className="flex items-baseline justify-between gap-2">
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
              <p className="mt-3 text-xs font-mono text-foreground/50">
                {p.href}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
