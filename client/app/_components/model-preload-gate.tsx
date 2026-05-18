"use client";

import { useEffect, useMemo, useState } from "react";

import {
  describeWaveWllamaSource,
  getWaveWllamaLoadState,
  preloadWaveWllama,
  subscribeWaveWllamaLoad,
  WAVE_GGUF_FILE,
  WAVE_GGUF_REPO,
  type WaveWllamaLoadState,
} from "@/lib/wllama";

interface Props {
  children: React.ReactNode;
}

export function ModelPreloadGate({ children }: Props) {
  const [state, setState] = useState<WaveWllamaLoadState>(
    getWaveWllamaLoadState,
  );

  useEffect(() => {
    return subscribeWaveWllamaLoad(setState);
  }, []);

  function handleStart() {
    void preloadWaveWllama().catch((err) => {
      if (typeof console === "undefined") return;
      console.error("[wave] wllama preload failed", err);
    });
  }

  const runtimeLabel = useMemo(() => {
    if (state.device === "webgpu") return "WebGPU acceleration";
    if (state.device === "wasm") return "browser WASM fallback";
    return "checking device support";
  }, [state.device]);

  if (state.phase === "ready") {
    return <>{children}</>;
  }

  const progress = state.progress ?? 0;
  const isIdle = state.phase === "idle";
  const isLoading = state.phase === "loading";
  const showProgress = isLoading && state.progress !== null;
  const isError = state.phase === "error";
  const statusLabel = isError
    ? "Setup paused"
    : isIdle
      ? "Ready to start"
      : "Downloading Gemma GGUF";
  const detailLabel = isIdle
    ? "The download has not started yet."
    : state.message;
  const summaryLabel = showProgress ? `${progress}%` : runtimeLabel;
  const sourceLabel = describeWaveWllamaSource();

  // Full-area blocking setup screen. Fixed below the sticky 4rem site
  // header so the menu bar stays visible/usable, and fully opaque so
  // the WaveSkin ocean canvas behind the route can't bleed through at
  // the edges (the symptom that made this look like a half-finished
  // panel rather than an intentional gate).
  return (
    <section className="fixed inset-x-0 bottom-0 top-16 z-20 flex items-center justify-center overflow-y-auto bg-background px-6 py-12 text-foreground">
      <section
        className="w-full max-w-xl rounded-[2rem] border border-border bg-surface p-8 shadow-2xl shadow-accent/10"
        aria-live="polite"
      >
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="grid h-11 w-11 place-items-center rounded-full bg-accent-soft text-accent"
          >
            <span
              className={`h-3 w-3 rounded-full bg-accent ${isLoading ? "animate-pulse" : ""}`}
            />
          </span>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-foreground/45">
              Local model setup
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">
              {isError
                ? "Gemma could not load"
                : "Preparing Gemma on this device"}
            </h1>
          </div>
        </div>

        <p className="mt-6 text-sm leading-relaxed text-foreground/70">
          WAVE runs the fine-tuned Gemma locally via wllama (GGUF) for chunks,
          check-ins, reflections, and insights. The first visit downloads and
          caches the model (~3.2 GB across 5 shards); after that, the app
          reuses it from browser storage.
        </p>

        <div className="mt-6 rounded-2xl border border-border bg-surface-muted p-4">
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="min-w-0 font-medium">{statusLabel}</span>
            <span className="w-28 shrink-0 text-right font-mono tabular-nums text-foreground/50">
              {summaryLabel}
            </span>
          </div>

          <p
            className="mt-3 h-5 truncate text-xs text-foreground/55"
            title={detailLabel}
          >
            {detailLabel}
          </p>

          {showProgress ? (
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-border">
              <div
                className="h-full rounded-full bg-accent transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          ) : null}

          <dl className="mt-4 grid gap-3 text-xs text-foreground/55 sm:grid-cols-2">
            <div>
              <dt className="font-medium text-foreground/70">Repo</dt>
              <dd className="mt-1 h-4 truncate" title={WAVE_GGUF_REPO}>
                {WAVE_GGUF_REPO}
              </dd>
            </div>
            <div>
              <dt className="font-medium text-foreground/70">First shard</dt>
              <dd className="mt-1 h-4 truncate" title={WAVE_GGUF_FILE}>
                {WAVE_GGUF_FILE.split("/").pop() ?? WAVE_GGUF_FILE}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="font-medium text-foreground/70">Source</dt>
              <dd className="mt-1 h-4 truncate" title={sourceLabel}>
                {sourceLabel}
              </dd>
            </div>
          </dl>
        </div>

        {isError ? (
          <div className="mt-6 rounded-2xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
            <p className="font-medium">Download or runtime setup failed.</p>
            <p className="mt-1 text-danger/80">{state.message}</p>
            <button
              type="button"
              onClick={handleStart}
              className="mt-4 rounded-full border border-danger/40 bg-surface px-4 py-2 text-xs font-medium text-danger transition hover:bg-danger-soft"
            >
              Try again
            </button>
          </div>
        ) : isIdle ? (
          <div className="mt-6">
            <button
              type="button"
              onClick={handleStart}
              className="inline-flex items-center justify-center rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-accent-foreground transition hover:opacity-90"
            >
              Start download
            </button>
            <p className="mt-4 text-xs leading-relaxed text-foreground/50">
              Start when you&apos;re ready to use a model-backed page. Chrome or
              Edge with WebGPU gives the smoothest demo; cached loads should be
              much faster.
            </p>
          </div>
        ) : (
          <p className="mt-5 text-xs leading-relaxed text-foreground/50">
            Keep this tab open during the first download. Chrome or Edge with
            WebGPU gives the smoothest demo; cached loads should be much faster.
          </p>
        )}
      </section>
    </section>
  );
}
