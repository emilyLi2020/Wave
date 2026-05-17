// CheckInScreen — RN port of the design bundle's CheckInScreen
// (session-screens.jsx). Bare Wave whose height tracks the craving
// score, the status-driven VoiceCard, streamed transcript bubbles,
// the MicButton that runs the scripted voice loop, and a "Skip
// check-in →" ghost button (design chat added it; commits the latest
// score and advances). Standalone there is no prior score, so
// priorScore = 7.
//
// The loop driver mirrors the prototype's runStep / streamAgentTurn /
// runUserTurn timing. Routes to /session/reflection when the scripted
// exchange ends. NOTE: the Wave + VoiceCard use react-native-svg /
// Reanimated worklets — needs a fresh EAS dev-client build on device.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Stack, useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import {
  ScreenScaffold,
  ScreenBody,
  TopBar,
  Pill,
  GhostButton,
} from "@/components/ui";
import { Wave } from "@/components/Wave";
import {
  MicButton,
  VoiceCard,
  type VoiceStatus,
} from "@/components/voice";
import { type Theme } from "@/theme";
import { useThemeStyles } from "@/theme-context";

const PRIOR_SCORE = 7; // no prior check-in when launched standalone

interface ScriptTurn {
  role: "agent" | "patient";
  content: string;
  score?: number;
  end?: boolean;
}

const VOICE_OPENER =
  "How intense is the craving right now? Give me a number from 1 to 10.";

// Verbatim from session-screens.jsx buildVoiceScript().
function buildVoiceScript(priorScore: number): ScriptTurn[] {
  const patientScore = 7;
  const drop = priorScore - patientScore;
  let firstAgentReply: string;
  if (drop >= 2) {
    firstAgentReply = `Okay — a seven. That's down from ${priorScore}. Notice it without grading it. Where in your body do you feel it most right now?`;
  } else if (drop >= 1) {
    firstAgentReply = `Down a notch from ${priorScore} to a seven. Small wins count. Where in your body is the craving loudest right now?`;
  } else if (drop === 0) {
    firstAgentReply =
      "Holding at a seven. That's not failure — surfing is staying upright, not making the wave smaller. Where in your body is it loudest?";
  } else {
    firstAgentReply = `Up from ${priorScore} to a seven. Worth pausing here. Where in your body is it loudest right now?`;
  }
  return [
    { role: "agent", content: VOICE_OPENER },
    { role: "patient", content: "About a seven.", score: patientScore },
    { role: "agent", content: firstAgentReply },
    {
      role: "patient",
      content: "Mostly in my chest. Tight, like a held breath.",
    },
    {
      role: "agent",
      content:
        "Got it. The chest is where the wave is breaking right now. We'll take that into the next chunk. Ready to continue?",
    },
    { role: "patient", content: "Yeah. Let's go." },
    { role: "agent", content: "Okay, surfing on.", end: true },
  ];
}

interface Bubble {
  id: string;
  role: "agent" | "patient";
  content: string;
}

