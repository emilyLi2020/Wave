import { DarkTheme, DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import "react-native-reanimated";

import { useColorScheme } from "@/hooks/use-color-scheme";
import { ThemeProvider as WaveThemeProvider } from "@/theme-context";

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <WaveThemeProvider initial="light">
      <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
        <Stack screenOptions={{ headerStyle: { backgroundColor: "#08080C" }, headerTintColor: "#F1F1F4" }}>
          <Stack.Screen name="index" options={{ title: "Wave dev" }} />
          <Stack.Screen name="tests" options={{ headerShown: false }} />
          <Stack.Screen name="session" options={{ headerShown: false }} />
          <Stack.Screen name="onboarding" options={{ title: "Onboarding" }} />
          <Stack.Screen name="dashboard" options={{ title: "Dashboard" }} />
          <Stack.Screen name="history" options={{ title: "History" }} />
          <Stack.Screen name="insights" options={{ title: "Insights" }} />
        </Stack>
        <StatusBar style="light" />
      </ThemeProvider>
    </WaveThemeProvider>
  );
}
