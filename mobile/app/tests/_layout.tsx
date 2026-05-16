import { Stack } from "expo-router";

export default function TestsLayout() {
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: "#08080C" }, headerTintColor: "#F1F1F4" }}>
      <Stack.Screen name="litert" options={{ title: "LiteRT smoke" }} />
      <Stack.Screen name="whisper" options={{ title: "Whisper STT" }} />
      <Stack.Screen name="kokoro" options={{ title: "Kokoro TTS" }} />
      <Stack.Screen name="vad" options={{ title: "Silero VAD" }} />
      <Stack.Screen name="combined" options={{ title: "Combined voice loop" }} />
    </Stack>
  );
}
