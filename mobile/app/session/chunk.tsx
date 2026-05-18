// Chunk player — task ①. Ensures the LiteRT model is resident, asks
// generateChunk() for this round's narration (model → scripted fallback
// inside the boundary), records it in the reducer, then plays the lines
// one beat at a time. Kokoro TTS (task ②) will later drive the pacing by
// speech-end; for now it's a readable timed beat.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { Eyebrow, TopBar, WaveButton, WaveScreen } from "@/components/wave-ui";
import { WaveColors, WaveType } from "@/constants/wave-theme";
import { generateChunk } from "@/gemma/chunk";
import { chunkContextFromState } from "@/session/build-context";
import { useSession } from "@/session/session-context";
import { useModelReady } from "@/session/use-model-ready";

export default function ChunkScreenRoute() {
  const router = useRouter();
  const { state, dispatch } = useSession();
  const model = useModelReady();

  const chunkNo = state.currentChunk;
  const generatedForRef = useRef<number | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [lineIdx, setLineIdx] = useState(0);

  const chunk = state.generatedChunk;
  const isThisChunk = chunk?.id === chunkNo;
  const lines = isThisChunk
    ? chunk!.segments
        .filter((s) => s.type === "text")
        .map((s) => (s.type === "text" ? s.content : ""))
    : [];

  // 1. Generate this round's chunk once the model is resident.
  useEffect(() => {
    if (model.status !== "ready") return;
    if (isThisChunk) return;
    if (generatedForRef.current === chunkNo) return;
    generatedForRef.current = chunkNo;
    setGenError(null);
    setLineIdx(0);
    let alive = true;
    generateChunk({ context: chunkContextFromState(state) })
      .then((res) => {
        if (!alive) return;
        dispatch({
          type: "chunkGenerated",
          chunk: res.chunk,
          lines: res.lines,
          source: res.source,
        });
      })
      .catch((err: unknown) => {
        if (!alive) return;
        generatedForRef.current = null;
        setGenError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.status, chunkNo, isThisChunk]);

  // 2. Play the lines, one timed beat each.
  useEffect(() => {
    if (!isThisChunk || lines.length === 0) return;
    if (lineIdx >= lines.length) return;
    const beat = state.demoMode ? 1600 : 3600;
    const t = setTimeout(() => setLineIdx((i) => i + 1), beat);
    return () => clearTimeout(t);
  }, [isThisChunk, lineIdx, lines.length, state.demoMode]);

  function finishChunk() {
    dispatch({ type: "chunkCompleted" });
    router.replace("/session/checkin");
  }

  // Auto-advance to the check-in once the last line has shown.
  useEffect(() => {
    if (isThisChunk && lines.length > 0 && lineIdx >= lines.length) {
      const t = setTimeout(finishChunk, state.demoMode ? 600 : 1400);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isThisChunk, lineIdx, lines.length]);

  const title = chunk?.title ?? "Settle in";
  const total = state.totalChunks;

  return (
    <WaveScreen intensity={state.intake?.intakeIntensity ?? 5}>
      <TopBar crumb={`Chunk ${chunkNo} of ${total} · ${title}`} />

      {model.status === "loading" ? (
        <View style={styles.center}>
          <ActivityIndicator color={WaveColors.waveGlow} />
          <Text style={styles.note}>
            Loading the on-device model…{" "}
            {model.pct > 0 ? `${Math.round(model.pct * 100)}%` : ""}
          </Text>
        </View>
      ) : model.status === "error" ? (
        <View style={styles.center}>
          <Text style={styles.note}>Model load failed.</Text>
          <Text style={styles.err}>{model.message}</Text>
          <WaveButton label="back" variant="quiet" onPress={() => router.back()} />
        </View>
      ) : !isThisChunk ? (
        <View style={styles.center}>
          <ActivityIndicator color={WaveColors.waveGlow} />
          <Text style={styles.note}>
            {genError ? `Generation error: ${genError}` : "Composing this phase…"}
          </Text>
        </View>
      ) : (
        <View style={styles.body}>
          {state.generatedChunkSource === "fallback" ? (
            <Eyebrow style={styles.src}>scripted fallback</Eyebrow>
          ) : (
            <Eyebrow accent style={styles.src}>
              on-device · gemma
            </Eyebrow>
          )}
          <View style={styles.lineWrap}>
            <Text style={styles.line}>{lines[Math.min(lineIdx, lines.length - 1)]}</Text>
          </View>
          <WaveButton
            label="skip to check-in →"
            variant="ghost"
            onPress={finishChunk}
            style={styles.skip}
          />
        </View>
      )}
    </WaveScreen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingVertical: 80 },
  note: { color: WaveColors.inkMute, fontSize: 13, fontFamily: WaveType.sans, textAlign: "center" },
  err: { color: WaveColors.danger, fontSize: 12, fontFamily: WaveType.mono, textAlign: "center" },
  body: { flex: 1, paddingVertical: 24 },
  src: { textAlign: "center", marginTop: 8 },
  lineWrap: { flex: 1, justifyContent: "center", paddingVertical: 40 },
  line: {
    fontFamily: WaveType.serif,
    fontStyle: "italic",
    fontSize: 27,
    lineHeight: 35,
    textAlign: "center",
    color: WaveColors.ink,
    paddingHorizontal: 14,
  },
  skip: { alignSelf: "center", marginBottom: 8 },
});
