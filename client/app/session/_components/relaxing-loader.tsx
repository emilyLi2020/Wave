"use client";

/**
 * Breath-orb loader shown while the next chunk is being generated.
 *
 * This is the interactive prototype's `BreathLoader` (a single slow
 * breathing orb on a near-empty screen). It reads as a piece of the
 * meditation rather than a system spinner: the orb eases through a
 * ~7-second breathe cycle (the `breathe` keyframe in session-skin.css)
 * so the patient stays in the practice while the model catches up.
 *
 * `pool` only changes the copy — `start` is settling-in language before
 * the first chunk, `between` is breath language between a check-in and
 * the next chunk.
 */

interface Props {
  pool: "start" | "between";
}

export function RelaxingLoader({ pool }: Props) {
  const label =
    pool === "start" ? "Settling into the session" : "Building your next part";
  const sublabel =
    pool === "start"
      ? "Find a position that works. Slow breath if it helps."
      : "Settle in. Slow breath if it helps.";

  return (
    <div className="screen" aria-live="polite" role="status">
      <div className="topbar">
        <span className="crumb">Loading</span>
      </div>
      <div className="breath">
        <div className="breath-orb" />
        <div className="center-col" style={{ gap: 6 }}>
          <h2 className="section" style={{ fontWeight: 500 }}>
            {label}
          </h2>
          <p
            className="lede"
            style={{ textAlign: "center", maxWidth: 260 }}
          >
            {sublabel}
          </p>
        </div>
      </div>
    </div>
  );
}
