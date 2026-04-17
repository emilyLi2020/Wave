import Link from "next/link";

const intensityOptions = [3, 5, 7, 9];
const medicationOptions = [
  { value: "on_time", label: "Yes, on time" },
  { value: "late", label: "Yes, but late" },
  { value: "missed", label: "No — missed dose" },
  { value: "none", label: "I don't take medication" },
] as const;
const triggerOptions = [
  { value: "social", label: "Social situation" },
  { value: "stress", label: "Stress / emotions" },
  { value: "physical", label: "Physical sensation" },
  { value: "unknown", label: "I don't know" },
  { value: "other", label: "Other" },
] as const;

export default function SessionPage() {
  return (
    <section className="mx-auto max-w-3xl px-6 py-16">
      <nav aria-label="Breadcrumb" className="text-sm text-foreground/60">
        <Link href="/" className="hover:text-accent">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span>Session</span>
      </nav>

      <h1 className="mt-4 text-3xl font-semibold tracking-tight">
        You&apos;re here. That&apos;s the hardest part.
      </h1>
      <p className="mt-2 text-foreground/70">
        Three taps to start. No typing. The rest of the session adapts to what
        you pick.
      </p>

      <div className="mt-10 space-y-8">
        <article className="rounded-2xl border border-border bg-surface p-6">
          <header className="flex items-center justify-between">
            <h2 className="font-semibold">
              1. How intense is this craving right now?
            </h2>
            <span className="text-xs uppercase tracking-wide text-foreground/50">
              Intake
            </span>
          </header>
          <div className="mt-4 grid grid-cols-4 gap-3">
            {intensityOptions.map((value) => (
              <button
                key={value}
                type="button"
                className="rounded-xl border border-border bg-surface-muted py-4 text-lg font-semibold hover:border-accent hover:text-accent transition"
              >
                {value}/10
              </button>
            ))}
          </div>
        </article>

        <article className="rounded-2xl border border-border bg-surface p-6">
          <h2 className="font-semibold">
            2. Did you take your medication today?
          </h2>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {medicationOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className="text-left rounded-xl border border-border bg-surface-muted px-4 py-3 text-sm hover:border-accent hover:text-accent transition"
              >
                {option.label}
              </button>
            ))}
          </div>
        </article>

        <article className="rounded-2xl border border-border bg-surface p-6">
          <h2 className="font-semibold">3. What triggered this?</h2>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {triggerOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className="text-left rounded-xl border border-border bg-surface-muted px-4 py-3 text-sm hover:border-accent hover:text-accent transition"
              >
                {option.label}
              </button>
            ))}
          </div>
        </article>

        <article className="rounded-2xl border border-border bg-gradient-to-b from-accent-soft/50 to-surface p-6">
          <h2 className="font-semibold">The wave</h2>
          <p className="mt-2 text-sm text-foreground/70">
            Once the three taps are in, this area will host the Lottie wave
            animation, adaptive Gemma 4 narration, and a live intensity slider
            the patient drags through the rise, peak, and fall.
          </p>
          <div
            aria-hidden
            className="mt-6 h-40 rounded-xl border border-border bg-surface relative overflow-hidden"
          >
            <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-wave-peak/40 via-wave-rise/20 to-transparent" />
            <div className="absolute inset-0 flex items-center justify-center text-sm text-foreground/50">
              Wave animation placeholder
            </div>
          </div>
        </article>

        <article className="rounded-2xl border border-border bg-surface p-6">
          <h2 className="font-semibold">Reflection &amp; next step</h2>
          <p className="mt-2 text-sm text-foreground/70">
            After the wave, WAVE will show the patient their drop, their
            longitudinal average, their medication correlation, and ask what
            they&apos;ll do in the next ten minutes.
          </p>
        </article>

        <div className="flex items-center justify-between pt-4">
          <Link
            href="/"
            className="text-sm text-foreground/60 hover:text-accent"
          >
            ← Leave session
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-accent-foreground font-medium hover:opacity-90"
          >
            Finish and see dashboard →
          </Link>
        </div>
      </div>
    </section>
  );
}
