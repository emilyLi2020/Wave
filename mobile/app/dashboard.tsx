// Dashboard — RN port of client/app/dashboard/page.tsx.
//
// Same demo dataset (mobile/src/data/mock-sessions.ts mirrors
// client/lib/data/mock-sessions.ts), same four stat cards, same 7×6
// risk heatmap, same "this week" summary card. The web version uses
// CSS `color-mix(... var(--accent) Xp%, var(--surface-muted))` for
// heatmap cell shading; here we lerp manually between
// SURFACE_MUTED and ACCENT in linear RGB.

import { Link } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  MOCK_RISK_GRID,
  MOCK_SESSION_STATS,
  MOCK_WEEK_SUMMARY,
  TRIGGER_INLINE_LABEL,
} from "@/data/mock-sessions";

const ACCENT = "#6366F1";
const SURFACE_MUTED = "#1C1C28";

const stats = [
  {
    label: "Sessions surfed",
    value: String(MOCK_SESSION_STATS.sessionsCount),
    hint: "Last 30 days",
  },
  {
    label: "Average intensity drop",
    value: `${MOCK_SESSION_STATS.avgDropPts.toFixed(1)} pts`,
    hint: "Across all sessions",
  },
  {
    label: "Medication-day drop",
    value: `${MOCK_SESSION_STATS.medicationDayDropPts.toFixed(1)} pts`,
    hint: "When dose was on time",
  },
  {
    label: "Non-medication drop",
    value: `${MOCK_SESSION_STATS.nonMedicationDropPts.toFixed(1)} pts`,
    hint: "When dose was missed",
  },
];

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = ["6a", "9a", "12p", "3p", "6p", "9p"];

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function heatmapColor(intensity: number): string {
  // Match the web CSS: cell = mix(accent, surface-muted, intensity*80%).
  const w = Math.max(0, Math.min(1, intensity)) * 0.8;
  const [r1, g1, b1] = hexToRgb(ACCENT);
  const [r2, g2, b2] = hexToRgb(SURFACE_MUTED);
  const r = Math.round(r1 * w + r2 * (1 - w));
  const g = Math.round(g1 * w + g2 * (1 - w));
  const b = Math.round(b1 * w + b2 * (1 - w));
  return `rgb(${r}, ${g}, ${b})`;
}

export default function DashboardScreen() {
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    >
      <Text style={styles.title}>Your recovery, in your own numbers</Text>
      <Text style={styles.subtitle}>
        Everything here is computed on your device from the sessions you&apos;ve
        logged. Adherence becomes something you can see, not something someone
        told you to do.
      </Text>

      <View style={styles.statGrid}>
        {stats.map((stat) => (
          <View key={stat.label} style={styles.statCard}>
            <Text style={styles.statLabel}>{stat.label}</Text>
            <Text style={styles.statValue}>{stat.value}</Text>
            <Text style={styles.statHint}>{stat.hint}</Text>
          </View>
        ))}
      </View>

      <View style={styles.panel}>
        <View style={styles.panelHeader}>
          <Text style={styles.panelTitle}>High-risk windows</Text>
          <Text style={styles.panelTag}>Last 30 days</Text>
        </View>
        <Text style={styles.panelBody}>
          Cells shaded darker show times when your history has the most
          high-intensity cravings. Proactive notifications target these
          windows.
        </Text>

        <View style={styles.heatmap}>
          <View style={styles.heatmapHeaderRow}>
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
                    style={[
                      styles.heatmapCell,
                      { backgroundColor: heatmapColor(intensity) },
                    ]}
                    accessibilityLabel={`${day} ${hour}: relative risk ${Math.round(
                      intensity * 100,
                    )}%`}
                  />
                );
              })}
            </View>
          ))}
        </View>
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>This week</Text>
        <Text style={styles.panelBody}>
          You&apos;ve surfed {MOCK_WEEK_SUMMARY.surfedThisWeek} cravings this
          week with an average starting intensity of{" "}
          {MOCK_WEEK_SUMMARY.avgIntakeIntensityThisWeek.toFixed(1)}. Your most
          common trigger was{" "}
          <Text style={styles.emphasis}>
            {TRIGGER_INLINE_LABEL[MOCK_WEEK_SUMMARY.topTriggerThisWeek]}
          </Text>
          . Your medication adherence this week is{" "}
          <Text style={styles.emphasis}>
            {MOCK_WEEK_SUMMARY.adherenceThisWeek.taken} of{" "}
            {MOCK_WEEK_SUMMARY.adherenceThisWeek.total} days
          </Text>
          .
        </Text>
      </View>

      <View style={styles.footer}>
        <Link href="/session/intake" asChild>
          <Pressable hitSlop={8}>
            <Text style={styles.footerLink}>← Start another session</Text>
          </Pressable>
        </Link>
        <Link href="/history" asChild>
          <Pressable style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>See full history →</Text>
          </Pressable>
        </Link>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#08080C" },
  content: { padding: 16, gap: 16, paddingBottom: 48 },
  title: { color: "#F1F1F4", fontSize: 22, fontWeight: "700" },
  subtitle: { color: "#9CA3AF", fontSize: 13, lineHeight: 19 },
  statGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
  },
  statCard: {
    flexGrow: 1,
    flexBasis: "47%",
    backgroundColor: "#16161F",
    borderRadius: 12,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: "#23232F",
    padding: 12,
  },
  statLabel: {
    color: "#6B7280",
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  statValue: {
    color: "#F1F1F4",
    fontSize: 22,
    fontWeight: "700",
    marginTop: 6,
  },
  statHint: { color: "#6B7280", fontSize: 11, marginTop: 2 },
  panel: {
    backgroundColor: "#16161F",
    borderRadius: 12,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: "#23232F",
    padding: 14,
    gap: 6,
  },
  panelHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  panelTitle: { color: "#F1F1F4", fontSize: 15, fontWeight: "600" },
  panelTag: {
    color: "#6B7280",
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  panelBody: { color: "#9CA3AF", fontSize: 13, lineHeight: 19 },
  emphasis: { color: "#F1F1F4", fontWeight: "600" },
  heatmap: { marginTop: 8, gap: 4 },
  heatmapHeaderRow: { flexDirection: "row", gap: 4 },
  heatmapRow: { flexDirection: "row", gap: 4, alignItems: "center" },
  heatmapRowLabel: {
    color: "#6B7280",
    fontSize: 11,
    width: 32,
  },
  heatmapColLabel: {
    color: "#6B7280",
    fontSize: 11,
    flex: 1,
    textAlign: "center",
  },
  heatmapCell: {
    flex: 1,
    height: 24,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#23232F",
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
    gap: 8,
    flexWrap: "wrap",
  },
  footerLink: { color: "#9CA3AF", fontSize: 13 },
  primaryButton: {
    backgroundColor: ACCENT,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
  },
  primaryButtonText: { color: "#F1F1F4", fontWeight: "600", fontSize: 13 },
});
