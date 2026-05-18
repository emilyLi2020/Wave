"use client";

/**
 * Craving arc — the interactive prototype's `ScoreArc`, drawn as a
 * glass `.arc-card`: a 1–10 baseline with the session's scores
 * connected (intake anchor + one point per check-in), a soft area
 * fill, value labels, and a mono axis row.
 */

interface Props {
  /** One score per check-in, in order. May have fewer than 5 entries. */
  scores: number[];
  /** Intake intensity collected before Check-in 1 — the leftmost anchor. */
  intakeIntensity: number;
}

const W = 320;
const H = 120;
const PADX = 14;
const PADY = 16;

export function ScoreArc({ scores, intakeIntensity }: Props) {
  const series = [intakeIntensity, ...scores];
  if (series.length < 2) return null;

  const n = series.length;
  const x = (i: number) => PADX + (i / Math.max(1, n - 1)) * (W - PADX * 2);
  const y = (s: number) => H - PADY - ((s - 1) / 9) * (H - PADY * 2);

  const dPath = series
    .map((s, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(s).toFixed(1)}`)
    .join(" ");
  const areaPath = `${dPath} L ${x(n - 1).toFixed(1)} ${H - PADY} L ${x(0).toFixed(1)} ${H - PADY} Z`;

  const axisLabel = (i: number) => {
    if (i === 0) return "Intake";
    if (i === n - 1 && scores.length >= 5) return "End";
    return String(i);
  };

  return (
    <div className="arc-card">
      <div className="row between" style={{ marginBottom: 8 }}>
        <span className="eyebrow">Craving · this session</span>
        <span
          className="mono"
          style={{
            fontSize: 11,
            color: "var(--fg-faint)",
            letterSpacing: "0.06em",
          }}
        >
          {series[0]} → {series[n - 1]}
        </span>
      </div>
      <svg
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ display: "block" }}
        role="img"
        aria-label={`Craving from intake ${intakeIntensity} through ${scores.length} check-ins, ending at ${series[n - 1]}.`}
      >
        <defs>
          <linearGradient id="arcgrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.35" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[1, 5, 10].map((v) => (
          <line
            key={v}
            x1={PADX}
            x2={W - PADX}
            y1={y(v)}
            y2={y(v)}
            stroke="var(--border)"
            strokeDasharray="2 4"
          />
        ))}
        <path d={areaPath} fill="url(#arcgrad)" />
        <path
          d={dPath}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {series.map((s, i) => (
          <g key={i}>
            <circle
              cx={x(i)}
              cy={y(s)}
              r="4"
              fill="var(--surface)"
              stroke="var(--accent)"
              strokeWidth="2"
            />
            <text
              x={x(i)}
              y={y(s) - 10}
              textAnchor="middle"
              fontFamily="var(--font-geist-mono), monospace"
              fontSize="10"
              fill="var(--fg-faint)"
            >
              {s}
            </text>
          </g>
        ))}
      </svg>
      <div className="arc-axis">
        {series.map((_, i) => (
          <span key={i}>{axisLabel(i)}</span>
        ))}
      </div>
    </div>
  );
}
