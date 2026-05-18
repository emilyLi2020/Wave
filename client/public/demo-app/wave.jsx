// wave.jsx — three flavors of WAVE's centerpiece visualization.
//
//   <Wave variant="ocean" | "sine" | "orb"
//         intensity={1..10}
//         breathPhase="inhale" | "hold" | "exhale" | null
//         breathSec={4}
//         height={220}
//         motion={0..1}           // tweak: motion intensity
//         showChrome              // chunk-page badge + gauge overlay
//         badge="Chunk 1 of 5"
//         gauge="7/10" />
//
// All three modes share the same `intensity → fill height` mapping so
// the user can tweak the visual style without changing the meaning.
// `breathPhase` overrides intensity-driven height while a breath is
// active; on null we fall back to ambient.

const { useEffect, useMemo, useRef, useState } = React;

const AMBIENT_MIN = 22;
const AMBIENT_MAX = 70;
const BREATH_PEAK = 82;
const BREATH_BASE = 18;

function fillForIntensity(i) {
  const c = Math.max(1, Math.min(10, i || 5));
  return AMBIENT_MIN + ((c - 1) / 9) * (AMBIENT_MAX - AMBIENT_MIN);
}

function fillForBreath(phase) {
  if (phase === 'inhale' || phase === 'hold') return BREATH_PEAK;
  if (phase === 'exhale') return BREATH_BASE;
  return null;
}

function Wave({
  variant = 'ocean',
  intensity = 5,
  breathPhase = null,
  breathSec = 4,
  height = 220,
  motion = 1,
  showChrome = false,
  badge,
  gauge,
  bare = false,
}) {
  const breathFill = fillForBreath(breathPhase);
  const targetFill = breathFill ?? fillForIntensity(intensity);
  const transitionMs =
    breathPhase && breathPhase !== 'hold' ? breathSec * 1000 : 700;

  return (
    <div className={`wave-canvas${bare ? ' bare' : ''}`} style={{ height }}>
      {showChrome && badge ? <div className="badge">{badge}</div> : null}
      {showChrome && gauge ? <div className="gauge">{gauge}</div> : null}

      {variant === 'ocean' ? (
        <OceanWave fill={targetFill} transitionMs={transitionMs} breath={!!breathPhase} motion={motion} intensity={intensity} bare={bare} />
      ) : variant === 'sine' ? (
        <SineWave fill={targetFill} transitionMs={transitionMs} breath={!!breathPhase} motion={motion} />
      ) : (
        <BreathOrb fill={targetFill} transitionMs={transitionMs} breath={!!breathPhase} motion={motion} />
      )}

      {bare ? null : <div className="scrim" />}
    </div>
  );
}

// ─── Ocean variant: layered multi-sine fills + crest highlight + sparkle ─

function OceanWave({ fill, transitionMs, breath, motion, intensity, bare }) {
  // The whole layer translates Y for the intensity → "water level"
  // metaphor (high score = water rises into view, low score = water
  // sits at the bottom of the frame). Inside the frame, the legacy
  // procedural SVG ocean runs — softened from the previous Stokes-
  // sharpened crests to a gentler rolling motion.
  const translateY = 100 - fill;
  return (
    <div
      className="layer"
      style={{
        transform: `translate3d(0, ${translateY}%, 0)`,
        transition: `transform ${transitionMs}ms ${breath ? 'cubic-bezier(0.45, 0, 0.55, 1)' : 'ease-out'}`,
        willChange: 'transform',
        overflow: 'hidden',
      }}
    >
      <OceanWaveSvg motion={motion} bare={bare} />
    </div>
  );
}

