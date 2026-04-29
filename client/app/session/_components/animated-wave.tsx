"use client";

/**
 * Animated wave visualization for the session.
 *
 * Two modes:
 *
 *   - `ambient` — a continuous slow ocean swell. Used during all
 *                 non-breath segments (text, pause) and during the
 *                 check-in chat. Two layered SVG sine paths slide
 *                 horizontally at different speeds.
 *
 *   - `breath`  — synced to the active breath segment. Water level
 *                 eases over `breathDurationSec`:
 *                   inhale → rises from baseline to peak,
 *                   hold   → holds at peak,
 *                   exhale → recedes from peak to baseline.
 *                 The horizontal slide continues underneath so the
 *                 surface still feels alive at peak; only the level
 *                 is driven by the breath phase.
 *
 * Smoothness notes
 *
 * The water level is driven by `transform: translateY()` on a
 * `height: 100%` fill layer, not by animating `height` directly. Height
 * transitions force layout on every frame and jitter under load;
 * translateY is composited on the GPU and stays smooth.
 *
 * The horizontal slide uses CSS `@keyframes wave-slide` (defined in
 * globals.css as translateX 0 → -50%) on a 200%-wide strip containing
 * two identical SVG copies. This replaces SMIL `<animateTransform>`,
 * which has known jitter issues in Chromium and doesn't survive HMR
 * cleanly in dev.
 *
 * Intensity-driven fill level is available in ambient mode via the
 * optional `intensity` prop (1-10 craving score). Higher score → taller
 * wave — the visualization mirrors what the patient just reported on the
 * slider, so the wave is never disconnected from the rating the patient
 * owns. When `intensity` is omitted the ambient fill falls back to a flat
 * mid-level. Breath mode ignores intensity — level there is locked to
 * the inhale/hold/exhale phase so the wave stays in lockstep with the
 * count (PRD § Session Runtime Requirements rule 5).
 */

import { useEffect, useMemo, useRef, useState } from "react";

interface AmbientProps {
  mode: "ambient";
  /**
   * Optional current craving intensity (1-10). Drives the ambient fill
   * level so higher cravings render as taller waves. Pass the most
   * recent check-in score if one exists, otherwise the intake intensity.
   * Falls back to a mid-level when omitted.
   */
  intensity?: number;
  breathPhase?: undefined;
  breathDurationSec?: undefined;
}

interface BreathProps {
  mode: "breath";
  breathPhase: "inhale" | "hold" | "exhale";
  breathDurationSec: number;
}

type AnimatedWaveProps = AmbientProps | BreathProps;

const VIEWBOX_WIDTH = 400;
const VIEWBOX_HEIGHT = 40;
const PERIOD = 100;
const BASELINE = 18;

const AMBIENT_FRONT_DURATION_S = 11;
const AMBIENT_BACK_DURATION_S = 17;
const AMBIENT_FILL_PERCENT = 38;
// Intensity-driven ambient range. Score 1 → MIN, score 10 → MAX, linear
// in between. Bounds stay inside the breath min/max so transitioning
// from an ambient high into a breath inhale still produces a visible
// rise, and an ambient low into exhale still produces a visible dip.
const AMBIENT_MIN_FILL_PERCENT = 22;
const AMBIENT_MAX_FILL_PERCENT = 68;

const BREATH_PEAK_PERCENT = 78;
const BREATH_BASELINE_PERCENT = 22;
const BREATH_FRONT_DURATION_S = 6;
const BREATH_BACK_DURATION_S = 9;

