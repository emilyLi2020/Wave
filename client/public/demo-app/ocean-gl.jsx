// ocean-gl.jsx — WebGL fragment-shader ocean.
//
// Replaces the layered sum-of-sines SVG with a per-pixel-shaded water
// surface. The pipeline is the standard real-time-ocean recipe:
//
//   1. Sum of 5 Gerstner-like wave components → height field h(x,y,t).
//      Each component has its own direction, wavelength, amplitude, and
//      speed. A small Stokes 2nd-harmonic (`sin(φ) − 0.18·cos(2φ)`)
//      sharpens crests and flattens troughs.
//   2. Analytic gradient of h → per-pixel surface normal.
//   3. Phong specular against a fixed sun direction → sparkle on crests.
//   4. Schlick-style fresnel → mix in sky reflection at glancing angles.
//   5. Foam mask from peak crests, knocked down with distance haze.
//   6. Distance haze toward the horizon flattens detail and tints sky.
//
// `intensity` (1..10) scales wave amplitude — high craving = stormy sea,
// low craving = glassy calm. `motion` (0..1) scales speed. Colors are
// read from CSS custom properties so the ocean shifts with the active
// accent palette.
//
// Falls back gracefully: if `webgl` context creation fails, the
// component does nothing and the caller can render its SVG fallback.

const VERT_SRC = `
  attribute vec2 aPos;
  varying vec2 vUv;
  void main() {
    vUv = aPos * 0.5 + 0.5;
    gl_Position = vec4(aPos, 0.0, 1.0);
  }
`;

const FRAG_SRC = `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uIntensity;   // 0..1
  uniform float uMotion;      // 0..1
  uniform vec2  uAspect;      // x,y aspect scale so waves don't squash
  uniform vec3  uColorDeep;
  uniform vec3  uColorPeak;
  uniform vec3  uColorRise;
  uniform vec3  uColorSpec;
  uniform vec3  uColorSky;

  // Wave components — direction, wave-number, amplitude, angular speed.
  // Hand-tuned set: a dominant long swell rolling toward the camera,
  // four shorter components in slightly varied directions. WebGL-1-safe
  // (no non-const array indexing).
  vec2 waveDir(int i) {
    if (i == 0) return normalize(vec2( 0.10,  1.00));
    if (i == 1) return normalize(vec2(-0.30,  1.00));
    if (i == 2) return normalize(vec2( 0.55,  1.00));
    if (i == 3) return normalize(vec2( 0.00,  1.00));
    return normalize(vec2(-0.85,  1.00));
  }
  float waveK(int i) {
    if (i == 0) return 1.4;
    if (i == 1) return 2.5;
    if (i == 2) return 3.7;
    if (i == 3) return 6.0;
    return 9.0;
  }
  float waveA(int i) {
    if (i == 0) return 0.30;
    if (i == 1) return 0.17;
    if (i == 2) return 0.10;
    if (i == 3) return 0.06;
    return 0.04;
  }
  float waveS(int i) {
    if (i == 0) return 0.55;
    if (i == 1) return 0.85;
    if (i == 2) return 1.20;
    if (i == 3) return 1.75;
    return 2.30;
  }

  // Cheap hash → 0..1 for foam micro-detail.
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  // Value noise for foam streak texture.
  float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  void main() {
    vec2 uv = vUv;

    // Perspective foreshortening: distance grows non-linearly toward
    // the top of the canvas. (wy) is the world-space y coordinate at
    // this screen pixel; the pow() exaggerates compression near the
    // horizon so distant waves read smaller.
    float depth = uv.y;
    float persp = mix(1.0, 0.22, pow(depth, 1.4));
    float wx = (uv.x * 2.0 - 1.0) * 2.0 * uAspect.x;
    float wy = mix(0.0, 9.0, pow(depth, 1.35));

    // Sum waves
    float h = 0.0;
    vec2  grad = vec2(0.0);
    float ampScale   = 0.45 + 0.85 * uIntensity;
    float speedScale = 0.25 + 1.55 * uMotion;
    for (int i = 0; i < 5; i++) {
      vec2  d = waveDir(i);
      float k = waveK(i);
      float a = waveA(i) * ampScale;
      float s = waveS(i) * speedScale;
      float arg = (d.x * wx + d.y * wy) * k - uTime * s;
      // Stokes 2nd-order: sharper crests, flatter troughs.
      float ss = sin(arg) - 0.18 * cos(2.0 * arg);
      h    += a * ss;
      float ds = cos(arg) + 0.36 * sin(2.0 * arg);
      grad += d * k * a * ds;
    }

    // Surface normal in 2D (z up). (persp) flattens normals toward the
    // horizon so foam doesn't dominate distance.
    vec3 N = normalize(vec3(-grad.x, -grad.y, 0.7 * persp));

    // Sun + camera. Sun front-and-slightly-right, camera looking down
    // and forward — classic ocean-from-the-shore composition.
    vec3 L = normalize(vec3(0.35, 0.55, 0.75));
    vec3 V = normalize(vec3(0.0, -0.55, 1.0));

    float diff = max(dot(N, L), 0.0);
    vec3  R    = reflect(-L, N);
    float spec = pow(max(dot(R, V), 0.0), 64.0);
    float fres = pow(1.0 - max(dot(V, N), 0.0), 4.0);

    // Base water color from local height (deep troughs darker, crests
    // tint toward the peak/rise hue).
    float hN  = clamp(h * 2.6, -1.0, 1.5);
    vec3 col  = mix(uColorDeep, uColorPeak, smoothstep(-0.7, 0.9, hN));

    // Sky reflection (Schlick fresnel) — bright at glancing angles.
    vec3 skyCol = mix(uColorRise, uColorSky, 0.50);
    col = mix(col, skyCol, fres * 0.55);

    // Distance haze: tint toward sky, lose contrast.
    float haze = smoothstep(0.55, 1.0, depth);
    col = mix(col, skyCol * 0.94, haze * 0.65);

    // Specular sun glint — bigger in choppy seas.
    col += spec * uColorSpec * (1.0 + 0.5 * uIntensity);

    // Foam on big crests. Modulate by value noise so it doesn't read as
    // a clean ramp; knock down by haze so distant water stays smooth.
    float crest    = smoothstep(0.55, 1.05, hN);
    float foamTex  = noise2(uv * vec2(28.0, 14.0) + uTime * vec2(0.2, 0.8));
    float foamTex2 = noise2(uv * vec2(80.0, 40.0) + uTime * vec2(-0.3, 1.4));
    float foam = crest * mix(foamTex, foamTex2, 0.4);
    foam *= (1.0 - haze * 0.85);
    col = mix(col, vec3(0.97, 0.98, 0.98), foam * 0.78);

    // Hint of diffuse so flat patches aren't a single tone.
    col *= (0.85 + diff * 0.25);

    // Soft vignette at very top — the box edge would otherwise read as
    // a hard cut into sky tone.
    float vig = smoothstep(0.95, 1.0, depth);
    col = mix(col, skyCol * 0.85, vig * 0.5);

    gl_FragColor = vec4(col, 1.0);
  }
`;

