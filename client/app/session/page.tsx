import "./session-skin.css";

import { SessionMachine } from "./_components/session-machine";

/**
 * Session page shell.
 *
 * Immersive, full-bleed — matches the interactive prototype (/demo):
 * no breadcrumb, no page heading, no card chrome. Each phase renders
 * its own demo-style `.screen` (topbar crumb + centered body) over the
 * WaveSkin ocean canvas. `.wave-session` scopes the ported prototype
 * design system (see session-skin.css).
 *
 * The ambient audio bed lives INSIDE <SessionMachine /> so it survives
 * every chunk → check-in → chunk transition (PRD § Risk Areas #6).
 */
export default function SessionPage() {
  return (
    <div className="wave-session min-h-screen w-full px-6 py-10">
      <SessionMachine />
    </div>
  );
}