export function AnimatedWave(props: AnimatedWaveProps) {
  const fillPercent = useBreathDrivenHeight(props);
  const isBreath = props.mode === "breath";

  const frontColor = isBreath ? "var(--wave-peak)" : "var(--wave-rise)";
  const backColor = isBreath ? "var(--wave-rise)" : "var(--wave-peak)";
  const amplitude = isBreath ? 12 : 8;
  const frontDurationS = isBreath
    ? BREATH_FRONT_DURATION_S
    : AMBIENT_FRONT_DURATION_S;
  const backDurationS = isBreath
    ? BREATH_BACK_DURATION_S
    : AMBIENT_BACK_DURATION_S;

  // Level transitions ride the breath. Inhale/exhale take the full
  // `breathDurationSec`. "Hold" snaps quickly so we don't visibly drift
  // while the patient holds at peak. Ambient mode only transitions when
  // switching into it, so a short ease is fine.
  const transitionMs =
    isBreath && props.breathPhase !== "hold"
      ? props.breathDurationSec * 1000
      : 700;

  // translateY percentage: at fillPercent=100 the layer sits at its
  // natural position (fully visible); at fillPercent=0 it's pushed
  // entirely past the bottom of the clipping container.
  const translateY = 100 - fillPercent;

  return (
    <div
      aria-hidden
      className="relative h-40 overflow-hidden rounded-2xl border border-border bg-surface"
    >
      <div
        className="absolute inset-0"
        style={{
          transform: `translate3d(0, ${translateY}%, 0)`,
          transition: `transform ${transitionMs}ms ${
            isBreath ? "cubic-bezier(0.45, 0, 0.55, 1)" : "ease-out"
          }`,
          willChange: "transform",
        }}
      >
        <WaveLayer
          color={backColor}
          durationS={backDurationS}
          amplitude={amplitude * 0.7}
          opacity={0.5}
          phaseOffset={0.5}
        />
        <WaveLayer
          color={frontColor}
          durationS={frontDurationS}
          amplitude={amplitude}
          opacity={0.9}
          phaseOffset={0}
        />
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: `linear-gradient(to bottom, transparent 0%, ${frontColor} 60%)`,
            opacity: 0.4,
          }}
        />
      </div>
    </div>
  );
}

/**
 * Returns the current fill level as a percentage.
 *
 * Ambient mode maps the current craving intensity (1-10) to a fill
 * percent so the wave's height mirrors the patient's latest rating.
 * When no intensity is provided it falls back to a flat mid-level.
 *
 * Breath mode animates the level by switching the target percent
 * whenever the breath phase changes — the CSS transition in the parent
 * does the easing over `breathDurationSec`.
 */
function useBreathDrivenHeight(props: AnimatedWaveProps): number {
  const ambientTarget =
    props.mode === "ambient"
      ? ambientFillForIntensity(props.intensity)
      : null;

  const [percent, setPercent] = useState(() =>
    props.mode === "breath"
      ? targetForPhase(props.breathPhase)
      : ambientFillForIntensity(props.intensity),
  );
  const lastPhaseRef = useRef<string | null>(
    props.mode === "breath" ? props.breathPhase : null,
  );

  useEffect(() => {
    if (props.mode === "ambient") {
      // ambientTarget is always a number when mode === "ambient"; the
      // null branch above only covers breath mode.
      setPercent(ambientTarget as number);
      lastPhaseRef.current = null;
      return;
    }

    // Re-trigger the level transition whenever a new breath phase
    // begins. Setting state inside an effect that depends on the phase
    // is safe here because the new value lasts for the full
    // breathDurationSec window.
    if (lastPhaseRef.current !== props.breathPhase) {
      lastPhaseRef.current = props.breathPhase;
      setPercent(targetForPhase(props.breathPhase));
    }
  }, [
    props.mode,
    props.mode === "breath" ? props.breathPhase : null,
    ambientTarget,
  ]);

  return percent;
}

/**
 * Maps a craving intensity (1-10) to an ambient fill percent. Undefined
 * → mid-level fallback so callers that don't track intensity still get
 * the old behaviour.
 */
function ambientFillForIntensity(intensity: number | undefined): number {
  if (intensity === undefined || Number.isNaN(intensity)) {
    return AMBIENT_FILL_PERCENT;
  }
  const clamped = Math.max(1, Math.min(10, intensity));
  return (
    AMBIENT_MIN_FILL_PERCENT +
    ((clamped - 1) / 9) *
      (AMBIENT_MAX_FILL_PERCENT - AMBIENT_MIN_FILL_PERCENT)
  );
}

