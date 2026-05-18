// On-device onboarding profile.
//
// Everything WAVE collects stays in the browser (localStorage) — no
// network. The session intake reads the saved MAT type to pre-select
// its medication step so the patient isn't asked the same thing twice.

import type { MatType } from "@/types/models";

export interface OnboardingProfile {
  /** Display name / nickname, or null if skipped. */
  firstName: string | null;
  /** Mapped MAT type, or null when "Prefer not to say" / skipped. */
  matType: MatType | null;
  /** Usual dose time (HH:MM), or null. */
  doseTime: string | null;
  /** ISO timestamp of when the safety acknowledgement was checked. */
  consentedAt: string | null;
}

const STORAGE_KEY = "wave.onboarding.profile.v1";

const MAT_VALUES: readonly MatType[] = [
  "buprenorphine",
  "naltrexone",
  "vivitrol",
  "methadone",
  "none",
];

function isMatType(value: unknown): value is MatType {
  return (
    typeof value === "string" &&
    (MAT_VALUES as readonly string[]).includes(value)
  );
}

/**
 * Onboarding's medication choices, mapped to the canonical MatType the
 * session intake uses. "Prefer not to say" maps to null (no pre-fill).
 */
export const ONBOARDING_MAT_OPTIONS: ReadonlyArray<{
  label: string;
  value: MatType | null;
}> = [
  { label: "Buprenorphine / Suboxone", value: "buprenorphine" },
  { label: "Naltrexone (oral)", value: "naltrexone" },
  { label: "Vivitrol (injection)", value: "vivitrol" },
  { label: "Methadone", value: "methadone" },
  { label: "Not on MAT", value: "none" },
  { label: "Prefer not to say", value: null },
];

export function readOnboardingProfile(): OnboardingProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OnboardingProfile>;
    return {
      firstName:
        typeof parsed.firstName === "string" && parsed.firstName.length > 0
          ? parsed.firstName
          : null,
      matType: isMatType(parsed.matType) ? parsed.matType : null,
      doseTime:
        typeof parsed.doseTime === "string" ? parsed.doseTime : null,
      consentedAt:
        typeof parsed.consentedAt === "string" ? parsed.consentedAt : null,
    };
  } catch {
    return null;
  }
}

export function writeOnboardingProfile(profile: OnboardingProfile): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // localStorage full / disabled (private mode) — onboarding is
    // best-effort; the session intake still collects everything it needs.
  }
}

// ── useSyncExternalStore helpers ──────────────────────────────────────
// Lets the in-session intake read the saved MAT type without a
// hydration mismatch or a setState-in-effect: the server snapshot is
// null, the client snapshot is the stored primitive, and React swaps to
// the client value after hydration by design.

export function subscribeOnboardingProfile(): () => void {
  // The profile only changes across a full navigation (onboarding →
  // session), so there is nothing to subscribe to within a mounted tree.
  return () => {};
}

export function getOnboardingMatSnapshot(): MatType | null {
  return readOnboardingProfile()?.matType ?? null;
}

export function getOnboardingMatServerSnapshot(): MatType | null {
  return null;
}
