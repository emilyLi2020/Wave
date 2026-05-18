// wave-canvas.jsx — the shared full-bleed wave canvas.
//
// One canvas, persistent across every screen of the prototype. Reads
// its state from WaveContext (cravingScore + per-screen posture +
// listening + breath delta) and re-renders 60fps. Three layered sines
// drift left→right; the front layer gets a lit crest stroke with a
// cyan shadowBlur glow. Implements the spec from wave-design.md:
//
//   amp = scoreToAmp(score) + breathDelta * swing
//   amp smoothing: amp += (target - amp) * 0.035
//   horizon smoothing: same
//   listening adds high-freq ripple to mid + front layers
//
// Particles, film grain, and a vignette sit ON TOP of the wave but
// underneath the screen content — they live in the same canvas so we
// keep everything atmospheric in one render loop.

const WaveContext = React.createContext({
  screen: 'home',
  cravingScore: null,
  intakeIntensity: null,
  breathDelta: 0,
  listening: false,
  motion: 1,
  dark: true,
});

window.WaveContext = WaveContext;

// ─── Geometry config ─────────────────────────────────────────

const HORIZONS = {
  lock:       0.58,
  home:       0.66,
  intake:     0.66,
  safety:     0.70,
  chunk:      0.74,
  checkin:    0.78,
  reflection: 0.84,
  done:       0.86,
  dashboard:  0.88,
  // loaders fall through to this
  _default:   0.70,
};

const LAYERS = [
  // back
  { ampFrac: 0.55, freq: 0.0034, speed: 0.00018, phase: 0.00, fillA: 0.20, fillB: 0.02 },
  // mid
  { ampFrac: 0.78, freq: 0.0046, speed: 0.00028, phase: 1.20, fillA: 0.32, fillB: 0.04 },
  // front
  { ampFrac: 1.00, freq: 0.0058, speed: 0.00042, phase: 2.40, fillA: 0.55, fillB: 0.08, isFront: true },
];

function scoreToAmp(score) {
  if (score == null) return 0.18;
  return 0.12 + (score / 10) * 0.70;
}

function targetAmplitude(score, breathDelta) {
  const base = scoreToAmp(score);
  const swing = breathDelta >= 0 ? 0.08 : 0.05;
  return Math.max(0.06, base + breathDelta * swing);
}

// ─── Particles ───────────────────────────────────────────────
// Distant plankton / ions, slow upward drift, near-static. ~36 dots.

function makeParticles(w, h, count = 36) {
  const arr = [];
  for (let i = 0; i < count; i++) {
    arr.push({
      x: Math.random() * w,
      y: Math.random() * h,
      r: 0.5 + Math.random() * 1.2,
      vy: -(0.05 + Math.random() * 0.15),
      alpha: 0.05 + Math.random() * 0.22,
      twinkleSeed: Math.random() * 6.28,
    });
  }
  return arr;
}

// ─── The component ───────────────────────────────────────────

