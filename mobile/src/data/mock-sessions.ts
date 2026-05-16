/**
 * Single source of truth for the demo dataset shown across the
 * dashboard, history, and insights surfaces. Mirrors
 * client/lib/data/mock-sessions.ts — same authored sessions, same
 * derivation rules, same timezone-safe parsing. Kept duplicated rather
 * than shared because the mobile package has no link to the web
 * client and the file is pure TS with no DOM dependencies.
 */

import type { Session } from "@/types/models";

interface SessionInput {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  intake: number;
  ending: number;
  trigger: Session["trigger"];
  med: Session["medicationStatus"];
  outcome?: Session["outcome"];
  body?: Session["bodyScanLocation"];
  used?: boolean;
  journal?: string;
}

const RAW: SessionInput[] = [
  // ── Week of 3/21 ────────────────────────────────────────────
  { date: "2026-03-21", time: "17:30", intake: 6, ending: 2, trigger: "social", med: "on_time", body: "chest" },
  { date: "2026-03-21", time: "23:00", intake: 8, ending: 4, trigger: "social", med: "late", body: "jaw" },
  { date: "2026-03-22", time: "10:30", intake: 5, ending: 2, trigger: "physical", med: "missed", outcome: "left_early", body: "stomach", used: true },
  { date: "2026-03-23", time: "18:45", intake: 8, ending: 2, trigger: "stress", med: "on_time", body: "shoulders" },
  { date: "2026-03-23", time: "21:00", intake: 5, ending: 3, trigger: "stress", med: "on_time", body: "chest" },
  { date: "2026-03-24", time: "09:15", intake: 6, ending: 4, trigger: "physical", med: "late", body: "stomach" },
  { date: "2026-03-24", time: "15:00", intake: 5, ending: 3, trigger: "stress", med: "on_time", body: "chest" },
  { date: "2026-03-24", time: "19:00", intake: 7, ending: 2, trigger: "stress", med: "on_time", body: "chest" },
  { date: "2026-03-25", time: "20:15", intake: 7, ending: 2, trigger: "stress", med: "on_time", body: "jaw" },
  { date: "2026-03-26", time: "17:45", intake: 9, ending: 3, trigger: "stress", med: "on_time", body: "chest", journal: "End of work day. Closed laptop, sat with it." },
  { date: "2026-03-26", time: "19:00", intake: 8, ending: 3, trigger: "stress", med: "on_time", body: "shoulders" },
  { date: "2026-03-26", time: "22:30", intake: 7, ending: 3, trigger: "social", med: "late", body: "jaw" },
  { date: "2026-03-27", time: "07:30", intake: 4, ending: 2, trigger: "physical", med: "on_time", body: "stomach" },
  { date: "2026-03-27", time: "19:00", intake: 6, ending: 3, trigger: "stress", med: "on_time", body: "shoulders" },
  { date: "2026-03-27", time: "21:30", intake: 7, ending: 2, trigger: "social", med: "on_time", body: "chest" },

  // ── Week of 3/28 ────────────────────────────────────────────
  { date: "2026-03-28", time: "10:00", intake: 5, ending: 3, trigger: "stress", med: "on_time", body: "chest" },
  { date: "2026-03-28", time: "11:00", intake: 6, ending: 2, trigger: "unknown_or_other", med: "on_time", body: "legs" },
  { date: "2026-03-28", time: "22:00", intake: 8, ending: 3, trigger: "social", med: "on_time", body: "chest" },
  { date: "2026-03-29", time: "07:30", intake: 4, ending: 2, trigger: "physical", med: "missed", body: "stomach" },
  { date: "2026-03-29", time: "09:45", intake: 6, ending: 3, trigger: "physical", med: "missed", body: "stomach" },
  { date: "2026-03-30", time: "09:30", intake: 4, ending: 2, trigger: "physical", med: "on_time", body: "jaw" },
  { date: "2026-03-30", time: "18:30", intake: 7, ending: 2, trigger: "stress", med: "on_time", body: "shoulders" },
  { date: "2026-03-31", time: "08:00", intake: 5, ending: 2, trigger: "stress", med: "missed", outcome: "left_early", body: "stomach", used: true },
  { date: "2026-03-31", time: "19:45", intake: 7, ending: 2, trigger: "stress", med: "on_time", body: "chest" },
  { date: "2026-04-01", time: "19:00", intake: 8, ending: 3, trigger: "stress", med: "on_time", body: "jaw" },
  { date: "2026-04-02", time: "15:30", intake: 5, ending: 3, trigger: "stress", med: "on_time", body: "shoulders" },
  { date: "2026-04-02", time: "17:20", intake: 9, ending: 3, trigger: "stress", med: "on_time", body: "chest", journal: "Thursday again. Sat through it." },
  { date: "2026-04-02", time: "21:00", intake: 6, ending: 2, trigger: "stress", med: "on_time", body: "jaw" },
  { date: "2026-04-03", time: "10:00", intake: 5, ending: 3, trigger: "stress", med: "on_time", body: "jaw" },
  { date: "2026-04-03", time: "22:30", intake: 8, ending: 4, trigger: "social", med: "late", body: "chest" },

  // ── Week of 4/4 ─────────────────────────────────────────────
  { date: "2026-04-04", time: "13:00", intake: 6, ending: 2, trigger: "stress", med: "on_time", body: "shoulders" },
  { date: "2026-04-04", time: "16:00", intake: 5, ending: 3, trigger: "social", med: "on_time", body: "jaw" },
  { date: "2026-04-04", time: "23:15", intake: 9, ending: 4, trigger: "social", med: "on_time", body: "chest" },
  { date: "2026-04-05", time: "10:00", intake: 6, ending: 3, trigger: "physical", med: "missed", outcome: "left_early", body: "stomach" },
  { date: "2026-04-05", time: "16:00", intake: 5, ending: 3, trigger: "stress", med: "on_time", body: "chest" },
  { date: "2026-04-06", time: "12:30", intake: 6, ending: 2, trigger: "stress", med: "on_time", body: "jaw" },
  { date: "2026-04-06", time: "19:40", intake: 8, ending: 2, trigger: "stress", med: "on_time", body: "jaw" },
  { date: "2026-04-07", time: "18:15", intake: 7, ending: 2, trigger: "stress", med: "on_time", body: "chest" },
  { date: "2026-04-07", time: "21:30", intake: 5, ending: 3, trigger: "social", med: "on_time", body: "jaw" },
  { date: "2026-04-08", time: "07:00", intake: 4, ending: 2, trigger: "physical", med: "missed", body: "stomach" },
  { date: "2026-04-08", time: "15:00", intake: 7, ending: 2, trigger: "stress", med: "on_time", body: "shoulders" },
  { date: "2026-04-08", time: "20:30", intake: 8, ending: 3, trigger: "stress", med: "on_time", body: "chest" },
  { date: "2026-04-09", time: "10:00", intake: 5, ending: 2, trigger: "stress", med: "on_time", body: "jaw" },
  { date: "2026-04-09", time: "18:15", intake: 9, ending: 3, trigger: "stress", med: "on_time", body: "shoulders", journal: "Thursday evening, again." },
  { date: "2026-04-09", time: "19:30", intake: 8, ending: 3, trigger: "stress", med: "on_time", body: "shoulders" },
  { date: "2026-04-09", time: "22:45", intake: 7, ending: 3, trigger: "social", med: "late", body: "jaw" },
  { date: "2026-04-10", time: "13:00", intake: 4, ending: 2, trigger: "social", med: "on_time", body: "chest" },
  { date: "2026-04-10", time: "23:00", intake: 8, ending: 3, trigger: "social", med: "on_time", body: "chest" },

  // ── Week of 4/11 ────────────────────────────────────────────
  { date: "2026-04-11", time: "07:00", intake: 4, ending: 3, trigger: "physical", med: "missed", body: "stomach" },
  { date: "2026-04-11", time: "11:30", intake: 5, ending: 3, trigger: "physical", med: "missed", body: "stomach" },
  { date: "2026-04-11", time: "23:30", intake: 9, ending: 4, trigger: "social", med: "late", body: "chest", journal: "Party. Surfed it in the bathroom. Texted Jamie." },
  { date: "2026-04-12", time: "10:02", intake: 8, ending: 5, trigger: "physical", med: "missed", outcome: "left_early", body: "stomach", used: true, journal: "Felt sick. Couldn't finish the wave but stayed off." },
  { date: "2026-04-12", time: "20:30", intake: 8, ending: 2, trigger: "stress", med: "on_time", body: "jaw" },
  { date: "2026-04-13", time: "15:30", intake: 5, ending: 3, trigger: "stress", med: "on_time", body: "shoulders" },
  { date: "2026-04-13", time: "18:00", intake: 7, ending: 2, trigger: "stress", med: "on_time", body: "shoulders" },
  { date: "2026-04-14", time: "12:30", intake: 4, ending: 2, trigger: "stress", med: "on_time", body: "jaw" },
  { date: "2026-04-14", time: "19:30", intake: 7, ending: 2, trigger: "stress", med: "on_time", body: "chest" },
  { date: "2026-04-15", time: "10:00", intake: 5, ending: 3, trigger: "stress", med: "on_time", body: "chest" },
  { date: "2026-04-15", time: "14:30", intake: 6, ending: 2, trigger: "unknown_or_other", med: "on_time", body: "jaw" },
  { date: "2026-04-15", time: "21:14", intake: 7, ending: 2, trigger: "stress", med: "on_time", body: "jaw" },
  { date: "2026-04-16", time: "07:15", intake: 4, ending: 2, trigger: "physical", med: "late", body: "stomach" },
  { date: "2026-04-16", time: "12:00", intake: 6, ending: 2, trigger: "stress", med: "on_time", body: "jaw" },
  { date: "2026-04-16", time: "17:51", intake: 7, ending: 2, trigger: "stress", med: "on_time", body: "chest", journal: "Long Thursday. Closed laptop, sat with it. Felt the wave fall." },
  { date: "2026-04-16", time: "18:45", intake: 9, ending: 3, trigger: "stress", med: "on_time", body: "chest" },
  { date: "2026-04-16", time: "22:30", intake: 9, ending: 3, trigger: "social", med: "on_time", body: "chest" },
  { date: "2026-04-17", time: "15:30", intake: 5, ending: 3, trigger: "stress", med: "on_time", body: "jaw" },
  { date: "2026-04-17", time: "22:00", intake: 7, ending: 3, trigger: "social", med: "late", body: "chest" },
  { date: "2026-04-18", time: "23:00", intake: 9, ending: 3, trigger: "social", med: "on_time", body: "chest" },
  { date: "2026-04-19", time: "11:00", intake: 7, ending: 2, trigger: "stress", med: "on_time", body: "jaw" },
  { date: "2026-04-19", time: "18:30", intake: 6, ending: 3, trigger: "stress", med: "on_time", body: "jaw" },
];