export default function CheckInScreen() {
  const router = useRouter();
  const styles = useThemeStyles(makeStyles);
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [handsFree, setHandsFree] = useState(false);
  const [transcript, setTranscript] = useState<Bubble[]>([]);
  const [committedScore, setCommittedScore] = useState<number | null>(null);

  const scrollRef = useRef<ScrollView>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const mounted = useRef(true);
  const completed = useRef(false);

  const latestScore = committedScore ?? PRIOR_SCORE;
  const script = useMemo(() => buildVoiceScript(PRIOR_SCORE), []);
  const speed = 0.55; // demo speed
  const ms = (n: number) => Math.round(n * speed);

  useEffect(() => {
    return () => {
      mounted.current = false;
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [transcript]);

  const later = useCallback(
    (fn: () => void, dur: number) => {
      const id = setTimeout(() => {
        if (mounted.current) fn();
      }, ms(dur));
      timers.current.push(id);
    },
    // ms() is stable enough for the prototype's purposes
    [],
  );

  function streamAgentTurn(turn: ScriptTurn, onDone: () => void) {
    setStatus("speaking");
    const id = `t-${Math.random().toString(36).slice(2, 8)}`;
    setTranscript((t) => [...t, { id, role: "agent", content: "" }]);
    const words = turn.content.split(/(\s+)/);
    let i = 0;
    const tick = () => {
      i += 1;
      const shown = words.slice(0, i).join("");
      setTranscript((t) =>
        t.map((x) => (x.id === id ? { ...x, content: shown } : x)),
      );
      if (i < words.length) {
        later(tick, 110 + Math.random() * 80);
      } else {
        later(onDone, 320);
      }
    };
    later(tick, 180);
  }

  function runUserTurn(turn: ScriptTurn, onDone: () => void) {
    setStatus("listening");
    later(() => {
      setStatus("recording");
      later(() => {
        setStatus("transcribing");
        later(() => {
          const id = `t-${Math.random().toString(36).slice(2, 8)}`;
          setTranscript((t) => [
            ...t,
            { id, role: "patient", content: turn.content },
          ]);
          if (turn.score != null) setCommittedScore(turn.score);
          onDone();
        }, 620);
      }, 1700);
    }, 700);
  }

  function runStep(i: number) {
    if (!mounted.current || completed.current) return;
    const turn = script[i];
    if (!turn) return;
    if (turn.role === "agent") {
      streamAgentTurn(turn, () => {
        if (turn.end) {
          completed.current = true;
          setStatus("done");
          later(() => router.push("/session/reflection"), 800);
          return;
        }
        later(() => runStep(i + 1), 240);
      });
    } else {
      runUserTurn(turn, () => {
        setStatus("thinking");
        later(() => runStep(i + 1), 950 + Math.random() * 400);
      });
    }
  }

  function toggleHandsFree() {
    if (handsFree) {
      timers.current.forEach(clearTimeout);
      timers.current = [];
      setHandsFree(false);
      setStatus("idle");
      return;
    }
    setHandsFree(true);
    setStatus("warming");
    later(() => runStep(0), 700);
  }

  function skipCheckIn() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    completed.current = true;
    router.push("/session/reflection");
  }

  const isLive = handsFree && status !== "idle" && status !== "done";

  return (
    <ScreenScaffold>
      <Stack.Screen options={{ headerShown: false }} />
      <TopBar
        crumb="Check-in 1 of 5"
        right={<Pill>{`${latestScore}/10`}</Pill>}
      />
      <ScreenBody style={{ gap: 12 }}>
        <Wave intensity={latestScore} bare height={130} />

        <VoiceCard status={status} live={isLive} />

        <ScrollView
          ref={scrollRef}
          style={styles.transcript}
          contentContainerStyle={{ gap: 8, paddingVertical: 4 }}
          showsVerticalScrollIndicator={false}
        >
          {transcript.length === 0 ? (
            <Text style={styles.empty}>
              On-device · Whisper transcribes you, Kokoro replies in
              voice. Nothing leaves the phone.
            </Text>
          ) : (
            transcript.map((t) => (
              <View
                key={t.id}
                style={[
                  styles.bubble,
                  t.role === "agent" ? styles.bubbleAgent : styles.bubblePatient,
                ]}
              >
                <Text
                  style={
                    t.role === "agent"
                      ? styles.bubbleTextAgent
                      : styles.bubbleTextPatient
                  }
                >
                  {t.content || "…"}
                </Text>
              </View>
            ))
          )}
        </ScrollView>

        <MicButton
          handsFree={handsFree}
          status={status}
          onToggle={toggleHandsFree}
        />

        <GhostButton label="Skip check-in →" onPress={skipCheckIn} />
      </ScreenBody>
    </ScreenScaffold>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  transcript: {
    flexGrow: 0,
    minHeight: 110,
    maxHeight: 220,
  },
  empty: {
    marginTop: 12,
    marginHorizontal: 4,
    fontSize: 12,
    lineHeight: 18,
    color: theme.fgFaint,
    textAlign: "center",
  },
  bubble: {
    maxWidth: "86%",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderCurve: "continuous",
  },
  bubbleAgent: {
    alignSelf: "flex-start",
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderTopLeftRadius: 8,
  },
  bubblePatient: {
    alignSelf: "flex-end",
    backgroundColor: theme.accent,
    borderTopRightRadius: 8,
  },
  bubbleTextAgent: { color: theme.fg, fontSize: 14.5, lineHeight: 21 },
  bubbleTextPatient: { color: theme.accentFg, fontSize: 14.5, lineHeight: 21 },
});
