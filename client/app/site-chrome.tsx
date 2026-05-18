"use client";

/**
 * Patient-facing header + footer. Hides itself on the dev-only
 * /training/* (training data) and /models/* (runtime/model test pages)
 * surfaces so each can render its own chrome. Both are gated by env
 * flags (NEXT_PUBLIC_TRAINING_ENABLED / NEXT_PUBLIC_MODELS_ENABLED)
 * and not shown to patients in production.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

const navLinks = [
  { href: "/", label: "Home" },
  { href: "/onboarding", label: "Onboarding" },
  { href: "/session", label: "Session" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/history", label: "History" },
  { href: "/insights", label: "Insights" },
  { href: "/demo", label: "Demo" },
  { href: "/model-results", label: "Model Results" },
];

function shouldHide(pathname: string | null): boolean {
  if (!pathname) return false;
  return (
    pathname === "/training" ||
    pathname.startsWith("/training/") ||
    pathname === "/models" ||
    pathname.startsWith("/models/") ||
    pathname === "/prompts"
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  if (shouldHide(pathname)) return null;
  return (
    <header className="border-b border-border bg-surface/80 backdrop-blur sticky top-0 z-10">
      <div className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-2 font-semibold tracking-tight"
        >
          <span
            aria-hidden
            className="inline-block h-3 w-6 rounded-full bg-accent"
          />
          <span>WAVE</span>
        </Link>
        <nav aria-label="Primary">
          <ul className="flex items-center gap-5 text-sm">
            {navLinks.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="text-foreground/70 hover:text-accent transition-colors"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  const pathname = usePathname();
  if (shouldHide(pathname)) return null;
  return (
    <footer className="border-t border-border bg-surface-muted/60">
      <div className="mx-auto max-w-6xl px-6 py-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-sm text-foreground/60">
        <p>
          WAVE — an urge surfing companion for SUD recovery. Not medical advice.
        </p>
        <p>
          Built with the{" "}
          <a
            href="https://thehackathonplaybook.dev"
            className="underline hover:text-accent"
            target="_blank"
            rel="noreferrer"
          >
            Hackathon Starter Kit
          </a>
          .
        </p>
      </div>
    </footer>
  );
}
