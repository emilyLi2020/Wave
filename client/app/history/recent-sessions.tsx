"use client";

import { useSyncExternalStore } from "react";

import { MOCK_RECENT_SESSIONS } from "@/lib/data/mock-sessions";
import {
  getCompletedServerSnapshot,
  getCompletedSnapshot,
  subscribeCompletedSessions,
} from "@/lib/sessions/completed-store";

function outcomeStyles(outcome: string) {
  if (outcome === "Surfed") return "bg-accent-soft text-accent";
  if (outcome === "Left early") return "bg-warn-soft text-warn";
  return "bg-danger-soft text-danger";
}

export function HistoryExportButton() {
  const completed = useSyncExternalStore(
    subscribeCompletedSessions,
    getCompletedSnapshot,
    getCompletedServerSnapshot,
  );

  function handleExport() {
    const all = [...completed, ...MOCK_RECENT_SESSIONS];
    const blob = new Blob([JSON.stringify(all, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wave-sessions-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      type="button"
      onClick={handleExport}
      className="rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium hover:border-accent hover:text-accent transition"
    >
      Export sessions for clinician
    </button>
  );
}

export function RecentSessionsList() {
  const completed = useSyncExternalStore(
    subscribeCompletedSessions,
    getCompletedSnapshot,
    getCompletedServerSnapshot,
  );
  const sessions = [...completed, ...MOCK_RECENT_SESSIONS];

  return (
    <ul className="mt-10 space-y-3">
      {sessions.map((session, i) => (
        <li
          key={`${session.id}-${i}`}
          className="rounded-2xl border border-border bg-surface p-5 grid gap-3 sm:grid-cols-[auto_1fr_auto] sm:items-center"
        >
          <div>
            <p className="text-sm text-foreground/60">{session.date}</p>
            <p className="text-xs text-foreground/40">ID {session.id}</p>
          </div>
          <div className="grid gap-1 text-sm">
            <p>
              <span className="font-medium">{session.start}</span> →{" "}
              <span className="font-medium text-accent">{session.end}</span>{" "}
              <span className="text-foreground/50">
                · drop of {session.start - session.end}
              </span>
            </p>
            <p className="text-foreground/60">
              {session.trigger} · {session.medication}
            </p>
          </div>
          <span
            className={`justify-self-start sm:justify-self-end rounded-full px-3 py-1 text-xs font-medium ${outcomeStyles(
              session.outcome,
            )}`}
          >
            {session.outcome}
          </span>
        </li>
      ))}
    </ul>
  );
}
