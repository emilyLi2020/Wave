// On-device log of sessions the patient has actually completed.
//
// Dashboard + history stay backed by the curated MOCK_* data (a
// believable baseline for the demo); this store just prepends the
// patient's own freshly-finished sessions on top so completing a
// session is visibly reflected. Nothing leaves the device.
//
// A module-level cache keeps `getSnapshot` referentially stable so it
// is safe to drive `useSyncExternalStore` (no server/client hydration
// mismatch — the server snapshot is a shared empty array).

import type { RecentSessionRow } from "@/lib/data/mock-sessions";

const STORAGE_KEY = "wave.completed-sessions.v1";
const MAX_KEPT = 20;
const EMPTY: ReadonlyArray<RecentSessionRow> = Object.freeze([]);

let cache: RecentSessionRow[] | null = null;
const listeners = new Set<() => void>();

function load(): RecentSessionRow[] {
  if (typeof window === "undefined") return EMPTY as RecentSessionRow[];
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    cache = raw ? (JSON.parse(raw) as RecentSessionRow[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

export function readCompletedSessions(): RecentSessionRow[] {
  return load();
}

export function recordCompletedSession(row: RecentSessionRow): void {
  if (typeof window === "undefined") return;
  const next = [row, ...load()].slice(0, MAX_KEPT);
  cache = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage full / disabled — the in-memory cache still reflects it
    // for the rest of this browsing session.
  }
  for (const listener of listeners) listener();
}

export function subscribeCompletedSessions(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function getCompletedSnapshot(): RecentSessionRow[] {
  return load();
}

export function getCompletedServerSnapshot(): RecentSessionRow[] {
  return EMPTY as RecentSessionRow[];
}
