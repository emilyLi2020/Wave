// Intake — faithful multi-step port of the design's IntakeScreen.
//
//   step 0  drag-the-wave intensity (drag up = stronger; the shared
//           ocean rises live with the value)
//   step 1  MAT type
//   step 2  today's dose status   (skipped when "Not on MAT")
//   step 3  trigger
//
// Submits IntakeAnswers into the session reducer (intakeSubmitted →
// phase "safety"); demoMode carried from the Home toggle.

import { useState } from "react";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";

import { WaveBackground } from "@/components/wave-background";
import { Chip, Display, Eyebrow, Hint, WaveButton } from "@/components/wave-ui";
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

  const [step, setStep] = useState(0);
  const [intensity, setIntensity] = useState<number | null>(null);
  const [matType, setMatType] = useState<IntakeAnswers["matType"] | null>(null);
  const [dose, setDose] = useState<IntakeAnswers["medicationStatus"] | null>(null);
  const [trigger, setTrigger] = useState<IntakeAnswers["trigger"] | null>(null);

  const noMat = matType === "none";
  const total = matType && !noMat ? 4 : 3;
  const visibleStep = noMat && step > 1 ? step - 1 : step;
  const value = intensity ?? 5;

  function back() {
    if (step === 0) router.back();
    else if (step === 3 && noMat) setStep(1);
    else setStep(step - 1);
  }

  function submit(finalTrigger: IntakeAnswers["trigger"]) {
    const answers: IntakeAnswers = {
      intakeIntensity: value,
      matType: matType as IntakeAnswers["matType"],
      medicationStatus: matType === "none" ? "none" : (dose as IntakeAnswers["medicationStatus"]),
      trigger: finalTrigger,
      triggerOther: null,
      demoMode,
    };
    dispatch({ type: "intakeSubmitted", answers });
    router.push("/session/safety");
  }

  // Tap-to-advance: picking an answer moves to the next page directly.
  function pickMat(v: IntakeAnswers["matType"]) {
    setMatType(v);
    setStep(v === "none" ? 3 : 2);
  }
  function pickDose(v: IntakeAnswers["medicationStatus"]) {
    setDose(v);
    setStep(3);
  }
  function pickTrigger(v: IntakeAnswers["trigger"]) {
    setTrigger(v);
    submit(v);
  }

  // ── Drag-the-wave (step 0) ──
  const [zoneH, setZoneH] = useState(1);
  function applyDragY(localY: number) {
    const ratio = 1 - Math.max(0, Math.min(1, localY / zoneH));
    const v = Math.max(1, Math.min(10, Math.round(1 + ratio * 9)));
    setIntensity((prev) => (prev === v ? prev : v));
  }
  const pan = Gesture.Pan()
    .onBegin((e) => runOnJS(applyDragY)(e.y))
    .onUpdate((e) => runOnJS(applyDragY)(e.y));

  return (
    <View style={styles.root}>
      <WaveBackground intensity={value} />

      <View style={styles.topbar}>
        <Pressable onPress={back} hitSlop={10}>
          <Text style={styles.back}>← Back</Text>
        </Pressable>
        <Text style={styles.crumb}>
          Intake · {Math.min(visibleStep + 1, total)} / {total}
          {demoMode ? " · demo" : ""}
        </Text>
        <View style={{ width: 56 }} />
      </View>

      {step === 0 ? (
        <View style={styles.flex}>
          <Display size="lg" style={styles.center}>
            How strong is it,{"\n"}right now?
          </Display>
          <Text style={styles.help}>Drag the wave up or down.</Text>
          <Hint style={styles.center}>
            {intensity != null
              ? "Let go when it feels right."
              : "Up is stronger. There's no wrong answer."}
          </Hint>

          <GestureDetector gesture={pan}>
            <View
              style={styles.dragZone}
              onLayout={(e) => setZoneH(e.nativeEvent.layout.height)}
            >
              <View
                style={[
                  styles.readout,
                  { opacity: intensity != null ? 1 : 0.35 },
                ]}
              >
                <Text style={styles.num}>
                  {value}
                  <Text style={styles.unit}> /10</Text>
                </Text>
                <Text style={styles.rlabel}>
                  {intensity != null ? INTENSITY_LABELS[value] : "drag the wave"}
                </Text>
              </View>
            </View>
          </GestureDetector>

          <WaveButton
            label="continue"
            onPress={() => setStep(1)}
            disabled={intensity == null}
            style={styles.cta}
          />
        </View>
      ) : (
        <View style={styles.body}>
          {step === 1 ? (
            <>
              <Eyebrow accent>Question 2 · MAT</Eyebrow>
              <Display>What medication{"\n"}are you on?</Display>
              <View style={styles.opts}>
                {MAT_OPTIONS.map((o) => (
                  <Chip
                    key={o.value}
                    label={o.label}
                    selected={matType === o.value}
                    onPress={() => pickMat(o.value)}
                  />
                ))}
              </View>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <Eyebrow accent>Question 3 · today&apos;s dose</Eyebrow>
              <Display>Did you take{"\n"}today&apos;s dose?</Display>
              <View style={styles.opts}>
                {DOSE_OPTIONS.map((o) => (
                  <Chip
                    key={o.value}
                    label={o.label}
                    selected={dose === o.value}
                    onPress={() => pickDose(o.value)}
                  />
                ))}
              </View>
            </>
          ) : null}

          {step === 3 ? (
            <>
              <Eyebrow accent>Last question · trigger</Eyebrow>
              <Display>What set{"\n"}this off?</Display>
              <View style={styles.opts}>
                {TRIGGER_OPTIONS.map((o) => (
                  <Chip
                    key={o.value}
                    label={o.label}
                    selected={trigger === o.value}
                    onPress={() => pickTrigger(o.value)}
                  />
                ))}
              </View>
            </>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: WaveColors.bgDeep },
  flex: { flex: 1 },
  topbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 22,
    paddingTop: 60,
    paddingBottom: 6,
  },
  back: {
    fontFamily: WaveType.mono,
    fontSize: 10,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: WaveColors.inkFaint,
  },
  crumb: {
    fontFamily: WaveType.mono,
    fontSize: 10,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: WaveColors.inkFaint,
  },
  center: { textAlign: "center" },
  help: {
    textAlign: "center",
    color: WaveColors.inkSoft,
    fontSize: 14,
    fontFamily: WaveType.sans,
    marginTop: 10,
  },
  dragZone: { flex: 1, alignItems: "center", justifyContent: "flex-end", paddingBottom: 36 },
  readout: { alignItems: "center", gap: 4 },
  num: {
    fontFamily: WaveType.serif,
    fontStyle: "italic",
    fontSize: 84,
    lineHeight: 88,
    letterSpacing: -2,
    color: WaveColors.ink,
  },
  unit: { fontSize: 22, color: WaveColors.inkMute },
  rlabel: {
    fontFamily: WaveType.serif,
    fontStyle: "italic",
    fontSize: 17,
    color: WaveColors.inkSoft,
  },
  body: { flex: 1, paddingHorizontal: 26, paddingTop: 10, gap: 12 },
  opts: { gap: 6, marginTop: 6 },
  grow: { flex: 1, minHeight: 16 },
  cta: { marginBottom: 36, marginTop: 16 },
});
