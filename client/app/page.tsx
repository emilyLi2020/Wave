import Link from "next/link";

const features = [
  {
    title: "Three-tap intake",
    description:
      "Intensity, medication status, trigger. No typing required to start a session — meet the craving in 30 seconds.",
  },
  {
    title: "Medication-aware acknowledgment",
    description:
      "Pharmacologically correct, trauma-informed copy tuned to whether you took your Suboxone, missed a dose, or are on Naltrexone.",
  },
  {
    title: "Ride the wave",
    description:
      "An animated wave with adaptive narration for the rise, peak, and fall — plus a live slider so you can feel the drop.",
  },
  {
    title: "Your data, shown back to you",
    description:
      "After seven sessions, see how much further cravings fall on medication days. Adherence becomes something you can see.",
  },
  {
    title: "Prophylactic notifications",
    description:
      "Your history predicts your high-risk windows. WAVE pings you fifteen minutes before, while you still have agency.",
  },
  {
    title: "Offline-first and private",
    description:
      "The production app runs Gemma 4 on-device. No account, no upload, no cloud. Your recovery stays on your phone.",
  },
];

export default function LandingPage() {
  return (
    <div>
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-gradient-to-b from-accent-soft/40 via-background to-background"
        />
        <div className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
          <p className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-foreground/70">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            Marlatt&apos;s MBRP protocol, personalized in real time
          </p>
          <h1 className="mt-6 text-4xl sm:text-6xl font-semibold tracking-tight max-w-3xl">
            Cravings are waves.{" "}
            <span className="text-accent">You can learn to surf them.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-foreground/70">
            WAVE is an offline-first, medication-aware urge surfing companion
            for SUD recovery. It learns your personal high-risk windows,
            notifies you before the next craving peaks, and guides you through
            evidence-based sessions tuned to what&apos;s actually happening in
            your body — including whether your medication is working right now.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link
              href="/session"
              className="inline-flex items-center gap-2 rounded-full bg-accent px-6 py-3 text-accent-foreground font-medium shadow-sm hover:opacity-90 transition"
            >
              Start a session
              <span aria-hidden>→</span>
            </Link>
            <Link
              href="/onboarding"
              className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-6 py-3 font-medium text-foreground/80 hover:border-accent hover:text-accent transition"
            >
              First time? Begin onboarding
            </Link>
          </div>
          <p className="mt-6 text-xs text-foreground/50 max-w-2xl">
            If you are in crisis, call or text 988 (Suicide &amp; Crisis
            Lifeline) or call SAMHSA&apos;s National Helpline at
            1-800-662-HELP. WAVE is a support tool, not a substitute for a
            counselor, prescriber, or crisis line.
          </p>
        </div>
      </section>

      <section className="border-t border-border bg-surface-muted/40">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <h2 className="text-2xl font-semibold tracking-tight">
            What WAVE does
          </h2>
          <p className="mt-2 max-w-2xl text-foreground/70">
            Six things every other urge-surfing tool misses.
          </p>
          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <li
                key={feature.title}
                className="rounded-2xl border border-border bg-surface p-6"
              >
                <h3 className="font-semibold">{feature.title}</h3>
                <p className="mt-2 text-sm text-foreground/70 leading-relaxed">
                  {feature.description}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-16 grid gap-10 lg:grid-cols-[1.1fr_0.9fr] items-start">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">
              The medication difference
            </h2>
            <p className="mt-3 text-foreground/70 leading-relaxed">
              A 7/10 craving at hour 4 post-Suboxone is not the same craving as
              one at hour 22. Generic apps ignore this. WAVE doesn&apos;t.
            </p>
            <blockquote className="mt-6 rounded-2xl border-l-4 border-accent bg-surface p-6 text-foreground/80">
              &ldquo;Your Suboxone is working right now. What you&apos;re
              feeling at a 7 would be a 9 or 10 without it. Let&apos;s work
              with what&apos;s left.&rdquo;
              <footer className="mt-3 text-xs uppercase tracking-wide text-foreground/50">
                Example of a medication-aware acknowledgment generated during a
                WAVE session.
              </footer>
            </blockquote>
          </div>
          <div className="rounded-2xl border border-border bg-surface p-6 space-y-4">
            <h3 className="font-semibold">Your privacy pledge</h3>
            <ul className="space-y-3 text-sm text-foreground/70">
              <li>
                <span className="font-medium text-foreground">No account.</span>{" "}
                You do not sign up. You open the app.
              </li>
              <li>
                <span className="font-medium text-foreground">
                  On-device AI.
                </span>{" "}
                The production app runs Gemma 4 entirely on your phone. Zero
                network traffic during sessions.
              </li>
              <li>
                <span className="font-medium text-foreground">
                  Photos never leave.
                </span>{" "}
                Medication photos are processed in memory and discarded.
              </li>
              <li>
                <span className="font-medium text-foreground">
                  Your data stays yours.
                </span>{" "}
                Exports to a clinician are opt-in local files you choose to
                share.
              </li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
