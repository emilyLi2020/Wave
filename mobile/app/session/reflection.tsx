// ReflectionScreen — RN port of the design bundle's ReflectionScreen
// (session-screens.jsx). Stages: thinking (cycling titles) → ready
// (reflection card + plan textarea) → suggestions. Standalone there's
// no session state, so a representative score arc [7,6,5,4,3] is used
// (intake 7 → end 3). "Use my plan" / picking a suggestion returns to
// the dev menu (the design went on to a Done/Dashboard handoff).
//
// NOTE: ScoreArc uses react-native-svg — needs a fresh EAS dev-client
// build before this screen renders on device.

import { useEffect, useState } from "react";
import { Stack, useRouter } from "expo-router";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  ScreenScaffold,
  ScreenBody,
  TopBar,
  Eyebrow,
  Display,
  Lede,
  Hint,
  Card,
  Chip,
  PrimaryButton,
  GhostButton,
} from "@/components/ui";
import { ScoreArc } from "@/components/ScoreArc";
import { type Theme } from "@/theme";
import { useTheme, useThemeStyles } from "@/theme-context";

const SCORES = [7, 6, 5, 4, 3]; // intake + 4 checkpoints (standalone)
const INTAKE_INTENSITY = 7;

const THINKING_TITLES = [
  "Re-reading your check-ins",
  "Comparing to your last session",
  "Looking for what worked",
  "Writing your reflection",
];

const SUGGESTIONS = [
  "Glass of water + step outside for two minutes",
  'Text the person you trust most: "today is a hard one"',
  "Eat something small — a piece of fruit or toast",
  "Lie down for 10 minutes with a podcast you trust",
];

type Stage = "thinking" | "ready" | "suggestions";

export default function ReflectionScreen() {
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemeStyles(makeStyles);
  const [stage, setStage] = useState<Stage>("thinking");
  const [titleIdx, setTitleIdx] = useState(0);
  const [plan, setPlan] = useState("");

  useEffect(() => {
    if (stage !== "thinking") return;
    if (titleIdx >= THINKING_TITLES.length) {
      setStage("ready");
      return;
    }
    const t = setTimeout(() => setTitleIdx((i) => i + 1), 750);
    return () => clearTimeout(t);
  }, [titleIdx, stage]);

  const finalScore = SCORES[SCORES.length - 1];
  const drop = INTAKE_INTENSITY - finalScore;
  const finish = () => router.push("/");

  return (
    <ScreenScaffold>
      <Stack.Screen options={{ headerShown: false }} />
      <TopBar crumb="Closing · reflection" />
      <ScreenBody>
        <ScrollView
          contentContainerStyle={{ gap: 16, paddingBottom: 16 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <ScoreArc scores={SCORES} />

          {stage === "thinking" ? (
            <Card flush>
              <Eyebrow accent>WRITING REFLECTION</Eyebrow>
              <View style={{ marginTop: 8, gap: 8 }}>
                {THINKING_TITLES.map((t, i) => {
                  const done = i < titleIdx;
                  const active = i === titleIdx;
                  return (
                    <View key={i} style={styles.thinkRow}>
                      <View
                        style={[
                          styles.marker,
                          done && styles.markerDone,
                          active && styles.markerActive,
                        ]}
                      >
                        {done ? (
                          <Text style={styles.markerCheck}>✓</Text>
                        ) : null}
                      </View>
                      <Text
                        style={[
                          styles.thinkText,
                          done && { color: theme.fg },
                        ]}
                      >
                        {t}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </Card>
          ) : null}

          {stage === "ready" || stage === "suggestions" ? (
            <Card flush>
              <Eyebrow accent>REFLECTION</Eyebrow>
              <Display style={{ marginTop: 6 }}>
                {drop >= 2
                  ? `Your craving fell ${drop} points across five chunks.`
                  : drop >= 1
                    ? `Your craving dropped ${drop} point — and you stayed.`
                    : "You stayed for the whole wave. That counts."}
              </Display>
              <Lede style={{ marginTop: 8 }}>
                On Suboxone days like today, sessions like this typically
                drop another 1.4 points in the next 20 minutes. The wave
                is still falling.
              </Lede>
              <Hint style={{ marginTop: 10, fontStyle: "italic" }}>
                When you noticed it in your chest, you stopped fighting
                it — that&apos;s when it started moving.
              </Hint>
            </Card>
          ) : null}

          {stage === "ready" ? (
            <Card flush>
              <Eyebrow>NEXT 10 MINUTES · YOUR PLAN</Eyebrow>
              <TextInput
                style={styles.planArea}
                placeholder="Drink water · step outside · text someone safe…"
                placeholderTextColor={theme.fgFaint}
                value={plan}
                onChangeText={setPlan}
                multiline
              />
              <View style={styles.planRow}>
                <GhostButton
                  label="No ideas — show options"
                  onPress={() => setStage("suggestions")}
                />
                <PrimaryButton
                  label="Use my plan"
                  onPress={finish}
                  disabled={plan.trim().length < 2}
                  style={{ flexShrink: 1 }}
                />
              </View>
            </Card>
          ) : null}

          {stage === "suggestions" ? (
            <Card flush>
              <Eyebrow>PICK ONE. OR WRITE YOUR OWN.</Eyebrow>
              <View style={{ gap: 8, marginTop: 10 }}>
                {SUGGESTIONS.map((s, i) => (
                  <Chip key={i} label={s} list onPress={finish} />
                ))}
              </View>
              <GhostButton
                label="← Back to my plan"
                onPress={() => setStage("ready")}
                style={{ alignItems: "flex-start", paddingHorizontal: 0 }}
              />
            </Card>
          ) : null}
        </ScrollView>
      </ScreenBody>
    </ScreenScaffold>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  thinkRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
  marker: {
    width: 16,
    height: 16,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: theme.border,
    alignItems: "center",
    justifyContent: "center",
  },
  markerDone: { backgroundColor: theme.accent, borderColor: theme.accent },
  markerActive: {
    borderColor: theme.accent,
    backgroundColor: theme.accentSoft,
  },
  markerCheck: { color: theme.accentFg, fontSize: 9, fontWeight: "700" },
  thinkText: { fontSize: 14.5, color: theme.fgSoft },
  planArea: {
    marginTop: 10,
    minHeight: 76,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: theme.surfaceMute,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 16,
    borderCurve: "continuous",
    fontSize: 14.5,
    color: theme.fg,
    textAlignVertical: "top",
  },
  planRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
    justifyContent: "flex-end",
    alignItems: "center",
  },
});
