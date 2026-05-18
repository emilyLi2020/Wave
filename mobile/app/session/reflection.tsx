// Reflection — task ④ will call generateReflection(ReflectionContext)
// for the structured card. For now this closes the loop with a real
// summary computed from the reducer's captured scores, then dispatches
// sessionFinished and returns Home.

import { useRouter } from "expo-router";
import { StyleSheet, Text } from "react-native";

import { Chip, Display, Eyebrow, TopBar, WaveButton, WaveCard, WaveScreen } from "@/components/wave-ui";
import { WaveColors, WaveType } from "@/constants/wave-theme";
import { useSession } from "@/session/session-context";

const NEXT_STEPS = [
  "Glass of water · step outside for two minutes",
  'Text the person you trust most: "today is a hard one"',
  "Eat something small — a piece of fruit or toast",
  "Lie down for 10 minutes with a podcast you trust",
];

export default function ReflectionScreenRoute() {
  const router = useRouter();
  const { state, dispatch, resetSession } = useSession();

  const intake = state.intake?.intakeIntensity ?? null;
  const scores = state.checkIns.map((c) => c.cravingScore);
  const last = scores.length ? scores[scores.length - 1] : intake;
  const drop = intake != null && last != null ? intake - last : 0;

  let summary: string;
  if (drop >= 2) summary = `Your craving fell ${drop} points across the session.`;
  else if (drop === 1) summary = "It dropped one point — and you stayed with it.";
  else if (drop === 0) summary = "You stayed for the whole wave. That counts.";
  else summary = "The wave is still here. You met it.";

  function finish(choice?: string) {
    if (choice) dispatch({ type: "nextStepPicked", choice });
    dispatch({ type: "sessionFinished" });
    resetSession();
    router.replace("/");
  }

  return (
    <WaveScreen intensity={last ?? 4}>
      <TopBar crumb="Closing · reflection" />

      <Eyebrow accent>Your reflection</Eyebrow>
      <Display size="lg">{summary}</Display>

      <WaveCard style={styles.arcCard}>
        <Eyebrow>Intake → end</Eyebrow>
        <Text style={styles.arc}>
          {[intake, ...scores].filter((n) => n != null).join(" · ") || "—"}
        </Text>
      </WaveCard>

      <Eyebrow style={styles.lbl}>Next 10 minutes · pick one</Eyebrow>
      {NEXT_STEPS.map((s) => (
        <Chip key={s} label={s} onPress={() => finish(s)} />
      ))}

      <WaveButton label="done" variant="quiet" onPress={() => finish()} style={styles.done} />
    </WaveScreen>
  );
}

const styles = StyleSheet.create({
  arcCard: { gap: 8, marginTop: 6 },
  arc: {
    fontFamily: WaveType.serif,
    fontStyle: "italic",
    fontSize: 22,
    letterSpacing: 1,
    color: WaveColors.waveCrest,
  },
  lbl: { marginTop: 8 },
  done: { alignSelf: "center", marginTop: 18 },
});
