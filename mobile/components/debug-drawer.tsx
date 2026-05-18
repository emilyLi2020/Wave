// DebugDrawer — the old dev menu, now a right-edge swipe-in panel.
//
// The app's landing page is the oceanic Home screen; this developer
// surface (runtime smoke tests, session-screen jumps, ported pages,
// cache panel) is preserved verbatim but tucked behind a swipe from the
// right edge. Pure navigation/dev tooling — no product logic.

import { ReactNode, useEffect, useState } from "react";
import { Link } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import CachePanel from "@/screens/CachePanel";
import { scheduleLockScreenPing } from "@/notifications/lock-screen-ping";
import { WaveColors, WaveType } from "@/constants/wave-theme";

interface Entry {
  href: string;
  title: string;
  blurb: string;
  status: "ready" | "wip" | "stub";
}

const TEST_ENTRIES: Entry[] = [
  { href: "/tests/litert", title: "LiteRT smoke (fine-tune)", blurb: "Loads our WAVE fine-tune bundle. Blocked on the wrapper-rebuild path (issue #13). Has the stock-Gemma sanity-check button.", status: "wip" },
  { href: "/tests/litert-stock", title: "LiteRT (stock Gemma 4)", blurb: "Prize demo: stock Gemma 4 E2B on the vendored GPU LiteRT-LM wrapper (~50 tok/s on device) running three real WAVE surfaces — phase narration, a 3-turn check-in that fires the endConversation tool call, and reflection.", status: "ready" },
  { href: "/tests/litert-sweep", title: "LiteRT context sweep (Wave#15 Phase 0)", blurb: "Sweeps engineMaxTokens × outputMaxTokens × backend × prompt-variant × WAVE surface on the stock bundle. Measures the real envelope (tokens, JSON validity, RAM, hangs).", status: "wip" },
  { href: "/tests/whisper", title: "Whisper STT", blurb: "Record audio with mic → whisper.rn (CoreML encoder) → transcript.", status: "ready" },
  { href: "/tests/kokoro", title: "Kokoro TTS", blurb: "Type/select text → react-native-sherpa-onnx Kokoro → audio playback.", status: "ready" },
  { href: "/tests/vad", title: "Silero VAD", blurb: "Live mic via sherpa-onnx + onnxruntime-react-native Silero v5. Indicator turns green when speech is detected.", status: "wip" },
  { href: "/tests/combined", title: "Combined voice loop", blurb: "Push-to-talk: record → Whisper → LiteRT → Kokoro → play. VAD + barge-in pending.", status: "wip" },
];

const SESSION_ENTRIES: Entry[] = [
  { href: "/session/intake", title: "Intake", blurb: "Patient profile + intake intensity.", status: "stub" },
  { href: "/session/safety", title: "Safety", blurb: "Rule-based safety screen.", status: "stub" },
  { href: "/session/chunk", title: "Chunk", blurb: "Generated meditation chunk playback.", status: "stub" },
  { href: "/session/checkin", title: "Check-in", blurb: "Multi-turn voice check-in.", status: "stub" },
  { href: "/session/reflection", title: "Reflection", blurb: "Post-session card + next-step chips.", status: "stub" },
];

const NON_SESSION_ENTRIES: Entry[] = [
  { href: "/onboarding", title: "Onboarding", blurb: "Name, MAT type, dose time, consent. Hands off to /session/intake.", status: "ready" },
  { href: "/dashboard", title: "Dashboard", blurb: "Stats, 7×6 risk heatmap, this-week summary. Backed by mock-sessions.", status: "ready" },
  { href: "/history", title: "History", blurb: "Recent sessions with outcome chips. Export-PDF button is a stub.", status: "ready" },
  { href: "/insights", title: "Insights", blurb: "Static cards + regenerate via on-device Gemma (LiteRT-backed).", status: "wip" },
];

function StatusBadge({ status }: { status: Entry["status"] }) {
  const colors: Record<Entry["status"], string> = {
    ready: "#34D399",
    wip: WaveColors.warn,
    stub: WaveColors.inkFaint,
  };
  return (
    <View style={[styles.badge, { borderColor: colors[status] }]}>
      <Text style={[styles.badgeText, { color: colors[status] }]}>{status}</Text>
    </View>
  );
}

function Row({ entry, onNavigate }: { entry: Entry; onNavigate: () => void }) {
  return (
    <Link href={entry.href as never} asChild onPress={onNavigate}>
      <Pressable style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
        <View style={styles.rowHead}>
          <Text style={styles.rowTitle}>{entry.title}</Text>
          <StatusBadge status={entry.status} />
        </View>
        <Text style={styles.rowBlurb}>{entry.blurb}</Text>
      </Pressable>
    </Link>
  );
}

function Section({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <>
      <Text style={styles.section}>{title}</Text>
      <Text style={styles.sectionSub}>{sub}</Text>
      {children}
    </>
  );
}

const EDGE = 24;

