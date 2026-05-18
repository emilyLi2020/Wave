import Link from "next/link";

import {
  MOCK_RISK_GRID,
  MOCK_SESSION_STATS,
  MOCK_WEEK_SUMMARY,
  TRIGGER_LABEL,
} from "@/lib/data/mock-sessions";
import { SessionsSurfedValue } from "./sessions-surfed-value";

const stats: { label: string; value: React.ReactNode; hint: string }[] = [
  {
    label: "Sessions surfed",
    value: <SessionsSurfedValue base={MOCK_SESSION_STATS.sessionsCount} />,
    hint: "Last 30 days",
  },
  {
    label: "Average intensity drop",
    value: `${MOCK_SESSION_STATS.avgDropPts.toFixed(1)} pts`,
    hint: "Across all sessions",
  },
  {
    label: "Medication-day drop",
    value: `${MOCK_SESSION_STATS.medicationDayDropPts.toFixed(1)} pts`,
    hint: "When dose was on time",
  },
  {
    label: "Non-medication drop",
    value: `${MOCK_SESSION_STATS.nonMedicationDropPts.toFixed(1)} pts`,
    hint: "When dose was missed",
  },
];

const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const hours = ["6a", "9a", "12p", "3p", "6p", "9p"];

const TRIGGER_INLINE_LABEL: Record<keyof typeof TRIGGER_LABEL, string> = {
  stress: "stress",
  social: "a social situation",
  physical: "a physical sensation",
  unknown_or_other: "don't know / other",
};

export default function DashboardPage() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-16">
      <nav aria-label="Breadcrumb" className="text-sm text-foreground/60">
        <Link href="/" className="hover:text-accent">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span>Dashboard</span>
      </nav>

      <h1 className="mt-4 text-3xl font-semibold tracking-tight">
        Your recovery, in your own numbers
      </h1>
      <p className="mt-2 text-foreground/70">
        Everything here is computed on your device from the sessions you&apos;ve
        logged. Adherence becomes something you can see, not something someone
        told you to do.
      </p>

      <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <li
            key={stat.label}
            className="rounded-2xl border border-border bg-surface p-5"
          >
            <p className="text-xs uppercase tracking-wide text-foreground/50">
              {stat.label}
            </p>
            <p className="mt-2 text-3xl font-semibold">{stat.value}</p>
            <p className="mt-1 text-xs text-foreground/50">{stat.hint}</p>
          </li>
        ))}
      </ul>

      <article className="mt-10 rounded-2xl border border-border bg-surface p-6">
        <header className="flex items-center justify-between">
          <h2 className="font-semibold">High-risk windows</h2>
          <span className="text-xs uppercase tracking-wide text-foreground/50">
            Last 30 days
          </span>
        </header>
        <p className="mt-2 text-sm text-foreground/70">
          Cells shaded darker show times when your history has the most
          high-intensity cravings. Proactive notifications target these
          windows.
        </p>
        <div className="mt-6 overflow-x-auto">
          <table className="w-full border-separate border-spacing-1 text-xs">
            <thead>
              <tr>
                <th className="text-left font-medium text-foreground/50 pr-2"></th>
                {hours.map((hour) => (
                  <th
                    key={hour}
                    className="font-medium text-foreground/50"
                    scope="col"
                  >
                    {hour}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weekdays.map((day, dayIndex) => (
                <tr key={day}>
                  <th
                    scope="row"
                    className="text-left font-medium text-foreground/50 pr-2"
                  >
                    {day}
                  </th>
                  {hours.map((hour, hourIndex) => {
                    const intensity = MOCK_RISK_GRID[dayIndex]?.[hourIndex] ?? 0;
                    return (
                      <td
                        key={hour}
                        className="h-8 rounded border border-border"
                        style={{
                          backgroundColor: `color-mix(in oklab, var(--accent) ${Math.round(
                            intensity * 80,
                          )}%, var(--surface-muted))`,
                        }}
                        aria-label={`${day} ${hour}: relative risk ${Math.round(
                          intensity * 100,
                        )}%`}
                      />
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      <article className="mt-6 rounded-2xl border border-border bg-surface p-6">
        <h2 className="font-semibold">This week</h2>
        <p className="mt-2 text-sm text-foreground/70">
          You&apos;ve surfed {MOCK_WEEK_SUMMARY.surfedThisWeek} cravings this
          week with an average starting intensity of{" "}
          {MOCK_WEEK_SUMMARY.avgIntakeIntensityThisWeek.toFixed(1)}. Your most
          common trigger was{" "}
          <span className="font-medium text-foreground">
            {TRIGGER_INLINE_LABEL[MOCK_WEEK_SUMMARY.topTriggerThisWeek]}
          </span>
          . Your medication adherence this week is{" "}
          <span className="font-medium text-foreground">
            {MOCK_WEEK_SUMMARY.adherenceThisWeek.taken} of{" "}
            {MOCK_WEEK_SUMMARY.adherenceThisWeek.total} days
          </span>
          .
        </p>
      </article>

      <div className="mt-10 flex items-center justify-between">
        <Link
          href="/session"
          className="text-sm text-foreground/60 hover:text-accent"
        >
          ← Start another session
        </Link>
        <Link
          href="/history"
          className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-accent-foreground font-medium hover:opacity-90"
        >
          See full history →
        </Link>
      </div>
    </section>
  );
}
