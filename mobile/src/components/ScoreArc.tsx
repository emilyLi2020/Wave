// ScoreArc — RN port of session-screens.jsx ScoreArc(). A 1–10
// baseline with the per-checkpoint scores connected; gridlines at
// 1/5/10, soft area fill, dots + value labels, axis row beneath.

import { StyleSheet, Text, View } from "react-native";
import Svg, {
  Circle,
  Defs,
  Line,
  LinearGradient,
  Path,
  Stop,
  Text as SvgText,
} from "react-native-svg";
import { type Theme } from "@/theme";
import { useTheme, useThemeStyles } from "@/theme-context";

const W = 320;
const H = 120;
const PADX = 14;
const PADY = 16;

export function ScoreArc({ scores }: { scores: number[] }) {
  const theme = useTheme();
  const styles = useThemeStyles(makeStyles);
  const n = scores.length;
  const x = (i: number) =>
    PADX + (i / Math.max(1, n - 1)) * (W - PADX * 2);
  const y = (s: number) => H - PADY - ((s - 1) / 9) * (H - PADY * 2);

  const dPath = scores
    .map((s, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(s).toFixed(1)}`)
    .join(" ");
  const areaPath = `${dPath} L ${x(n - 1).toFixed(1)} ${H - PADY} L ${x(0).toFixed(
    1,
  )} ${H - PADY} Z`;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.eyebrow}>CRAVING · THIS SESSION</Text>
        <Text style={styles.mono}>
          {scores[0]} → {scores[n - 1]}
        </Text>
      </View>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        <Defs>
          <LinearGradient id="arcgrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={theme.accent} stopOpacity={0.35} />
            <Stop offset="1" stopColor={theme.accent} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        {[1, 5, 10].map((v) => (
          <Line
            key={v}
            x1={PADX}
            x2={W - PADX}
            y1={y(v)}
            y2={y(v)}
            stroke={theme.border}
            strokeDasharray="2 4"
          />
        ))}
        <Path d={areaPath} fill="url(#arcgrad)" />
        <Path
          d={dPath}
          fill="none"
          stroke={theme.accent}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {scores.map((s, i) => (
          <Circle
            key={`c${i}`}
            cx={x(i)}
            cy={y(s)}
            r={4}
            fill={theme.surface}
            stroke={theme.accent}
            strokeWidth={2}
          />
        ))}
        {scores.map((s, i) => (
          <SvgText
            key={`t${i}`}
            x={x(i)}
            y={y(s) - 10}
            textAnchor="middle"
            fontSize={10}
            fill={theme.fgFaint}
          >
            {String(s)}
          </SvgText>
        ))}
      </Svg>
      <View style={styles.axis}>
        {["Intake", "Chunk 1", "2", "3", "4", "End"].map((l, i) => (
          <Text key={i} style={styles.axisText}>
            {l}
          </Text>
        ))}
      </View>
    </View>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  card: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 24,
    borderCurve: "continuous",
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 18,
  },
  head: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  eyebrow: { fontSize: 10.5, letterSpacing: 1.9, color: theme.fgFaint },
  mono: { fontSize: 11, color: theme.fgFaint, letterSpacing: 0.6 },
  axis: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
  axisText: { fontSize: 10, letterSpacing: 1.2, color: theme.fgFaint },
});
