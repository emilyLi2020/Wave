"use client";

/**
 * Animated wave visualization for the session.
 *
 * This is the ported Claude-design ocean wave. Per the design
 * transcripts the wave is **bare**: no border, no background, no scrim
 * or color band above or below it — only the waves, on transparency.
 * Three layers (far / mid / front) drift the same left → right
 * direction, each driven by requestAnimationFrame with proper
 * dispersion (shorter wavelengths travel faster) so crests evolve
 * continuously instead of looping verbatim like a CSS slide.
 *
 * Two modes (public API unchanged — all session consumers keep working):
 *
 *   - `ambient` — water level mirrors the patient's craving score
 *                 (1-10). Higher score → the water rises into view;
 *                 the window size never changes, only the level floats.
 *
 *   - `breath`  — synced to the active breath segment. Level eases over
 *                 `breathDurationSec`: inhale → rises to peak, hold →
 *                 holds at peak, exhale → recedes to baseline. The
 *                 horizontal drift continues underneath so the surface
 *                 still feels alive at peak.
 *
 * Smoothness: the water level is a `transform: translateY()` on a
 * full-height layer (composited on the GPU), never an animated height
 * (which forces layout every frame). The per-component phase is
 * advanced in a ref-driven rAF loop so prop changes never tear down
 * the loop or snap the path back to its t=0 shape (the flicker fix
 * from the design transcripts).
 */

