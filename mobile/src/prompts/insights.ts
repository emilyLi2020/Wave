import type { Session } from "@/types/models";

interface BuiltPrompt {
  systemPrompt: string;
  userPrompt: string;
}

const SYSTEM_PROMPT = `<role>
You write the "What Wave noticed" cards on the WAVE insights page for an adult in Substance Use Disorder recovery. You are reasoning over the patient's own session log, not generic SUD literature.
</role>

<voice>
- Trauma-informed, second-person, warm, concrete, plain English. Sound like a thoughtful peer, not a database report.
- Each card has three fields: a short \`tag\` (3-30 chars, like "Time pattern" or "Trigger pattern"), a one-sentence \`title\` (10-120 chars) that names the pattern, and a \`body\` (40-400 chars, 2-4 sentences) that grounds the pattern in numbers drawn from the input.
- Patterns must be descriptive, not prescriptive. Name what the data shows; do not tell the patient what to change.
</voice>

<plain_english>
- NEVER use code-like or schema-like notation in patient-facing copy. Say "missed-dose days", not "med:missed". Say "on-time-dose days", not "med:on-time". Say "you said you'd used a substance that day", not "usedSubstanceToday=true" or "usedSubstanceToday:yes". Say "your session log shows", not "aggregates" or "the aggregates show".
- NEVER mention field names, JSON keys, tags, brackets, parentheses citing data sources, or any artifact of the input format.
- NEVER include parenthetical citations like "(aggregates)" or "(sessions)". Just state the number naturally: "across your 70 sessions" or "in 4 of those sessions".
- Time references should sound natural: "Thursday between 5 and 8 PM", not "Thu 5p-8p" or "the Thu/5p band".
- Phrases like "left early", "on-time-dose", "missed-dose", "social trigger", "stress trigger", "physical trigger", "body region" are fine. Internal field names are not.
</plain_english>

<never>
- NEVER invent statistics. Every number you cite must trace back to a row or aggregate in the input.
- NEVER prescribe medication. NEVER tell the patient to start, stop, or change a dose. You may say "this might be worth raising with your prescriber" — you may not say "you should take more".
- NEVER use toxic positivity ("you've got this", "stay strong", "amazing job").
- NEVER call a session a "relapse" and NEVER moralize about substance use. The "used a substance that day" signal is clinical context, not a verdict.
- NEVER produce more than 5 cards or fewer than 3.
</never>

<output>
Strict JSON matching the supplied schema: \`{ "insights": [ { "tag", "title", "body" }, ... ] }\`.
</output>`;

const TRIGGER_LINE: Record<Session["trigger"], string> = {
  stress: "stress",
  social: "social",
  physical: "physical",
  unknown_or_other: "unknown_or_other",
};

const STATUS_LINE: Record<Session["medicationStatus"], string> = {
  on_time: "dose on time",
  late: "dose late",
  missed: "dose missed",
  none: "no medication",
};

const OUTCOME_LINE: Record<Session["outcome"], string> = {
  completed: "completed",
  left_early: "ended early",
  used: "used",
  safety_exited: "safety exit",
};

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function parseIsoParts(iso: string) {
  return {
    year: Number(iso.slice(0, 4)),
    month: Number(iso.slice(5, 7)),
    day: Number(iso.slice(8, 10)),
    hour: Number(iso.slice(11, 13)),
    minute: Number(iso.slice(14, 16)),
  };
}

function weekdayLabel(iso: string): string {
  const { year, month, day } = parseIsoParts(iso);
  const wd = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return WEEKDAY[wd];
}

