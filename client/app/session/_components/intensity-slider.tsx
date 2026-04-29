"use client";

/**
 * @deprecated Legacy standalone intensity slider used by the old wave
 * sub-phases. The five-chunk check-in chat has its own composer-
 * embedded score selector (`ScoreComposer` inside
 * `check-in-chat.tsx`); the standalone slider is no longer mounted.
 * Slated for removal in a follow-up cleanup PR. Do not import from
 * here in new code.
 */

import { useEffect, useId } from "react";

interface Props {
  value: number | null;
  onChange: (next: number) => void;
  /**
   * Called every 15 seconds with the current value, matching the PRD's
   * IntensitySample cadence (Data Model > Intensity sample). Skipped
   * while value is null (patient has not picked yet).
   */
  onSample?: (value: number) => void;
  /**
   * Fires once when the patient finishes adjusting the slider (pointer
   * release, touch end, or arrow-key release). The wave phase uses this
   * to regenerate narration off the new intensity without spamming a
   * request for every intermediate value during a drag.
   */
  onCommit?: (value: number) => void;
  /**
   * Copy shown in the unselected state to invite the patient to pick
   * an intensity. Defaults to a generic prompt.
   */
  unselectedPrompt?: string;
}

const SAMPLE_INTERVAL_MS = 15_000;

export function IntensitySlider({
  value,
  onChange,
  onSample,
  onCommit,
  unselectedPrompt = "Tap a number to start. The wave shapes itself around your answer.",
}: Props) {
  const id = useId();
  const isSelected = value !== null;

  useEffect(() => {
    if (!onSample || value === null) return;
    const interval = setInterval(() => {
      onSample(value);
    }, SAMPLE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [value, onSample]);

  return (
    <div className="rounded-xl border border-border bg-surface-muted p-4">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-sm font-medium">
          {isSelected
            ? "Right now, the wave is at:"
            : "Where's the wave for you right now?"}
        </label>
        <span
          className={`text-2xl font-semibold tabular-nums ${
            isSelected ? "text-accent" : "text-foreground/30"
          }`}
        >
          {isSelected ? `${value}/10` : "—/10"}
        </span>
      </div>

      {isSelected ? (
        <input
          id={id}
          type="range"
          min={1}
          max={10}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          onPointerUp={(e) => onCommit?.(Number(e.currentTarget.value))}
          onTouchEnd={(e) => onCommit?.(Number(e.currentTarget.value))}
          onKeyUp={(e) => onCommit?.(Number(e.currentTarget.value))}
          className="mt-3 w-full accent-accent"
          aria-valuemin={1}
          aria-valuemax={10}
          aria-valuenow={value}
        />
      ) : (
        <div
          role="radiogroup"
          aria-labelledby={id}
          className="mt-3 grid grid-cols-10 gap-1.5"
        >
          {Array.from({ length: 10 }, (_, index) => index + 1).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => {
                onChange(n);
                onCommit?.(n);
              }}
              className="rounded-md border border-border bg-surface py-2 text-sm font-medium text-foreground/70 hover:border-accent hover:bg-accent-soft hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-label={`Intensity ${n} of 10`}
            >
              {n}
            </button>
          ))}
        </div>
      )}

      <div className="mt-2 flex justify-between text-[10px] uppercase tracking-wide text-foreground/50">
        <span>calm</span>
        <span>peak</span>
      </div>

      {!isSelected ? (
        <p className="mt-3 text-xs text-foreground/60">{unselectedPrompt}</p>
      ) : null}
    </div>
  );
}