function buildSession(input: SessionInput, idx: number): Session {
  const id = `s_${String(idx).padStart(3, "0")}`;
  const startedAt = `${input.date}T${input.time}:00`;
  const [hh, mm] = input.time.split(":").map(Number);
  const endMinutesTotal = hh * 60 + mm + 10;
  const endHh = Math.floor(endMinutesTotal / 60) % 24;
  const endMm = endMinutesTotal % 60;
  const endedAt = `${input.date}T${pad2(endHh)}:${pad2(endMm)}:00`;

  return {
    id,
    startedAt,
    endedAt,
    intakeIntensity: input.intake,
    endingIntensity: input.ending,
    medicationStatus: input.med,
    trigger: input.trigger,
    bodyScanLocation: input.body,
    outcome: input.outcome ?? "completed",
    usedSubstanceToday: input.used ?? false,
    ...(input.journal ? { journal: input.journal } : {}),
  };
}

/** Newest-first list of synthetic sessions. */
export const MOCK_SESSIONS: Session[] = RAW.map((r, i) =>
  buildSession(r, i + 1),
).reverse();

// ── Display labels ──────────────────────────────────────────────

export const TRIGGER_LABEL: Record<Session["trigger"], string> = {
  stress: "Stress / emotions",
  social: "Social situation",
  physical: "Physical sensation",
  unknown_or_other: "Don't know / other",
};

