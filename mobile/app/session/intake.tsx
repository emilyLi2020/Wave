// Intake — collects IntakeAnswers and submits them into the session
// reducer (intakeSubmitted → phase "safety"). Intensity + MAT type +
// today's dose status + trigger, in the dark oceanic skin. demoMode is
// carried from the Home toggle via the session context.

import { useState } from "react";
import { useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { Chip, Display, Eyebrow, Hint, TopBar, WaveButton, WaveScreen } from "@/components/wave-ui";
import { WaveColors, WaveType } from "@/constants/wave-theme";
import { useSession } from "@/session/session-context";
import type { IntakeAnswers } from "@/session/session-machine";

const INTENSITY_LABELS = ["", "barely there", "faint", "noticing it", "present", "hard to ignore", "pulling", "strong", "loud", "urgent", "all-consuming"];

const MAT_OPTIONS: { label: string; value: IntakeAnswers["matType"] }[] = [
  { label: "Buprenorphine / Suboxone", value: "buprenorphine" },
  { label: "Naltrexone (oral)", value: "naltrexone" },
  { label: "Vivitrol (injection)", value: "vivitrol" },
  { label: "Methadone", value: "methadone" },
  { label: "Not on MAT", value: "none" },
];
const DOSE_OPTIONS: { label: string; value: IntakeAnswers["medicationStatus"] }[] = [
  { label: "Yes, on time", value: "on_time" },
  { label: "Yes, but late", value: "late" },
  { label: "Missed dose", value: "missed" },
];
const TRIGGER_OPTIONS: { label: string; value: IntakeAnswers["trigger"] }[] = [
  { label: "Social situation", value: "social" },
  { label: "Stress · emotions", value: "stress" },
  { label: "Physical sensation", value: "physical" },
  { label: "Don't know · other", value: "unknown_or_other" },
];

export default function IntakeScreen() {
  const router = useRouter();
  const { demoMode, dispatch } = useSession();

  const [intensity, setIntensity] = useState<number | null>(null);
  const [matType, setMatType] = useState<IntakeAnswers["matType"] | null>(null);
  const [dose, setDose] = useState<IntakeAnswers["medicationStatus"] | null>(null);
  const [trigger, setTrigger] = useState<IntakeAnswers["trigger"] | null>(null);

  const noMat = matType === "none";
  const ready =
    intensity != null && matType != null && (noMat || dose != null) && trigger != null;

  function submit() {
    if (!ready) return;
    const answers: IntakeAnswers = {
      intakeIntensity: intensity as number,
      matType: matType as IntakeAnswers["matType"],
      medicationStatus: noMat ? "none" : (dose as IntakeAnswers["medicationStatus"]),
      trigger: trigger as IntakeAnswers["trigger"],
      triggerOther: null,
      demoMode,
    };
    dispatch({ type: "intakeSubmitted", answers });
    router.push("/session/safety");
  }

  const value = intensity ?? 5;

  return (
    <WaveScreen intensity={value}>
      <TopBar crumb={demoMode ? "Intake · demo" : "Intake"} onBack={() => router.back()} />

      <Display size="lg" style={styles.center}>
        How strong is it,{"\n"}right now?
      </Display>
      <Hint style={styles.center}>
        {intensity != null ? INTENSITY_LABELS[value] : "Tap where it feels right."}
      </Hint>
      <View style={styles.scale}>
        {Array.from({ length: 10 }).map((_, i) => {
          const n = i + 1;
          const on = intensity != null && n <= value;
          return (
            <Text
              key={n}
              onPress={() => setIntensity(n)}
              style={[styles.tick, on && styles.tickOn]}
            >
              {n}
            </Text>
          );
        })}
      </View>

      <Eyebrow accent style={styles.q}>
        What medication are you on?
      </Eyebrow>
      <View style={styles.opts}>
        {MAT_OPTIONS.map((o) => (
          <Chip
            key={o.value}
            label={o.label}
            selected={matType === o.value}
            onPress={() => setMatType(o.value)}
          />
        ))}
      </View>

      {!noMat && matType != null ? (
        <>
          <Eyebrow accent style={styles.q}>
            Did you take today&apos;s dose?
          </Eyebrow>
          <View style={styles.opts}>
            {DOSE_OPTIONS.map((o) => (
              <Chip
                key={o.value}
                label={o.label}
                selected={dose === o.value}
                onPress={() => setDose(o.value)}
              />
            ))}
          </View>
        </>
      ) : null}

      <Eyebrow accent style={styles.q}>
        What set this off?
      </Eyebrow>
      <View style={styles.opts}>
        {TRIGGER_OPTIONS.map((o) => (
          <Chip
            key={o.value}
            label={o.label}
            selected={trigger === o.value}
            onPress={() => setTrigger(o.value)}
          />
        ))}
      </View>

      <WaveButton
        label="continue"
        onPress={submit}
        disabled={!ready}
        style={styles.cta}
      />
    </WaveScreen>
  );
}

const styles = StyleSheet.create({
  center: { textAlign: "center" },
  scale: { flexDirection: "row", gap: 6, marginTop: 14, justifyContent: "center" },
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
  q: { marginTop: 22 },
  opts: { gap: 6, marginTop: 8 },
  cta: { marginTop: 28 },
});
