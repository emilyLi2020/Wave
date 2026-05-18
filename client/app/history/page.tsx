import Link from "next/link";

import { HistoryExportButton, RecentSessionsList } from "./recent-sessions";

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
        <HistoryExportButton />
      </div>

      <RecentSessionsList />

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
