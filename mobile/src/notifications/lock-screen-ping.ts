// Lock-screen "prophylactic ping" — the notification from the Claude
// Design Lock screen ("Your typical 7pm window is 15 minutes out. Open
// WAVE while you still have agency.").
//
// This is a *local* scheduled notification: no server, no push token, no
// APNs. iOS delivers it to the lock screen / notification center once the
// user has granted permission. Tapping it deep-links into the session.
//
// expo-notifications is a native module — it only works in a dev client /
// custom build, not Expo Go.

import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

const PING_TITLE = "WAVE";
const PING_BODY =
  "Your typical 7pm window is 15 minutes out. Open WAVE while you still have agency.";

// Show banners even if the app is foregrounded (demo convenience).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/** Ask once; safe to call repeatedly. Returns true if we can post. */
export async function ensureNotificationPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain && current.status === "denied") return false;
  const req = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowSound: true, allowBadge: false },
  });
  return req.granted;
}

/**
 * Schedule the prophylactic ping. `secondsFromNow` lets the demo fire it
 * shortly (e.g. 6s) so you can lock the phone and watch it land; in the
 * real flow it would be scheduled for ~15 min before the risk window.
 */
export async function scheduleLockScreenPing(secondsFromNow = 6): Promise<string | null> {
  const ok = await ensureNotificationPermission();
  if (!ok) return null;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("wave-ping", {
      name: "Window reminders",
      importance: Notifications.AndroidImportance.HIGH,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  }

  return Notifications.scheduleNotificationAsync({
    content: {
      title: PING_TITLE,
      body: PING_BODY,
      // Surfaces above other notifications and on the lock screen.
      interruptionLevel: "timeSensitive",
      data: { url: "/session/intake" },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: Math.max(1, secondsFromNow),
      channelId: Platform.OS === "android" ? "wave-ping" : undefined,
    },
  });
}

/** Cancel any pending pings (e.g. when a session actually starts). */
export async function cancelLockScreenPings(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}
