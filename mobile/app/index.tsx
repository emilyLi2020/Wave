// Home — the app's landing page (oceanic design).
//
// "Something's rising. Let's watch it." → start session enters the demo
// flow at /session/intake. The old developer menu now lives in a
// right-edge swipe-in panel (components/debug-drawer.tsx); swipe from the
// right edge to reach the runtime tests / screen jumps / cache panel.

import { Link, useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { WaveBackground } from "@/components/wave-background";
import { DebugDrawer } from "@/components/debug-drawer";
import { WaveButton } from "@/components/wave-ui";
import { WaveColors, WaveType } from "@/constants/wave-theme";
import { useSession } from "@/session/session-context";

function IconBtn({ href, label }: { href: string; label: string }) {
  // Two tiny inline glyphs (history / dashboard) — bordered pills so we
  // don't pull in an icon font just for these.
  return (
    <Link href={href as never} asChild>
      <View accessibilityRole="button" accessibilityLabel={label} style={styles.iconBtn}>
        <Text style={styles.iconGlyph}>{label === "History" ? "↺" : "◔"}</Text>
      </View>
    </Link>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const { demoMode, setDemoMode, resetSession } = useSession();

  function startSession() {
    resetSession();
    router.push("/session/intake");
  }

  return (
    <View style={styles.root}>
      <WaveBackground intensity={4} />

      <View style={styles.topbar}>
        <View style={styles.topbarSide}>
          <IconBtn href="/history" label="History" />
          <IconBtn href="/dashboard" label="Dashboard" />
        </View>
        <Text style={styles.mark}>WAVE</Text>
        <View style={styles.topbarSide} />
      </View>

      <View style={styles.body}>
        <View style={styles.grow} />

        <Text style={styles.headline}>Something&apos;s rising.{"\n"}Let&apos;s watch it.</Text>
        <Text style={styles.sub}>
          A wave you don&apos;t have to fight. Just watch it crest and pass.
        </Text>

        <View style={styles.grow} />

        <WaveButton label="start session" onPress={startSession} style={styles.cta} />

        <View style={styles.demoRow}>
          {(
            [
              ["Full", false, "5 chunks"],
              ["Demo", true, "2 chunks"],
            ] as const
          ).map(([label, value, hint]) => {
            const active = demoMode === value;
            return (
              <Pressable
                key={label}
                onPress={() => setDemoMode(value)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[styles.demoChip, active && styles.demoChipActive]}
              >
                <Text style={[styles.demoChipText, active && styles.demoChipTextActive]}>
                  {label}
                </Text>
                <Text style={styles.demoChipHint}>{hint}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.crisis}>
          In crisis? Call or text 988{"\n"}SAMHSA 1-800-662-HELP
        </Text>
      </View>

      <DebugDrawer />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: WaveColors.bgDeep },
  topbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 22,
    paddingTop: 64,
    paddingBottom: 6,
    gap: 8,
  },
  topbarSide: { flexDirection: "row", gap: 8, minWidth: 68 },
  iconBtn: {
    width: 30,
    height: 30,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: WaveColors.border,
    backgroundColor: WaveColors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  iconGlyph: { color: WaveColors.inkMute, fontSize: 14, lineHeight: 18 },
  mark: {
    fontFamily: WaveType.serif,
    fontStyle: "italic",
    fontSize: 20,
    color: WaveColors.inkSoft,
  },
  body: { flex: 1, paddingHorizontal: 28, alignItems: "center", paddingBottom: 40 },
  grow: { flex: 1, minHeight: 12 },
  headline: {
    fontFamily: WaveType.serif,
    fontStyle: "italic",
    fontSize: 42,
    lineHeight: 46,
    letterSpacing: -1,
    color: WaveColors.ink,
    textAlign: "center",
  },
  sub: {
    marginTop: 14,
    fontSize: 14,
    lineHeight: 21,
    color: WaveColors.inkMute,
    textAlign: "center",
    fontFamily: WaveType.sans,
  },
  cta: { marginBottom: 16 },
  demoRow: { flexDirection: "row", gap: 8, marginBottom: 20 },
  demoChip: {
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: WaveColors.border,
    backgroundColor: WaveColors.surface,
    alignItems: "center",
    gap: 1,
  },
  demoChipActive: {
    borderColor: WaveColors.chipActiveBorder,
    backgroundColor: WaveColors.chipActive,
  },
  demoChipText: {
    fontFamily: WaveType.mono,
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: WaveColors.inkMute,
  },
  demoChipTextActive: { color: WaveColors.waveCrest },
  demoChipHint: {
    fontFamily: WaveType.mono,
    fontSize: 8.5,
    letterSpacing: 0.6,
    color: WaveColors.inkFaint,
  },
  crisis: {
    fontFamily: WaveType.mono,
    fontSize: 11,
    lineHeight: 18,
    letterSpacing: 1,
    color: WaveColors.inkFaint,
    textAlign: "center",
  },
});
