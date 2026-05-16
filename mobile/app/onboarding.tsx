// Onboarding — RN port of client/app/onboarding/page.tsx. Three
// optional questions: first name, MAT type, usual dose time, plus a
// consent checkbox. The web version is uncontrolled and just hands
// off to /session on submit; this mirrors that behaviour with local
// state and routes to /session/intake. Persistence into a real
// PatientProfile is out of scope here — that will land alongside the
// session reducer wiring on the intake screen.

import { useState } from "react";
import { Link, useRouter } from "expo-router";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

const ACCENT = "#6366F1";

const MAT_OPTIONS = [
  "Buprenorphine / Suboxone",
  "Naltrexone (oral)",
  "Vivitrol (injection)",
  "Methadone",
  "Not on MAT",
  "Prefer not to say",
];

export default function OnboardingScreen() {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [matType, setMatType] = useState<string | null>(null);
  const [doseTime, setDoseTime] = useState("08:00");
  const [consent, setConsent] = useState(false);

  function handleContinue() {
    // Future: persist {firstName, matType, doseTime} into the patient
    // profile slice before routing.
    router.push("/session/intake");
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Let&apos;s set up your WAVE</Text>
      <Text style={styles.subtitle}>
        Three quick questions. Everything stays on your device. You can skip
        any of them.
      </Text>

      <View style={styles.field}>
        <Text style={styles.legend}>
          What should WAVE call you?{" "}
          <Text style={styles.legendOptional}>(Optional)</Text>
        </Text>
        <TextInput
          value={firstName}
          onChangeText={setFirstName}
          placeholder="First name or nickname"
          placeholderTextColor="#4B5563"
          autoCapitalize="words"
          style={styles.input}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.legend}>
          Are you on Medication-Assisted Treatment (MAT)?
        </Text>
        <View style={styles.optionGrid}>
          {MAT_OPTIONS.map((option) => {
            const selected = matType === option;
            return (
              <Pressable
                key={option}
                onPress={() => setMatType(option)}
                style={[styles.option, selected && styles.optionSelected]}
              >
                <View
                  style={[styles.radio, selected && styles.radioSelected]}
                >
                  {selected ? <View style={styles.radioDot} /> : null}
                </View>
                <Text style={styles.optionText}>{option}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.field}>
        <Text style={styles.legend}>
          When do you usually take your dose?{" "}
          <Text style={styles.legendOptional}>
            (Helps WAVE spot missed-dose patterns)
          </Text>
        </Text>
        <TextInput
          value={doseTime}
          onChangeText={setDoseTime}
          placeholder="HH:MM"
          placeholderTextColor="#4B5563"
          keyboardType="numbers-and-punctuation"
          maxLength={5}
          style={[styles.input, styles.inputTime]}
        />
      </View>

      <Pressable
        onPress={() => setConsent((c) => !c)}
        style={styles.consentPanel}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: consent }}
      >
        <View style={[styles.checkbox, consent && styles.checkboxChecked]}>
          {consent ? <Text style={styles.checkboxMark}>✓</Text> : null}
        </View>
        <Text style={styles.consentText}>
          I understand WAVE is a support tool, not a substitute for a
          counselor, prescriber, or crisis line. If I am in crisis I will
          call or text 988, or call 1-800-662-HELP (SAMHSA National
          Helpline).
        </Text>
      </Pressable>

      <View style={styles.footer}>
        <Link href="/" asChild>
          <Pressable hitSlop={8}>
            <Text style={styles.footerLink}>← Back to dev menu</Text>
          </Pressable>
        </Link>
        <Pressable
          onPress={handleContinue}
          style={[styles.primaryButton, !consent && styles.primaryButtonDisabled]}
          disabled={!consent}
        >
          <Text style={styles.primaryButtonText}>Continue →</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#08080C" },
  content: { padding: 16, gap: 18, paddingBottom: 48 },
  title: { color: "#F1F1F4", fontSize: 22, fontWeight: "700" },
  subtitle: { color: "#9CA3AF", fontSize: 13, lineHeight: 19 },
  field: { gap: 8 },
  legend: { color: "#F1F1F4", fontSize: 14, fontWeight: "600" },
  legendOptional: { color: "#6B7280", fontWeight: "400" },
  input: {
    backgroundColor: "#16161F",
    borderColor: "#23232F",
    borderWidth: 1,
    borderRadius: 12,
    borderCurve: "continuous",
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#F1F1F4",
    fontSize: 14,
  },
  inputTime: { alignSelf: "flex-start", minWidth: 120 },
  optionGrid: { gap: 6 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#16161F",
    borderColor: "#23232F",
    borderWidth: 1,
    borderRadius: 12,
    borderCurve: "continuous",
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  optionSelected: { borderColor: ACCENT },
  optionText: { color: "#F1F1F4", fontSize: 13 },
  radio: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#3F3F50",
    alignItems: "center",
    justifyContent: "center",
  },
  radioSelected: { borderColor: ACCENT },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: ACCENT },
  consentPanel: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: "#1C1C28",
    borderRadius: 12,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: "#23232F",
    padding: 14,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#3F3F50",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  checkboxChecked: { backgroundColor: ACCENT, borderColor: ACCENT },
  checkboxMark: { color: "#F1F1F4", fontSize: 12, fontWeight: "700" },
  consentText: { color: "#9CA3AF", fontSize: 12, lineHeight: 18, flex: 1 },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
    gap: 8,
    flexWrap: "wrap",
  },
  footerLink: { color: "#9CA3AF", fontSize: 13 },
  primaryButton: {
    backgroundColor: ACCENT,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
  },
  primaryButtonDisabled: { opacity: 0.4 },
  primaryButtonText: { color: "#F1F1F4", fontWeight: "600", fontSize: 13 },
});
