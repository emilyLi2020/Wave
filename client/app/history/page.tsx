import Link from "next/link";

const sessions = [
  {
    id: "s_012",
    date: "Thu · Apr 16 · 5:51 PM",
    start: 7,
    end: 2,
    trigger: "Stress / emotions",
    medication: "Suboxone · on time",
    outcome: "Surfed",
  },
  {
    id: "s_011",
    date: "Wed · Apr 15 · 9:14 PM",
    start: 6,
    end: 3,
    trigger: "Social situation",
    medication: "Suboxone · on time",
    outcome: "Surfed",
  },
  {
    id: "s_010",
    date: "Sun · Apr 12 · 10:02 AM",
    start: 8,
    end: 5,
    trigger: "Physical sensation",
    medication: "Suboxone · missed",
    outcome: "Left early",
  },
  {
    id: "s_009",
    date: "Sat · Apr 11 · 11:30 PM",
    start: 9,
    end: 4,
    trigger: "Social situation",
    medication: "Suboxone · late",
    outcome: "Surfed",
  },
];

function outcomeStyles(outcome: string) {
  if (outcome === "Surfed") {
    return "bg-accent-soft text-accent";
  }
  if (outcome === "Left early") {
    return "bg-warn-soft text-warn";
  }
  return "bg-danger-soft text-danger";
}

export default function HistoryPage() {
  return (
    <section className="mx-auto max-w-4xl px-6 py-16">
      <nav aria-label="Breadcrumb" className="text-sm text-foreground/60">
        <Link href="/" className="hover:text-accent">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span>History</span>
      </nav>

      <div className="mt-4 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Every wave you&apos;ve surfed
          </h1>
          <p className="mt-2 text-foreground/70">
            Tap a session to see its adaptive narration, body-scan location,
            and journal entry. Export anything you want to share with your
            clinician.
          </p>
        </div>
        <button
          type="button"
          className="rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium hover:border-accent hover:text-accent transition"
        >
          Export PDF for clinician
        </button>
      </div>

      <ul className="mt-10 space-y-3">
        {sessions.map((session) => (
          <li
            key={session.id}
            className="rounded-2xl border border-border bg-surface p-5 grid gap-3 sm:grid-cols-[auto_1fr_auto] sm:items-center"
          >
            <div>
              <p className="text-sm text-foreground/60">{session.date}</p>
              <p className="text-xs text-foreground/40">ID {session.id}</p>
            </div>
            <div className="grid gap-1 text-sm">
              <p>
                <span className="font-medium">{session.start}</span> →{" "}
                <span className="font-medium text-accent">{session.end}</span>{" "}
                <span className="text-foreground/50">· drop of {session.start - session.end}</span>
              </p>
              <p className="text-foreground/60">
                {session.trigger} · {session.medication}
              </p>
            </div>
            <span
              className={`justify-self-start sm:justify-self-end rounded-full px-3 py-1 text-xs font-medium ${outcomeStyles(session.outcome)}`}
            >
              {session.outcome}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-10 flex items-center justify-between">
        <Link
          href="/dashboard"
          className="text-sm text-foreground/60 hover:text-accent"
        >
          ← Back to dashboard
        </Link>
        <Link
          href="/insights"
          className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-accent-foreground font-medium hover:opacity-90"
        >
          See patterns &amp; insights →
        </Link>
      </div>
    </section>
  );
}