// ─── Component ──────────────────────────────────────────────

const { useEffect: useEffectOG, useRef: useRefOG } = React;

function OceanGL({ intensity = 5, motion = 0.7 }) {
  const canvasRef = useRefOG(null);
  const intensityRef = useRefOG(intensity);
  const motionRef = useRefOG(motion);
  intensityRef.current = intensity;
  motionRef.current = motion;

  useEffectOG(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const gl =
      canvas.getContext('webgl', {
        alpha: false,
        antialias: false,
        premultipliedAlpha: false,
        powerPreference: 'low-power',
      }) ||
      canvas.getContext('experimental-webgl');
    if (!gl) {
      canvas.dataset.failed = '1';
      return undefined;
    }

    function compile(type, src) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        // eslint-disable-next-line no-console
        console.error('[ocean-gl] shader compile error:', gl.getShaderInfoLog(s));
        return null;
      }
      return s;
    }
    const vs = compile(gl.VERTEX_SHADER, VERT_SRC);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG_SRC);
    if (!vs || !fs) return undefined;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      // eslint-disable-next-line no-console
      console.error('[ocean-gl] link error:', gl.getProgramInfoLog(prog));
      return undefined;
    }
    gl.useProgram(prog);

    // Fullscreen quad.
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const locPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(locPos);
    gl.vertexAttribPointer(locPos, 2, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(prog, 'uTime');
    const uIntensity = gl.getUniformLocation(prog, 'uIntensity');
    const uMotion = gl.getUniformLocation(prog, 'uMotion');
    const uAspect = gl.getUniformLocation(prog, 'uAspect');
    const uColorDeep = gl.getUniformLocation(prog, 'uColorDeep');
    const uColorPeak = gl.getUniformLocation(prog, 'uColorPeak');
    const uColorRise = gl.getUniformLocation(prog, 'uColorRise');
    const uColorSpec = gl.getUniformLocation(prog, 'uColorSpec');
    const uColorSky = gl.getUniformLocation(prog, 'uColorSky');

    // Resolve CSS color custom properties to RGB triples. We can't read
    // `color-mix()` results from getComputedStyle directly, but we can
    // bounce the value through an offscreen element's `color` property
    // — the browser computes it down to rgb()/rgba() for us.
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;';
    document.body.appendChild(probe);
    function readColor(cssVar, fallback) {
      probe.style.color = `var(${cssVar})`;
      const computed = getComputedStyle(probe).color;
      probe.style.color = '';
      const m = computed.match(/rgba?\(([^)]+)\)/);
      if (!m) return fallback;
      const parts = m[1].split(',').map((s) => parseFloat(s.trim()));
      if (parts.length < 3 || parts.some(Number.isNaN)) return fallback;
      return [parts[0] / 255, parts[1] / 255, parts[2] / 255];
    }

    let lastDeep = null;
    let lastPeak = null;
    let lastRise = null;
    let lastSpec = [1.0, 0.95, 0.85];
    let lastSky = [0.95, 0.97, 0.99];
    let lastReadAt = 0;
    function maybeReadColors(now) {
      // Re-read every 250ms after the first read — cheap and tracks
      // tweak-panel changes without a MutationObserver. The first call
      // ALWAYS reads, regardless of `now`, so the first paint isn't
      // black (rAF timestamps can be small or the loop can be throttled
      // on init in some preview environments).
      if (lastDeep !== null && now - lastReadAt < 250) return;
      lastReadAt = now;
      lastDeep = readColor('--accent-deep', [0.04, 0.18, 0.28]);
      lastPeak = readColor('--wave-peak', [0.16, 0.50, 0.65]);
      lastRise = readColor('--wave-rise', [0.45, 0.75, 0.85]);
      const fall = readColor('--wave-fall', [0.8, 0.92, 0.95]);
      // "Sky" tint biases toward the lightest palette color so the
      // horizon doesn't read as a foreign color band.
      lastSky = [
        Math.min(1, fall[0] * 0.55 + 0.55),
        Math.min(1, fall[1] * 0.55 + 0.55),
        Math.min(1, fall[2] * 0.55 + 0.6),
      ];
      // Sun glint stays warm regardless of theme.
      lastSpec = [1.0, 0.96, 0.85];
      gl.uniform3fv(uColorDeep, lastDeep);
      gl.uniform3fv(uColorPeak, lastPeak);
      gl.uniform3fv(uColorRise, lastRise);
      gl.uniform3fv(uColorSpec, lastSpec);
      gl.uniform3fv(uColorSky, lastSky);
    }

    // Eagerly seed all color uniforms BEFORE the first frame so a
    // throttled / paused rAF can't leave the canvas painted black.
    maybeReadColors(0);

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cw = Math.max(1, canvas.clientWidth);
      const ch = Math.max(1, canvas.clientHeight);
      const w = Math.round(cw * dpr);
      const h = Math.round(ch * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
      // Aspect for world-space wave field — short, wide canvases compress
      // x; the uAspect.x term keeps wave proportions readable.
      const ar = cw / Math.max(1, ch);
      gl.uniform2f(uAspect, ar, 1.0);
    }

    let raf;
    const start = performance.now();
    const visibilityChange = () => {
      // Pause when hidden — saves battery and prevents the time jump
      // from accumulating off-screen wave motion.
      if (document.hidden) {
        cancelAnimationFrame(raf);
      } else {
        raf = requestAnimationFrame(tick);
      }
    };
    document.addEventListener('visibilitychange', visibilityChange);

    function tick(now) {
      resize();
      maybeReadColors(now);
      const t = (now - start) / 1000;
      gl.uniform1f(uTime, t);
      gl.uniform1f(uIntensity, Math.max(0, Math.min(1, (intensityRef.current - 1) / 9)));
      gl.uniform1f(uMotion, Math.max(0, Math.min(1, motionRef.current)));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', visibilityChange);
      if (probe.parentNode) probe.parentNode.removeChild(probe);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        display: 'block',
      }}
    />
  );
}

window.OceanGL = OceanGL;
