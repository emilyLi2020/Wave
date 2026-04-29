import Link from "next/link";

import { SessionMachine } from "./_components/session-machine";

/**
 * Session page shell.
 *
 * Mounts a single <SessionMachine /> for the lifetime of this route.
 * The ambient audio bed lives INSIDE <SessionMachine /> so it is built
 * once on the first chunk and stays alive across every chunk →
 * check-in → chunk transition (PRD § Risk Areas #6 — audio
 * continuity). Navigating away from this route is the only thing that
 * tears the bed down; the reflection screen fades it out gracefully
 * before that point.
 */
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
        Five short chunks, with a check-in after each one. Twelve to fifteen
        minutes total. You can mute the ambient sound any time.
      </p>

      <div className="mt-10">
        <SessionMachine />
      </div>
    </section>
  );
}