function WaveCanvas() {
  const containerRef = React.useRef(null);
  const canvasRef    = React.useRef(null);
  const stateRef     = React.useRef({
    // smoothed
    amp: 0.18,
    horizon: 0.66,
    listeningMix: 0,
    // for resize
    dpr: 1, w: 0, h: 0,
    particles: [],
    t0: performance.now(),
  });

  const wave = React.useContext(WaveContext);

  // Keep latest context readable from inside the rAF loop without
  // restarting it on every prop change.
  const liveRef = React.useRef(wave);
  liveRef.current = wave;

  // ─── Setup canvas + resize ─────
  React.useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      const w = Math.max(64, Math.round(rect.width));
      const h = Math.max(64, Math.round(rect.height));
      canvas.width  = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width  = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const s = stateRef.current;
      s.dpr = dpr; s.w = w; s.h = h;
      s.particles = makeParticles(w, h);
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    window.addEventListener('resize', resize);

    // ─── Render loop ─────
    // NOTE: requestAnimationFrame is heavily throttled when this
    // page renders inside the host's preview iframe, so the wave
    // never started in practice. setTimeout-driven loop runs even
    // when the iframe doesn't have focus, which matches the
    // "always moving" atmosphere the doc requires.
    let timer;
    let cancelled = false;
    function frame(now) {
      const s = stateRef.current;
      const l = liveRef.current;
      const w = s.w, h = s.h;
      if (!w || !h) {
        if (!cancelled) timer = setTimeout(() => frame(performance.now()), 32);
        return;
      }

      // ── update smoothed targets
      const tgtAmp = targetAmplitude(l.cravingScore, l.breathDelta || 0);
      const tgtHorizon = HORIZONS[l.screen] ?? HORIZONS._default;
      const tgtListening = l.listening ? 1 : 0;
      const motion = l.motion ?? 1;

      s.amp     += (tgtAmp - s.amp) * 0.035;
      s.horizon += (tgtHorizon - s.horizon) * 0.035;
      s.listeningMix += (tgtListening - s.listeningMix) * 0.06;

      const t = (now - s.t0) * motion;

      // ── clear with depth gradient
      const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
      if (l.dark !== false) {
        bgGrad.addColorStop(0, '#02060d');
        bgGrad.addColorStop(0.55, '#05101c');
        bgGrad.addColorStop(1, '#02060d');
      } else {
        bgGrad.addColorStop(0, '#f5fbff');
        bgGrad.addColorStop(0.55, '#eaf3fb');
        bgGrad.addColorStop(1, '#dceaf5');
      }
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      // ── particles (behind wave)
      for (const p of s.particles) {
        p.y += p.vy;
        if (p.y < -4) { p.y = h + 4; p.x = Math.random() * w; }
        const tw = 0.5 + 0.5 * Math.sin(t * 0.001 + p.twinkleSeed);
        ctx.beginPath();
        ctx.fillStyle = l.dark !== false
          ? `rgba(92,225,214,${(p.alpha * tw).toFixed(3)})`
          : `rgba(14,116,144,${(p.alpha * tw * 0.4).toFixed(3)})`;
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }

      const horizonY = h * s.horizon;
      const ampPx = s.amp * (h * 0.42); // peak height in pixels at amp 1.0

      // ── three wave layers
      for (let li = 0; li < LAYERS.length; li++) {
        const cfg = LAYERS[li];
        const layerAmp = ampPx * cfg.ampFrac;

        // build path along top of wave
        ctx.beginPath();
        ctx.moveTo(0, h);
        ctx.lineTo(0, horizonY);
        const step = 2;
        for (let x = 0; x <= w; x += step) {
          // drift left→right: argument uses (x*freq − t*speed) so a
          // constant phase line shifts right as t grows
          let y = horizonY - layerAmp * Math.sin(x * cfg.freq - t * cfg.speed + cfg.phase);
          // a second harmonic gives the crest a little asymmetry
          y -= layerAmp * 0.25 * Math.sin(x * cfg.freq * 1.7 - t * cfg.speed * 1.3 + cfg.phase * 0.5);
          // listening ripple on mid + front layers
          if (li > 0 && s.listeningMix > 0.01) {
            const jitter = 3 * s.listeningMix * (li === 2 ? 1 : 0.6);
            y -= jitter * Math.sin(x * 0.06 - t * 0.007);
          }
          ctx.lineTo(x, y);
        }
        ctx.lineTo(w, h);
        ctx.closePath();

        // fill with teal gradient
        const grad = ctx.createLinearGradient(0, horizonY - layerAmp, 0, h);
        if (l.dark !== false) {
          grad.addColorStop(0, `rgba(92,225,214,${cfg.fillA})`);
          grad.addColorStop(0.45, `rgba(34,211,238,${cfg.fillB * 1.4})`);
          grad.addColorStop(1, `rgba(2,6,13,${cfg.fillB})`);
        } else {
          grad.addColorStop(0, `rgba(14,116,144,${cfg.fillA * 0.6})`);
          grad.addColorStop(0.5, `rgba(34,211,238,${cfg.fillB * 0.8})`);
          grad.addColorStop(1, `rgba(220,234,245,${cfg.fillB})`);
        }
        ctx.fillStyle = grad;
        ctx.fill();

        // lit crest stroke on the front layer
        if (cfg.isFront) {
          ctx.save();
          ctx.beginPath();
          for (let x = 0; x <= w; x += step) {
            let y = horizonY - layerAmp * Math.sin(x * cfg.freq - t * cfg.speed + cfg.phase);
            y -= layerAmp * 0.25 * Math.sin(x * cfg.freq * 1.7 - t * cfg.speed * 1.3 + cfg.phase * 0.5);
            if (s.listeningMix > 0.01) {
              y -= 3 * s.listeningMix * Math.sin(x * 0.06 - t * 0.007);
            }
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.lineWidth = 1.2;
          ctx.strokeStyle = l.dark !== false
            ? 'rgba(184,255,242,0.85)'
            : 'rgba(8,145,178,0.7)';
          ctx.shadowColor = l.dark !== false ? '#5ce1d6' : '#22d3ee';
          ctx.shadowBlur = 12;
          ctx.stroke();
          ctx.restore();
        }
      }

      // ── radial glow above the crest peak
      const crestX = w * (0.55 + 0.06 * Math.sin(t * 0.00018));
      const crestY = horizonY - ampPx;
      const glowR = Math.max(120, h * 0.4 * s.amp + 60);
      const glowGrad = ctx.createRadialGradient(crestX, crestY, 0, crestX, crestY, glowR);
      if (l.dark !== false) {
        glowGrad.addColorStop(0, 'rgba(92,225,214,0.30)');
        glowGrad.addColorStop(0.45, 'rgba(34,211,238,0.10)');
        glowGrad.addColorStop(1, 'rgba(2,6,13,0)');
      } else {
        glowGrad.addColorStop(0, 'rgba(34,211,238,0.20)');
        glowGrad.addColorStop(1, 'rgba(255,255,255,0)');
      }
      ctx.fillStyle = glowGrad;
      ctx.fillRect(0, 0, w, h);

      // ── corner vignette
      const vign = ctx.createRadialGradient(w / 2, h * 0.55, h * 0.45, w / 2, h * 0.55, h * 0.95);
      vign.addColorStop(0, 'rgba(0,0,0,0)');
      vign.addColorStop(1, l.dark !== false ? 'rgba(0,0,0,0.55)' : 'rgba(11,31,51,0.18)');
      ctx.fillStyle = vign;
      ctx.fillRect(0, 0, w, h);

      if (!cancelled) timer = setTimeout(() => frame(performance.now()), 16);
    }
    timer = setTimeout(() => frame(performance.now()), 16);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      ro.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="wave-canvas-host"
      aria-hidden
      style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        overflow: 'hidden',
      }}
    >
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
      {/* SVG fractal-noise film grain on top, blend mode handles tinting */}
      <div className="wave-grain" />
    </div>
  );
}

window.WaveCanvas = WaveCanvas;