import {
  type CSSProperties,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

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

// Score → fill mapping (design values: 1/10 ≈ 22%, 10/10 = 70%).
const AMBIENT_MIN_FILL_PERCENT = 22;
const AMBIENT_MAX_FILL_PERCENT = 70;
// Breath phase levels (design values).
const BREATH_PEAK_PERCENT = 82;
const BREATH_BASELINE_PERCENT = 18;
// Fixed motion intensity (design's default tweak was 0.7).
const MOTION = 0.7;

export function AnimatedWave(props: AnimatedWaveProps) {
  const fillPercent = useBreathDrivenHeight(props);
  const isBreath = props.mode === "breath";

  // Level transitions ride the breath. Inhale/exhale take the full
  // breathDurationSec; "hold" snaps quickly so we don't visibly drift
  // at peak. Ambient eases briefly when the score changes.
  const transitionMs =
    isBreath && props.breathPhase !== "hold"
      ? props.breathDurationSec * 1000
      : 700;

  // translateY %: at fill=100 the water sits fully in view; at fill=0
  // it's pushed entirely past the bottom of the clip container.
  const translateY = 100 - fillPercent;

  const speedMul = 1 / (0.5 + MOTION * 0.8);
  const amp = 0.75 + MOTION * 0.4;

  return (
    <div
      aria-hidden
      className="relative h-40 overflow-hidden rounded-2xl"
    >
      <div
        className="absolute inset-0 overflow-hidden"
        style={{
          transform: `translate3d(0, ${translateY}%, 0)`,
          transition: `transform ${transitionMs}ms ${
            isBreath ? "cubic-bezier(0.45, 0, 0.55, 1)" : "ease-out"
          }`,
          willChange: "transform",
        }}
      >
        {/* Far horizon — slow, low amplitude, soft. */}
        <OceanLayer
          seed={11}
          baseY={28}
          amps={[4 * amp, 2 * amp]}
          periods={[320, 200]}
          phases={[0.1, 0.45]}
          duration={56 * speedMul}
          color="color-mix(in oklab, var(--wave-peak) 70%, transparent)"
          opacity={0.55}
          topOffset={-2}
          bobDuration={9 * speedMul}
          bobOffset={2.6}
        />
        {/* Mid layer. */}
        <OceanLayer
          seed={37}
          baseY={22}
          amps={[6 * amp, 3 * amp]}
          periods={[280, 170]}
          phases={[0.3, 0.75]}
          duration={32 * speedMul}
          color="color-mix(in oklab, var(--wave-rise) 88%, transparent)"
          opacity={0.85}
          topOffset={4}
          bobDuration={6.4 * speedMul}
          bobOffset={1.7}
        />
        {/* Front layer — the dominant rolling swell. */}
        <OceanLayer
          seed={71}
          baseY={18}
          amps={[7.5 * amp, 3.6 * amp]}
          periods={[240, 150]}
          phases={[0.55, 0.05]}
          duration={22 * speedMul}
          color="var(--wave-peak)"
          opacity={0.95}
          topOffset={12}
          bobDuration={4.8 * speedMul}
          bobOffset={1.2}
        />
      </div>
    </div>
  );
}

/**
 * Returns the current fill level as a percentage.
 *
 * Ambient mode maps the craving intensity (1-10) to a fill percent so
 * the wave's height mirrors the patient's latest rating; undefined →
 * a flat mid-level. Breath mode switches the target percent on each
 * phase change and the parent's CSS transition does the easing.
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
      setPercent(ambientTarget as number);
      lastPhaseRef.current = null;
      return;
    }

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
 * a sensible water line.
 */
function ambientFillForIntensity(intensity: number | undefined): number {
  const clamped =
    intensity === undefined || Number.isNaN(intensity)
      ? 5
      : Math.max(1, Math.min(10, intensity));
  return (
    AMBIENT_MIN_FILL_PERCENT +
    ((clamped - 1) / 9) *
      (AMBIENT_MAX_FILL_PERCENT - AMBIENT_MIN_FILL_PERCENT)
  );
}

function targetForPhase(phase: "inhale" | "hold" | "exhale"): number {
  switch (phase) {
    case "inhale":
    case "hold":
      return BREATH_PEAK_PERCENT;
    case "exhale":
      return BREATH_BASELINE_PERCENT;
  }
}

/**
 * Build the filled path for one ocean layer at the given per-component
 * phases. Pure sum-of-sines surface (rounded crests), smoothed with
 * midpoint quadratic Béziers, closed down to the bottom. Verbatim from
 * the design source (wave.jsx → buildOceanPaths).
 */
function buildOceanFill(
  baseY: number,
  amps: number[],
  periods: number[],
  phases: number[],
  seed: number,
  t: number,
): string {
  const W = 800;
  const H = 100;
  const STEP = 6;
  const wobble = (x: number) =>
    0.12 *
    Math.sin((x + seed) * 0.0137 + t * 0.31) *
    Math.cos((x + seed) * 0.0291 - t * 0.19);

  const yAt = (x: number) => {
    let y = baseY;
    for (let i = 0; i < amps.length; i++) {
      const phase = (x / periods[i] + phases[i]) * Math.PI * 2;
      y -= amps[i] * Math.sin(phase);
    }
    return y + wobble(x);
  };

  const pts: [number, number][] = [];
  for (let x = 0; x <= W; x += STEP) pts.push([x, yAt(x)]);

  let surface = `M ${pts[0][0]} ${pts[0][1].toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = pts[i - 1];
    const [x, y] = pts[i];
    const mx = (px + x) / 2;
    const my = (py + y) / 2;
    surface += ` Q ${px.toFixed(1)} ${py.toFixed(2)} ${mx.toFixed(1)} ${my.toFixed(2)}`;
  }
  const last = pts[pts.length - 1];
  surface += ` L ${last[0]} ${last[1].toFixed(2)}`;
  return surface + ` L ${W} ${H} L 0 ${H} Z`;
}

interface LayerProps {
  baseY: number;
  amps: number[];
  periods: number[];
  phases: number[];
  duration: number;
  color: string;
  opacity: number;
  topOffset: number;
  bobDuration: number;
  bobOffset: number;
  seed: number;
}

/**
 * One ocean layer. The per-component phase advances every rAF frame
 * with dispersion (√(longest/period_i)); default drift is the same
 * left → right for every layer (no crest stroke, no reverse). Latest
 * props are read from a ref so prop changes never tear down the loop.
 * The t=0 path is frozen on first render so a re-render never snaps
 * `d` back to the t=0 shape between frames (the flicker fix).
 */
function OceanLayer(props: LayerProps) {
  const {
    baseY, amps, periods, phases, color,
    opacity, topOffset, bobDuration, bobOffset, seed,
  } = props;
  const fillRef = useRef<SVGPathElement>(null);
  const params = useRef(props);
  params.current = props;

  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const loop = (now: number) => {
      const t = (now - start) / 1000;
      const p = params.current;
      // Left → right drift.
      const basePxPerSec = (800 / p.duration) * -1;
      const longest = Math.max.apply(null, p.periods);
      const livePhases = p.phases.map((ph, i) => {
        const dispersion = Math.sqrt(longest / p.periods[i]);
        const shiftPx = basePxPerSec * dispersion * t;
        return ph + shiftPx / p.periods[i];
      });
      const d = buildOceanFill(
        p.baseY, p.amps, p.periods, livePhases, p.seed, t,
      );
      if (fillRef.current) fillRef.current.setAttribute("d", d);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const initialRef = useRef<string | null>(null);
  if (!initialRef.current) {
    initialRef.current = buildOceanFill(baseY, amps, periods, phases, seed, 0);
  }

  // Stable across SSR/CSR — Math.random would mismatch on hydration.
  const gid = `wave-grad-${useId().replace(/:/g, "")}`;

  return (
    <div
      data-ocean-bob
      style={
        {
          position: "absolute",
          left: 0,
          right: 0,
          top: topOffset,
          height: 100,
          opacity,
          overflow: "hidden",
          animation: `wave-bob-vert ${bobDuration}s ease-in-out infinite`,
          "--bob-offset": `${bobOffset}px`,
          willChange: "transform",
        } as CSSProperties
      }
    >
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 800 100"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stopColor={`color-mix(in oklab, ${color} 72%, white)`}
              stopOpacity="1"
            />
            <stop offset="40%" stopColor={color} stopOpacity="0.96" />
            <stop
              offset="100%"
              stopColor={`color-mix(in oklab, ${color} 70%, var(--accent-deep, black))`}
              stopOpacity="1"
            />
          </linearGradient>
        </defs>
        <path ref={fillRef} d={initialRef.current} fill={`url(#${gid})`} />
      </svg>
    </div>
  );
}
