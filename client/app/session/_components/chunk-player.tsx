"use client";

/**
 * Auto-advancing player for one scripted Chunk.
 *
 * State is a single `currentSegmentIndex`. For each segment type:
 *   - `text`   — display the line and advance after `max(3000ms, length * 55ms)`.
 *               This is a reading-speed estimate, not a fixed timeout, so
 *               longer instructions get more time (PRD § Session Runtime
 *               Requirements rule 3).
 *   - `pause`  — display nothing new (the wave bed continues on its own)
 *               and advance after `duration * 1000ms`.
 *   - `breath` — display the instruction and tell <AnimatedWave> the
 *               current breath phase + duration so the visualization
 *               rises on inhale, holds at peak, recedes on exhale —
 *               in lockstep with the count.
 *
 * After the last segment we call `onComplete()` with NO transition copy
 * (PRD § Session Runtime Requirements rule 4: no "chunk complete", no
 * "the agent will check in now" — the next surface mounts seamlessly).
 *
 * The ambient audio bed is intentionally NOT mounted here — it lives at
 * the session shell so it never restarts on chunk boundaries (PRD Risk
 * Area #6). All this component owns is text + the wave visualization.
 *
 * Demo mode
 *
 * When `demoMode` is true (set by the intake-screen toggle) every
 * `pause` and `breath` segment is collapsed to a flat 2-second beat
 * and the text-segment minimum drops to 1.2 s. The whole 5-chunk arc
 * runs in roughly two minutes so a reviewer can watch the flow
 * end-to-end. The breath visualization still receives the segment's
 * actual duration so the wave keeps its calm rise/hold/recede shape;
 * only the time we wait before advancing is shortened.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AnimatedWave } from "./animated-wave";
import type { Chunk, Segment } from "@/types/session";

interface Props {
  chunk: Chunk;
  onComplete: () => void;
  demoMode?: boolean;
  /**
   * Current craving intensity (1-10) the ambient wave should render at.
   * SessionMachine passes the most recent check-in score when one
   * exists, otherwise the intake intensity, so the wave's height stays
   * consistent with whatever rating the patient owns right now.
   */
  currentIntensity?: number;
}

const MIN_TEXT_DISPLAY_MS = 3000;
const TEXT_MS_PER_CHAR = 55;
const DEMO_BEAT_MS = 2000;
const DEMO_MIN_TEXT_DISPLAY_MS = 1200;
const DEMO_TEXT_MS_PER_CHAR = 22;

export function ChunkPlayer({
  chunk,
  onComplete,
  demoMode = false,
  currentIntensity,
}: Props) {
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0);
  const advanceHandleRef = useRef<number | null>(null);

  // Reset when the chunk changes (re-mounted by the session machine on
  // every chunk boundary, but defensive in case parents reuse the
  // component).
  useEffect(() => {
    setCurrentSegmentIndex(0);
  }, [chunk.id]);

  const segments = chunk.segments;
  const segment: Segment | undefined = segments[currentSegmentIndex];

  useEffect(() => {
    if (!segment) {
      onComplete();
      return;
    }

    const advance = () => setCurrentSegmentIndex((idx) => idx + 1);

    let delayMs: number;
    if (segment.type === "text") {
      const minMs = demoMode
        ? DEMO_MIN_TEXT_DISPLAY_MS
        : MIN_TEXT_DISPLAY_MS;
      const perChar = demoMode ? DEMO_TEXT_MS_PER_CHAR : TEXT_MS_PER_CHAR;
      delayMs = Math.max(minMs, segment.content.length * perChar);
    } else if (segment.type === "pause") {
      delayMs = demoMode ? DEMO_BEAT_MS : segment.duration * 1000;
    } else {
      delayMs = demoMode ? DEMO_BEAT_MS : segment.duration * 1000;
    }

    const handle = window.setTimeout(advance, delayMs);
    advanceHandleRef.current = handle;
    return () => {
      window.clearTimeout(handle);
      advanceHandleRef.current = null;
    };
  }, [segment, onComplete, demoMode]);

  // Skip the current non-breath segment. Breath segments are deliberately
  // not skippable — the paced breath *is* the intervention, not waiting on
  // it. The button in the UI is only rendered for text/pause anyway; this
  // guard is defensive.
  const skipSegment = useCallback(() => {
    if (!segment) return;
    if (segment.type === "breath") return;
    if (advanceHandleRef.current !== null) {
      window.clearTimeout(advanceHandleRef.current);
      advanceHandleRef.current = null;
    }
    setCurrentSegmentIndex((idx) => idx + 1);
  }, [segment]);

  const canSkip = segment ? segment.type !== "breath" : false;

  // The line we render is the most recent text or breath instruction.
  // During pure `pause` segments we keep the previous line on screen
  // so the patient is not staring at a blank surface.
  const visibleText = useMemo(() => {
    for (let idx = currentSegmentIndex; idx >= 0; idx--) {
      const candidate = segments[idx];
      if (!candidate) continue;
      if (candidate.type === "text") return candidate.content;
      if (candidate.type === "breath") return candidate.instruction;
    }
    return "";
  }, [currentSegmentIndex, segments]);

  const breathSegment =
    segment && segment.type === "breath" ? segment : null;

  return (
    <div className="space-y-6">
      {breathSegment ? (
        <AnimatedWave
          mode="breath"
          breathPhase={breathSegment.phase}
          // In demo mode the chunk player advances on a 2-second beat,
          // so we tell the wave to ease over that same window. Without
          // this the wave would only get halfway up on inhale before
          // we hopped to the next phase, which looks broken.
          breathDurationSec={
            demoMode ? DEMO_BEAT_MS / 1000 : breathSegment.duration
          }
        />
      ) : (
        <AnimatedWave mode="ambient" intensity={currentIntensity} />
      )}

      <article className="relative rounded-2xl border border-border bg-surface p-6">
        <p className="min-h-[3.5rem] pr-20 text-lg leading-relaxed text-foreground/90">
          {visibleText}
        </p>
        {canSkip ? (
          <button
            type="button"
            onClick={skipSegment}
            aria-label="Skip pause"
            className="absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-full border border-border bg-surface-muted px-3 py-1 text-xs font-medium text-foreground/60 transition hover:border-accent hover:text-accent focus:border-accent focus:text-accent focus:outline-none"
          >
            Skip pause
            <span aria-hidden>→</span>
          </button>
        ) : null}
      </article>
    </div>
  );
}
