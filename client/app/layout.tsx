import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "WAVE — Urge Surfing Companion",
  description:
    "WAVE is an offline-first, medication-aware urge surfing companion that helps people in SUD recovery ride out cravings in real time.",
};

const navLinks = [
  { href: "/", label: "Home" },
  { href: "/onboarding", label: "Onboarding" },
  { href: "/session", label: "Session" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/history", label: "History" },
  { href: "/insights", label: "Insights" },
];

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
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

        <main className="flex-1">{children}</main>

        <footer className="border-t border-border bg-surface-muted/60">
          <div className="mx-auto max-w-6xl px-6 py-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-sm text-foreground/60">
            <p>
              WAVE — an urge surfing companion for SUD recovery. Not medical
              advice.
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
      </body>
    </html>
  );
}
