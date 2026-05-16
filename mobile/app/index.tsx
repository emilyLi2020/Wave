// Dev menu — root entry point during the build-up. After step 6 polish, this
// becomes either a "start session" landing screen or gets gated behind a dev
// build flag.

import { Link } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import CachePanel from "@/screens/CachePanel";

interface Entry {
  href: string;
  title: string;
  blurb: string;
  status: "ready" | "wip" | "stub";
}

const TEST_ENTRIES: Entry[] = [
  {
    href: "/tests/litert",
    title: "LiteRT smoke",
    blurb: "Download model.litertlm, generate chunk 1, validate JSON, measure RSS/TTFT/tok/s.",
    status: "ready",
  },
  {
    href: "/tests/whisper",
    title: "Whisper STT",
    blurb: "Record audio with mic → whisper.rn (CoreML encoder) → transcript.",
    status: "wip",
  },
  {
    href: "/tests/kokoro",
    title: "Kokoro TTS",
    blurb: "Type/select text → react-native-sherpa-onnx Kokoro → audio playback.",
    status: "wip",
  },
  {
    href: "/tests/combined",
    title: "Combined voice loop",
    blurb: "Push-to-talk: record → Whisper → LiteRT → Kokoro → play. VAD + barge-in pending.",
    status: "wip",
  },
];

const SESSION_ENTRIES: Entry[] = [
  { href: "/session/intake", title: "Intake", blurb: "Patient profile + intake intensity.", status: "stub" },
  { href: "/session/safety", title: "Safety", blurb: "Rule-based safety screen.", status: "stub" },
  { href: "/session/chunk", title: "Chunk", blurb: "Generated meditation chunk playback.", status: "stub" },
  { href: "/session/checkin", title: "Check-in", blurb: "Multi-turn voice check-in.", status: "stub" },
  { href: "/session/reflection", title: "Reflection", blurb: "Post-session card + next-step chips.", status: "stub" },
];

function StatusBadge({ status }: { status: Entry["status"] }) {
  const colors: Record<Entry["status"], string> = {
    ready: "#34D399",
    wip: "#FBBF24",
    stub: "#6B7280",
  };
  return (
    <View style={[styles.badge, { borderColor: colors[status] }]}>
      <Text style={[styles.badgeText, { color: colors[status] }]}>{status}</Text>
    </View>
  );
}

function Row({ entry }: { entry: Entry }) {
  return (
    <Link href={entry.href as any} asChild>
      <View style={styles.row}>
        <View style={styles.rowHead}>
          <Text style={styles.rowTitle}>{entry.title}</Text>
          <StatusBadge status={entry.status} />
        </View>
        <Text style={styles.rowBlurb}>{entry.blurb}</Text>
      </View>
    </Link>
  );
}

export default function DevMenu() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.section}>Tests</Text>
      <Text style={styles.sectionSub}>Isolated runtime smoke checks.</Text>
      {TEST_ENTRIES.map((e) => (
        <Row key={e.href} entry={e} />
      ))}

      <Text style={[styles.section, { marginTop: 24 }]}>Session flow</Text>
      <Text style={styles.sectionSub}>Production screen skeletons — not yet wired to LiteRT.</Text>
      {SESSION_ENTRIES.map((e) => (
        <Row key={e.href} entry={e} />
      ))}

      <View style={{ marginTop: 24 }}>
        <CachePanel />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#08080C" },
  content: { padding: 16, gap: 8 },
  section: { color: "#F1F1F4", fontSize: 18, fontWeight: "700", marginTop: 4 },
  sectionSub: { color: "#6B7280", fontSize: 12, marginBottom: 8 },
  row: {
    backgroundColor: "#16161F",
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#23232F",
    marginBottom: 6,
  },
  rowHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rowTitle: { color: "#F1F1F4", fontSize: 15, fontWeight: "600" },
  rowBlurb: { color: "#9CA3AF", fontSize: 12, marginTop: 4 },
  badge: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: { fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 },
});
