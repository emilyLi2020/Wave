// ChunkPlayer — RN port of the design bundle's ChunkPlayer
// (session-screens.jsx). Segments auto-advance; the narration card
// shows the most recent text line; chunk 1 carries the medication-
// aware acknowledgment card. The bare Wave's height reflects the
// craving score only (the chat removed breath-driven height).
//
// Standalone from the dev menu there is no prior check-in score, so
// intensity defaults to 7 (matches the chunk-1 ack copy). Routes to
// /session/checkin. NOTE: the Wave uses react-native-svg — needs a
// fresh EAS dev-client build before this screen renders on device.

import { useEffect, useMemo, useState } from "react";
import { Stack, useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import {
  ScreenScaffold,
  ScreenBody,
  TopBar,
  Eyebrow,
  Pill,
  Card,
  GhostButton,
} from "@/components/ui";
import { Icon } from "@/components/Icon";
import { Wave } from "@/components/Wave";
import { type Theme } from "@/theme";
import { useTheme, useThemeStyles } from "@/theme-context";

type Segment =
  | { type: "text"; content: string }
  | { type: "pause"; sec: number }
  | { type: "breath"; phase: "inhale" | "hold" | "exhale"; sec: number };

interface ChunkDef {
  id: number;
  badge: string;
  title: string;
  ack: string;
  segments: Segment[];
}

// Verbatim from session-screens.jsx CHUNKS[0].
const CHUNK: ChunkDef = {
  id: 1,
  badge: "Chunk 1 of 5 · Settle",
  title: "Notice it. Don't fight it.",
  ack: "Your Suboxone is working right now. What you're feeling at a 7 would be a 9 or 10 without it. Let's work with what's left.",
  segments: [
    { type: "text", content: "You're here. That's already the hardest part." },
    { type: "pause", sec: 3 },
    {
      type: "text",
      content:
        "Notice where the craving lives in your body. Don't fix it. Just notice.",
    },
    { type: "breath", phase: "inhale", sec: 4 },
    { type: "breath", phase: "hold", sec: 2 },
    { type: "breath", phase: "exhale", sec: 6 },
    { type: "text", content: "Cravings rise. They peak. They fall. Like a wave." },
    { type: "pause", sec: 2 },
  ],
};

const INTENSITY = 7; // no prior score when launched standalone
const SPEED_MUL = 0.5; // demo speed

export default function ChunkScreen() {
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemeStyles(makeStyles);
  const [segIdx, setSegIdx] = useState(0);
  const seg = CHUNK.segments[segIdx];

  useEffect(() => {
    if (!seg) return;
    const sec = "sec" in seg ? seg.sec : 4;
    const t = setTimeout(() => {
      setSegIdx((i) => (i + 1 >= CHUNK.segments.length ? i : i + 1));
    }, sec * 1000 * SPEED_MUL);
    return () => clearTimeout(t);
  }, [segIdx, seg]);

  const lastText = useMemo(() => {
    for (let i = segIdx; i >= 0; i--) {
      const s = CHUNK.segments[i];
      if (s.type === "text") return s.content;
    }
    return " ";
  }, [segIdx]);

  const breathLabel =
    seg?.type === "breath"
      ? seg.phase === "inhale"
        ? "Breathe in"
        : seg.phase === "hold"
          ? "Hold"
          : "Breathe out"
      : null;

  const pct = ((segIdx + 1) / CHUNK.segments.length) * 100;

  return (
    <ScreenScaffold>
      <Stack.Screen options={{ headerShown: false }} />
      <TopBar crumb={CHUNK.badge} right={<Pill>Ambient on</Pill>} />
      <ScreenBody style={{ gap: 16 }}>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${pct}%` }]} />
        </View>

        <View style={styles.waveCaption}>
          <Eyebrow accent>
            {breathLabel ?? `Wave height · ${INTENSITY}/10`}
          </Eyebrow>
        </View>
        <Wave intensity={INTENSITY} bare height={130} />

        <Card flush>
          <Eyebrow accent style={{ marginBottom: 6 }}>
            {CHUNK.title}
          </Eyebrow>
          <Text style={styles.narration}>{lastText}</Text>
        </Card>

        <Card flush tone="soft">
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ marginTop: 2 }}>
              <Icon name="pill" color={theme.accent} />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Eyebrow accent>MEDICATION-AWARE ACKNOWLEDGMENT</Eyebrow>
              <Text style={styles.ack}>{CHUNK.ack}</Text>
            </View>
          </View>
        </Card>

        <View style={{ flex: 1 }} />

        <GhostButton
          label="Skip to check-in →"
          onPress={() => router.push("/session/checkin")}
        />
      </ScreenBody>
    </ScreenScaffold>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  progressTrack: {
    height: 3,
    borderRadius: 999,
    backgroundColor: theme.borderSoft,
    overflow: "hidden",
  },
  progressFill: { height: 3, borderRadius: 999, backgroundColor: theme.accent },
  waveCaption: { alignItems: "center" },
  narration: { fontSize: 18, lineHeight: 25, fontWeight: "500", color: theme.fg },
  ack: { fontSize: 14, lineHeight: 20, color: theme.accent },
});
