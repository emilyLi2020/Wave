// Reflection — task ④. After the final check-in, generateReflection()
// produces the structured card (insight + journal prompt + 4 next-step
// options). The insight is spoken with Kokoro. Picking a step (or Done)
// dispatches into the reducer and returns Home.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { Chip, Display, Eyebrow, TopBar, WaveButton, WaveCard, WaveScreen } from "@/components/wave-ui";
import { WaveColors, WaveType } from "@/constants/wave-theme";
import { generateReflection } from "@/gemma/session";
import type { ReflectionPayload } from "@/lib/prompts/schemas";
import { reflectionContextFromState } from "@/session/build-context";
import { useSession } from "@/session/session-context";
import { ensurePlaybackSession, speak, stopSpeaking } from "@/voice/kokoro";

type Stage =
  | { status: "thinking" }
  | { status: "ready"; payload: ReflectionPayload; source: "model" | "fallback" }
  | { status: "error"; message: string };

export default function ReflectionScreenRoute() {
  const router = useRouter();
  const { state, dispatch, resetSession } = useSession();
  const [stage, setStage] = useState<Stage>({ status: "thinking" });
  const startedRef = useRef(false);

  const intake = state.intake?.intakeIntensity ?? null;
  const scores = state.checkIns.map((c) => c.cravingScore);
  const last = scores.length ? scores[scores.length - 1] : intake;
  const drop = intake != null && last != null ? intake - last : 0;
  let headline: string;
  if (drop >= 2) headline = `Your craving fell ${drop} points.`;
  else if (drop === 1) headline = "It dropped a point — and you stayed with it.";
  else if (drop === 0) headline = "You stayed for the whole wave. That counts.";
  else headline = "The wave is still here. You met it.";

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    let alive = true;
    console.log("[wave][reflection] generate start");
    generateReflection(reflectionContextFromState(state))
      .then((res) => {
        if (!alive) return;
        console.log(`[wave][reflection] ok source=${res.source}`);
        setStage({ status: "ready", payload: res.payload, source: res.source });
        // Step 4 (issue #26): normalize the audio route — the prior
        // check-in's mic stream left the session in PlayAndRecord/
        // VoiceChat (louder) and never restored it.
        ensurePlaybackSession()
          .then(() => speak(`${headline} ${res.payload.insight}`))
          .catch(() => {});
      })
      .catch((err: unknown) => {
        if (!alive) return;
        const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        console.error("[wave][reflection] failed:", message);
        setStage({ status: "error", message });
      });
    return () => {
      alive = false;
      stopSpeaking().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function finish(choice?: string) {
    stopSpeaking().catch(() => {});
    if (choice) dispatch({ type: "nextStepPicked", choice });
    dispatch({ type: "sessionFinished" });
    resetSession();
    // End of session → History first, then the user continues to the
    // Dashboard, then Home (post-session review flow).
    router.replace("/history");
  }

  return (
    <WaveScreen intensity={last ?? 4}>
      <TopBar crumb="Closing · reflection" />

      {stage.status === "thinking" ? (
        <View style={styles.center}>
          <ActivityIndicator color={WaveColors.waveGlow} />
          <Text style={styles.note}>Writing your reflection…</Text>
        </View>
      ) : stage.status === "error" ? (
        <>
          <Eyebrow accent>Your reflection</Eyebrow>
          <Display size="lg">{headline}</Display>
          <Text style={styles.note}>
            Couldn&apos;t compose the full reflection ({stage.message}). The
            arc still stands.
          </Text>
          <WaveButton label="done" variant="quiet" onPress={() => finish()} style={styles.done} />
        </>
      ) : (
        <>
          <Eyebrow accent>
            Your reflection{stage.source === "fallback" ? " · saved" : " · on-device"}
          </Eyebrow>
          <Display size="lg">{headline}</Display>
          <Text style={styles.insight}>{stage.payload.insight}</Text>

          <WaveCard style={styles.arcCard}>
            <Eyebrow>Intake → end</Eyebrow>
            <Text style={styles.arc}>
              {[intake, ...scores].filter((n) => n != null).join(" · ") || "—"}
            </Text>
          </WaveCard>

          <Text style={styles.journal}>{stage.payload.journalPromptQuestion}</Text>

          <Eyebrow style={styles.lbl}>Next 10 minutes · pick one</Eyebrow>
          {[
            stage.payload.nextSteps.one,
            stage.payload.nextSteps.two,
            stage.payload.nextSteps.three,
            stage.payload.nextSteps.four,
          ].map((s) => (
            <Chip key={s} label={s} onPress={() => finish(s)} />
          ))}

          <WaveButton label="done" variant="quiet" onPress={() => finish()} style={styles.done} />
        </>
      )}
    </WaveScreen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingVertical: 90 },
  note: { color: WaveColors.inkMute, fontSize: 13, fontFamily: WaveType.sans, textAlign: "center" },
  insight: {
    fontFamily: WaveType.serif,
    fontStyle: "italic",
    fontSize: 16,
    lineHeight: 24,
    color: WaveColors.inkSoft,
    marginTop: 4,
  },
  arcCard: { gap: 8, marginTop: 8 },
  arc: {
    fontFamily: WaveType.serif,
    fontStyle: "italic",
    fontSize: 22,
    letterSpacing: 1,
    color: WaveColors.waveCrest,
  },
  journal: {
    fontFamily: WaveType.serif,
    fontStyle: "italic",
    fontSize: 15,
    lineHeight: 22,
    color: WaveColors.inkMute,
    marginTop: 8,
  },
  lbl: { marginTop: 10 },
  done: { alignSelf: "center", marginTop: 18 },
});
