// Safety — rule-based gate. Dispatches safetyResolved into the reducer
// (proceed → phase loadingChunk; handoff → safetyHandoff) then routes
// into the chunk player. Q1 "no" → not used today; any "yes" → used
// today (still proceeds). The crisis card is the handoff affordance.

import { useRouter } from "expo-router";
import { StyleSheet, Text } from "react-native";

import { Chip, Display, Eyebrow, Lede, TopBar, WaveCard, WaveScreen } from "@/components/wave-ui";
import { WaveColors, WaveType } from "@/constants/wave-theme";
import { useSession } from "@/session/session-context";

const ANSWERS: { label: string; used: boolean }[] = [
  { label: "No, not today", used: false },
  { label: "Yes, earlier today", used: true },
  { label: "Yes, within the last hour", used: true },
];

export default function SafetyScreenRoute() {
  const router = useRouter();
  const { dispatch } = useSession();

  function resolve(usedSubstanceToday: boolean) {
    dispatch({
      type: "safetyResolved",
      outcome: { kind: "proceed", usedSubstanceToday },
    });
    router.push("/session/chunk");
  }

  return (
    <WaveScreen>
      <TopBar crumb="Before we start" onBack={() => router.back()} />

      <Eyebrow accent>Safety check</Eyebrow>
      <Display>Have you used today?</Display>
      <Lede>
        We ask so the session knows what to say next. There&apos;s no right
        answer and no judgment.
      </Lede>

      {ANSWERS.map((a) => (
        <Chip key={a.label} label={a.label} onPress={() => resolve(a.used)} />
      ))}

      <WaveCard style={styles.shield}>
        <Eyebrow accent>If you&apos;re in crisis</Eyebrow>
        <Text style={styles.body}>
          Call or text <Text style={styles.b}>988</Text> (Suicide &amp; Crisis
          Lifeline),{"\n"}or call SAMHSA at{" "}
          <Text style={styles.b}>1-800-662-HELP</Text>.{"\n"}WAVE is a support
          tool — not a substitute for a counselor or prescriber.
        </Text>
      </WaveCard>
    </WaveScreen>
  );
}

const styles = StyleSheet.create({
  shield: { marginTop: 16, gap: 8 },
  body: { color: WaveColors.inkSoft, fontSize: 13, lineHeight: 20, fontFamily: WaveType.sans },
  b: { color: WaveColors.waveCrest, fontWeight: "700" },
});
