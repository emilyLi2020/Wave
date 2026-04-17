import Link from "next/link";

const stats = [
  { label: "Sessions surfed", value: "12", hint: "Last 30 days" },
  { label: "Average intensity drop", value: "4.3 pts", hint: "Across all sessions" },
  { label: "Medication-day drop", value: "5.1 pts", hint: "When dose was on time" },
  { label: "Non-medication drop", value: "2.8 pts", hint: "When dose was missed" },
];

const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const hours = ["6a", "9a", "12p", "3p", "6p", "9p"];

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
                    const intensity =
                      ((dayIndex * 3 + hourIndex * 2) % 10) / 10;
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
          You&apos;ve surfed 4 cravings this week with an average starting
          intensity of 6.5. Your most common trigger was{" "}
          <span className="font-medium text-foreground">stress</span>. Your
          medication adherence this week is{" "}
          <span className="font-medium text-foreground">6 of 7 days</span>.
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
