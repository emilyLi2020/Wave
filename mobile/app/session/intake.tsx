import { Link } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

// Skeleton — will host the IntakeForm port from
// client/app/session/_components/intake-form.tsx (intensity slider 1-10,
// MAT picker, medication status, trigger). For now it just hands off the
// next screen with hardcoded answers.

export default function IntakeScreen() {
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    >
      <Text style={styles.sub}>
        TODO: port intake-form.tsx — intensity slider, MAT picker, medication
        status, trigger, demo-mode toggle. Submits IntakeAnswers into the
        session reducer.
      </Text>

      <View style={styles.panel}>
        <Text style={styles.panelHead}>Skeleton</Text>
        <Text style={styles.bodyText}>
          The reducer (src/session/session-machine.ts) is already ported. This
          screen needs the form UI.
        </Text>
      </View>

      <Link href="/session/safety" asChild>
        <Pressable style={styles.button}>
          <Text style={styles.buttonText}>Skip → safety</Text>
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
