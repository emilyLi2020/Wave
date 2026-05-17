// Intake — RN port of the Claude Design bundle's IntakeScreen
// (wave/project/screens.jsx). Four-step carousel: intensity → MAT →
// today's dose (+ how-late sub-prompt) → trigger. Step/skip logic is
// ported verbatim from the design's next()/back(); the design's parent
// owned `intake` state, here it's local and mapped to the reducer's
// IntakeAnswers shape on continue.
//
// Wiring into session-machine.ts is still pending across all session
// screens (see docs/handoff.md outstanding work); for now this routes
// forward to /session/safety like the design's intakeContinue(), with
// the assembled answers ready to dispatch once the reducer is wired.

import { useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import {
  ScreenScaffold,
  ScreenBody,
  TopBar,
  Eyebrow,
  Display,
  Lede,
  Hint,
  Chip,
  PrimaryButton,
  IntensitySlider,
} from "@/components/ui";
import type {
  MatType,
  MedicationStatus,
  TriggerCategory,
} from "@/types/models";
import type { IntakeAnswers } from "@/session/session-machine";

const MAT_OPTIONS: { v: MatType; l: string }[] = [
  { v: "buprenorphine", l: "Buprenorphine / Suboxone" },
  { v: "naltrexone", l: "Naltrexone (oral)" },
  { v: "vivitrol", l: "Vivitrol (injection)" },
  { v: "methadone", l: "Methadone" },
  { v: "none", l: "Not on MAT" },
];
const DOSE_OPTIONS: { v: MedicationStatus; l: string }[] = [
  { v: "on_time", l: "Yes, on time" },
  { v: "late", l: "Yes, but late" },
  { v: "missed", l: "Missed dose" },
];
const DOSE_LATE_OPTIONS = [
  { v: "1-2", l: "1–2 hours late" },
  { v: "3-5", l: "3–5 hours late" },
  { v: "6+", l: "6+ hours late" },
];
const TRIGGER_OPTIONS: { v: TriggerCategory; l: string }[] = [
  { v: "social", l: "Social situation" },
  { v: "stress", l: "Stress · emotions" },
  { v: "physical", l: "Physical sensation" },
  { v: "unknown_or_other", l: "Don't know · other" },
];

interface IntakeState {
  step: number;
  intensity: number | null;
  mat: MatType | null;
  dose: MedicationStatus | null;
  doseLate: string | null;
  trigger: TriggerCategory | null;
}

export default function IntakeScreen() {
  const router = useRouter();
  const [intake, setIntake] = useState<IntakeState>({
    step: 0,
    intensity: null,
    mat: null,
    dose: null,
    doseLate: null,
    trigger: null,
  });
  const answersRef = useRef<IntakeAnswers | null>(null);

  const step = intake.step;
  const setStep = (s: number) => setIntake((p) => ({ ...p, step: s }));

  const total = intake.mat && intake.mat !== "none" ? 4 : 3;
  const visibleStep =
    intake.mat === "none" && step > 1 ? step - 1 : step;

  function next() {
    if (step === 0) {
      if (intake.intensity != null) setStep(1);
      return;
    }
    if (step === 1) {
      if (!intake.mat) return;
      // Not on MAT → there's no dose to ask about; skip step 2.
      setStep(intake.mat === "none" ? 3 : 2);
      return;
    }
    if (step === 2) {
      if (!intake.dose) return;
      if (intake.dose === "late" && !intake.doseLate) return;
      setStep(3);
      return;
    }
    if (step === 3 && intake.trigger) {
      answersRef.current = {
        intakeIntensity: intake.intensity ?? 5,
        matType: intake.mat ?? "none",
        // Not on MAT collapses to medicationStatus "none".
        medicationStatus: intake.mat === "none" ? "none" : intake.dose!,
        trigger: intake.trigger,
        triggerOther: null,
        demoMode: false,
      };
      router.push("/session/safety");
    }
  }

  function back() {
    if (step === 0) router.back();
    else if (step === 3 && intake.mat === "none") setStep(1);
    else setStep(step - 1);
  }

  const continueDisabled =
    (step === 0 && intake.intensity == null) ||
    (step === 1 && !intake.mat) ||
    (step === 2 &&
      (!intake.dose || (intake.dose === "late" && !intake.doseLate))) ||
    (step === 3 && !intake.trigger);

  return (
    <ScreenScaffold>
      <Stack.Screen options={{ headerShown: false }} />
      <TopBar
        crumb={`Intake · ${Math.min(visibleStep + 1, total)} / ${total}`}
        onBack={back}
      />
      <ScreenBody>
        <ScrollView
          contentContainerStyle={{ gap: 16, paddingBottom: 8 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          style={{ flex: 1 }}
        >
          {step === 0 ? (
            <>
              <Eyebrow>QUESTION 1 · INTENSITY</Eyebrow>
              <Display>How intense is this craving right now?</Display>
              <Lede>Drag the wave. No wrong answer.</Lede>
              <View style={{ height: 12 }} />
              <IntensitySlider
                value={intake.intensity ?? 5}
                touched={intake.intensity != null}
                onChange={(n) =>
                  setIntake((p) => ({ ...p, intensity: n }))
                }
                big
              />
            </>
          ) : null}

          {step === 1 ? (
            <>
              <Eyebrow>QUESTION 2 · MAT</Eyebrow>
              <Display>What medication are you on?</Display>
              <Lede>
                This is the thing every other urge-surfing app misses.
              </Lede>
              <View style={{ gap: 8, marginTop: 4 }}>
                {MAT_OPTIONS.map((o) => (
                  <Chip
                    key={o.v}
                    label={o.l}
                    list
                    pressed={intake.mat === o.v}
                    onPress={() =>
                      setIntake((p) => ({ ...p, mat: o.v }))
                    }
                  />
                ))}
              </View>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <Eyebrow>{"QUESTION 3 · TODAY'S DOSE"}</Eyebrow>
              <Display>{"Did you take today's dose?"}</Display>
              <Lede>
                A 7/10 at hour 4 isn&apos;t the same as a 7/10 at hour 22.
              </Lede>
              <View style={{ gap: 8, marginTop: 4 }}>
                {DOSE_OPTIONS.map((o) => (
                  <Chip
                    key={o.v}
                    label={o.l}
                    list
                    pressed={intake.dose === o.v}
                    onPress={() =>
                      setIntake((p) => ({
                        ...p,
                        dose: o.v,
                        doseLate: o.v === "late" ? p.doseLate : null,
                      }))
                    }
                  />
                ))}
              </View>
              {intake.dose === "late" ? (
                <View style={{ marginTop: 6, gap: 8 }}>
                  <Eyebrow>ABOUT HOW LATE?</Eyebrow>
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    {DOSE_LATE_OPTIONS.map((o) => (
                      <View key={o.v} style={{ flex: 1 }}>
                        <Chip
                          label={o.l}
                          small
                          pressed={intake.doseLate === o.v}
                          onPress={() =>
                            setIntake((p) => ({ ...p, doseLate: o.v }))
                          }
                        />
                      </View>
                    ))}
                  </View>
                  <Hint>
                    Best guess — Waves uses this to set the
                    acknowledgment, not to grade you.
                  </Hint>
                </View>
              ) : null}
            </>
          ) : null}

          {step === 3 ? (
            <>
              <Eyebrow>LAST QUESTION · TRIGGER</Eyebrow>
              <Display>What set this off?</Display>
              <Lede>Best guess. You can change your mind later.</Lede>
              <View style={{ gap: 8, marginTop: 4 }}>
                {TRIGGER_OPTIONS.map((o) => (
                  <Chip
                    key={o.v}
                    label={o.l}
                    list
                    pressed={intake.trigger === o.v}
                    onPress={() =>
                      setIntake((p) => ({ ...p, trigger: o.v }))
                    }
                  />
                ))}
              </View>
            </>
          ) : null}
        </ScrollView>

        <PrimaryButton
          label={step === 3 ? "Continue to session" : "Continue"}
          trailing="→"
          onPress={next}
          disabled={continueDisabled}
        />
      </ScreenBody>
    </ScreenScaffold>
  );
}
