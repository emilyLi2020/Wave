"use client";

import { useState } from "react";

export type SafetyOutcome =
  | { kind: "proceed"; usedSubstanceToday: boolean }
  | { kind: "handoff" };

interface Props {
  onResolved: (outcome: SafetyOutcome) => void;
}

/**
 * Rule-based intake safety screen — re-skinned to the prototype's
 * safety screen (eyebrow + serif headline + chip list + crisis card),
 * with the real two-question gate intact (PRD § Domain Constraints >
 * Crisis handoff, runs BEFORE any LLM call):
 *
 *  - Q1 No                 → proceed, usedSubstanceToday=false
 *  - Q1 Yes, Q2 No         → proceed, usedSubstanceToday=true
 *  - Q1 Yes, Q2 Yes        → SAMHSA handoff (no model call)
 *  - "Connect me now"      → SAMHSA handoff
 */
export function SafetyScreen({ onResolved }: Props) {
  const [q1, setQ1] = useState<"yes" | "no" | null>(null);

  return (
    <div className="screen">
      <div className="topbar">
        <span className="crumb">Before we start</span>
      </div>
      <div className="screen-body">
        <span className="eyebrow">Safety check</span>
        <h1 className="display">Have you used today?</h1>
        <p className="lede">
          We ask so the session knows what to say next. There&apos;s no right
          answer and no judgment.
        </p>
        <div style={{ height: 4 }} />

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button
            type="button"
            className="chip list"
            aria-pressed={q1 === "no"}
            onClick={() => {
              setQ1("no");
              onResolved({ kind: "proceed", usedSubstanceToday: false });
            }}
          >
            No, not today
          </button>
          <button
            type="button"
            className="chip list"
            aria-pressed={q1 === "yes"}
            onClick={() => setQ1("yes")}
          >
            Yes, earlier today
          </button>
        </div>

        {q1 === "yes" ? (
          <div className="card flush" style={{ marginTop: 4 }}>
            <p style={{ margin: 0, fontWeight: 500 }}>
              Are you feeling physically unwell, dizzy, or having trouble
              breathing right now?
            </p>
            <div className="btn-row" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="chip list"
                style={{ flex: 1 }}
                onClick={() =>
                  onResolved({ kind: "proceed", usedSubstanceToday: true })
                }
              >
                No
              </button>
              <button
                type="button"
                className="chip list"
                style={{ flex: 1, borderColor: "var(--danger)" }}
                onClick={() => onResolved({ kind: "handoff" })}
              >
                Yes
              </button>
            </div>
          </div>
        ) : null}

        <div className="spacer-grow" />

        <div className="card">
          <div
            className="row"
            style={{ alignItems: "flex-start", gap: 10 }}
          >
            <span style={{ marginTop: 2, color: "var(--accent)" }}>
              <ShieldIcon />
            </span>
            <div>
              <div style={{ fontWeight: 500, marginBottom: 4 }}>
                If you&apos;re in crisis
              </div>
              <p className="hint" style={{ margin: 0 }}>
                Call or text <b>988</b> (Suicide &amp; Crisis Lifeline), or
                call SAMHSA at <b>1-800-662-HELP</b>. WAVE is a support tool,
                not a substitute for a counselor or prescriber.
              </p>
              <button
                type="button"
                className="btn ghost"
                style={{ padding: 0, marginTop: 8 }}
                onClick={() => onResolved({ kind: "handoff" })}
              >
                Connect me to someone now →
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ShieldIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}