// SVG fallback when WebGL is unavailable. This is the previous
// sum-of-sines layered implementation, preserved so we degrade
// gracefully rather than showing a blank water rectangle.
function OceanWaveSvg({ motion, bare }) {
  // Gentle settings: reduced amplitudes overall and shallower crest
  // sharpening so the surface rolls rather than peaks.
  const speedMul = 1 / (0.5 + motion * 0.8);
  const amp = 0.75 + motion * 0.4;
  return (
    <React.Fragment>
      {/* ── Atmospheric stack — only in non-bare mode. In bare mode the
            wave shapes float on transparency. ── */}

      {bare ? null : (
        <React.Fragment>
          {/* 1. Deep water base — a constant tint underneath everything so
                transparency from the upper layers reads as depth, not bleed. */}
          <div
            style={{
              position: 'absolute', inset: 0,
              background:
                'linear-gradient(180deg, color-mix(in oklab, var(--wave-rise) 18%, transparent) 0%, color-mix(in oklab, var(--wave-peak) 55%, transparent) 55%, color-mix(in oklab, var(--accent-deep, var(--wave-peak)) 85%, transparent) 100%)',
            }}
          />

          {/* 2. Directional sun glow from upper-left — gives the surface a
                sense of where the light is coming from. Screen-blended so
                it warms rather than overwriting the base hue. */}
          <div
            aria-hidden
            style={{
              position: 'absolute', inset: 0,
              background:
                'radial-gradient(120% 80% at 25% -10%, color-mix(in oklab, var(--wave-fall) 78%, transparent) 0%, color-mix(in oklab, var(--wave-rise) 32%, transparent) 22%, transparent 55%)',
              mixBlendMode: 'screen',
              opacity: 0.85,
            }}
          />

          {/* 3. Thin horizon mist band — a soft horizontal glow that sits
                just above the surface, picks out crests in the distance. */}
          <div
            aria-hidden
            style={{
              position: 'absolute', left: 0, right: 0, top: '8%', height: '24%',
              background:
                'linear-gradient(180deg, transparent 0%, color-mix(in oklab, var(--wave-fall) 35%, transparent) 50%, transparent 100%)',
              opacity: 0.55,
              mixBlendMode: 'screen',
              pointerEvents: 'none',
            }}
          />
        </React.Fragment>
      )}

      {/* Far horizon layer — slow, low amplitude, soft. Two long swells
          only — no high-frequency component, so the surface stays
          fluid. */}
      <OceanLayer
        seed={11}
        baseY={28}
        amps={[4 * amp, 2 * amp]}
        periods={[320, 200]}
        phases={[0.10, 0.45]}
        duration={56 * speedMul}
        color="color-mix(in oklab, var(--wave-peak) 70%, transparent)"
        opacity={0.55}
        topOffset={-2}
        bobDuration={9 * speedMul}
        bobOffset={2.6}
      />

      {/* Mid layer — medium amplitude, two components. */}
      <OceanLayer
        seed={37}
        baseY={22}
        amps={[6 * amp, 3 * amp]}
        periods={[280, 170]}
        phases={[0.30, 0.75]}
        duration={32 * speedMul}
        color="color-mix(in oklab, var(--wave-rise) 88%, transparent)"
        opacity={0.85}
        topOffset={4}
        bobDuration={6.4 * speedMul}
        bobOffset={1.7}
      />

      {/* Front layer — the dominant rolling swell. Slightly taller than
          the mid layer; two long components for fluidity. All layers
          drift in the same left-to-right direction. */}
      <OceanLayer
        seed={71}
        baseY={18}
        amps={[7.5 * amp, 3.6 * amp]}
        periods={[240, 150]}
        phases={[0.55, 0.05]}
        duration={22 * speedMul}
        color="var(--wave-peak)"
        opacity={0.95}
        topOffset={12}
        bobDuration={4.8 * speedMul}
        bobOffset={1.2}
      />

      {bare ? null : (
        <React.Fragment>
          {/* Bottom vignette — gentle depth fade at the very bottom so the
              frame doesn't end on a hard color edge. */}
          <div
            aria-hidden
            style={{
              position: 'absolute', left: 0, right: 0, bottom: 0, height: '32%',
              background:
                'linear-gradient(180deg, transparent 0%, color-mix(in oklab, var(--accent-deep, var(--wave-peak)) 35%, transparent) 100%)',
              pointerEvents: 'none',
            }}
          />

          {/* Sparkle / specular dots drifting across the surface */}
          <Sparkle motion={motion} />
        </React.Fragment>
      )}
    </React.Fragment>
  );
}

