"use client";

// WAVE front page — a faithful port of the design's Home screen
// (wave-web/project/screens.jsx → HomeScreen) with its soft layered
// HomeWaveBg (wave.jsx). The global site top bar is kept above this;
// the hero is centered both axes and sized for web.

import Link from "next/link";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import "./home.css";

// ─── Theme toggle (ported from app.jsx) ──────────────────────
//
// Flips the front page between light/dark. Defaults to 'auto'
// (follows the OS and live-updates), persisted to localStorage.
// Scoped to this page's wrapper so the rest of the app is untouched.

type Theme = "light" | "dark" | "auto";

const STORE_THEME = "wave-home-theme";

function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme === "dark" || theme === "light") return theme;
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return "light";
}

function ThemeToggle({
  theme,
  onChange,
}: {
  theme: Theme;
  onChange: (t: Theme) => void;
}) {
  const resolved = resolveTheme(theme);
  const next: Theme = resolved === "dark" ? "light" : "dark";
  const isDark = resolved === "dark";
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => onChange(next)}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
    >
      {isDark ? (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}

// ─── HomeWaveBg (ported from wave.jsx) ───────────────────────
//
// Page is --bg at the top and smoothly transitions into gentle,
// layered pastel-blue swells along the bottom — no hard horizon line.
// Three bands drift independently (all left → right via `reverse`) so
// the surface never loops visibly.

function buildHomeBandPath(
  amp: number[],
  periods: number[],
  phases: number[],
) {
  const W = 1200;
  const H = 200;
  const baseY = 60;
  const STEP = 20;

  const yAt = (x: number) => {
    let y = baseY;
    for (let i = 0; i < amp.length; i++) {
      const phase = (x / periods[i] + phases[i]) * Math.PI * 2;
      y -= amp[i] * Math.sin(phase);
    }
    return y;
  };

  const pts: [number, number][] = [];
  for (let x = 0; x <= W; x += STEP) pts.push([x, yAt(x)]);

  let d = `M 0 ${H} L 0 ${pts[0][1].toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = pts[i - 1];
    const [x, y] = pts[i];
    const mx = (px + x) / 2;
    const my = (py + y) / 2;
    d += ` Q ${px.toFixed(1)} ${py.toFixed(2)} ${mx.toFixed(1)} ${my.toFixed(2)}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last[0]} ${last[1].toFixed(2)} L ${W} ${H} Z`;
  return d;
}

interface BandProps {
  heightPct: number;
  amp: number[];
  periods: number[];
  phases: number[];
  speedPxPerSec: number;
  fillTop: string;
  fillBot: string;
}

function HomeWaveBand(props: BandProps) {
  const { heightPct, amp, periods, phases, fillTop, fillBot } = props;
  const pathRef = useRef<SVGPathElement>(null);
  const params = useRef(props);
  params.current = props;

  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const loop = (now: number) => {
      const t = (now - start) / 1000;
      const p = params.current;
      // All bands pass `reverse` → drift left → right.
      const dir = -1;
      const longest = Math.max.apply(null, p.periods);
      const livePhases = p.phases.map((ph, i) => {
        const dispersion = Math.sqrt(longest / p.periods[i]);
        const shiftPx = p.speedPxPerSec * dir * dispersion * t;
        return ph + shiftPx / p.periods[i];
      });
      const d = buildHomeBandPath(p.amp, p.periods, livePhases);
      if (pathRef.current) pathRef.current.setAttribute("d", d);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const initial = useMemo(
    () => buildHomeBandPath(amp, periods, phases),
    [amp, periods, phases],
  );
  // Stable across SSR/CSR — Math.random would mismatch on hydration.
  const gid = `home-band-${useId().replace(/:/g, "")}`;

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: `${heightPct}%`,
        pointerEvents: "none",
      }}
    >
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 1200 200"
        preserveAspectRatio="none"
        style={{ display: "block" }}
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={fillTop} />
            <stop offset="100%" stopColor={fillBot} />
          </linearGradient>
        </defs>
        <path ref={pathRef} d={initial} fill={`url(#${gid})`} />
      </svg>
    </div>
  );
}

