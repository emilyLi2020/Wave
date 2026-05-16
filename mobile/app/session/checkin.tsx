import { Link } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

// Skeleton — will host the VoiceCheckIn port from
// client/app/session/_components/voice-check-in.tsx. The combined voice
// test page (/tests/combined) is where the loop gets validated; this screen
// is the production surface that imports the same loop.

export default function CheckInScreenRoute() {
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    >
      <Text style={styles.sub}>
        TODO: wire the conversational voice loop from
        src/voice/use-check-in-voice-loop.ts (after step 5c). Multi-turn LLM
        chat with VAD-driven turn taking, streaming Kokoro TTS, and barge-in.
      </Text>

      <View style={styles.panel}>
        <Text style={styles.panelHead}>Dependencies</Text>
        <Text style={styles.bodyText}>
          - streamCheckInTurn() from src/gemma/checkin.ts (ported)
        </Text>
        <Text style={styles.bodyText}>
          - vad-listener (port from client/lib/voice/vad-listener.ts)
        </Text>
        <Text style={styles.bodyText}>
          - whisper.rn STT + sherpa-onnx Kokoro TTS
        </Text>
      </View>

      <Link href="/session/reflection" asChild>
        <Pressable style={styles.button}>
          <Text style={styles.buttonText}>Skip → reflection</Text>
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
