/**
 * Layout for the dev-only /models surface. Internal pages for testing
 * browser-side model runtimes (MLC PR #3485, ONNX via @huggingface/transformers,
 * voice loop). Separate from /training, which is for training-data collection.
 *
 * Gated by assertModelsEnabled() — falls back to the training flag so existing
 * dev setups don't break after the rename.
 */

import Link from "next/link";

import { assertModelsEnabled } from "@/lib/models/guard";

import { SidebarLink } from "./sidebar-link";

export const dynamic = "force-dynamic";

export default function ModelsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  assertModelsEnabled();

  return (
    <div className="min-h-full bg-background">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto max-w-7xl px-6 h-14 flex items-center justify-between">
          <Link
            href="/models"
            className="flex items-center gap-2 font-semibold tracking-tight"
          >
            <span
              aria-hidden
              className="inline-block h-3 w-6 rounded-full bg-accent"
            />
            <span>WAVE — model tests</span>
          </Link>
          <div className="flex items-center gap-4 text-xs text-foreground/60">
            <span className="rounded-full border border-warn/40 bg-warn-soft px-2 py-0.5 text-warn">
              Internal · dev only
            </span>
            <Link
              href="/training"
              className="text-foreground/60 hover:text-accent transition-colors"
            >
              ↗ Training data
            </Link>
            <Link
              href="/"
              className="text-foreground/60 hover:text-accent transition-colors"
            >
              ↗ Patient app
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8 grid gap-8 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="space-y-1">
          <SidebarLink href="/models" label="Overview" />

          <div className="pt-6 pb-2 text-xs uppercase tracking-wide text-foreground/50 px-2">
            ONNX runtime
          </div>
          <SidebarLink
            href="/models/onnx-test/benchmark"
            label="Benchmark · TTFT / tok/s"
          />
          <SidebarLink
            href="/models/onnx-test/compare"
            label="A/B · upstream vs fine-tune"
          />

          <div className="pt-6 pb-2 text-xs uppercase tracking-wide text-foreground/50 px-2">
            MLC runtime (PR #3485)
          </div>
          <SidebarLink href="/models/mlc-test" label="Chat · our fine-tune" />
          <SidebarLink href="/models/mlc-test/base" label="Chat · unsloth base" />
          <SidebarLink href="/models/mlc-test/google" label="Chat · google IT" />
          <SidebarLink
            href="/models/mlc-test/compare"
            label="A/B · MLC fine-tune vs ONNX"
          />
          <SidebarLink
            href="/models/mlc-test/compare-all"
            label="3-way · finetune / unsloth / google"
          />

          <div className="pt-6 pb-2 text-xs uppercase tracking-wide text-foreground/50 px-2">
            Voice loop
          </div>
          <SidebarLink href="/models/voice-test" label="STT → LLM → TTS" />
        </aside>

        <section>{children}</section>
      </div>
    </div>
  );
}
