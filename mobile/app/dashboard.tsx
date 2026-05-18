// Dashboard — RN port of client/app/dashboard/page.tsx.
//
// Same demo dataset (mobile/src/data/mock-sessions.ts), same four stat
// cards, same 7×6 risk heatmap, same "this week" summary card. Only the
// presentation changed: dark oceanic skin, teal heatmap shading. The
// mock-data wiring and navigation links are untouched.

import { Link } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import {
  Display,
  Eyebrow,
  Lede,
  TopBar,
  WaveCard,
  WaveScreen,
} from "@/components/wave-ui";
import { WaveColors, WaveType } from "@/constants/wave-theme";
import {
  MOCK_RISK_GRID,
  MOCK_SESSION_STATS,
  MOCK_WEEK_SUMMARY,
  TRIGGER_INLINE_LABEL,
} from "@/data/mock-sessions";

// Heatmap shading endpoints (teal accent → deep surface).
const HEAT_HI = "#5ce1d6";
const HEAT_LO = "#0a1c2c";

const stats = [
  { label: "Sessions surfed", value: String(MOCK_SESSION_STATS.sessionsCount), hint: "Last 30 days" },
  { label: "Avg intensity drop", value: `${MOCK_SESSION_STATS.avgDropPts.toFixed(1)} pts`, hint: "All sessions" },
  { label: "Medication-day drop", value: `${MOCK_SESSION_STATS.medicationDayDropPts.toFixed(1)} pts`, hint: "Dose on time" },
  { label: "Non-medication drop", value: `${MOCK_SESSION_STATS.nonMedicationDropPts.toFixed(1)} pts`, hint: "Dose missed" },
];

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = ["6a", "9a", "12p", "3p", "6p", "9p"];

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function heatmapColor(intensity: number): string {
  const w = Math.max(0, Math.min(1, intensity)) * 0.85;
  const [r1, g1, b1] = hexToRgb(HEAT_HI);
  const [r2, g2, b2] = hexToRgb(HEAT_LO);
  const r = Math.round(r1 * w + r2 * (1 - w));
  const g = Math.round(g1 * w + g2 * (1 - w));
  const b = Math.round(b1 * w + b2 * (1 - w));
  return `rgb(${r}, ${g}, ${b})`;
}

export default function DashboardScreen() {
  return (
    <WaveScreen>
      <TopBar
        crumb="Dashboard"
        trailing={
          <Link href="/history" asChild>
            <Text style={styles.topLink}>History →</Text>
          </Link>
        }
      />

      <Eyebrow accent>Your last 30 days</Eyebrow>
      <Display>Adherence becomes{"\n"}something you can see.</Display>
      <Lede>
        Everything here is computed on your device from the sessions you&apos;ve
        logged — not something someone told you to do.
      </Lede>

      <View style={styles.statGrid}>
        {stats.map((stat) => (
          <WaveCard key={stat.label} style={styles.statCard}>
            <Eyebrow>{stat.label}</Eyebrow>
            <Text style={styles.statValue}>{stat.value}</Text>
            <Text style={styles.statHint}>{stat.hint}</Text>
          </WaveCard>
        ))}
      </View>

      <WaveCard>
        <View style={styles.cardHead}>
          <Eyebrow>High-risk windows</Eyebrow>
          <Eyebrow>Last 30 days</Eyebrow>
        </View>
        <Text style={styles.cardBody}>
          Brighter cells mark the times your history clusters the most
          high-intensity cravings. Proactive pings target these windows.
        </Text>

        <View style={styles.heatmap}>
          <View style={styles.heatmapRow}>
            <View style={styles.heatmapRowLabel} />
            {HOURS.map((hour) => (
              <Text key={hour} style={styles.heatmapColLabel}>
                {hour}
              </Text>
            ))}
          </View>
          {WEEKDAYS.map((day, dayIndex) => (
            <View key={day} style={styles.heatmapRow}>
              <Text style={styles.heatmapRowLabel}>{day}</Text>
              {HOURS.map((hour, hourIndex) => {
                const intensity = MOCK_RISK_GRID[dayIndex]?.[hourIndex] ?? 0;
                return (
                  <View
                    key={hour}
                    style={[styles.heatmapCell, { backgroundColor: heatmapColor(intensity) }]}
                    accessibilityLabel={`${day} ${hour}: relative risk ${Math.round(intensity * 100)}%`}
                  />
                );
              })}
            </View>
          ))}
        </View>
      </WaveCard>

      <WaveCard accent>
        <Eyebrow accent>Pattern WAVE noticed</Eyebrow>
        <Text style={styles.cardBody}>
          You&apos;ve surfed {MOCK_WEEK_SUMMARY.surfedThisWeek} cravings this
          week with an average starting intensity of{" "}
          {MOCK_WEEK_SUMMARY.avgIntakeIntensityThisWeek.toFixed(1)}. Your most
          common trigger was{" "}
          <Text style={styles.emphasis}>
            {TRIGGER_INLINE_LABEL[MOCK_WEEK_SUMMARY.topTriggerThisWeek]}
          </Text>
          . Medication adherence this week is{" "}
          <Text style={styles.emphasis}>
            {MOCK_WEEK_SUMMARY.adherenceThisWeek.taken} of{" "}
            {MOCK_WEEK_SUMMARY.adherenceThisWeek.total} days
          </Text>
          .
        </Text>
      </WaveCard>

      <View style={styles.footer}>
        <Link href="/history" asChild>
          <Text style={styles.footerLink}>← Back to history</Text>
        </Link>
        <Link href="/" asChild>
          <Text style={styles.footerLinkAccent}>Done →</Text>
        </Link>
      </View>
    </WaveScreen>
  );
}

const styles = StyleSheet.create({
  topLink: {
    fontFamily: WaveType.mono,
    fontSize: 11,
    color: WaveColors.inkMute,
    letterSpacing: 0.4,
  },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  statCard: { flexGrow: 1, flexBasis: "47%", gap: 6 },
  statValue: {
    fontFamily: WaveType.serif,
    fontStyle: "italic",
    fontSize: 30,
    letterSpacing: -0.6,
    color: WaveColors.waveCrest,
    marginTop: 2,
  },
  statHint: { color: WaveColors.inkFaint, fontSize: 11, fontFamily: WaveType.sans },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardBody: {
    color: WaveColors.inkMute,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: WaveType.sans,
  },
  emphasis: { color: WaveColors.waveCrest, fontWeight: "600" },
  heatmap: { marginTop: 10, gap: 4 },
  heatmapRow: { flexDirection: "row", gap: 4, alignItems: "center" },
  heatmapRowLabel: {
    color: WaveColors.inkFaint,
    fontSize: 10,
    width: 30,
    fontFamily: WaveType.mono,
  },
  heatmapColLabel: {
    color: WaveColors.inkFaint,
    fontSize: 10,
    flex: 1,
    textAlign: "center",
    fontFamily: WaveType.mono,
  },
  heatmapCell: {
    flex: 1,
    height: 24,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: WaveColors.borderSoft,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 10,
    gap: 8,
    flexWrap: "wrap",
  },
  footerLink: {
    color: WaveColors.inkFaint,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    fontFamily: WaveType.mono,
  },
  footerLinkAccent: {
    color: WaveColors.waveGlow,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    fontFamily: WaveType.mono,
  },
});
