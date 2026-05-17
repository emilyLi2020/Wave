// Dev menu — root entry point during the build-up. After step 6 polish, this
// becomes either a "start session" landing screen or gets gated behind a dev
// build flag.

import { Link } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

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
    title: "LiteRT smoke (fine-tune)",
    blurb: "Loads our WAVE fine-tune bundle. Blocked on the wrapper-rebuild path (issue #13). Has the stock-Gemma sanity-check button.",
    status: "wip",
  },
  {
    href: "/tests/litert-stock",
    title: "LiteRT (stock Gemma 4)",
    blurb: "Prize demo: stock Gemma 4 E2B on the vendored GPU LiteRT-LM wrapper (~50 tok/s on device) running three real WAVE surfaces — phase narration, a 3-turn check-in that fires the endConversation tool call, and reflection.",
    status: "ready",
  },
  {
    href: "/tests/litert-stock-custom",
    title: "LiteRT (stock Gemma 4, custom)",
    blurb: "Same 3-surface harness as the prize demo, on the from-source libLiteRTLMEngine v0.11.0 dylib instead of PhoneClaw's CLiteRTLM. Passed the HANDOFF step-4 on-device acceptance — coherent output, tok/s in range of the ~50 baseline, MLDrift GPU cache present. The from-source binary is a proven drop-in.",
    status: "ready",
  },
  {
    href: "/tests/litert-sweep",
    title: "LiteRT context sweep (Wave#15 Phase 0)",
    blurb: "Sweeps engineMaxTokens × outputMaxTokens × backend × prompt-variant × WAVE surface on the stock bundle. Measures the real envelope (tokens, JSON validity, RAM, hangs).",
    status: "wip",
  },
  {
    href: "/tests/whisper",
    title: "Whisper STT",
    blurb: "Record audio with mic → whisper.rn (CoreML encoder) → transcript.",
    status: "ready",
  },
  {
    href: "/tests/kokoro",
    title: "Kokoro TTS",
    blurb: "Type/select text → react-native-sherpa-onnx Kokoro → audio playback.",
    status: "ready",
  },
  {
    href: "/tests/vad",
    title: "Silero VAD",
    blurb: "Live mic via sherpa-onnx + onnxruntime-react-native Silero v5. Indicator turns green when speech is detected.",
    status: "ready",
  },
  {
    href: "/tests/combined",
    title: "Combined voice loop",
    blurb: "Full hands-free loop: Silero VAD endpoints speech → Whisper base STT → Gemma 4 GPU LiteRT → Kokoro TTS → playback, with barge-in. See issue for the staged model-memory plan.",
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

const NON_SESSION_ENTRIES: Entry[] = [
  {
    href: "/onboarding",
    title: "Onboarding",
    blurb: "Name, MAT type, dose time, consent. Hands off to /session/intake.",
    status: "ready",
  },
  {
    href: "/dashboard",
    title: "Dashboard",
    blurb: "Stats, 7×6 risk heatmap, this-week summary. Backed by mock-sessions.",
    status: "ready",
  },
  {
    href: "/history",
    title: "History",
    blurb: "Recent sessions with outcome chips. Export-PDF button is a stub.",
    status: "ready",
  },
  {
    href: "/insights",
    title: "Insights",
    blurb: "Static cards + regenerate via on-device Gemma (LiteRT-backed).",
    status: "wip",
  },
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
      <Pressable
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      >
        <View style={styles.rowHead}>
          <Text style={styles.rowTitle}>{entry.title}</Text>
          <StatusBadge status={entry.status} />
        </View>
        <Text style={styles.rowBlurb}>{entry.blurb}</Text>
      </Pressable>
    </Link>
  );
}

export default function DevMenu() {
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    >
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

      <Text style={[styles.section, { marginTop: 24 }]}>Non-session pages</Text>
      <Text style={styles.sectionSub}>Ports of the web surfaces around the session loop.</Text>
      {NON_SESSION_ENTRIES.map((e) => (
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
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: "#23232F",
    marginBottom: 6,
  },
  rowPressed: { backgroundColor: "#1C1C28", borderColor: "#3F3F50" },
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
    borderCurve: "continuous",
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: { fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 },
});
