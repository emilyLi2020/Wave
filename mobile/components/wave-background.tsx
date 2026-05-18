/**
 * WaveBackground — the single shared ocean behind every screen.
 *
 * A faithful Skia port of the Claude Design prototype's canvas draw loop
 * (project/wave.jsx): three drifting sine layers (far / mid / front), a
 * crest glow on the front layer, rising atmospheric particles, and a
 * deep-water vertical gradient. `intensity` (1–10) scales the swell
 * amplitude exactly like the prototype's `WaveAPI.setScore`.
 *
 * Purely decorative — no props change app behaviour.
 */

import { useEffect, useMemo } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import {
  BlurMask,
  Canvas,
  Circle,
  Group,
  LinearGradient,
  Path,
  Rect,
  Skia,
  useClock,
  vec,
} from "@shopify/react-native-skia";
import {
  Easing,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { WaveColors } from "@/constants/wave-theme";

const HORIZON = 0.68; // mean sea level as a fraction of screen height

type LayerSpec = {
  ampMul: number;
  freq: number;
  speed: number;
  phase: number;
  horizonShift: number;
  color: string;
};

const LAYERS: LayerSpec[] = [
  // far — slow distant swell
  { ampMul: 0.55, freq: 0.0034, speed: 0.018, phase: 0, horizonShift: 0, color: "rgba(12, 60, 80, 0.55)" },
  // mid
  { ampMul: 0.78, freq: 0.0046, speed: 0.028, phase: 1.3, horizonShift: 6, color: "rgba(20, 110, 130, 0.66)" },
  // front — gets the crest glow
  { ampMul: 1.0, freq: 0.0058, speed: 0.042, phase: 3.1, horizonShift: 14, color: "rgba(92, 225, 214, 0.45)" },
];

function Particle({
  i,
  W,
  H,
  clock,
}: {
  i: number;
  W: number;
  H: number;
  clock: { value: number };
}) {
  const seed = useMemo(() => {
    const r = (n: number) => Math.abs(Math.sin(i * 12.9898 + n) * 43758.5453) % 1;
    return {
      x: r(1) * W,
      size: 0.4 + r(2) * 1.1,
      dur: 14000 + r(3) * 9000,
      off: r(4),
      a: 0.05 + r(5) * 0.2,
    };
  }, [i, W]);

  const cy = useDerivedValue(() => {
    const prog = ((clock.value / seed.dur + seed.off) % 1 + 1) % 1;
    return H - prog * (H + 40);
  });
  const opacity = useDerivedValue(() => {
    const prog = ((clock.value / seed.dur + seed.off) % 1 + 1) % 1;
    return seed.a * (1 - Math.abs(prog - 0.5) * 2);
  });

  return (
    <Circle cx={seed.x} cy={cy} r={seed.size} color={WaveColors.waveCrest} opacity={opacity} />
  );
}

export function WaveBackground({ intensity = 4 }: { intensity?: number }) {
  const { width: W, height: H } = useWindowDimensions();
  const clock = useClock();

  // Smooth amplitude toward the score target (prototype eased toward it).
  const ampFrac = useSharedValue(scoreToAmpFracJS(intensity));
  useEffect(() => {
    ampFrac.value = withTiming(scoreToAmpFracJS(intensity), {
      duration: 900,
      easing: Easing.out(Easing.cubic),
    });
  }, [intensity, ampFrac]);

  const maxRise = H * 0.5;

  const fillPath = (spec: LayerSpec, t: number, frac: number) => {
    "worklet";
    const amp = frac * maxRise * spec.ampMul;
    const horizonY = H * HORIZON + spec.horizonShift;
    const p = Skia.Path.Make();
    p.moveTo(0, H);
    for (let x = 0; x <= W; x += 3) {
      const y = horizonY - amp * Math.sin(x * spec.freq - t * (spec.speed / 1000) + spec.phase);
      p.lineTo(x, y);
    }
    p.lineTo(W, H);
    p.close();
    return p;
  };

  const farPath = useDerivedValue(() => fillPath(LAYERS[0], clock.value, ampFrac.value));
  const midPath = useDerivedValue(() => fillPath(LAYERS[1], clock.value, ampFrac.value));
  const frontPath = useDerivedValue(() => fillPath(LAYERS[2], clock.value, ampFrac.value));

  // Crest stroke path (front layer top edge only) for the glow.
  const crestPath = useDerivedValue(() => {
    const t = clock.value;
    const spec = LAYERS[2];
    const amp = ampFrac.value * maxRise * spec.ampMul;
    const horizonY = H * HORIZON + spec.horizonShift;
    const p = Skia.Path.Make();
    for (let x = 0; x <= W; x += 3) {
      const y = horizonY - amp * Math.sin(x * spec.freq - t * (spec.speed / 1000) + spec.phase);
      if (x === 0) p.moveTo(x, y);
      else p.lineTo(x, y);
    }
    return p;
  });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Canvas style={StyleSheet.absoluteFill}>
        {/* deep-water gradient */}
        <Rect x={0} y={0} width={W} height={H}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(0, H)}
            colors={["#02060d", "#040a14", "#020509"]}
            positions={[0, 0.55, 1]}
          />
        </Rect>

        {Array.from({ length: 26 }).map((_, i) => (
          <Particle key={`p-${i}`} i={i} W={W} H={H} clock={clock} />
        ))}

        <Path path={farPath} color={LAYERS[0].color} />
        <Path path={midPath} color={LAYERS[1].color} />
        <Path path={frontPath} color={LAYERS[2].color} />

        {/* crest glow */}
        <Group>
          <BlurMask blur={7} style="solid" />
          <Path
            path={crestPath}
            style="stroke"
            strokeWidth={1.4}
            color="rgba(184, 255, 242, 0.55)"
          />
        </Group>

        {/* top fade so content stays readable */}
        <Rect x={0} y={0} width={W} height={H}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(0, H)}
            colors={[
              "rgba(2, 6, 13, 0.78)",
              "rgba(2, 6, 13, 0)",
              "rgba(2, 6, 13, 0)",
              "rgba(2, 6, 13, 0.30)",
            ]}
            positions={[0, 0.34, 0.7, 1]}
          />
        </Rect>
      </Canvas>
    </View>
  );
}

// JS-thread mirror of scoreToAmpFrac (used to seed the shared value).
function scoreToAmpFracJS(score: number) {
  const s = Math.max(1, Math.min(10, score));
  return 0.12 + (s / 10) * 0.7;
}