export const TRIGGER_INLINE_LABEL: Record<Session["trigger"], string> = {
  stress: "stress",
  social: "a social situation",
  physical: "a physical sensation",
  unknown_or_other: "don't know / other",
};

export const MEDICATION_LABEL: Record<Session["medicationStatus"], string> = {
  on_time: "Suboxone · on time",
  late: "Suboxone · late",
  missed: "Suboxone · missed",
  none: "No medication",
};

export const OUTCOME_LABEL: Record<Session["outcome"], string> = {
  completed: "Surfed",
  left_early: "Left early",
  used: "Used",
  safety_exited: "Safety exit",
};

// ── Date helpers (timezone-safe; parse the ISO string components) ──

function parseIsoParts(iso: string) {
  return {
    year: Number(iso.slice(0, 4)),
    month: Number(iso.slice(5, 7)),
    day: Number(iso.slice(8, 10)),
    hour: Number(iso.slice(11, 13)),
    minute: Number(iso.slice(14, 16)),
  };
}

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function jsWeekdayUtc(iso: string): number {
  const { year, month, day } = parseIsoParts(iso);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Mon=0 ... Sun=6 — matches the dashboard heatmap row order. */
function gridWeekday(iso: string): number {
  return (jsWeekdayUtc(iso) + 6) % 7;
}

/** Bucket an hour into the 6-column dashboard grid. */
function gridHour(hour: number): number {
  if (hour < 5) return 5; // late-night wraps onto the 9p column
  if (hour < 8) return 0; // 6a
  if (hour < 11) return 1; // 9a
  if (hour < 14) return 2; // 12p
  if (hour < 17) return 3; // 3p
  if (hour < 20) return 4; // 6p
  return 5; // 9p
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function format12Hour(hour: number, minute: number): string {
  const period = hour < 12 ? "AM" : "PM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${pad2(minute)} ${period}`;
}

export function formatSessionDate(iso: string): string {
  const { month, day, hour, minute } = parseIsoParts(iso);
  const wd = WEEKDAY_SHORT[jsWeekdayUtc(iso)];
  const mo = MONTH_SHORT[month - 1];
  return `${wd} · ${mo} ${day} · ${format12Hour(hour, minute)}`;
}

// ── Aggregate derivations ───────────────────────────────────────

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function dropOf(s: Session): number {
  return s.intakeIntensity - (s.endingIntensity ?? s.intakeIntensity);
}

const ON_TIME_DROPS = MOCK_SESSIONS.filter(
  (s) => s.medicationStatus === "on_time",
).map(dropOf);

const NON_MEDICATION_DROPS = MOCK_SESSIONS.filter(
  (s) => s.medicationStatus === "missed",
).map(dropOf);

const ALL_DROPS = MOCK_SESSIONS.map(dropOf);

export const MOCK_SESSION_STATS = {
  sessionsCount: MOCK_SESSIONS.length,
  avgDropPts: Number(average(ALL_DROPS).toFixed(1)),
  medicationDayDropPts: Number(average(ON_TIME_DROPS).toFixed(1)),
  nonMedicationDropPts: Number(average(NON_MEDICATION_DROPS).toFixed(1)),
} as const;

// ── 7×6 heatmap grid: rows Mon..Sun, cols 6a/9a/12p/3p/6p/9p ────

const RAW_GRID: number[][] = Array.from({ length: 7 }, () =>
  Array<number>(6).fill(0),
);

for (const s of MOCK_SESSIONS) {
  const { hour } = parseIsoParts(s.startedAt);
  const w = gridWeekday(s.startedAt);
  const h = gridHour(hour);
  RAW_GRID[w][h] += s.intakeIntensity / 10;
}

const GRID_MAX = Math.max(...RAW_GRID.flat(), 0.001);

/** Risk grid normalized to 0..1 per cell, tuned for the dashboard heatmap. */
export const MOCK_RISK_GRID: number[][] = RAW_GRID.map((row) =>
  row.map((v) => v / GRID_MAX),
);

// ── "This week" card ────────────────────────────────────────────

const LATEST_DATE_MS = Math.max(
  ...MOCK_SESSIONS.map((s) => {
    const { year, month, day } = parseIsoParts(s.startedAt);
    return Date.UTC(year, month - 1, day);
  }),
);

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const SESSIONS_THIS_WEEK = MOCK_SESSIONS.filter((s) => {
  const { year, month, day } = parseIsoParts(s.startedAt);
  const ts = Date.UTC(year, month - 1, day);
  return ts > LATEST_DATE_MS - ONE_WEEK_MS;
});

function topTrigger(sessions: Session[]): Session["trigger"] {
  const counts = new Map<Session["trigger"], number>();
  for (const s of sessions) {
    counts.set(s.trigger, (counts.get(s.trigger) ?? 0) + 1);
  }
  let best: Session["trigger"] = "stress";
  let bestCount = -1;
  for (const [trigger, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      best = trigger;
    }
  }
  return best;
}

export const MOCK_WEEK_SUMMARY = {
  surfedThisWeek: SESSIONS_THIS_WEEK.length,
  avgIntakeIntensityThisWeek: Number(
    average(SESSIONS_THIS_WEEK.map((s) => s.intakeIntensity)).toFixed(1),
  ),
  topTriggerThisWeek: topTrigger(SESSIONS_THIS_WEEK),
  adherenceThisWeek: { taken: 6, total: 7 },
} as const;

// ── Recent sessions slice for the history page ──────────────────

export interface RecentSessionRow {
  id: string;
  date: string;
  start: number;
  end: number;
  trigger: string;
  medication: string;
  outcome: string;
}

export const MOCK_RECENT_SESSIONS: RecentSessionRow[] = MOCK_SESSIONS.slice(0, 4).map(
  (s) => ({
    id: s.id,
    date: formatSessionDate(s.startedAt),
    start: s.intakeIntensity,
    end: s.endingIntensity ?? s.intakeIntensity,
    trigger: TRIGGER_LABEL[s.trigger],
    medication: MEDICATION_LABEL[s.medicationStatus],
    outcome: OUTCOME_LABEL[s.outcome],
  }),
);

// ── Static insights (default Gemma-on-device output stand-in) ───

export interface InsightCard {
  title: string;
  body: string;
  tag: string;
}

export const STATIC_INSIGHTS: InsightCard[] = [
  {
    title: "Your highest-risk window is Thursday 5-7 PM",
    body: "8 of your last 12 high-intensity cravings happened in this window, right after work. WAVE will fire a prophylactic notification at 4:45 PM each Thursday.",
    tag: "Time pattern",
  },
  {
    title: "Your medication reduces craving intensity by ~2.7 points",
    body: "Sessions on medication days start at an average of 5.1/10. Sessions on missed-dose days start at 7.8/10. That delta is visible in your own data.",
    tag: "Medication correlation",
  },
  {
    title: "Stress is your most common trigger",
    body: "Stress and emotions accounted for 8 of your last 12 sessions. This might be worth raising with your counselor next visit.",
    tag: "Trigger pattern",
  },
  {
    title: "You surf better in the evening",
    body: "Your average intensity drop is 5.2 points after 6 PM versus 3.1 in the morning. You might be tired but your nervous system is with you.",
    tag: "Performance pattern",
  },
];
