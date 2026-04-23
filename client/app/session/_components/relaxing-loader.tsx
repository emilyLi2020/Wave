"use client";

/**
 * Slow-pulsating relaxing filler shown while the next chunk is being
 * generated. Replaces the older "Composing the next chunk..." shimmer
 * and the 3-2-1 countdown — both felt either utilitarian or too fast.
 *
 * Tone goals (from session UX brief):
 *   - Reads like a piece of the meditation, not a system message.
 *   - Pulses at ~4 second cycles so the cadence matches a calm breath
 *     rather than a UI spinner.
 *   - At session start, the phrases are settling-in language. Between
 *     a check-in and the next chunk, the phrases are breath cues so
 *     the patient stays in the practice while the model catches up.
 *
 * Phrase selection is randomized per mount within the appropriate
 * pool. We also rotate phrases every ~6 seconds in case the wait
 * stretches beyond a single pulse cycle.
 */

import { useEffect, useMemo, useState } from "react";

const SETTLING_PHRASES = [
  "settling in",
  "finding the wave",
  "easing into the session",
  "letting the room get quiet",
  "softening the shoulders",
];

const BREATH_PHRASES = [
  "breathe in",
  "breathe out",
  "soft inhale",
  "slow exhale",
  "rest at the top of the breath",
  "rest at the bottom of the breath",
  "let the wave gather",
];

interface Props {
  /**
   * Where in the session this loader is sitting. `start` plays the
   * settling pool (used before the very first chunk). `between` plays
   * the breath pool (used between every check-in and the next chunk).
   */
  pool: "start" | "between";
}

export function RelaxingLoader({ pool }: Props) {
  const phrases = pool === "start" ? SETTLING_PHRASES : BREATH_PHRASES;
  // Pick a random starting index so consecutive loaders don't all
  // open with the same line on a fast demo run.
  const startIndex = useMemo(
    () => Math.floor(Math.random() * phrases.length),
    [phrases],
  );
  const [index, setIndex] = useState(startIndex);

  useEffect(() => {
    const interval = setInterval(() => {
      setIndex((prev) => (prev + 1) % phrases.length);
    }, 6000);
    return () => clearInterval(interval);
  }, [phrases.length]);

  return (
    <div
      className="flex min-h-[280px] flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-surface p-8"
      aria-live="polite"
      role="status"
    >
      <p
        key={index}
        className="text-2xl font-light tracking-wide text-foreground/80 animate-relax-pulse"
      >
        {phrases[index]}
      </p>
      <p className="text-xs uppercase tracking-[0.2em] text-foreground/35">
        {pool === "start" ? "loading session" : "easing into the next part"}
      </p>
    </div>
  );
}
