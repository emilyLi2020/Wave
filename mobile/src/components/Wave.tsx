// Wave.tsx — RN port of the design bundle's wave.jsx OceanWave, in the
// final state the design chat converged on:
//
//   • bare mode: transparent, no border/scrim, no atmospheric stack —
//     only the three wave shapes float (chat: "Only keeps the waves").
//   • height reflects ONLY the craving score (chat: breath no longer
//     pulls the water level). fill = 22…70% of the frame; the layer
//     stack translates down by (100 - fill)% so a high score = water
//     risen into view, a low score = water sitting at the bottom.
//   • all three layers drift the same left → right direction with
//     per-component dispersion so the surface never loops verbatim.
//   • window size is fixed (caller passes height; session uses 130).
//
// SVG path rendering uses react-native-svg; the per-frame `d` recompute
// runs on the Reanimated UI thread via useFrameCallback + useAnimatedProps
// (the web prototype used rAF + setAttribute — same idea, off the JS
// thread here). buildOceanPath is a worklet so it can run UI-side.

import React, { useEffect, useMemo } from "react";
import { StyleSheet, View, type DimensionValue } from "react-native";
import Svg, { Path, Defs, LinearGradient, Stop } from "react-native-svg";
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { radius, type Theme } from "@/theme";
import { useTheme } from "@/theme-context";

const AnimatedPath = Animated.createAnimatedComponent(Path);

// ─── intensity → fill height (verbatim from wave.jsx) ──────────
const AMBIENT_MIN = 22;
const AMBIENT_MAX = 70;

function fillForIntensity(i: number): number {
  "worklet";
  const c = Math.max(1, Math.min(10, i || 5));
  return AMBIENT_MIN + ((c - 1) / 9) * (AMBIENT_MAX - AMBIENT_MIN);
}

// ─── colour helpers (JS thread, run once) ──────────────────────
type RGB = [number, number, number];

function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}
function rgb(c: RGB): string {
  return `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;
}
// color-mix(in oklab, a P%, b) — approximated in sRGB; visually close
// enough for these soft gradient stops.
function mix(a: RGB, b: RGB, pA: number): RGB {
  return [
    a[0] * pA + b[0] * (1 - pA),
    a[1] * pA + b[1] * (1 - pA),
    a[2] * pA + b[2] * (1 - pA),
  ];
}

const WHITE: RGB = [255, 255, 255];

interface LayerSpec {
  seed: number;
  baseY: number;
  amps: [number, number];
  periods: [number, number];
  phases: [number, number];
  duration: number;
  base: RGB;
  accentDeep: RGB;
  opacity: number;
  topOffset: number;
  bobDuration: number;
  bobOffset: number;
  gid: string;
}

// motion is the design's TWEAK_DEFAULTS.motion (0.7). speedMul / amp
// scaling are verbatim from OceanWaveSvg. Wave colours come from the
// active theme (wavePeak/waveRise/accentDeep) so the stack re-tints
// with the light/dark palette.
function buildLayers(motion: number, theme: Theme): LayerSpec[] {
  const speedMul = 1 / (0.5 + motion * 0.8);
  const amp = 0.75 + motion * 0.4;
  const peak = hexToRgb(theme.wavePeak);
  const rise = hexToRgb(theme.waveRise);
  const accentDeep = hexToRgb(theme.accentDeep);
  // far/mid carried `color-mix(... X%, transparent)` on top of the
  // layer opacity; fold that into a combined opacity so the look
  // matches without per-stop alpha.
  return [
    {
      seed: 11,
      baseY: 28,
      amps: [4 * amp, 2 * amp],
      periods: [320, 200],
      phases: [0.1, 0.45],
      duration: 56 * speedMul,
      base: peak,
      accentDeep,
      opacity: 0.55 * 0.7,
      topOffset: -2,
      bobDuration: 9 * speedMul,
      bobOffset: 2.6,
      gid: "ogFar",
    },
    {
      seed: 37,
      baseY: 22,
      amps: [6 * amp, 3 * amp],
      periods: [280, 170],
      phases: [0.3, 0.75],
      duration: 32 * speedMul,
      base: rise,
      accentDeep,
      opacity: 0.85 * 0.88,
      topOffset: 4,
      bobDuration: 6.4 * speedMul,
      bobOffset: 1.7,
      gid: "ogMid",
    },
    {
      seed: 71,
      baseY: 18,
      amps: [7.5 * amp, 3.6 * amp],
      periods: [240, 150],
      phases: [0.55, 0.05],
      duration: 22 * speedMul,
      base: peak,
      accentDeep,
      opacity: 0.95,
      topOffset: 12,
      bobDuration: 4.8 * speedMul,
      bobOffset: 1.2,
      gid: "ogFront",
    },
  ];
}

// Vertical body gradient per layer: top lighter (light kiss), middle
// the base hue, bottom deeper — matches the <linearGradient> in
// OceanLayer.
function layerStops(base: RGB, accentDeep: RGB) {
  return {
    top: rgb(mix(base, WHITE, 0.72)),
    mid: rgb(base),
    bot: rgb(mix(base, accentDeep, 0.7)),
  };
}

// ─── path builder (worklet) — port of buildOceanPaths ──────────
// Pure sine sum (no Stokes sharpening — the chat settled on round
// crests), smoothed with midpoint quadratic Béziers. viewBox is
// 800×100; preserveAspectRatio="none" stretches it to the frame.
function buildOceanPath(
  baseY: number,
  a0: number,
  a1: number,
  p0: number,
  p1: number,
  ph0: number,
  ph1: number,
  seed: number,
  t: number,
): string {
  "worklet";
  const W = 800;
  const H = 100;
  const STEP = 8;
  const TWO_PI = Math.PI * 2;

  const yAt = (x: number): number => {
    let y = baseY;
    y -= a0 * Math.sin((x / p0 + ph0) * TWO_PI);
    y -= a1 * Math.sin((x / p1 + ph1) * TWO_PI);
    const wob =
      0.12 *
      Math.sin((x + seed) * 0.0137 + t * 0.31) *
      Math.cos((x + seed) * 0.0291 - t * 0.19);
    return y + wob;
  };

  let prevX = 0;
  let prevY = yAt(0);
  let d = "M 0 " + prevY.toFixed(2);
  for (let x = STEP; x <= W; x += STEP) {
    const y = yAt(x);
    const mx = (prevX + x) / 2;
    const my = (prevY + y) / 2;
    d +=
      " Q " +
      prevX.toFixed(1) +
      " " +
      prevY.toFixed(2) +
      " " +
      mx.toFixed(1) +
      " " +
      my.toFixed(2);
    prevX = x;
    prevY = y;
  }
  d += " L " + prevX + " " + prevY.toFixed(2);
  d += " L " + W + " " + H + " L 0 " + H + " Z";
  return d;
}

// ─── one drifting + bobbing layer ──────────────────────────────
function OceanLayer({
  spec,
  clock,
}: {
  spec: LayerSpec;
  clock: SharedValue<number>;
}) {
  // Per-component live phase with dispersion (shorter waves move
  // faster). dir = -1 → the design's left→right default.
  const animatedProps = useAnimatedProps(() => {
    const t = clock.value;
    const longest = Math.max(spec.periods[0], spec.periods[1]);
    const basePxPerSec = (800 / spec.duration) * -1;
    const disp0 = Math.sqrt(longest / spec.periods[0]);
    const disp1 = Math.sqrt(longest / spec.periods[1]);
    const live0 =
      spec.phases[0] + (basePxPerSec * disp0 * t) / spec.periods[0];
    const live1 =
      spec.phases[1] + (basePxPerSec * disp1 * t) / spec.periods[1];
    return {
      d: buildOceanPath(
        spec.baseY,
        spec.amps[0],
        spec.amps[1],
        spec.periods[0],
        spec.periods[1],
        live0,
        live1,
        spec.seed,
        t,
      ),
    };
  });

  // Slow vertical bob — approximation of @keyframes wave-bob-vert
  // (single eased hump per cycle).
  const bobStyle = useAnimatedStyle(() => {
    const phase = (clock.value % spec.bobDuration) / spec.bobDuration;
    const e = Math.sin(phase * Math.PI);
    return { transform: [{ translateY: e * spec.bobOffset }] };
  });

  const stops = layerStops(spec.base, spec.accentDeep);

  return (
    <Animated.View
      style={[
        styles.layer,
        { top: spec.topOffset, opacity: spec.opacity },
        bobStyle,
      ]}
    >
      <Svg
        width="100%"
        height="100%"
        viewBox="0 0 800 100"
        preserveAspectRatio="none"
      >
        <Defs>
          <LinearGradient id={spec.gid} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={stops.top} stopOpacity={1} />
            <Stop offset="40%" stopColor={stops.mid} stopOpacity={0.96} />
            <Stop offset="100%" stopColor={stops.bot} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <AnimatedPath animatedProps={animatedProps} fill={`url(#${spec.gid})`} />
      </Svg>
    </Animated.View>
  );
}

