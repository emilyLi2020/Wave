// History — RN port of client/app/history/page.tsx. Shows the
// recent-sessions slice from mock-sessions and an outcome pill per
// row. Export-PDF button is a stub (matches the web counterpart).
//
// Re-skinned in the dark oceanic system. Data + navigation unchanged.

import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  Display,
  Eyebrow,
  Lede,
  TopBar,
  WaveCard,
  WaveScreen,
} from "@/components/wave-ui";
import { WaveColors, WaveType } from "@/constants/wave-theme";
import { MOCK_RECENT_SESSIONS } from "@/data/mock-sessions";

function outcomeChipStyle(outcome: string) {
  if (outcome === "Surfed") {
    return { bg: "rgba(92, 225, 214, 0.16)", fg: WaveColors.waveCrest };
  }
  if (outcome === "Left early") {
    return { bg: WaveColors.warnSoft, fg: WaveColors.warn };
  }
  return { bg: WaveColors.dangerSoft, fg: WaveColors.danger };
}

function trendFor(drop: number) {
  if (drop > 0) return { lbl: `↓ ${drop}`, color: WaveColors.waveGlow };
  if (drop === 0) return { lbl: "— 0", color: WaveColors.warn };
  return { lbl: `↑ ${-drop}`, color: WaveColors.danger };
}

export default function HistoryScreen() {
  return (
    <WaveScreen>
      <TopBar
        crumb="History"
        trailing={
          <Link href="/dashboard" asChild>
            <Text style={styles.topLink}>Dashboard →</Text>
          </Link>
        }
      />

      <Eyebrow accent>{MOCK_RECENT_SESSIONS.length} sessions</Eyebrow>
      <Display>Every wave{"\n"}you&apos;ve watched.</Display>
      <Lede>
        Each session keeps its adaptive narration, body-scan location, and
        journal entry. Export anything you want to share with your clinician.
      </Lede>

      <Pressable style={styles.exportButton}>
        <Text style={styles.exportButtonText}>Export PDF for clinician</Text>
      </Pressable>

      <View style={styles.list}>
        {MOCK_RECENT_SESSIONS.map((session) => {
          const chip = outcomeChipStyle(session.outcome);
          const drop = session.start - session.end;
          const trend = trendFor(drop);
          return (
            <WaveCard key={session.id} style={styles.row}>
              <View style={styles.rowHead}>
                <View style={styles.flex}>
                  <Text style={styles.rowDate}>{session.date}</Text>
                  <View style={styles.metaLine}>
                    <Text style={styles.metaText}>{session.medication}</Text>
                    <Text style={styles.dotsep}>·</Text>
                    <Text style={styles.metaText}>{session.trigger}</Text>
                  </View>
                </View>
                <View style={styles.trendCol}>
                  <Text style={[styles.trendLbl, { color: trend.color }]}>
                    {trend.lbl}
                  </Text>
                  <Text style={styles.trendRange}>
                    {session.start} → {session.end}
                  </Text>
                </View>
              </View>

              <View style={styles.rowFoot}>
                <View style={[styles.chip, { backgroundColor: chip.bg }]}>
                  <Text style={[styles.chipText, { color: chip.fg }]}>
                    {session.outcome}
                  </Text>
                </View>
                <Text style={styles.rowId}>ID {session.id}</Text>
              </View>
            </WaveCard>
          );
        })}
      </View>

      <View style={styles.footer}>
        <Link href="/" asChild>
          <Text style={styles.footerLink}>← Home</Text>
        </Link>
        <Link href="/dashboard" asChild>
          <Text style={styles.footerLinkAccent}>Continue to dashboard →</Text>
        </Link>
      </View>
    </WaveScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  topLink: {
    fontFamily: WaveType.mono,
    fontSize: 11,
    color: WaveColors.inkMute,
    letterSpacing: 0.4,
  },
  exportButton: {
    alignSelf: "flex-start",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: WaveColors.border,
    backgroundColor: WaveColors.surface,
    paddingVertical: 9,
    paddingHorizontal: 16,
  },
  exportButtonText: {
    color: WaveColors.inkMute,
    fontSize: 11,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    fontFamily: WaveType.mono,
  },
  list: { gap: 10 },
  row: { gap: 10 },
  rowHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  rowDate: {
    color: WaveColors.ink,
    fontSize: 18,
    fontFamily: WaveType.serif,
    fontStyle: "italic",
  },
  metaLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 3,
    flexWrap: "wrap",
  },
  metaText: {
    color: WaveColors.inkFaint,
    fontSize: 9,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    fontFamily: WaveType.mono,
  },
  dotsep: { color: WaveColors.inkGhost, fontSize: 9 },
  trendCol: { alignItems: "flex-end", gap: 2 },
  trendLbl: {
    fontFamily: WaveType.serif,
    fontStyle: "italic",
    fontSize: 22,
    letterSpacing: -0.4,
  },
  trendRange: {
    fontFamily: WaveType.mono,
    fontSize: 9,
    letterSpacing: 1.4,
    color: WaveColors.inkFaint,
  },
  rowFoot: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  chip: { paddingHorizontal: 11, paddingVertical: 4, borderRadius: 999 },
  chipText: {
    fontSize: 9,
    fontFamily: WaveType.mono,
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  rowId: {
    color: WaveColors.inkFaint,
    fontSize: 10,
    fontFamily: WaveType.mono,
    letterSpacing: 0.6,
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
