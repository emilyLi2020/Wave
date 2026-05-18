"use client";

/**
 * Route-aware skin wrapper.
 *
 * Applies the bioluminescent oceanic re-skin (dark palette + wave canvas +
 * film grain + serif headlines + glass cards — all scoped under
 * `[data-wave-skin]` in globals.css) to patient-facing routes only.
 *
 * Explicitly EXCLUDED so they keep their own look untouched:
 *   - /training/*  — dev training-data UI (out of scope)
 *   - /models/*    — dev model/runtime test pages (out of scope)
 *   - /demo        — the self-contained design prototype (own chrome)
 *
 * Business logic is never touched: this only wraps `children` and paints a
 * decorative canvas behind them.
 */

import { usePathname } from "next/navigation";

import { WaveCanvas } from "./wave-canvas";

function isExcluded(pathname: string | null): boolean {
  if (!pathname) return false;
  return (
    pathname === "/training" ||
    pathname.startsWith("/training/") ||
    pathname === "/models" ||
    pathname.startsWith("/models/") ||
    pathname === "/demo" ||
    pathname.startsWith("/demo/")
  );
}

export function WaveSkin({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (isExcluded(pathname)) return <>{children}</>;

  return (
    <div data-wave-skin className="relative min-h-screen">
      <WaveCanvas />
      <div className="relative z-10 flex min-h-screen flex-col">{children}</div>
    </div>
  );
}
