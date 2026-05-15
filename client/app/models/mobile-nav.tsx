"use client";

import { useState, type ReactNode } from "react";

/**
 * Mobile collapsible wrapper for the /models sidebar.
 *
 * Renders a Fragment (button + aside) so the two land as direct grid children
 * of the layout's grid container — the aside fills its 260px column on lg+
 * without an interposing wrapper.
 *
 * Why React state instead of the CSS-only <input type=checkbox> + peer hack:
 * iOS 26 Safari does not reliably deliver tap events on a page that contains
 * an absolutely-positioned interactive form control marked aria-hidden="true"
 * (the sr-only checkbox pattern). That was breaking Load / Run buttons across
 * the whole /models surface. A plain <button> + useState avoids the aria
 * contradiction and the absolute-positioned form control entirely.
 */
export function MobileNav({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls="wave-models-nav"
        className="flex items-center justify-between gap-2 rounded-2xl border border-border bg-surface-muted/40 px-4 py-3 text-sm font-medium text-foreground/80 hover:bg-surface-muted lg:hidden"
      >
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-accent" />
          Tests menu
        </span>
        <span
          aria-hidden
          className={`text-foreground/50 transition-transform ${open ? "rotate-180" : ""}`}
        >
          ▾
        </span>
      </button>
      <aside
        id="wave-models-nav"
        className={`space-y-1 rounded-2xl border border-border bg-surface-muted/30 p-3 lg:block lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 ${
          open ? "block" : "hidden"
        }`}
      >
        {children}
      </aside>
    </>
  );
}
