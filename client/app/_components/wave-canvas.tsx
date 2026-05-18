"use client";

/**
 * Shared full-bleed bioluminescent wave canvas.
 *
 * Ported from the Claude Design handoff (`public/demo-app/wave-canvas.jsx`).
 * Three layered sines drift left→right; the front layer gets a lit crest
 * stroke with a cyan glow. Distant plankton particles, a radial glow above
 * the crest, and a corner vignette complete the atmosphere. A separate SVG
 * film-grain layer (see globals.css `.wave-grain`) sits on top.
 *
 * This is purely decorative — it reads no app state and touches no business
 * logic. It renders fixed behind all patient-facing content.
 *
 * NOTE: the loop is setTimeout-driven (not rAF) to match the source and to
 * keep the water moving even when the tab is briefly backgrounded.
 */

import { useEffect, useRef } from "react";

const HORIZON = 0.72; // calm "session" posture
const LAYERS = [
  { ampFrac: 0.55, freq: 0.0034, speed: 0.00018, phase: 0.0, fillA: 0.2, fillB: 0.02 },
  { ampFrac: 0.78, freq: 0.0046, speed: 0.00028, phase: 1.2, fillA: 0.32, fillB: 0.04 },
  { ampFrac: 1.0, freq: 0.0058, speed: 0.00042, phase: 2.4, fillA: 0.55, fillB: 0.08, isFront: true },
];

type Particle = {
  x: number;
  y: number;
  r: number;
  vy: number;
  alpha: number;
  twinkleSeed: number;
};

function makeParticles(w: number, h: number, count = 36): Particle[] {
  const arr: Particle[] = [];
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

export function WaveCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const s = {
      amp: 0.42,
      w: 0,
      h: 0,
      particles: [] as Particle[],
      t0: performance.now(),
    };

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      const rect = container!.getBoundingClientRect();
      const w = Math.max(64, Math.round(rect.width));
      const h = Math.max(64, Math.round(rect.height));
      canvas!.width = Math.round(w * dpr);
      canvas!.height = Math.round(h * dpr);
      canvas!.style.width = `${w}px`;
      canvas!.style.height = `${h}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      s.w = w;
      s.h = h;
      s.particles = makeParticles(w, h);
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    window.addEventListener("resize", resize);

    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    function frame(now: number) {
      const c = ctx!;
      const w = s.w;
      const h = s.h;
      if (!w || !h) {
        if (!cancelled) timer = setTimeout(() => frame(performance.now()), 32);
        return;
      }
      const t = now - s.t0;

      const bgGrad = c.createLinearGradient(0, 0, 0, h);
      bgGrad.addColorStop(0, "#02060d");
      bgGrad.addColorStop(0.55, "#05101c");
      bgGrad.addColorStop(1, "#02060d");
      c.fillStyle = bgGrad;
      c.fillRect(0, 0, w, h);

      for (const p of s.particles) {
        p.y += p.vy;
        if (p.y < -4) {
          p.y = h + 4;
          p.x = Math.random() * w;
        }
        const tw = 0.5 + 0.5 * Math.sin(t * 0.001 + p.twinkleSeed);
        c.beginPath();
        c.fillStyle = `rgba(92,225,214,${(p.alpha * tw).toFixed(3)})`;
        c.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        c.fill();
      }

      const horizonY = h * HORIZON;
      const ampPx = s.amp * (h * 0.42);

      for (let li = 0; li < LAYERS.length; li++) {
        const cfg = LAYERS[li];
        const layerAmp = ampPx * cfg.ampFrac;

        c.beginPath();
        c.moveTo(0, h);
        c.lineTo(0, horizonY);
        const step = 2;
        for (let x = 0; x <= w; x += step) {
          let y = horizonY - layerAmp * Math.sin(x * cfg.freq - t * cfg.speed + cfg.phase);
          y -= layerAmp * 0.25 * Math.sin(x * cfg.freq * 1.7 - t * cfg.speed * 1.3 + cfg.phase * 0.5);
          c.lineTo(x, y);
        }
        c.lineTo(w, h);
        c.closePath();

        const grad = c.createLinearGradient(0, horizonY - layerAmp, 0, h);
        grad.addColorStop(0, `rgba(92,225,214,${cfg.fillA})`);
        grad.addColorStop(0.45, `rgba(34,211,238,${cfg.fillB * 1.4})`);
        grad.addColorStop(1, `rgba(2,6,13,${cfg.fillB})`);
        c.fillStyle = grad;
        c.fill();

        if (cfg.isFront) {
          c.save();
          c.beginPath();
          for (let x = 0; x <= w; x += step) {
            let y = horizonY - layerAmp * Math.sin(x * cfg.freq - t * cfg.speed + cfg.phase);
            y -= layerAmp * 0.25 * Math.sin(x * cfg.freq * 1.7 - t * cfg.speed * 1.3 + cfg.phase * 0.5);
            if (x === 0) c.moveTo(x, y);
            else c.lineTo(x, y);
          }
          c.lineWidth = 1.2;
          c.strokeStyle = "rgba(184,255,242,0.85)";
          c.shadowColor = "#5ce1d6";
          c.shadowBlur = 12;
          c.stroke();
          c.restore();
        }
      }

      const crestX = w * (0.55 + 0.06 * Math.sin(t * 0.00018));
      const crestY = horizonY - ampPx;
      const glowR = Math.max(120, h * 0.4 * s.amp + 60);
      const glowGrad = c.createRadialGradient(crestX, crestY, 0, crestX, crestY, glowR);
      glowGrad.addColorStop(0, "rgba(92,225,214,0.30)");
      glowGrad.addColorStop(0.45, "rgba(34,211,238,0.10)");
      glowGrad.addColorStop(1, "rgba(2,6,13,0)");
      c.fillStyle = glowGrad;
      c.fillRect(0, 0, w, h);

      const vign = c.createRadialGradient(w / 2, h * 0.55, h * 0.45, w / 2, h * 0.55, h * 0.95);
      vign.addColorStop(0, "rgba(0,0,0,0)");
      vign.addColorStop(1, "rgba(0,0,0,0.55)");
      c.fillStyle = vign;
      c.fillRect(0, 0, w, h);

      if (!cancelled) timer = setTimeout(() => frame(performance.now()), 16);
    }
    timer = setTimeout(() => frame(performance.now()), 16);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      ro.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="wave-canvas-host"
      aria-hidden
      style={{ position: "fixed", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 0 }}
    >
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
      <div className="wave-grain" />
    </div>
  );
}
