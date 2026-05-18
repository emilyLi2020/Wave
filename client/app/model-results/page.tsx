import type { Metadata } from "next";
import Link from "next/link";

import {
  CAVEATS,
  DATASET_SURFACES,
  MODEL_RESULT,
  PAIRED_STATS,
  SCORE_CARDS,
} from "@/lib/data/model-results";

export const metadata: Metadata = {
  title: "Model Results - WAVE",
  description:
    "Held-out evaluation of the lora-wave-session fine-tune WAVE actually serves (Maelstrome/lora-wave-session-r32): completion NLL, perplexity, and paired statistics versus base Gemma.",
};

export default function ModelResultsPage() {
  const surfaceTotal = DATASET_SURFACES.reduce((a, s) => a + s.value, 0);

  return (
    <div className="relative overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-x-[-20%] top-0 -z-10 h-[34rem] rounded-full bg-gradient-to-r from-wave-fall/30 via-accent-soft/50 to-wave-rise/30 blur-3xl"
      />

      <section className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
        <nav aria-label="Breadcrumb" className="text-sm text-foreground/60">
          <Link href="/" className="hover:text-accent">
            Home
          </Link>
          <span className="mx-2">/</span>
          <span>Model Results</span>
        </nav>

        <div className="mt-8 grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/90 px-3 py-1 text-xs font-medium text-foreground/70 shadow-sm backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              The fine-tune WAVE actually serves
            </p>
            <h1 className="mt-5 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
              The shipped LoRA beat base Gemma on every held-out prompt.
            </h1>
            <p className="mt-4 max-w-2xl text-lg leading-relaxed text-foreground/70">
              {MODEL_RESULT.claim}
            </p>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-foreground/55">
              Served as{" "}
              <code className="rounded bg-surface-muted px-1.5 py-0.5 text-xs">
                {MODEL_RESULT.servedRepo}
              </code>{" "}
              — {MODEL_RESULT.servedArtifact}, covering{" "}
              {MODEL_RESULT.surfaces}. {MODEL_RESULT.evalMode} Eval generated{" "}
              {MODEL_RESULT.evalDate}.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {MODEL_RESULT.badges.map((badge) => (
                <span
                  key={badge}
                  className="rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-foreground/70"
                >
                  {badge}
                </span>
              ))}
            </div>
          </div>

          <article className="rounded-[2rem] border border-border bg-surface/90 p-6 shadow-lg shadow-accent/10 backdrop-blur">
            <p className="text-xs uppercase tracking-wide text-foreground/50">
              Held-out perplexity
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <ScorePlate label="Base Gemma" value="138.8" muted />
              <ScorePlate label="WAVE LoRA" value="28.7" />
            </div>
            <div className="mt-5 rounded-2xl bg-accent-soft/60 p-4">
              <p className="text-sm font-medium text-accent">
                32.0% lower completion NLL · 428/428 held-out wins
              </p>
              <p className="mt-1 text-sm leading-relaxed text-foreground/70">
                Lower NLL on every one of the 428 frozen prompts — no losses,
                no ties (sign-test p ≈ 2.9e-129).
              </p>
            </div>
          </article>
        </div>
      </section>

      <section className="border-y border-border bg-surface-muted/40">
        <div className="mx-auto max-w-6xl px-6 py-14">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">
                Scorecard
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-foreground/70">
                Completion NLL and perplexity are the closest LLM analogs to a
                training loss — lower is better. Base and LoRA were scored on
                the same frozen held-out prompts.
              </p>
            </div>
            <span className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-foreground">
              Better than base: yes
            </span>
          </div>

          <ul className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {SCORE_CARDS.map((score) => (
              <li
                key={score.label}
                className="rounded-2xl border border-border bg-surface p-5"
              >
                <p className="text-xs uppercase tracking-wide text-foreground/50">
                  {score.label}
                </p>
                <div className="mt-4 space-y-2 text-sm">
                  <MetricRow label="Base" value={score.base} />
                  <MetricRow label="LoRA" value={score.lora} highlight />
                </div>
                <p className="mt-4 inline-flex rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent">
                  Delta {score.delta}
                </p>
                <p className="mt-3 text-xs leading-relaxed text-foreground/60">
                  {score.interpretation}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-6 px-6 py-14 lg:grid-cols-[0.95fr_1.05fr]">
        <article className="rounded-2xl border border-border bg-surface p-6">
          <h2 className="text-2xl font-semibold tracking-tight">
            Statistical strength
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-foreground/70">
            A paired per-prompt comparison: every held-out prompt scored under
            base and under the LoRA, then differenced. The win is not a
            few-example fluke.
          </p>
          <ul className="mt-6 space-y-3">
            {PAIRED_STATS.map((stat) => (
              <li
                key={stat.label}
                className="rounded-2xl border border-border bg-surface-muted/50 p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium">{stat.label}</p>
                  <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent">
                    {stat.value}
                  </span>
                </div>
                <p className="mt-2 text-sm text-foreground/60">
                  {stat.description}
                </p>
              </li>
            ))}
          </ul>
        </article>

        <article className="rounded-2xl border border-border bg-surface p-6">
          <h2 className="text-2xl font-semibold tracking-tight">
            Methodology
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-foreground/70">
            One multitask LoRA over all three runtime surfaces, trained once on
            the selected config (no hyperparameter search).
          </p>

          <div className="mt-6">
            <p className="text-xs uppercase tracking-wide text-foreground/50">
              Held-out test split by surface ({surfaceTotal} prompts)
            </p>
            <ul className="mt-3 space-y-3">
              {DATASET_SURFACES.map((s) => (
                <li key={s.label}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{s.label}</span>
                    <span className="text-foreground/60">{s.value}</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-muted">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{
                        width: `${(s.value / surfaceTotal) * 100}%`,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <dl className="mt-6 grid gap-3 rounded-2xl bg-surface-muted p-4 text-sm leading-relaxed text-foreground/70 sm:grid-cols-2">
            <Fact
              k="Dataset"
              v={`${MODEL_RESULT.dataset.totalExamples.toLocaleString()} examples · ${MODEL_RESULT.dataset.split} split · seed ${MODEL_RESULT.dataset.seed}`}
            />
            <Fact
              k="LoRA"
              v={`rank ${MODEL_RESULT.training.loraRank} · alpha ${MODEL_RESULT.training.loraAlpha} · dropout ${MODEL_RESULT.training.loraDropout}`}
            />
            <Fact
              k="Optimizer"
              v={`${MODEL_RESULT.training.optimizerSteps} steps · lr ${MODEL_RESULT.training.learningRate} · ${MODEL_RESULT.training.batchSize}`}
            />
            <Fact k="Base" v={MODEL_RESULT.baseModel} />
            <Fact k="Trained on" v={MODEL_RESULT.training.gpu} />
            <Fact k="Wall time" v={MODEL_RESULT.training.wallTime} />
            <Fact k="Peak GPU memory" v={MODEL_RESULT.training.peakGpuMemory} />
            <Fact k="Backend" v={MODEL_RESULT.training.method} />
            <Fact
              k={MODEL_RESULT.adapterCheck.label}
              v={MODEL_RESULT.adapterCheck.detail}
              wide
            />
          </dl>
        </article>
      </section>

      <section className="border-t border-border bg-surface-muted/40">
        <div className="mx-auto grid max-w-6xl gap-6 px-6 py-14 lg:grid-cols-[1fr_0.85fr]">
          <article className="rounded-2xl border border-border bg-surface p-6">
            <h2 className="text-2xl font-semibold tracking-tight">
              What this proves
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-foreground/70">
              On the 428-prompt held-out split, the LoRA reduced completion NLL
              from 4.9327 to 3.3555 (−1.58, a 32.0% improvement) and perplexity
              from 138.76 to 28.66. It beat base Gemma on{" "}
              <span className="font-medium text-foreground/85">
                every prompt
              </span>{" "}
              (428/428, sign-test p ≈ 2.9e-129) across check-in,
              phase-narration, and reflection prompts — the exact surfaces the
              app serves this adapter for.
            </p>
            <div className="mt-5 rounded-2xl border border-border bg-surface-muted/60 p-4">
              <p className="text-sm font-medium">Contest-ready claim</p>
              <p className="mt-2 text-sm leading-relaxed text-foreground/70">
                Fine-tuning the model WAVE actually ships (
                {MODEL_RESULT.servedRepo}) made the desired WAVE completion
                dramatically more likely than base Gemma — a 32% NLL reduction
                with a 100% paired win rate on held-out data.
              </p>
            </div>
          </article>

          <aside className="rounded-2xl border border-border bg-surface p-6">
            <h2 className="font-semibold">Caveats</h2>
            <ul className="mt-4 space-y-3 text-sm leading-relaxed text-foreground/70">
              {CAVEATS.map((caveat) => (
                <li key={caveat} className="flex gap-2">
                  <span
                    aria-hidden
                    className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-warn"
                  />
                  <span>{caveat}</span>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </section>
    </div>
  );
}

function ScorePlate({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border border-border p-4 ${
        muted ? "bg-surface-muted/70" : "bg-accent text-accent-foreground"
      }`}
    >
      <p className="text-xs uppercase tracking-wide opacity-70">{label}</p>
      <p className="mt-2 text-4xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}

function MetricRow({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-foreground/55">{label}</span>
      <span className={highlight ? "font-semibold text-accent" : "font-medium"}>
        {value}
      </span>
    </div>
  );
}

function Fact({
  k,
  v,
  wide = false,
}: {
  k: string;
  v: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="font-medium text-foreground/70">{k}</dt>
      <dd className="mt-1">{v}</dd>
    </div>
  );
}