// ─── public Wave ───────────────────────────────────────────────
export interface WaveProps {
  /** Craving score 1–10 → water level. */
  intensity?: number;
  /** TWEAK_DEFAULTS.motion. */
  motion?: number;
  /** Fixed frame height in px (session screens use 130). */
  height?: number;
  /** Transparent, borderless — only the wave shapes. */
  bare?: boolean;
  width?: DimensionValue;
}

export function Wave({
  intensity = 5,
  motion = 0.7,
  height = 130,
  bare = true,
  width = "100%",
}: WaveProps) {
  const theme = useTheme();
  const clock = useSharedValue(0);
  const frame = useFrameCallback((info) => {
    "worklet";
    clock.value = info.timeSinceFirstFrame / 1000;
  }, false);

  useEffect(() => {
    frame.setActive(true);
    return () => frame.setActive(false);
  }, [frame]);

  const layers = useMemo(() => buildLayers(motion, theme), [motion, theme]);

  // Water level: translate the whole stack down by (100 - fill)% of
  // the frame height (chat: "like a water level"). 700ms ease-out,
  // verbatim transitionMs/easing from the non-breath path.
  const fillPct = useSharedValue(fillForIntensity(intensity));
  useEffect(() => {
    fillPct.value = withTiming(fillForIntensity(intensity), {
      duration: 700,
      easing: Easing.out(Easing.ease),
    });
  }, [intensity, fillPct]);

  const stackStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: ((100 - fillPct.value) / 100) * height }],
  }));

  return (
    <View
      style={[
        { height, width, borderRadius: bare ? radius.md : radius.lg },
        bare
          ? styles.bare
          : {
              backgroundColor: theme.surface,
              borderWidth: 1,
              borderColor: theme.borderSoft,
              overflow: "hidden",
            },
      ]}
    >
      <Animated.View style={[styles.stack, stackStyle]}>
        {layers.map((spec) => (
          <OceanLayer key={spec.gid} spec={spec} clock={clock} />
        ))}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  bare: { backgroundColor: "transparent", overflow: "hidden" },
  stack: { ...StyleSheet.absoluteFillObject },
  layer: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 100,
    overflow: "hidden",
  },
});
