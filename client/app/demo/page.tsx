import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "WAVE — Interactive Demo",
  description:
    "Client-facing interactive prototype of the WAVE experience: the full bioluminescent oceanic re-skin across lock, intake, session, check-in, reflection, dashboard, and history.",
};

/**
 * Self-contained client demo.
 *
 * The design handoff from Claude Design is a complete, standalone
 * React + Babel prototype. It is served verbatim from
 * `public/demo-app/` and embedded full-viewport here so it keeps its
 * own browser-window / iPhone chrome and global CSS, fully isolated
 * from the production app's styles and business logic.
 *
 * Nothing in `/session`, `/onboarding`, `lib/`, or the landing page is
 * touched — this route only frames the prototype for the client.
 */
export default function DemoPage() {
  // The embedded prototype loads React + Babel from unpkg and compiles
  // ~10 JSX files in-browser before it paints. Until then the iframe
  // shows default white, then snaps to the demo's deep-ocean base
  // (#02060d) — a jarring flash. Painting the frame and the iframe with
  // that same base color makes the load window dark instead of white.
  return (
    <div
      className="fixed inset-0"
      style={{ background: "#02060d", colorScheme: "dark" }}
    >
      <iframe
        src="/demo-app/index.html"
        title="WAVE interactive demo"
        className="h-screen w-screen border-0"
        style={{ background: "#02060d" }}
        allow="autoplay; microphone"
      />
    </div>
  );
}