function targetForPhase(phase: "inhale" | "hold" | "exhale"): number {
  switch (phase) {
    case "inhale":
      return BREATH_PEAK_PERCENT;
    case "hold":
      return BREATH_PEAK_PERCENT;
    case "exhale":
      return BREATH_BASELINE_PERCENT;
  }
}

/**
 * One horizontally-scrolling wave strip. The strip is 200% the width
 * of its container and contains two identical SVG copies of the wave;
 * the CSS `wave-slide` keyframes translate it from 0 → -50%, producing
 * a seamless infinite scroll on the compositor.
 *
 * `phaseOffset` shifts the back layer by half a period relative to the
 * front so the two layers don't crest in lockstep.
 */
function WaveLayer({
  color,
  durationS,
  amplitude,
  opacity,
  phaseOffset,
}: {
  color: string;
  durationS: number;
  amplitude: number;
  opacity: number;
  phaseOffset: number;
}) {
  const pathD = useMemo(
    () => buildWavePath(amplitude, phaseOffset),
    [amplitude, phaseOffset],
  );
  return (
    <div
      className="pointer-events-none absolute left-0 right-0 -top-4 h-10 overflow-hidden"
      style={{ opacity }}
    >
      <div
        className="flex h-full"
        style={{
          width: "200%",
          animation: `wave-slide ${durationS}s linear infinite`,
          willChange: "transform",
        }}
      >
        <svg
          className="block h-full"
          style={{ width: "50%" }}
          viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
          preserveAspectRatio="none"
        >
          <path d={pathD} fill={color} />
        </svg>
        <svg
          className="block h-full"
          style={{ width: "50%" }}
          viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
          preserveAspectRatio="none"
          aria-hidden
        >
          <path d={pathD} fill={color} />
        </svg>
      </div>
    </div>
  );
}

/**
 * Quadratic-Bezier sine approximation. Sampling every half-period and
 * connecting midpoints via `Q` gives a round, smooth crest without
 * needing a high point count. This looks noticeably softer than the
 * previous dense `L`-segment polyline and costs almost nothing to draw.
 *
 * The path is drawn across the full `VIEWBOX_WIDTH` (2 full periods),
 * so a 50%-width SVG instance renders exactly one horizontal repeat.
 */
function buildWavePath(amplitude: number, phaseOffset: number): string {
  const segments: string[] = [];
  const startX = 0;
  const startPhase = (startX / PERIOD + phaseOffset) * Math.PI * 2;
  segments.push(`M ${startX} ${(BASELINE - Math.sin(startPhase) * amplitude).toFixed(2)}`);

  // Step along quarter-periods: Q control point sits at the sine peak,
  // endpoint sits at the next zero-crossing. The alternating control
  // y-values give us the up/down wave without the faceted look.
  const step = PERIOD / 2;
  for (let x = step; x <= VIEWBOX_WIDTH; x += step) {
    const controlX = x - step / 2;
    const controlPhase = (controlX / PERIOD + phaseOffset) * Math.PI * 2;
    const endPhase = (x / PERIOD + phaseOffset) * Math.PI * 2;
    // Overshoot the control point so the bezier traces closer to a true
    // sine amplitude (a Q through the sine peak undershoots by ~21%).
    const controlY =
      BASELINE - Math.sin(controlPhase) * amplitude * 1.27;
    const endY = BASELINE - Math.sin(endPhase) * amplitude;
    segments.push(`Q ${controlX} ${controlY.toFixed(2)} ${x} ${endY.toFixed(2)}`);
  }

  segments.push(`L ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`);
  segments.push(`L 0 ${VIEWBOX_HEIGHT}`);
  segments.push("Z");
  return segments.join(" ");
}
