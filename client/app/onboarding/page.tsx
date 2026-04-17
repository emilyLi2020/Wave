import Link from "next/link";

export default function OnboardingPage() {
  return (
    <section className="mx-auto max-w-2xl px-6 py-16">
      <nav aria-label="Breadcrumb" className="text-sm text-foreground/60">
        <Link href="/" className="hover:text-accent">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span>Onboarding</span>
      </nav>

      <h1 className="mt-4 text-3xl font-semibold tracking-tight">
        Let&apos;s set up your WAVE
      </h1>
      <p className="mt-2 text-foreground/70">
        Three quick questions. Everything stays on your device. You can skip
        any of them.
      </p>

      <form className="mt-10 space-y-8" aria-label="Onboarding">
        <fieldset className="space-y-3">
          <legend className="font-medium">
            What should WAVE call you? <span className="text-foreground/50 font-normal">(Optional)</span>
          </legend>
          <input
            type="text"
            name="firstName"
            placeholder="First name or nickname"
            className="w-full rounded-xl border border-border bg-surface px-4 py-3 placeholder:text-foreground/40 focus:outline-none focus:border-accent"
          />
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="font-medium">
            Are you on Medication-Assisted Treatment (MAT)?
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              "Buprenorphine / Suboxone",
              "Naltrexone (oral)",
              "Vivitrol (injection)",
              "Methadone",
              "Not on MAT",
              "Prefer not to say",
            ].map((option) => (
              <label
                key={option}
                className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 cursor-pointer hover:border-accent"
              >
                <input
                  type="radio"
                  name="medication"
                  value={option}
                  className="accent-accent"
                />
                <span className="text-sm">{option}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="font-medium">
            When do you usually take your dose?{" "}
            <span className="text-foreground/50 font-normal">
              (Helps WAVE spot missed-dose patterns)
            </span>
          </legend>
          <input
            type="time"
            name="doseTime"
            defaultValue="08:00"
            className="rounded-xl border border-border bg-surface px-4 py-3 focus:outline-none focus:border-accent"
          />
        </fieldset>

        <fieldset className="space-y-3 rounded-xl border border-border bg-surface-muted p-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" name="consent" className="mt-1 accent-accent" />
            <span className="text-sm text-foreground/80">
              I understand WAVE is a support tool, not a substitute for a
              counselor, prescriber, or crisis line. If I am in crisis I will
              call or text 988, or call 1-800-662-HELP (SAMHSA National
              Helpline).
            </span>
          </label>
        </fieldset>

        <div className="flex items-center justify-between pt-4">
          <Link href="/" className="text-sm text-foreground/60 hover:text-accent">
            ← Back to home
          </Link>
          <Link
            href="/session"
            className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-accent-foreground font-medium hover:opacity-90"
          >
            Continue to first session →
          </Link>
        </div>
      </form>
    </section>
  );
}
