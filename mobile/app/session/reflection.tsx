import { Link } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

// Skeleton — will host the reflection card after check-in 5. Calls
// generateReflection() from src/gemma/session.ts (already ported) and
// renders the insight + journalPromptQuestion + 4 next-step chips.

export default function ReflectionScreenRoute() {
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    >
      <Text style={styles.sub}>
        TODO: render insight + journalPromptQuestion + NextStepChips. Use
        reflectionPayloadSchema for validation.
      </Text>

      <View style={styles.panel}>
        <Text style={styles.panelHead}>Wired with</Text>
        <Text style={styles.bodyText}>
          - generateReflection() from src/gemma/session.ts (ported)
        </Text>
        <Text style={styles.bodyText}>
          - reflectionPayloadSchema (already in src/prompts/schemas.ts)
        </Text>
        <Text style={styles.bodyText}>
          - fallbackReflection() if the model fails twice
        </Text>
      </View>

      <Link href="/" asChild>
        <Pressable style={styles.button}>
          <Text style={styles.buttonText}>Done → dev menu</Text>
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
