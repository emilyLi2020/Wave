import { Link } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

// Skeleton — will host the SafetyScreen port from
// client/app/session/_components/safety-screen.tsx (two yes/no questions,
// SAMHSA handoff on Q1+Q2 both yes). Pure rule-based gate before any LLM.

export default function SafetyScreenRoute() {
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    >
      <Text style={styles.sub}>
        TODO: port safety-screen.tsx — two yes/no questions, handoff path
        (SAMHSA), proceed path with usedSubstanceToday flag.
      </Text>

      <View style={styles.panel}>
        <Text style={styles.panelHead}>Logic</Text>
        <Text style={styles.bodyText}>Q1 No → proceed, usedSubstanceToday=false</Text>
        <Text style={styles.bodyText}>Q1 Yes + Q2 No → proceed, usedSubstanceToday=true</Text>
        <Text style={styles.bodyText}>Q1 Yes + Q2 Yes → SAMHSA handoff (no model call)</Text>
      </View>

      <Link href="/session/chunk" asChild>
        <Pressable style={styles.button}>
          <Text style={styles.buttonText}>Skip → chunk</Text>
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
