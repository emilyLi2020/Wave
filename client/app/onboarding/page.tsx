"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  ONBOARDING_MAT_OPTIONS,
  writeOnboardingProfile,
} from "@/lib/onboarding/profile";

export default function OnboardingPage() {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [medication, setMedication] = useState<string | null>(null);
  const [doseTime, setDoseTime] = useState("08:00");
  const [consent, setConsent] = useState(false);

  function handleContinue() {
    if (!consent) return;
    const matType =
      ONBOARDING_MAT_OPTIONS.find((o) => o.label === medication)?.value ??
      null;
    writeOnboardingProfile({
      firstName: firstName.trim() || null,
      matType,
      doseTime: doseTime || null,
      consentedAt: new Date().toISOString(),
    });
    router.push("/session");
  }

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
        the first two.
      </p>

      <form
        className="mt-10 space-y-8"
        aria-label="Onboarding"
        onSubmit={(e) => {
          e.preventDefault();
          handleContinue();
        }}
      >
        <fieldset className="space-y-3">
          <legend className="font-medium">
            What should WAVE call you?{" "}
            <span className="text-foreground/50 font-normal">(Optional)</span>
          </legend>
          <input
            type="text"
            name="firstName"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="First name or nickname"
            className="w-full rounded-xl border border-border bg-surface px-4 py-3 placeholder:text-foreground/40 focus:outline-none focus:border-accent"
          />
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="font-medium">
            Are you on Medication-Assisted Treatment (MAT)?
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {ONBOARDING_MAT_OPTIONS.map((option) => (
              <label
                key={option.label}
                className={`flex items-center gap-3 rounded-xl border bg-surface px-4 py-3 cursor-pointer transition ${
                  medication === option.label
                    ? "border-accent text-accent"
                    : "border-border hover:border-accent"
                }`}
              >
                <input
                  type="radio"
                  name="medication"
                  value={option.label}
                  checked={medication === option.label}
                  onChange={() => setMedication(option.label)}
                  className="accent-accent"
                />
                <span className="text-sm">{option.label}</span>
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
            value={doseTime}
            onChange={(e) => setDoseTime(e.target.value)}
            className="rounded-xl border border-border bg-surface px-4 py-3 focus:outline-none focus:border-accent"
          />
        </fieldset>

        <fieldset className="space-y-3 rounded-xl border border-border bg-surface-muted p-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              name="consent"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-1 accent-accent"
            />
            <span className="text-sm text-foreground/80">
              I understand WAVE is a support tool, not a substitute for a
              counselor, prescriber, or crisis line. If I am in crisis I will
              call or text 988, or call 1-800-662-HELP (SAMHSA National
              Helpline).
            </span>
          </label>
        </fieldset>

        <div className="flex items-center justify-between pt-4">
          <Link
            href="/"
            className="text-sm text-foreground/60 hover:text-accent"
          >
            ← Back to home
          </Link>
          <button
            type="submit"
            disabled={!consent}
            className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-accent-foreground font-medium hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Continue to first session →
          </button>
        </div>
        {!consent ? (
          <p className="text-right text-xs text-foreground/50">
            Please acknowledge the note above to continue.
          </p>
        ) : null}
      </form>
    </section>
  );
}