function HomeWaveBg({
  motion = 0.6,
  accent = "var(--wave-rise)",
}: {
  motion?: number;
  accent?: string;
}) {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        background: `linear-gradient(180deg, var(--bg) 0%, var(--bg) 38%, color-mix(in oklab, ${accent} 6%, var(--bg)) 62%, color-mix(in oklab, ${accent} 10%, var(--bg)) 100%)`,
      }}
    >
      <HomeWaveBand
        heightPct={56}
        amp={[18, 8]}
        periods={[1100, 620]}
        phases={[0.1, 0.55]}
        speedPxPerSec={42 * (0.4 + motion)}
        fillTop={`color-mix(in oklab, ${accent} 22%, transparent)`}
        fillBot={`color-mix(in oklab, ${accent} 32%, transparent)`}
      />
      <HomeWaveBand
        heightPct={46}
        amp={[22, 10]}
        periods={[960, 540]}
        phases={[0.42, 0.18]}
        speedPxPerSec={64 * (0.4 + motion)}
        fillTop={`color-mix(in oklab, ${accent} 38%, transparent)`}
        fillBot={`color-mix(in oklab, ${accent} 52%, transparent)`}
      />
      <HomeWaveBand
        heightPct={38}
        amp={[20, 9]}
        periods={[880, 480]}
        phases={[0.7, 0.3]}
        speedPxPerSec={88 * (0.4 + motion)}
        fillTop={`color-mix(in oklab, ${accent} 58%, transparent)`}
        fillBot={`color-mix(in oklab, ${accent} 78%, var(--bg))`}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          height: "40%",
          background:
            "linear-gradient(180deg, var(--bg) 0%, color-mix(in oklab, var(--bg) 80%, transparent) 60%, transparent 100%)",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

// Lane-break a sentence: break the line right after a "," or "." when
// only 1-2 words follow it, so a short trailing clause drops onto its
// own line instead of dangling. e.g. "When a craving hits, start here."
// → "When a craving hits," / "start here." (the comma's tail is 2
// words). A longer tail (3+ words) stays on the same line.
function laneBreak(text: string): ReactNode[] {
  const clauses =
    text.match(/[^,.]+[,.]?/g)?.map((s) => s.trim()).filter(Boolean) ?? [
      text,
    ];
  const lines: string[] = [];
  let current = "";
  for (let i = 0; i < clauses.length; i++) {
    const clause = clauses[i];
    current = current ? `${current} ${clause}` : clause;
    const next = clauses[i + 1];
    const nextWordCount = next
      ? next.split(/\s+/).filter(Boolean).length
      : 0;
    if (/[,.]$/.test(clause) && next && nextWordCount <= 2) {
      lines.push(current);
      current = "";
    }
  }
  if (current) lines.push(current);
  return lines.flatMap((line, idx) =>
    idx === 0 ? [line] : [<br key={idx} />, line],
  );
}

function ArrowRight({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

// ─── Front page ──────────────────────────────────────────────

export default function LandingPage() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [theme, setThemeState] = useState<Theme>("auto");

  useEffect(() => {
    const t = localStorage.getItem(STORE_THEME) as Theme | null;
    if (t === "light" || t === "dark" || t === "auto") setThemeState(t);
  }, []);

  // Apply the resolved theme to both this page's scoped wrapper AND
  // <html>, so the global top bar (styled from the app-level :root
  // tokens) matches the front page instead of tracking the OS.
  useEffect(() => {
    const resolved = resolveTheme(theme);
    if (rootRef.current) rootRef.current.setAttribute("data-theme", resolved);
    document.documentElement.setAttribute("data-theme", resolved);
  }, [theme]);

  useEffect(() => {
    if (theme !== "auto") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const resolved = resolveTheme("auto");
      if (rootRef.current) {
        rootRef.current.setAttribute("data-theme", resolved);
      }
      document.documentElement.setAttribute("data-theme", resolved);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    localStorage.setItem(STORE_THEME, t);
  }, []);

  return (
    <div ref={rootRef} data-wave-home data-theme="light">
      <div className="screen">
        <div className="home-corner">
          <ThemeToggle theme={theme} onChange={setTheme} />
        </div>
        <div className="home-bg">
          <HomeWaveBg motion={0.6} />
        </div>

        <div className="screen-body">
          <span className="eyebrow">
            Marlatt&apos;s MBRP protocol · personalized
          </span>
          <h1 className="display">
            {laneBreak("When a craving hits, start here.")}
          </h1>
          <p className="lede">
            One clear path into an urge-surfing session. No account, no
            setup, no typing to begin.
          </p>

          <div className="actions">
            <Link className="btn primary huge" href="/session">
              Start session
              <ArrowRight size={22} />
            </Link>
            <Link className="btn ghost" href="/onboarding">
              First time? Set up profile
            </Link>
          </div>

          <div className="hint">
            In crisis? Call or text 988 · SAMHSA 1-800-662-HELP
          </div>
        </div>
      </div>
    </div>
  );
}
