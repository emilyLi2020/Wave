// voice.tsx — VoiceCard (status-driven bar visualizer) + MicButton,
// ported from session-screens.jsx VoiceCard / MicButton. The web
// version drove bar heights with rAF off `status`; here a single
// Reanimated frame loop drives a shared clock and each bar's height
// is computed in a worklet from the same status→pattern switch.

import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Path, Rect } from "react-native-svg";
import { type Theme } from "@/theme";
import { useThemeStyles } from "@/theme-context";

export type VoiceStatus =
  | "idle"
  | "warming"
  | "speaking"
  | "listening"
  | "recording"
  | "transcribing"
  | "thinking"
  | "done";

export const STATUS_COPY: Record<VoiceStatus, string> = {
  idle: "Tap to start",
  warming: "Warming up the voice…",
  speaking: "Wave is speaking",
  listening: "Listening",
  recording: "You're speaking",
  transcribing: "Transcribing…",
  thinking: "Thinking…",
  done: "Done",
};

// status encoded as a number so the bar worklet can switch on it.
const S = {
  idle: 0,
  warming: 1,
  speaking: 2,
  listening: 3,
  recording: 4,
  transcribing: 5,
  thinking: 6,
  done: 7,
} as const;

const N_BARS = 17;

function Bar({
  i,
  clock,
  status,
}: {
  i: number;
  clock: SharedValue<number>;
  status: SharedValue<number>;
}) {
  const styles = useThemeStyles(makeStyles);
  const seed = i * 0.61 + Math.sin(i * 1.7) * 0.4;
  const c = (N_BARS - 1) / 2;
  const d = Math.abs(i - c) / c;
  const env = Math.pow(1 - d, 0.55);

  const aStyle = useAnimatedStyle(() => {
    const t = clock.value;
    const st = status.value;
    let h: number;
    if (st === S.recording) {
      const a = Math.sin(t * 3.4 + seed * 1.1);
      const b = Math.cos(t * 1.7 - seed * 0.7);
      h = 0.18 + 0.78 * env * Math.abs(a * 0.7 + b * 0.4);
    } else if (st === S.speaking) {
      const a = Math.sin(t * 2.3 + seed);
      const b = Math.sin(t * 0.9 + seed * 0.5);
      h = 0.16 + 0.58 * env * Math.abs(a * 0.7 + b * 0.35);
    } else if (st === S.listening) {
      h = 0.1 + 0.06 * env * (1 + Math.sin(t * 1.8 + seed));
    } else if (st === S.thinking) {
      h = 0.12 + 0.18 * env * (0.5 + 0.5 * Math.sin(t * 2.2 - i * 0.55));
    } else if (st === S.transcribing) {
      h = 0.1 + 0.14 * env * (0.5 + 0.5 * Math.sin(t * 3.4 - i * 0.7));
    } else if (st === S.warming) {
      h = 0.1 + 0.05 * env;
    } else if (st === S.done) {
      h = 0.07 * env + 0.04;
    } else {
      h = 0.06 * env + 0.03;
    }
    return { height: `${Math.max(8, Math.min(100, h * 100))}%` };
  });

  return <Animated.View style={[styles.vbar, aStyle]} />;
}

export function VoiceCard({
  status,
  live,
}: {
  status: VoiceStatus;
  live: boolean;
}) {
  const styles = useThemeStyles(makeStyles);
  const clock = useSharedValue(0);
  const statusSV = useSharedValue<number>(S[status]);
  const frame = useFrameCallback((info) => {
    "worklet";
    clock.value = info.timeSinceFirstFrame / 1000;
  }, false);

  useEffect(() => {
    frame.setActive(true);
    return () => frame.setActive(false);
  }, [frame]);

  useEffect(() => {
    statusSV.value = S[status];
  }, [status, statusSV]);

  return (
    <View
      style={[
        styles.voiceCard,
        live && styles.voiceCardLive,
        status === "recording" && styles.voiceCardRecording,
      ]}
    >
      <View style={styles.voiceViz}>
        {Array.from({ length: N_BARS }, (_, i) => (
          <Bar key={i} i={i} clock={clock} status={statusSV} />
        ))}
      </View>
      <View style={styles.voiceStatus}>
        <View
          style={[
            styles.voiceDot,
            status !== "idle" && status !== "done" && styles.voiceDotActive,
          ]}
        />
        <Text style={styles.voiceStatusText}>{STATUS_COPY[status]}</Text>
      </View>
    </View>
  );
}

function MicGlyph() {
  return (
    <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
      <Rect x={9} y={3} width={6} height={12} rx={3} fill="#fff" />
      <Path
        d="M5 11a7 7 0 0 0 14 0"
        stroke="#fff"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <Path d="M12 18v3" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" />
      <Path d="M9 21h6" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

function StopGlyph() {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24">
      <Rect x={6} y={6} width={12} height={12} rx={2.5} fill="#fff" />
    </Svg>
  );
}

export function MicButton({
  handsFree,
  status,
  onToggle,
}: {
  handsFree: boolean;
  status: VoiceStatus;
  onToggle: () => void;
}) {
  const styles = useThemeStyles(makeStyles);
  const isLive = handsFree && status !== "idle" && status !== "done";
  const label = handsFree ? "Stop check-in" : "Start check-in";

  return (
    <View style={styles.micWrap}>
      <Pressable
        onPress={onToggle}
        style={({ pressed }) => [
          styles.micBtn,
          handsFree && styles.micBtnOn,
          pressed && { transform: [{ scale: 0.94 }] },
        ]}
      >
        {handsFree ? <StopGlyph /> : <MicGlyph />}
      </Pressable>
      <Text style={styles.micLabel}>{label}</Text>
      <Text style={styles.micHint}>
        {isLive
          ? "Speak naturally — pauses are fine. Tap to end."
          : "Whisper · wllama · Kokoro · all on-device"}
      </Text>
    </View>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  voiceCard: {
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 22,
    borderCurve: "continuous",
    overflow: "hidden",
  },
  voiceCardLive: { borderColor: theme.accent },
  voiceCardRecording: {
    borderColor: theme.accent,
    shadowColor: theme.accent,
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 3,
  },
  voiceViz: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    height: 56,
    width: "100%",
  },
  vbar: {
    width: 4,
    minHeight: 8,
    borderRadius: 999,
    backgroundColor: theme.accent,
  },
  voiceStatus: { flexDirection: "row", alignItems: "center", gap: 8 },
  voiceDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: theme.fgFaint,
  },
  voiceDotActive: { backgroundColor: theme.accent },
  voiceStatusText: { fontSize: 12.5, fontWeight: "500", color: theme.fgSoft },

  micWrap: { alignItems: "center", gap: 6, paddingTop: 6 },
  micBtn: {
    width: 76,
    height: 76,
    borderRadius: 999,
    backgroundColor: theme.accent,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: theme.accent,
    shadowOpacity: 0.35,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  micBtnOn: { backgroundColor: theme.danger },
  micLabel: {
    marginTop: 2,
    fontSize: 13,
    fontWeight: "600",
    color: theme.fg,
  },
  micHint: {
    fontSize: 11,
    lineHeight: 15,
    textAlign: "center",
    color: theme.fgFaint,
    maxWidth: 260,
  },
});
