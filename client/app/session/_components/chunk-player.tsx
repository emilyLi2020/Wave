"use client";

/**
 * Auto-advancing player for one generated Chunk — re-skinned to match
 * the interactive prototype's chunk screen:
 *
 *   - thin glowing progress bar pinned at the top
 *   - centered uppercase crumb "CHUNK N OF 5 · <phase>"
 *   - a medication-aware banner that auto-dismisses (~7 s) on chunk 1
 *   - centered italic-serif guidance line, with a "Breathe in · 4s"
 *     overline while a breath segment is active
 *   - a quiet "Skip to check-in →" control bottom-right
 *
 * The ambient ocean is the WaveSkin canvas behind the whole route, so
 * this screen carries no inline wave widget (matching the prototype's
 * "minimal chrome, the shared wave does the rest").
 *
 * Segment timing + Kokoro narration are unchanged from before:
 *   - `text`   — spoken via Kokoro; advance the instant playback ends.
 *   - `pause`  — silent beat; advance after `duration` (or the demo beat).
 *   - `breath` — show the breath instruction + count; advance after
 *                `duration` (or the demo beat).
 *
 * Demo mode collapses every pause/breath to a flat 1-second beat.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createKokoroTextToSpeechEngine,
  KOKORO_DEFAULT_RUNTIME_ID,
  KOKORO_DEFAULT_VOICE_ID,
  type KokoroTextToSpeechEngine,
} from "@/lib/voice";
import type { MatType } from "@/types/models";
import type { Chunk, ChunkNumber, Segment } from "@/types/session";

interface Props {
  chunk: Chunk;
  chunkNumber: ChunkNumber;
  matType: MatType;
  onComplete: () => void;
  demoMode?: boolean;
  /** Current craving intensity (1-10). Unused visually now that the
   *  shared WaveSkin canvas owns the ocean, but kept on the prop so the
   *  session-machine call site doesn't have to special-case it. */
  currentIntensity?: number;
}

const DEMO_BEAT_MS = 1000;

const CHUNK_PHASE_WORD: Record<ChunkNumber, string> = {
  1: "Settle",
  2: "Body",
  3: "Sound",
  4: "Breath",
  5: "Close",
};

// Medication-aware acknowledgment copy (ported from the prototype's
// session-screens.jsx MAT_ACK). A statement of fact about how the
// medication is or isn't buffering the urge — never a judgment.
const MAT_ACK: Record<MatType, { label: string; body: string }> = {
  buprenorphine: {
    label: "Suboxone",
    body: "Your Suboxone is in your system right now. What you're feeling at this intensity would be far louder without it. Work with what's left.",
  },
  methadone: {
    label: "Methadone",
    body: "Your methadone is steady underneath this. What you're feeling isn't withdrawal, it's the urge on top. We can meet just that.",
  },
  naltrexone: {
    label: "Naltrexone",
    body: "Naltrexone is blocking the reward right now. Whatever this craving is promising, the receptor isn't open. Stay with the wave.",
  },
  vivitrol: {
    label: "Vivitrol",
    body: "Vivitrol is still active. The reward isn't going to land, that's the chemistry. Let's let the urge crest without chasing it.",
  },
  none: {
    label: "No medication",
    body: "No medication is buffering this, you're meeting it fully. That's harder, and it counts more.",
  },
};

const BREATH_LABEL: Record<"inhale" | "hold" | "exhale", string> = {
  inhale: "Breathe in",
  hold: "Hold",
  exhale: "Breathe out",
};

