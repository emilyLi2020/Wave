import { Link } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

// Skeleton — will host the ChunkPlayer port from
// client/app/session/_components/chunk-player.tsx (renders Segment[] as
// narrated meditation, drives ambient audio bed, fades between lines).

export default function ChunkScreenRoute() {
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    >
      <Text style={styles.sub}>
        TODO: port chunk-player.tsx + narration-card.tsx. Drives the
        generated 6-line narration with default pauses between beats. Per the
        plan, Kokoro speaks each line (sentence buffer) instead of relying on
        scripted pauses alone.
      </Text>

      <View style={styles.panel}>
        <Text style={styles.panelHead}>Wired with</Text>
        <Text style={styles.bodyText}>
          - generateChunk() from src/gemma/chunk.ts (already ported)
        </Text>
        <Text style={styles.bodyText}>
          - LiteRT runtime via src/runtime/litert-generators.ts
        </Text>
        <Text style={styles.bodyText}>
          - Kokoro TTS via src/voice/tts-sherpa-kokoro.ts (after Kokoro smoke greens)
        </Text>
      </View>

      <Link href="/session/checkin" asChild>
        <Pressable style={styles.button}>
          <Text style={styles.buttonText}>Skip → check-in</Text>
        </Pressable>
      </Link>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#08080C" },
  content: { padding: 16, gap: 12 },
  heading: { color: "#F1F1F4", fontSize: 22, fontWeight: "700" },
  sub: { color: "#9CA3AF", fontSize: 13 },
  panel: {
    backgroundColor: "#16161F",
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#23232F",
    gap: 4,
  },
  panelHead: {
    color: "#6B7280",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 4,
  },
  bodyText: { color: "#F1F1F4", fontSize: 13, lineHeight: 18 },
  button: {
    backgroundColor: "#6366F1",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 6,
    marginTop: 8,
  },
  buttonText: { color: "#F1F1F4", fontWeight: "600", fontSize: 14, textAlign: "center" },
});
