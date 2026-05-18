// Check-in — task ③ will replace the body with the real conversational
// voice loop (VAD → Whisper → generateCheckIn → Kokoro). For now this is
// a minimal interactive bridge so the reducer loop is fully traversable:
// capture a craving score, dispatch checkInCompleted, and let the reducer
// route to the next chunk or to reflection.

import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { Display, Pill, TopBar, WaveButton, WaveCard, WaveScreen } from "@/components/wave-ui";
import { WaveColors, WaveType } from "@/constants/wave-theme";
import { useSession } from "@/session/session-context";
import type { CheckIn } from "@/types/session";

function Orb() {
  const ring = useSharedValue(0);
  useEffect(() => {
    ring.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.out(Easing.ease) }), -1);
  }, [ring]);
  const r = useAnimatedStyle(() => ({
    transform: [{ scale: 0.9 + ring.value * 1.5 }],
    opacity: 0.85 - ring.value * 0.85,
  }));
  return (
    <View style={styles.orb}>
      <Animated.View style={[styles.ring, r]} />
      <View style={styles.core} />
    </View>
  );
}

export default function CheckInScreenRoute() {
  const router = useRouter();
  const { state, dispatch } = useSession();
  const chunkNo = state.currentChunk;
  const [score, setScore] = useState<number | null>(null);

  function complete() {
    const now = Date.now();
    const checkIn: CheckIn = {
      chunkNumber: chunkNo,
      cravingScore: score ?? state.intake?.intakeIntensity ?? 5,
      turns: [],
      obstacleCategory: null,
      readyToContinue: chunkNo >= state.totalChunks ? null : true,
      startedAt: now,
      endedAt: now,
    };
    const goReflection = chunkNo >= state.totalChunks;
    dispatch({ type: "checkInCompleted", checkIn });
    router.replace(goReflection ? "/session/reflection" : "/session/chunk");
  }

  return (
    <WaveScreen intensity={score ?? 7}>
      <TopBar
        crumb={`Check-in ${chunkNo} of ${state.totalChunks}`}
        trailing={<Pill>Voice · on-device</Pill>}
      />

      <Display size="lg" style={styles.center}>
        Where is it{"\n"}now?
      </Display>

      <WaveCard style={styles.voiceCard}>
        <Orb />
        <Text style={styles.state}>tap your number — voice loop next</Text>
      </WaveCard>

      <View style={styles.scale}>
        {Array.from({ length: 10 }).map((_, i) => {
          const n = i + 1;
          const on = score != null && n <= score;
          return (
            <Text
              key={n}
              onPress={() => setScore(n)}
              style={[styles.tick, on && styles.tickOn]}
            >
              {n}
            </Text>
          );
        })}
      </View>

      <WaveButton
        label={chunkNo >= state.totalChunks ? "to reflection →" : "next phase →"}
        onPress={complete}
        disabled={score == null}
        style={styles.cta}
      />
    </WaveScreen>
  );
}

const styles = StyleSheet.create({
  center: { textAlign: "center", marginTop: 6 },
  voiceCard: { alignItems: "center", gap: 12, marginTop: 8, paddingVertical: 24 },
  orb: { width: 78, height: 78, alignItems: "center", justifyContent: "center" },
  ring: {
    position: "absolute",
    width: 70,
    height: 70,
    borderRadius: 35,
    borderWidth: 1,
    borderColor: WaveColors.waveGlow,
  },
  core: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: WaveColors.waveGlow,
    shadowColor: WaveColors.waveGlow,
    shadowOpacity: 0.9,
    shadowRadius: 18,
  },
  state: {
    fontFamily: WaveType.mono,
    fontSize: 9.5,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: WaveColors.inkFaint,
  },
  scale: { flexDirection: "row", gap: 6, marginTop: 22, justifyContent: "center" },
  tick: {
    flex: 1,
    textAlign: "center",
    paddingVertical: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: WaveColors.border,
    backgroundColor: WaveColors.surface,
    color: WaveColors.inkFaint,
    fontFamily: WaveType.mono,
    fontSize: 11,
    overflow: "hidden",
  },
  tickOn: {
    borderColor: WaveColors.chipActiveBorder,
    backgroundColor: WaveColors.chipActive,
    color: WaveColors.waveCrest,
  },
  cta: { marginTop: 28 },
});
