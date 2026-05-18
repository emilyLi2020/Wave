"use client";

import { useSyncExternalStore } from "react";

import {
  getCompletedServerSnapshot,
  getCompletedSnapshot,
  subscribeCompletedSessions,
} from "@/lib/sessions/completed-store";

/**
 * "Sessions surfed" value = the curated mock baseline plus however many
 * sessions the patient has actually completed on this device. Server
 * snapshot is the base count, so there is no hydration mismatch.
 */
export function SessionsSurfedValue({ base }: { base: number }) {
  const completed = useSyncExternalStore(
    subscribeCompletedSessions,
    getCompletedSnapshot,
    getCompletedServerSnapshot,
  );
  return <>{base + completed.length}</>;
}