// One ocean layer:
//   ─ filled wave path (sum-of-sines, organic non-symmetric)
//   ─ optional thin crest highlight on the surface line
//   ─ slow vertical bob so the whole layer breathes
//
// Phase per component is advanced every frame with proper DISPERSION:
// in real water, shorter wavelengths travel faster than longer swells
// (ω ∝ √k). Driving each component independently breaks the tile loop
// you get from a single linear CSS slide, so crests evolve continuously
// instead of repeating verbatim every `duration` seconds.
function OceanLayer({
  baseY, amps, periods, phases, duration, color, opacity, topOffset,
  highlight, bobDuration, bobOffset, reverse, seed,
}) {
  const fillRef = useRef(null);
  const lineRef = useRef(null);
  // Stash latest props in a ref so the rAF loop always reads fresh
  // values without we tearing down the loop on every render.
  const params = useRef(null);
  params.current = { baseY, amps, periods, phases, duration, reverse, seed };

  useEffect(() => {
    let raf;
    const start = performance.now();
    const loop = (now) => {
      const t = (now - start) / 1000;
      const p = params.current;
      // Default drift is left → right; passing `reverse` flips it.
      const dir = p.reverse ? 1 : -1;
      // Match the old CSS slide speed: 800px traversed per `duration` s.
      const basePxPerSec = (800 / p.duration) * dir;
      const longest = Math.max.apply(null, p.periods);
      // Per-component phase: time advances each one at its own rate.
      const livePhases = p.phases.map((ph, i) => {
        // Dispersion: shorter waves move faster. √(longest/period_i).
        const dispersion = Math.sqrt(longest / p.periods[i]);
        // x-shift in px → cycles for this component.
        const shiftPx = basePxPerSec * dispersion * t;
        return ph + shiftPx / p.periods[i];
      });
      const { fillPath, linePath } = buildOceanPaths(
        p.baseY, p.amps, p.periods, livePhases, p.seed, t,
      );
      if (fillRef.current) fillRef.current.setAttribute('d', fillPath);
      if (lineRef.current) lineRef.current.setAttribute('d', linePath);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const bobAnim = `wave-bob-vert ${bobDuration}s ease-in-out infinite`;

  // Compute an initial path at t=0 so first paint already has a wave
  // even before rAF fires (matters when tab/iframe is backgrounded on
  // mount). Frozen on first render via useRef — once mounted, the rAF
  // loop is the only thing updating `d`. If we re-derived this on every
  // render the path attribute would snap back to the latest "t=0"
  // shape whenever a prop changed (e.g. dynamic `motion` during voice
  // check-in), then jump forward on the next rAF frame — visible flicker.
  const initialRef = useRef(null);
  if (!initialRef.current) {
    initialRef.current = buildOceanPaths(baseY, amps, periods, phases, seed, 0);
  }
  const initialPaths = initialRef.current;

  // Unique gradient id per layer instance — used for the vertical
  // brightness ramp on the filled wave body. Nested color-mix is valid
  // CSS Color Module 5, supported in current evergreens.
  const gid = `og-${seed}`;

  return (
    <div
      style={{
        position: 'absolute', left: 0, right: 0, top: topOffset,
        height: 100, opacity, overflow: 'hidden',
        animation: bobAnim,
        ['--bob-offset']: `${bobOffset}px`,
        willChange: 'transform',
      }}
    >
      <svg width="100%" height="100%" viewBox="0 0 800 100" preserveAspectRatio="none">
        <defs>
          {/* Vertical gradient on the wave body:
                top    → brighter (light kiss on the crest)
                middle → the layer's base color
                bottom → deeper (depth shadow) */}
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"
                  stopColor={`color-mix(in oklab, ${color} 72%, white)`}
                  stopOpacity="1" />
            <stop offset="40%"
                  stopColor={color}
                  stopOpacity="0.96" />
            <stop offset="100%"
                  stopColor={`color-mix(in oklab, ${color} 70%, var(--accent-deep, black))`}
                  stopOpacity="1" />
          </linearGradient>
        </defs>
        <path ref={fillRef} d={initialPaths.fillPath} fill={`url(#${gid})`} />
        {highlight ? (
          <path
            ref={lineRef}
            d={initialPaths.linePath}
            fill="none"
            stroke={highlight}
            strokeWidth="0.9"
            strokeLinecap="round"
            opacity="0.85"
          />
        ) : null}
      </svg>
    </div>
  );
}

// Build fill + surface-line paths for one ocean layer at the given
// per-component phases. Crest shape uses a Stokes-like 2nd harmonic so
// peaks come to a point and troughs flatten out, the way real swells do.
function buildOceanPaths(baseY, amps, periods, phases, seed, t) {
  const W = 800, H = 100;
  // Finer sampling step — small step + quadratic-bezier midpoint
  // interpolation gives a perfectly smooth curve at any reasonable
  // wavelength. The previous 12px step was visibly faceting the longer
  // crests.
  const STEP = 6;
  // Tiny per-x perturbation that drifts in time — stays inside ~±0.15px
  // so it adds life without ever reading as a wobble or kink.
  const wobble = (x) =>
    0.12 * Math.sin((x + seed) * 0.0137 + t * 0.31)
         * Math.cos((x + seed) * 0.0291 - t * 0.19);

  const yAt = (x) => {
    let y = baseY;
    for (let i = 0; i < amps.length; i++) {
      const phase = (x / periods[i] + phases[i]) * Math.PI * 2;
      // Pure sine — no Stokes sharpening at all. Crests are as round
      // as a sine wave can be. Anything above ~0 was reading as too
      // pointy in the previous pass.
      const sharpened = Math.sin(phase);
      y -= amps[i] * sharpened;
    }
    return y + wobble(x);
  };

  const pts = [];
  for (let x = 0; x <= W; x += STEP) pts.push([x, yAt(x)]);

  // Smooth path via midpoint quadratic Beziers.
  let surface = `M ${pts[0][0]} ${pts[0][1].toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = pts[i - 1];
    const [x, y] = pts[i];
    const mx = (px + x) / 2;
    const my = (py + y) / 2;
    surface += ` Q ${px.toFixed(1)} ${py.toFixed(2)} ${mx.toFixed(1)} ${my.toFixed(2)}`;
  }
  const last = pts[pts.length - 1];
  surface += ` L ${last[0]} ${last[1].toFixed(2)}`;
  const fillPath = surface + ` L ${W} ${H} L 0 ${H} Z`;
  return { fillPath, linePath: surface };
}

// Subtle specular glints. Fewer, slower, softer, irregularly timed —
// reads as light catching the surface, not as decorative bullet points.
function Sparkle({ motion }) {
  const dots = useMemo(() => {
    // Irregular positions + durations so they never appear to march.
    const seeds = [
      { left: 18, top: 14, dur: 11.3, delay: -0.4, size: 2 },
      { left: 47, top: 19, dur: 14.7, delay: -7.1, size: 3 },
      { left: 71, top: 16, dur: 12.1, delay: -3.6, size: 2 },
      { left: 88, top: 22, dur: 16.4, delay: -9.8, size: 2 },
    ];
    return seeds;
  }, []);
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        opacity: 0.22 + motion * 0.18,
        mixBlendMode: 'screen',
        filter: 'blur(0.4px)',
      }}
    >
      {dots.map((d, i) => (
        <span
          key={i}
          style={{
            position: 'absolute',
            left: `${d.left}%`,
            top: `${d.top}%`,
            width: d.size, height: d.size,
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.7)',
            boxShadow: '0 0 5px rgba(255,255,255,0.55)',
            animation: `sparkle-drift ${d.dur}s ease-in-out ${d.delay}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

// ─── Sine variant: abstract two-tone line ─────────────────────

function SineWave({ fill, transitionMs, breath, motion }) {
  // Two thin sine paths drifting in opposite directions.
  const translateY = 100 - fill;
  return (
    <div
      className="layer"
      style={{
        background:
          'linear-gradient(180deg, color-mix(in oklab, var(--wave-rise) 9%, transparent), transparent 60%)',
      }}
    >
      <div
        style={{
          position: 'absolute', inset: 0,
          transform: `translate3d(0, ${translateY}%, 0)`,
          transition: `transform ${transitionMs}ms ${breath ? 'cubic-bezier(0.45, 0, 0.55, 1)' : 'ease-out'}`,
        }}
      >
        <SineStrip stroke="var(--accent)" thickness={2.2} amp={10 * (0.5 + motion * 0.7)} dur={22 / (0.5 + motion * 0.8)} reverse={false} y={20} />
        <SineStrip stroke="color-mix(in oklab, var(--accent) 50%, transparent)" thickness={1.2} amp={14 * (0.5 + motion * 0.6)} dur={32 / (0.5 + motion * 0.8)} reverse y={28} />
        <div
          style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(180deg, transparent 60%, color-mix(in oklab, var(--accent) 14%, transparent))',
          }}
        />
      </div>
    </div>
  );
}

function SineStrip({ stroke, thickness, amp, dur, reverse, y }) {
  // Build a long path tile (4 wavelengths) so motion is smooth
  const W = 800, P = 200;
  const segs = [];
  segs.push(`M 0 ${y}`);
  const step = P / 2;
  for (let x = step; x <= W; x += step) {
    const cx = x - step / 2;
    const phase = (cx / P) * Math.PI * 2;
    const cy = y - Math.sin(phase) * amp * 1.27;
    const phase2 = (x / P) * Math.PI * 2;
    const ey = y - Math.sin(phase2) * amp;
    segs.push(`Q ${cx} ${cy.toFixed(2)} ${x} ${ey.toFixed(2)}`);
  }
  const d = segs.join(' ');
  return (
    <div
      style={{
        position: 'absolute', left: 0, right: 0,
        top: `calc(50% - 30px)`,
        height: 60, overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex', width: '200%', height: '100%',
          animation: `${reverse ? 'wave-slide-rev' : 'wave-slide'} ${dur}s linear infinite`,
        }}
      >
        <svg width="50%" height="100%" viewBox="0 0 800 60" preserveAspectRatio="none">
          <path d={d} fill="none" stroke={stroke} strokeWidth={thickness} strokeLinecap="round" />
        </svg>
        <svg width="50%" height="100%" viewBox="0 0 800 60" preserveAspectRatio="none">
          <path d={d} fill="none" stroke={stroke} strokeWidth={thickness} strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}

// ─── Orb variant: pulsing radial breath orb ────────────────────

function BreathOrb({ fill, transitionMs, breath, motion }) {
  // Orb scale derived from fill (intensity) AND breath phase.
  // Higher fill → larger orb; breath inhale = bigger, exhale = smaller.
  const scale = 0.55 + (fill / 100) * 0.55;
  return (
    <div
      className="layer"
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background:
          'radial-gradient(60% 50% at 50% 60%, color-mix(in oklab, var(--accent) 18%, transparent), transparent 70%)',
      }}
    >
      <div
        style={{
          width: '70%',
          aspectRatio: '1 / 1',
          maxHeight: '90%',
          borderRadius: '50%',
          background:
            'radial-gradient(circle at 30% 30%, color-mix(in oklab, var(--wave-fall) 65%, transparent), transparent 60%), radial-gradient(circle at 70% 75%, color-mix(in oklab, var(--accent) 80%, transparent), transparent 60%), radial-gradient(circle at 50% 50%, var(--wave-rise), var(--wave-peak))',
          boxShadow:
            '0 0 80px color-mix(in oklab, var(--accent) 35%, transparent), inset 0 -20px 40px color-mix(in oklab, var(--accent-deep) 35%, transparent)',
          transform: `scale(${scale})`,
          transition: `transform ${transitionMs}ms cubic-bezier(0.45, 0, 0.55, 1)`,
          animation: `orb-bob ${5 / (0.5 + motion * 0.6)}s ease-in-out infinite`,
        }}
      />
      {/* halo */}
      <div
        style={{
          position: 'absolute',
          width: '88%', aspectRatio: '1/1',
          borderRadius: '50%',
          border: '1px solid color-mix(in oklab, var(--accent) 25%, transparent)',
          opacity: 0.7,
          animation: `orb-halo ${5 / (0.5 + motion * 0.6)}s ease-in-out infinite`,
        }}
      />
    </div>
  );
}

// ─── HomeWaveBg: soft layered swell for the Home screen ─────────────
//
// Replaces the heavy ocean fill on the landing page. Reference brief:
// page is white at the top and smoothly transitions into gentle, layered
// pastel-blue swells along the bottom — no hard horizon line.
//
// Structure (back→front):
//   • Vertical gradient backdrop  — --bg at top → soft blue near bottom
//   • Three translucent wave bands (light → mid → dark) layered with
//     overlapping cross-fades so crests of one band peek through the
//     trough of the next
//   • A subtle top scrim so the brightest band kisses into the page bg
//     instead of meeting it at a hard line.
//
// Each band is animated independently (different speeds + directions)
// so the surface drifts without ever looping visibly.

function HomeWaveBg({ motion = 0.6, accent = 'var(--wave-rise)' }) {
  // Three bands. baseY = where the band's mean surface sits inside its
  // own 0..100 viewBox; bands are stacked at different bottom offsets
  // so they overlap. Each path's body fills DOWN from the wave to its
  // own bottom, which we then position absolutely at the bottom of the
  // home-bg area.
  //
  // Heights stair-step so the bottom-most (darkest) band reaches up
  // about 38% of the screen, mid ~46%, lightest ~52% — that's what
  // gives the reference image its layered, depth-of-field feel.
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute', inset: 0,
        overflow: 'hidden',
        background:
          // Top: page bg (white-ish). Bottom: a faint blue tint so the
          // waves never meet a hard color edge at the very bottom either.
          'linear-gradient(180deg, var(--bg) 0%, var(--bg) 38%, color-mix(in oklab, ' + accent + ' 6%, var(--bg)) 62%, color-mix(in oklab, ' + accent + ' 10%, var(--bg)) 100%)',
      }}
    >
      {/* Lightest, tallest band — sits furthest back. Wide gentle swells. */}
      <HomeWaveBand
        heightPct={56}
        amp={[18, 8]}
        periods={[1100, 620]}
        phases={[0.10, 0.55]}
        speedPxPerSec={42 * (0.4 + motion)}
        reverse
        fillTop={`color-mix(in oklab, ${accent} 22%, transparent)`}
        fillBot={`color-mix(in oklab, ${accent} 32%, transparent)`}
      />

      {/* Mid band — slightly shorter, opposite drift direction. */}
      <HomeWaveBand
        heightPct={46}
        amp={[22, 10]}
        periods={[960, 540]}
        phases={[0.42, 0.18]}
        speedPxPerSec={64 * (0.4 + motion)}
        reverse
        fillTop={`color-mix(in oklab, ${accent} 38%, transparent)`}
        fillBot={`color-mix(in oklab, ${accent} 52%, transparent)`}
      />

      {/* Front band — the darkest, dominant swell. Shorter and the only
          one that reaches near-solid color at the bottom so the page has
          a clear visual base. */}
      <HomeWaveBand
        heightPct={38}
        amp={[20, 9]}
        periods={[880, 480]}
        phases={[0.70, 0.30]}
        speedPxPerSec={88 * (0.4 + motion)}
        reverse
        fillTop={`color-mix(in oklab, ${accent} 58%, transparent)`}
        fillBot={`color-mix(in oklab, ${accent} 78%, var(--bg))`}
      />

      {/* Top scrim — a final feathering from page bg down through the
          first ~30% of the canvas. Kills any residual hard edge where
          the lightest band's crests touch the white area. */}
      <div
        style={{
          position: 'absolute', left: 0, right: 0, top: 0, height: '40%',
          background:
            'linear-gradient(180deg, var(--bg) 0%, color-mix(in oklab, var(--bg) 80%, transparent) 60%, transparent 100%)',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}

// One smooth band: a sum-of-two-sines surface that drifts horizontally
// at its own rate. We render it as an SVG path filled with a soft
// vertical gradient (top a touch lighter, bottom slightly deeper) so
// individual bands have their own subtle depth rather than looking like
// flat cut-outs.
function HomeWaveBand({
  heightPct, amp, periods, phases, speedPxPerSec, reverse, fillTop, fillBot,
}) {
  const pathRef = useRef(null);
  const params = useRef(null);
  params.current = { amp, periods, phases, speedPxPerSec, reverse };

  useEffect(() => {
    let raf;
    const start = performance.now();
    const loop = (now) => {
      const t = (now - start) / 1000;
      const p = params.current;
      const dir = p.reverse ? -1 : 1;
      const livePhases = p.phases.map((ph, i) => {
        // Each component drifts at its own rate (longer wavelengths
        // move slower) so the surface never loops verbatim.
        const longest = Math.max.apply(null, p.periods);
        const dispersion = Math.sqrt(longest / p.periods[i]);
        const shiftPx = p.speedPxPerSec * dir * dispersion * t;
        return ph + shiftPx / p.periods[i];
      });
      const d = buildHomeBandPath(p.amp, p.periods, livePhases);
      if (pathRef.current) pathRef.current.setAttribute('d', d);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const initial = useMemo(
    () => buildHomeBandPath(amp, periods, phases),
    [amp.join(','), periods.join(','), phases.join(',')],
  );
  // Unique gradient id per band so multiple instances don't collide.
  const gid = useMemo(() => `hw-${Math.random().toString(36).slice(2, 8)}`, []);

  return (
    <div
      style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        height: `${heightPct}%`,
        pointerEvents: 'none',
      }}
    >
      <svg
        width="100%" height="100%"
        viewBox="0 0 1200 200"
        preserveAspectRatio="none"
        style={{ display: 'block' }}
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

// Build a smooth filled-band path:
//   ─ surface = sum of two sines over x in [0..1200]
//   ─ fills DOWN from the surface to y=200, closes left+right edges
//   ─ uses midpoint quadratic Beziers for a kink-free curve
// baseY anchors the mean surface near the top of the band's local
// viewBox so the body has room to breathe under it.
function buildHomeBandPath(amp, periods, phases) {
  const W = 1200, H = 200;
  const baseY = 60; // surface mean line inside the band's viewBox
  const STEP = 20;

  const yAt = (x) => {
    let y = baseY;
    for (let i = 0; i < amp.length; i++) {
      const phase = (x / periods[i] + phases[i]) * Math.PI * 2;
      y -= amp[i] * Math.sin(phase);
    }
    return y;
  };

  const pts = [];
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

window.Wave = Wave;
window.HomeWaveBg = HomeWaveBg;