export function DebugDrawer() {
  const { width } = useWindowDimensions();
  const drawerW = Math.min(width * 0.9, 420);
  const [open, setOpen] = useState(false);
  const tx = useSharedValue(drawerW); // drawerW = closed (off right), 0 = open

  useEffect(() => {
    tx.value = withTiming(open ? 0 : drawerW, {
      duration: 280,
      easing: Easing.out(Easing.cubic),
    });
  }, [open, drawerW, tx]);

  const panel = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));
  const backdrop = useAnimatedStyle(() => ({
    opacity: 1 - tx.value / drawerW,
  }));

  // Swipe in from the right edge.
  const edgePan = Gesture.Pan()
    .activeOffsetX(-8)
    .onUpdate((e) => {
      tx.value = Math.max(0, Math.min(drawerW, drawerW + e.translationX));
    })
    .onEnd((e) => {
      const shouldOpen = e.translationX < -drawerW * 0.35 || e.velocityX < -500;
      tx.value = withTiming(shouldOpen ? 0 : drawerW, { duration: 220 });
      runOnJS(setOpen)(shouldOpen);
    });

  // Swipe the open panel back to the right to dismiss.
  const closePan = Gesture.Pan()
    .activeOffsetX(8)
    .onUpdate((e) => {
      tx.value = Math.max(0, Math.min(drawerW, e.translationX));
    })
    .onEnd((e) => {
      const shouldClose = e.translationX > drawerW * 0.35 || e.velocityX > 500;
      tx.value = withTiming(shouldClose ? drawerW : 0, { duration: 220 });
      runOnJS(setOpen)(!shouldClose);
    });

  return (
    <>
      {/* Right-edge catcher (always present, invisible). */}
      <GestureDetector gesture={edgePan}>
        <View style={styles.edge} pointerEvents="box-only" />
      </GestureDetector>

      {/* Backdrop — only interactive while open. */}
      <Animated.View
        style={[styles.backdrop, backdrop]}
        pointerEvents={open ? "auto" : "none"}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
      </Animated.View>

      {/* The panel. */}
      <GestureDetector gesture={closePan}>
        <Animated.View
          style={[styles.panel, { width: drawerW }, panel]}
          pointerEvents={open ? "auto" : "none"}
        >
          <View style={styles.grab} />
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <Text style={styles.drawerTitle}>Debug menu</Text>
            <Text style={styles.sectionSub}>Swipe right to close.</Text>

            <Pressable
              style={({ pressed }) => [styles.action, pressed && styles.rowPressed]}
              onPress={async () => {
                const id = await scheduleLockScreenPing(6);
                setOpen(false);
                if (id) console.log("[wave] lock-screen ping scheduled", id);
                else console.warn("[wave] notification permission not granted");
              }}
            >
              <Text style={styles.actionText}>Send lock-screen ping (6s)</Text>
              <Text style={styles.rowBlurb}>
                Schedules the design&apos;s prophylactic notification. Close the
                drawer and lock the phone to see it.
              </Text>
            </Pressable>

            <Section title="Tests" sub="Isolated runtime smoke checks.">
              {TEST_ENTRIES.map((e) => (
                <Row key={e.href} entry={e} onNavigate={() => setOpen(false)} />
              ))}
            </Section>

            <View style={styles.gap} />
            <Section title="Session flow" sub="Production screen skeletons.">
              {SESSION_ENTRIES.map((e) => (
                <Row key={e.href} entry={e} onNavigate={() => setOpen(false)} />
              ))}
            </Section>

            <View style={styles.gap} />
            <Section title="Non-session pages" sub="Ports of the surfaces around the loop.">
              {NON_SESSION_ENTRIES.map((e) => (
                <Row key={e.href} entry={e} onNavigate={() => setOpen(false)} />
              ))}
            </Section>

            <View style={styles.gap} />
            <CachePanel />
          </ScrollView>
        </Animated.View>
      </GestureDetector>
    </>
  );
}

const styles = StyleSheet.create({
  edge: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 0,
    width: EDGE,
    zIndex: 40,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(2, 6, 13, 0.6)",
    zIndex: 50,
  },
  panel: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 0,
    zIndex: 60,
    backgroundColor: "#040a14",
    borderLeftWidth: 1,
    borderLeftColor: WaveColors.border,
    flexDirection: "row",
  },
  grab: {
    width: 4,
    marginVertical: "auto",
    height: 54,
    borderRadius: 4,
    backgroundColor: WaveColors.border,
    alignSelf: "center",
    marginLeft: 6,
  },
  content: { padding: 16, paddingTop: 64, paddingBottom: 56, gap: 8, flex: 0 },
  drawerTitle: {
    color: WaveColors.ink,
    fontSize: 22,
    fontFamily: WaveType.serif,
    fontStyle: "italic",
  },
  section: { color: WaveColors.ink, fontSize: 16, fontWeight: "700", marginTop: 12 },
  sectionSub: { color: WaveColors.inkFaint, fontSize: 12, marginBottom: 6 },
  gap: { height: 8 },
  action: {
    backgroundColor: WaveColors.chipActive,
    borderWidth: 1,
    borderColor: WaveColors.borderGlow,
    borderRadius: 12,
    borderCurve: "continuous",
    padding: 12,
    marginTop: 10,
    marginBottom: 4,
    gap: 4,
  },
  actionText: { color: WaveColors.waveCrest, fontSize: 14, fontWeight: "600" },
  row: {
    backgroundColor: WaveColors.surface,
    padding: 12,
    borderRadius: 10,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: WaveColors.border,
    marginBottom: 6,
  },
  rowPressed: { backgroundColor: WaveColors.chipActive, borderColor: WaveColors.borderGlow },
  rowHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rowTitle: { color: WaveColors.ink, fontSize: 15, fontWeight: "600" },
  rowBlurb: { color: WaveColors.inkMute, fontSize: 12, marginTop: 4 },
  badge: {
    borderWidth: 1,
    borderRadius: 4,
    borderCurve: "continuous",
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: { fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 },
});
