"use client";

/**
 * Hidden prompt visualizer (`/prompts`).
 *
 * Not linked from anywhere in the patient UI and excluded from the site
 * chrome (see app/site-chrome.tsx `shouldHide`). Renders every prompt
 * fed to the local model, grouped by feature, straight from
 * lib/prompts/registry.ts. Spans filled at runtime show as placeholders.
 */

import { useMemo, useState } from "react";

import {
  PROMPT_REGISTRY,
  type PromptFeature,
  type PromptMessage,
} from "@/lib/prompts/registry";

const ROLE_STYLES: Record<PromptMessage["role"], string> = {
  system: "bg-accent-soft text-accent border-accent/40",
  user: "bg-surface-muted text-foreground/80 border-border",
  assistant: "bg-surface text-foreground/70 border-border",
};

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        } catch {
          /* clipboard blocked — no-op */
        }
      }}
      className="rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-foreground/70 hover:text-accent hover:border-accent/50 transition"
    >
      {copied ? "Copied" : label}
    </button>
  );
}

function MessageBlock({ message }: { message: PromptMessage }) {
  const charCount = message.content.length;
  const approxTokens = Math.ceil(charCount / 4);
  return (
    <div
      className={`rounded-xl border ${
        message.placeholder
          ? "border-dashed border-warn/50 bg-warn-soft/40"
          : "border-border bg-surface"
      }`}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-2">
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${ROLE_STYLES[message.role]}`}
          >
            {message.role}
          </span>
          {message.placeholder ? (
            <span className="text-[11px] uppercase tracking-wide text-warn">
              runtime placeholder
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-foreground/40">
            {charCount.toLocaleString()} chars · ~{approxTokens.toLocaleString()}{" "}
            tok
          </span>
          <CopyButton text={message.content} label="Copy" />
        </div>
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-[12.5px] leading-relaxed text-foreground/85">
        {message.content}
      </pre>
    </div>
  );
}

function FeatureSection({ feature }: { feature: PromptFeature }) {
  return (
    <section id={feature.id} className="scroll-mt-24">
      <div className="rounded-2xl border border-border bg-surface-muted p-6">
        <h2 className="text-2xl font-semibold tracking-tight">
          {feature.title}
        </h2>
        <p className="mt-2 text-sm text-foreground/70 leading-relaxed">
          {feature.description}
        </p>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-foreground/50">
              Response format
            </dt>
            <dd className="mt-0.5 font-mono text-[12.5px] text-foreground/80">
              {feature.responseFormat}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-foreground/50">
              Source
            </dt>
            <dd className="mt-0.5 font-mono text-[12.5px] text-foreground/80">
              {feature.source}
            </dd>
          </div>
        </dl>
        <div className="mt-4">
          <dt className="text-xs uppercase tracking-wide text-foreground/50">
            Filled at runtime
          </dt>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[12.5px] text-foreground/70">
            {feature.runtimeFilled.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-6 space-y-8">
        {feature.variants.map((variant) => {
          const fullText = variant.messages
            .map((m) => `### ${m.role.toUpperCase()}\n${m.content}`)
            .join("\n\n");
          return (
            <article
              key={variant.id}
              id={`${feature.id}--${variant.id}`}
              className="scroll-mt-24"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold">{variant.title}</h3>
                  <p className="mt-1 text-sm text-foreground/60">
                    {variant.scenario}
                  </p>
                </div>
                <CopyButton text={fullText} label="Copy variant" />
              </div>
              <div className="mt-3 space-y-3">
                {variant.messages.map((message, i) => (
                  <MessageBlock key={i} message={message} />
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export default function PromptsPage() {
  const [query, setQuery] = useState("");

  const filtered = useMemo<PromptFeature[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return PROMPT_REGISTRY;
    return PROMPT_REGISTRY.map((feature) => {
      const featureMatches =
        feature.title.toLowerCase().includes(q) ||
        feature.description.toLowerCase().includes(q);
      const variants = featureMatches
        ? feature.variants
        : feature.variants.filter(
            (v) =>
              v.title.toLowerCase().includes(q) ||
              v.scenario.toLowerCase().includes(q) ||
              v.messages.some((m) => m.content.toLowerCase().includes(q)),
          );
      return { ...feature, variants };
    }).filter((f) => f.variants.length > 0);
  }, [query]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              WAVE — Prompt visualizer
            </h1>
            <p className="text-xs text-foreground/50">
              Every prompt fed to the local model, grouped by feature. Hidden /
              dev-only.
            </p>
          </div>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter prompts…"
            className="w-56 rounded-full border border-border bg-surface px-4 py-1.5 text-sm outline-none focus:border-accent/60"
          />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        <nav
          aria-label="Features"
          className="mb-10 flex flex-wrap gap-2 text-sm"
        >
          {PROMPT_REGISTRY.map((feature) => (
            <a
              key={feature.id}
              href={`#${feature.id}`}
              className="rounded-full border border-border bg-surface px-3 py-1 text-foreground/70 hover:text-accent hover:border-accent/50 transition"
            >
              {feature.title}
              <span className="ml-1.5 text-foreground/40">
                {feature.variants.length}
              </span>
            </a>
          ))}
        </nav>

        {filtered.length === 0 ? (
          <p className="text-sm text-foreground/60">
            No prompts match “{query}”.
          </p>
        ) : (
          <div className="space-y-16">
            {filtered.map((feature) => (
              <FeatureSection key={feature.id} feature={feature} />
            ))}
          </div>
        )}

        <footer className="mt-20 border-t border-border pt-6 text-xs text-foreground/40">
          Reconstructed from lib/prompts/registry.ts — the same builders the
          wllama runtime calls. Example scenarios use representative values;
          dashed blocks are filled from live data at runtime.
        </footer>
      </main>
    </div>
  );
}