export function ChunkPlayer({
  chunk,
  chunkNumber,
  matType,
  onComplete,
  demoMode = false,
}: Props) {
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0);
  const kokoroRef = useRef<KokoroTextToSpeechEngine | null>(null);

  const [bannerVisible, setBannerVisible] = useState(chunkNumber === 1);
  const [bannerLeaving, setBannerLeaving] = useState(false);

  const getKokoro = useCallback((): KokoroTextToSpeechEngine => {
    if (!kokoroRef.current) {
      kokoroRef.current = createKokoroTextToSpeechEngine(
        KOKORO_DEFAULT_RUNTIME_ID,
      );
    }
    return kokoroRef.current;
  }, []);

  // No chunk.id reset effect needed: the session machine remounts this
  // component with a per-chunk `key`, so state starts fresh each chunk.

  useEffect(() => {
    return () => {
      kokoroRef.current?.stop();
    };
  }, []);

  // MAT banner auto-dismiss (~7 s, shortened in demo mode).
  useEffect(() => {
    if (!bannerVisible) return;
    const mul = demoMode ? 0.5 : 1;
    const t1 = window.setTimeout(() => setBannerLeaving(true), 7000 * mul);
    const t2 = window.setTimeout(() => setBannerVisible(false), 7600 * mul);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [bannerVisible, demoMode]);

  const segments = chunk.segments;
  const segment: Segment | undefined = segments[currentSegmentIndex];

  useEffect(() => {
    if (!segment) {
      onComplete();
      return;
    }

    let cancelled = false;
    const advance = () => {
      if (cancelled) return;
      setCurrentSegmentIndex((idx) => idx + 1);
    };

    if (segment.type === "text") {
      const kokoro = getKokoro();
      void kokoro
        .speak(segment.content, KOKORO_DEFAULT_VOICE_ID)
        .then(() => advance())
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") {
            return;
          }
          if (typeof console !== "undefined") {
            console.warn("[wave] ChunkPlayer Kokoro speak failed", err);
          }
          advance();
        });
      return () => {
        cancelled = true;
        kokoro.stop();
      };
    }

    const delayMs = demoMode ? DEMO_BEAT_MS : segment.duration * 1000;
    const handle = window.setTimeout(advance, delayMs);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [segment, onComplete, demoMode, getKokoro]);

  // The line we render is the most recent spoken text. During pause /
  // breath segments we keep the last text line on screen.
  const visibleText = useMemo(() => {
    for (let idx = currentSegmentIndex; idx >= 0; idx--) {
      const candidate = segments[idx];
      if (candidate?.type === "text") return candidate.content;
    }
    return "";
  }, [currentSegmentIndex, segments]);

  const breathSegment =
    segment && segment.type === "breath" ? segment : null;

  const total = segments.length;
  const pct = total > 0 ? ((currentSegmentIndex + 1) / total) * 100 : 0;

  const ack = MAT_ACK[matType] ?? MAT_ACK.none;
  const crumb = `Chunk ${chunkNumber} of 5 · ${CHUNK_PHASE_WORD[chunkNumber]}`;

  return (
    <div className="screen">
      <div style={{ padding: "8px 8px 0", maxWidth: 880, margin: "0 auto", width: "100%" }}>
        <div className="thin-progress">
          <span style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="topbar" style={{ justifyContent: "center" }}>
        <span className="crumb" style={{ letterSpacing: "0.28em" }}>
          {crumb.toUpperCase()}
        </span>
      </div>

      <div className="screen-body" style={{ paddingTop: 6 }}>
        {bannerVisible ? (
          <div className={`mat-banner ${bannerLeaving ? "dismissing" : ""}`}>
            <div
              className="row"
              style={{ alignItems: "flex-start", gap: 10 }}
            >
              <span style={{ marginTop: 2, color: "var(--wave-glow)" }}>
                <PillIcon />
              </span>
              <div>
                <div
                  className="eyebrow accent"
                  style={{ marginBottom: 6 }}
                >
                  Medication-aware · {ack.label}
                </div>
                <p
                  style={{
                    margin: 0,
                    fontSize: 14.5,
                    lineHeight: 1.5,
                    color: "var(--wave-crest)",
                  }}
                >
                  {ack.body}
                </p>
              </div>
            </div>
          </div>
        ) : null}

        <div style={{ flex: 1 }} />

        <div
          style={{
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            gap: 18,
          }}
        >
          {breathSegment ? (
            <div
              className="serif"
              style={{
                fontSize: 28,
                color: "var(--wave-crest)",
                textShadow: "0 0 24px rgba(92,225,214,0.4)",
                transition: "opacity 600ms ease",
              }}
            >
              {BREATH_LABEL[breathSegment.phase]}{" "}
              <span
                className="mono"
                style={{
                  fontStyle: "normal",
                  fontSize: 13,
                  color: "var(--ink-faint)",
                  letterSpacing: "0.22em",
                  marginLeft: 8,
                }}
              >
                · {breathSegment.duration}s
              </span>
            </div>
          ) : null}

          <div
            className="serif"
            style={{
              fontSize: 22,
              lineHeight: 1.35,
              color: "var(--ink)",
              maxWidth: 360,
              margin: "0 auto",
              opacity: visibleText ? 1 : 0.4,
              transition: "opacity 600ms ease",
              textWrap: "pretty",
            }}
          >
            {visibleText || " "}
          </div>
        </div>

        <div style={{ flex: 1 }} />

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            className="btn ghost"
            style={{
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 11,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              padding: "6px 10px",
            }}
            onClick={() => {
              kokoroRef.current?.stop();
              onComplete();
            }}
          >
            Skip to check-in →
          </button>
        </div>
      </div>
    </div>
  );
}

function PillIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="2" y="9" width="20" height="6" rx="3" />
      <path d="M12 9v6" />
    </svg>
  );
}
