"use client";

/**
 * Sparkline of the 5 craving scores collected at every check-in.
 *
 * Rendered above the reflection card so the patient can see the full
 * arc at a glance — where they came in, the path between, and where
 * they ended up. Inline SVG, no chart library.
 */

interface Props {
  /** One score per check-in, in order. May have fewer than 5 entries. */
  scores: number[];
  /** Intake intensity collected before Check-in 1. Drawn as the leftmost anchor. */
  intakeIntensity: number;
}

const VIEW_WIDTH = 320;
const VIEW_HEIGHT = 90;
const PAD_X = 24;
const PAD_Y = 14;
const POINT_RADIUS = 4.5;

export function ScoreArc({ scores, intakeIntensity }: Props) {
  // Always include intake as point 0 so the chart shows the journey
  // from the initial reading.
  const series = [intakeIntensity, ...scores];
  if (series.length < 2) {
    return null;
  }

  const xs = series.map((_, i) =>
    PAD_X + (i / (series.length - 1)) * (VIEW_WIDTH - PAD_X * 2),
  );
  const ys = series.map(
    (score) =>
      PAD_Y + (1 - clamp(score, 1, 10) / 10) * (VIEW_HEIGHT - PAD_Y * 2),
  );

  const path = xs
    .map((x, i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${ys[i].toFixed(1)}`)
    .join(" ");

  const areaPath = `${path} L ${xs[xs.length - 1].toFixed(1)} ${VIEW_HEIGHT - PAD_Y} L ${xs[0].toFixed(1)} ${VIEW_HEIGHT - PAD_Y} Z`;

  return (
    <figure className="rounded-2xl border border-border bg-surface p-4">
      <figcaption className="mb-2 flex items-center justify-between text-xs uppercase tracking-wide text-foreground/50">
        <span>Craving arc</span>
        <span>
          {intakeIntensity} → {series[series.length - 1]}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        className="h-24 w-full"
        role="img"
        aria-label={`Craving scores from intake ${intakeIntensity} through ${scores.length} check-ins, ending at ${series[series.length - 1]}.`}
      >
        <line
          x1={PAD_X}
          y1={VIEW_HEIGHT - PAD_Y}
          x2={VIEW_WIDTH - PAD_X}
          y2={VIEW_HEIGHT - PAD_Y}
          stroke="var(--border)"
          strokeWidth="1"
        />
        <path d={areaPath} fill="var(--wave-rise)" opacity={0.18} />
        <path
          d={path}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {xs.map((x, i) => (
          <g key={i}>
            <circle
              cx={x}
              cy={ys[i]}
              r={POINT_RADIUS}
              fill="var(--surface)"
              stroke="var(--accent)"
              strokeWidth="2"
            />
            <text
              x={x}
              y={ys[i] - POINT_RADIUS - 4}
              textAnchor="middle"
              fontSize="9"
              fill="var(--foreground)"
              opacity={0.6}
            >
              {series[i]}
            </text>
            <text
              x={x}
              y={VIEW_HEIGHT - 2}
              textAnchor="middle"
              fontSize="8"
              fill="var(--foreground)"
              opacity={0.4}
            >
              {i === 0 ? "intake" : `c${i}`}
            </text>
          </g>
        ))}
      </svg>
    </figure>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
