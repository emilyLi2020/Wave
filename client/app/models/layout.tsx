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

import { MobileNav } from "./mobile-nav";
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
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:h-14 sm:flex-nowrap sm:gap-y-0 sm:px-6 sm:py-0">
          <Link
            href="/models"
            className="flex items-center gap-2 font-semibold tracking-tight"
          >
            <span
              aria-hidden
              className="inline-block h-3 w-6 rounded-full bg-accent"
            />
            <span className="text-sm sm:text-base">WAVE — model tests</span>
          </Link>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground/60 sm:gap-4">
            <span className="rounded-full border border-warn/40 bg-warn-soft px-2 py-0.5 text-warn">
              <span className="sm:hidden">dev</span>
              <span className="hidden sm:inline">Internal · dev only</span>
            </span>
            <Link
              href="/training"
              className="text-foreground/60 hover:text-accent transition-colors"
            >
              ↗ Training
            </Link>
            <Link
              href="/"
              className="text-foreground/60 hover:text-accent transition-colors"
            >
              ↗ App
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 sm:py-8 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-8">
        <MobileNav>
          <SidebarLink href="/models" label="Overview" />

          <div className="pt-6 pb-2 text-xs uppercase tracking-wide text-accent px-2">
            Shipping
          </div>
          <SidebarLink
            href="/models/wllama-test"
            label="Fine-tune GGUF · wllama"
          />
          <SidebarLink href="/models/voice-test" label="Voice loop · STT → LLM → TTS" />

          <div className="pt-6 pb-2 text-xs uppercase tracking-wide text-foreground/50 px-2">
            Benchmarks
          </div>
          <SidebarLink
            href="/models/onnx-test/benchmark"
            label="ONNX base vs wllama fine-tune"
          />

          <div className="pt-6 pb-2 text-xs uppercase tracking-wide text-foreground/50 px-2">
            MediaPipe runtime (LiteRT-LM)
          </div>
          <SidebarLink href="/models/mediapipe-test" label="Chat · base Gemma 4" />
          <SidebarLink
            href="/models/mediapipe-finetune-test"
            label="Chat · WAVE fine-tune"
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

          <div className="pt-6 pb-2 text-xs uppercase tracking-wide text-foreground/40 px-2">
            ONNX runtime · parked
          </div>
          <SidebarLink
            href="/models/onnx-test/compare"
            label="A/B · upstream vs fine-tune (historical)"
          />
        </MobileNav>

        <section className="min-w-0">{children}</section>
      </div>
    </div>
  );
}