function dropOf(s: Session): number {
  return s.intakeIntensity - (s.endingIntensity ?? s.intakeIntensity);
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function sessionLine(s: Session): string {
  const { month, day, hour, minute } = parseIsoParts(s.startedAt);
  const wd = weekdayLabel(s.startedAt);
  const dropPiece =
    s.endingIntensity !== undefined
      ? `started ${s.intakeIntensity}, ended ${s.endingIntensity}, drop ${dropOf(s)}`
      : `started ${s.intakeIntensity}, no end recorded`;
  const usedPiece = s.usedSubstanceToday
    ? "; patient said they had used a substance that day"
    : "";
  const bodyPiece = s.bodyScanLocation
    ? `; body region noted: ${s.bodyScanLocation}`
    : "";
  const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  return `- ${wd} ${month}/${day} ${time}: ${dropPiece}; ${TRIGGER_LINE[s.trigger]} trigger; ${STATUS_LINE[s.medicationStatus]}; ${OUTCOME_LINE[s.outcome]}${bodyPiece}${usedPiece}`;
}

interface Aggregates {
  totalSessions: number;
  avgDrop: number;
  onTimeAvgDrop: number | null;
  missedAvgDrop: number | null;
  lateAvgDrop: number | null;
  topTrigger: { name: Session["trigger"]; count: number };
  topWeekdayHourCluster: {
    weekday: string;
    hourBand: string;
    count: number;
  } | null;
  usedTodayCount: number;
  leftEarlyCount: number;
}

function computeAggregates(sessions: Session[]): Aggregates {
  const onTime = sessions.filter((s) => s.medicationStatus === "on_time").map(dropOf);
  const missed = sessions.filter((s) => s.medicationStatus === "missed").map(dropOf);
  const late = sessions.filter((s) => s.medicationStatus === "late").map(dropOf);

  const triggerCounts = new Map<Session["trigger"], number>();
  for (const s of sessions) {
    triggerCounts.set(s.trigger, (triggerCounts.get(s.trigger) ?? 0) + 1);
  }
  let topTrigger: { name: Session["trigger"]; count: number } = {
    name: "stress",
    count: 0,
  };
  for (const [name, count] of triggerCounts) {
    if (count > topTrigger.count) topTrigger = { name, count };
  }

  // (weekday × 3-hour band) cluster — labels written in plain English so
  // the model has nothing schema-like to copy into patient-facing copy.
  const bandFor = (h: number): string => {
    if (h < 5) return "between 9 PM and midnight";
    if (h < 8) return "between 5 and 8 AM";
    if (h < 11) return "between 8 and 11 AM";
    if (h < 14) return "between 11 AM and 2 PM";
    if (h < 17) return "between 2 and 5 PM";
    if (h < 20) return "between 5 and 8 PM";
    return "between 8 and 11 PM";
  };
  const cluster = new Map<string, number>();
  for (const s of sessions) {
    const { hour } = parseIsoParts(s.startedAt);
    const key = `${weekdayLabel(s.startedAt)}|${bandFor(hour)}`;
    cluster.set(key, (cluster.get(key) ?? 0) + 1);
  }
  let top: { weekday: string; hourBand: string; count: number } | null = null;
  for (const [key, count] of cluster) {
    if (!top || count > top.count) {
      const [weekday, hourBand] = key.split("|");
      top = { weekday, hourBand, count };
    }
  }

  return {
    totalSessions: sessions.length,
    avgDrop: average(sessions.map(dropOf)),
    onTimeAvgDrop: onTime.length === 0 ? null : average(onTime),
    missedAvgDrop: missed.length === 0 ? null : average(missed),
    lateAvgDrop: late.length === 0 ? null : average(late),
    topTrigger,
    topWeekdayHourCluster: top,
    usedTodayCount: sessions.filter((s) => s.usedSubstanceToday).length,
    leftEarlyCount: sessions.filter((s) => s.outcome === "left_early").length,
  };
}

function fmt(n: number | null): string {
  return n === null ? "n/a" : n.toFixed(1);
}

export function buildInsightsPrompt(sessions: Session[]): BuiltPrompt {
  const agg = computeAggregates(sessions);

  const aggLines = [
    `- total sessions: ${agg.totalSessions}`,
    `- average intensity drop overall: ${fmt(agg.avgDrop)} points`,
    `- average drop on on-time-dose days: ${fmt(agg.onTimeAvgDrop)} points`,
    `- average drop on missed-dose days: ${fmt(agg.missedAvgDrop)} points`,
    `- average drop on late-dose days: ${fmt(agg.lateAvgDrop)} points`,
    `- most common trigger: ${agg.topTrigger.name} (${agg.topTrigger.count} of ${agg.totalSessions} sessions)`,
    agg.topWeekdayHourCluster
      ? `- densest time window: ${agg.topWeekdayHourCluster.weekday} ${agg.topWeekdayHourCluster.hourBand} (${agg.topWeekdayHourCluster.count} session${agg.topWeekdayHourCluster.count === 1 ? "" : "s"})`
      : `- densest time window: not enough data`,
    `- sessions where the patient said they had used a substance that day: ${agg.usedTodayCount}`,
    `- sessions that ended early: ${agg.leftEarlyCount}`,
  ];

  const sessionLines = sessions.map(sessionLine);

  const userPrompt = [
    "<session_log>",
    "One line per session, in plain English.",
    ...sessionLines,
    "</session_log>",
    "",
    "<summary_numbers>",
    ...aggLines,
    "</summary_numbers>",
    "",
    "<task>",
    "Produce 3-5 insight cards reasoning over the session log and summary numbers above. Each card MUST cite at least one specific number from the input. Vary the tags so the cards do not repeat (good tag examples: \"Time pattern\", \"Trigger pattern\", \"Medication correlation\", \"Performance pattern\", \"Body cue\", \"Stamina\"). Order from most actionable to most observational.",
    "Write every card in plain, warm second-person English. Do NOT echo internal labels or schema fragments such as \"med:missed\", \"usedSubstanceToday\", \"aggregates\", \"sessions\", \"med:on-time\", \"5p-8p\", or any colon-separated key/value pairs. Convert them to natural phrases like \"missed-dose days\", \"on-time-dose days\", \"Thursday between 5 and 8 PM\", \"days you said you'd used a substance\", \"your session log\".",
    "</task>",
    "",
    "<output_shape>",
    '{"insights": [{"tag": "<3-30 chars>", "title": "<10-120 chars>", "body": "<40-400 chars, 2-4 sentences>"}, ...]}',
    "</output_shape>",
  ].join("\n");

  return { systemPrompt: SYSTEM_PROMPT, userPrompt };
}
