// History — RN port of client/app/history/page.tsx. Shows the
// recent-sessions slice from mock-sessions and an outcome pill per
// row. Export-PDF button is a stub for now (matches the web
// counterpart, which is also a non-functional placeholder).

import { Link } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { MOCK_RECENT_SESSIONS } from "@/data/mock-sessions";

const ACCENT = "#6366F1";

function outcomeChipStyle(outcome: string) {
  if (outcome === "Surfed") {
    return { bg: "rgba(99, 102, 241, 0.15)", fg: "#A5B4FC" };
  }
  if (outcome === "Left early") {
    return { bg: "rgba(251, 191, 36, 0.15)", fg: "#FBBF24" };
  }
  return { bg: "rgba(248, 113, 113, 0.15)", fg: "#F87171" };
}

export default function HistoryScreen() {
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    >
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Every wave you&apos;ve surfed</Text>
          <Text style={styles.subtitle}>
            Tap a session to see its adaptive narration, body-scan location,
            and journal entry. Export anything you want to share with your
            clinician.
          </Text>
        </View>
      </View>

      <Pressable style={styles.exportButton}>
        <Text style={styles.exportButtonText}>Export PDF for clinician</Text>
      </Pressable>

      <View style={styles.list}>
        {MOCK_RECENT_SESSIONS.map((session) => {
          const chip = outcomeChipStyle(session.outcome);
          const drop = session.start - session.end;
          return (
            <View key={session.id} style={styles.row}>
              <View style={styles.rowHead}>
                <View>
                  <Text style={styles.rowDate}>{session.date}</Text>
                  <Text style={styles.rowId}>ID {session.id}</Text>
                </View>
                <View
                  style={[styles.chip, { backgroundColor: chip.bg }]}
                >
                  <Text style={[styles.chipText, { color: chip.fg }]}>
                    {session.outcome}
                  </Text>
                </View>
              </View>
              <Text style={styles.rowIntensity}>
                <Text style={styles.intensityStart}>{session.start}</Text>
                {" → "}
                <Text style={styles.intensityEnd}>{session.end}</Text>
                <Text style={styles.rowMeta}>{`  · drop of ${drop}`}</Text>
              </Text>
              <Text style={styles.rowMeta}>
                {session.trigger} · {session.medication}
              </Text>
            </View>
          );
        })}
      </View>

      <View style={styles.footer}>
        <Link href="/dashboard" asChild>
          <Pressable hitSlop={8}>
            <Text style={styles.footerLink}>← Back to dashboard</Text>
          </Pressable>
        </Link>
        <Link href="/insights" asChild>
          <Pressable style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>See patterns →</Text>
          </Pressable>
        </Link>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#08080C" },
  content: { padding: 16, gap: 14, paddingBottom: 48 },
  headerRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  title: { color: "#F1F1F4", fontSize: 22, fontWeight: "700" },
  subtitle: { color: "#9CA3AF", fontSize: 13, lineHeight: 19, marginTop: 4 },
  exportButton: {
    alignSelf: "flex-start",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#23232F",
    backgroundColor: "#16161F",
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  exportButtonText: { color: "#F1F1F4", fontSize: 13, fontWeight: "600" },
  list: { gap: 8 },
  row: {
    backgroundColor: "#16161F",
    borderRadius: 12,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: "#23232F",
    padding: 14,
    gap: 6,
  },
  rowHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  rowDate: { color: "#F1F1F4", fontSize: 13, fontWeight: "600" },
  rowId: { color: "#6B7280", fontSize: 11, marginTop: 2 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  chipText: { fontSize: 11, fontWeight: "700" },
  rowIntensity: { color: "#F1F1F4", fontSize: 13 },
  intensityStart: { fontWeight: "700" },
  intensityEnd: { fontWeight: "700", color: ACCENT },
  rowMeta: { color: "#9CA3AF", fontSize: 12 },
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
