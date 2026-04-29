import Link from "next/link";

const features = [
  {
    title: "Three-tap intake",
    description:
      "Intensity, medication status, trigger. No typing required to start a session, meet the craving in 30 seconds.",
  },
  {
    title: "Medication-aware acknowledgment",
    description:
      "Pharmacologically correct, trauma-informed copy tuned to whether you took your Suboxone, missed a dose, or are on Naltrexone.",
  },
  {
    title: "Ride the wave",
    description:
      "An animated wave with adaptive narration for the rise, peak, and fall, plus a live slider so you can feel the drop.",
  },
  {
    title: "Your data, shown back to you",
    description:
      "After seven sessions, see how much further cravings fall on medication days. Adherence becomes something you can see.",
  },
  {
    title: "Prophylactic notifications",
    description:
      "Your history predicts your high-risk windows. WAVE pings you 15 minutes before, while you still have agency.",
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
        <HomeWaveBackground />
        <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl flex-col items-center justify-center px-6 py-20 text-center sm:py-28">
          <p className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-foreground/70">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            Marlatt&apos;s MBRP protocol, personalized in real time
          </p>
          <h1 className="mt-6 max-w-4xl text-4xl font-semibold tracking-tight sm:text-6xl">
            When a craving hits, start here.
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-foreground/70">
            One clear path into an urge-surfing session. No account, no setup,
            no typing required to begin.
          </p>
          <div className="mt-10 flex w-full max-w-2xl flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            <Link
              href="/session"
              className="inline-flex min-h-24 flex-1 items-center justify-center gap-3 rounded-[2rem] bg-accent px-8 py-7 text-center text-2xl font-semibold tracking-tight text-accent-foreground shadow-lg shadow-accent/20 transition hover:-translate-y-0.5 hover:opacity-90 focus:outline-none focus:ring-4 focus:ring-accent/20 sm:text-3xl"
            >
              Start Session
              <span aria-hidden>→</span>
            </Link>
            <Link
              href="/onboarding"
              className="inline-flex items-center justify-center rounded-full border border-border bg-surface/90 px-5 py-3 text-sm font-medium text-foreground/75 shadow-sm backdrop-blur transition hover:border-accent hover:text-accent focus:outline-none focus:ring-4 focus:ring-accent/10 sm:self-end"
            >
              First time? Build profile
            </Link>
          </div>
          <p className="mt-8 max-w-2xl text-lg text-foreground/70">
            WAVE is an offline-first, medication-aware urge surfing companion
            for SUD recovery. It learns your personal high-risk windows,
            notifies you before the next craving peaks, and guides you through
            evidence-based sessions tuned to what&apos;s actually happening in
            your body, including whether your medication is working right now.
          </p>
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

function HomeWaveBackground() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
      <div className="absolute inset-x-[-20%] top-0 h-[34rem] opacity-70 blur-3xl">
        <div className="h-full rounded-full bg-gradient-to-r from-wave-fall/40 via-accent-soft to-wave-rise/40" />
      </div>
      <div className="absolute inset-x-0 bottom-0 h-[48%] bg-gradient-to-t from-wave-peak/30 via-wave-rise/14 to-transparent" />
      <OceanLayer
        className="absolute left-1/2 bottom-[-2rem] w-[1800px] -translate-x-1/2 text-wave-peak opacity-35"
        durationSec={36}
        heightClassName="h-72"
      />
      <OceanLayer
        className="absolute left-1/2 bottom-12 w-[1600px] -translate-x-1/2 text-wave-rise opacity-25"
        durationSec={28}
        heightClassName="h-60"
      />
      <OceanLayer
        className="absolute left-1/2 bottom-28 w-[1400px] -translate-x-1/2 text-wave-fall opacity-20 blur-[1px]"
        durationSec={44}
        heightClassName="h-48"
      />
    </div>
  );
}

function OceanLayer({
  className,
  durationSec,
  heightClassName,
}: {
  className: string;
  durationSec: number;
  heightClassName: string;
}) {
  return (
    <div className={`${className} overflow-hidden`}>
      <div
        className="flex"
        style={{
          width: "200%",
          animation: `wave-slide ${durationSec}s linear infinite`,
        }}
      >
        <OceanSvg heightClassName={heightClassName} />
        <OceanSvg heightClassName={heightClassName} />
      </div>
    </div>
  );
}

function OceanSvg({ heightClassName }: { heightClassName: string }) {
  return (
    <svg
      className={`${heightClassName} w-1/2 flex-none`}
      viewBox="0 0 900 260"
      preserveAspectRatio="none"
    >
      <path
        d="M0 96 C75 28 150 28 225 96 C300 164 375 164 450 96 C525 28 600 28 675 96 C750 164 825 164 900 96 V260 H0 Z"
        fill="currentColor"
      />
      <path
        d="M0 128 C75 72 150 72 225 128 C300 184 375 184 450 128 C525 72 600 72 675 128 C750 184 825 184 900 128 V260 H0 Z"
        fill="currentColor"
        opacity="0.45"
      />
    </svg>
  );
}
