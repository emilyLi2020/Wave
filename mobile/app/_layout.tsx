import { useEffect } from "react";
import { DarkTheme, ThemeProvider } from "@react-navigation/native";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "react-native-reanimated";

import { ensureNotificationPermission } from "@/notifications/lock-screen-ping";
import { SessionProvider } from "@/session/session-context";

// The oceanic skin is dark-first and full-bleed: every screen draws its
// own in-screen top bar over the shared wave, so the stack chrome is
// hidden throughout. Home is the landing page; the dev menu is a
// right-edge swipe drawer rendered inside it. GestureHandlerRootView
// wraps the app so that drawer's pan gestures work.
export default function RootLayout() {
  const router = useRouter();

  useEffect(() => {
    // Warm the permission prompt so the lock-screen ping can fire later.
    ensureNotificationPermission();
    // Tapping the ping (from the lock screen) deep-links into the flow.
    const sub = Notifications.addNotificationResponseReceivedListener((res) => {
      const url = res.notification.request.content.data?.url;
      if (typeof url === "string") router.push(url as never);
    });
    return () => sub.remove();
  }, [router]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={DarkTheme}>
        <SessionProvider>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: "#02060d" },
            }}
          >
            <Stack.Screen name="index" />
            <Stack.Screen name="tests" />
            <Stack.Screen name="session" />
            <Stack.Screen name="onboarding" />
            <Stack.Screen name="dashboard" />
            <Stack.Screen name="history" />
            <Stack.Screen name="insights" />
          </Stack>
          <StatusBar style="light" />
        </SessionProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
