// Safety — RN port of the design bundle's SafetyScreen (screens.jsx).
// Rule-based, pre-LLM. Three answers; any "yes" still proceeds in the
// design prototype (the real branching is the reducer's job, deferred
// with the rest of the session wiring). "Connect me to someone now"
// is the early exit. Routes forward to /session/chunk like the
// design's onResolved → loading → chunk.

import { Stack, useRouter } from "expo-router";
import { View } from "react-native";
import {
  ScreenScaffold,
  ScreenBody,
  TopBar,
  Eyebrow,
  Display,
  Lede,
  Hint,
  Chip,
  Card,
  GhostButton,
} from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useTheme } from "@/theme-context";

export default function SafetyScreen() {
  const router = useRouter();
  const theme = useTheme();

  return (
    <ScreenScaffold>
      <Stack.Screen options={{ headerShown: false }} />
      <TopBar crumb="Before we start" />
      <ScreenBody>
        <Eyebrow>SAFETY CHECK</Eyebrow>
        <Display>Have you used today?</Display>
        <Lede>
          We ask so the session knows what to say next. There&apos;s no
          right answer and no judgment.
        </Lede>

        <View style={{ gap: 10, marginTop: 4 }}>
          <Chip
            label="No, not today"
            list
            onPress={() => router.push("/session/chunk")}
          />
          <Chip
            label="Yes, earlier today"
            list
            onPress={() => router.push("/session/chunk")}
          />
          <Chip
            label="Yes, within the last hour"
            list
            onPress={() => router.push("/session/chunk")}
          />
        </View>

        <View style={{ flex: 1 }} />

        <Card tone="mute">
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ marginTop: 2 }}>
              <Icon name="shield" color={theme.accent} />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Eyebrow style={{ color: theme.fg, letterSpacing: 0.2 }}>
                IF YOU&apos;RE IN CRISIS
              </Eyebrow>
              <Hint>
                Call or text 988 (Suicide & Crisis Lifeline), or call
                SAMHSA at 1-800-662-HELP. Waves is a support tool — not a
                substitute for a counselor or prescriber.
              </Hint>
              <GhostButton
                label="Connect me to someone now →"
                onPress={() => router.back()}
                style={{ alignItems: "flex-start", paddingHorizontal: 0 }}
              />
            </View>
          </View>
        </Card>
      </ScreenBody>
    </ScreenScaffold>
  );
}
