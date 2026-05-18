// screens.jsx — every screen of the WAVE prototype.
//
// Each screen receives `state` and `actions` plus the live `tweaks` so
// motion/density/style stay applied across the whole flow.

const { Fragment, useRef } = React;

// ─── Iconography (minimal stroked SVG, line-weight only) ─────

function Icon({ name, size = 18, stroke = 'currentColor', strokeWidth = 1.6 }) {
  const common = {
    width: size, height: size, viewBox: '0 0 24 24',
    fill: 'none', stroke, strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round',
  };
  switch (name) {
    case 'arrow-right': return (<svg {...common}><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>);
    case 'arrow-left':  return (<svg {...common}><path d="M19 12H5"/><path d="m11 6-6 6 6 6"/></svg>);
    case 'check':       return (<svg {...common}><path d="m5 12 5 5L20 7"/></svg>);
    case 'send':        return (<svg {...common}><path d="M22 2 11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>);
    case 'mute':        return (<svg {...common}><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M22 9l-6 6m0-6 6 6"/></svg>);
    case 'sound':       return (<svg {...common}><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>);
    case 'shield':      return (<svg {...common}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>);
    case 'pill':        return (<svg {...common}><rect x="2" y="9" width="20" height="6" rx="3"/><path d="M12 9v6"/></svg>);
    case 'spark':       return (<svg {...common}><path d="M12 3v3"/><path d="M12 18v3"/><path d="M5.6 5.6 7.7 7.7"/><path d="m16.3 16.3 2.1 2.1"/><path d="M3 12h3"/><path d="M18 12h3"/><path d="M5.6 18.4 7.7 16.3"/><path d="m16.3 7.7 2.1-2.1"/></svg>);
    case 'home':        return (<svg {...common}><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/></svg>);
    default: return null;
  }
}

window.Icon = Icon;

// ─── Intensity slider ────────────────────────────────────────
//
// Reusable across intake and check-in. Renders the current value as
// a big number above the track; the track is intentionally tall and
// the thumb large so it's a one-handed gesture in a craving moment.
// Snaps to integers 1–10.

function IntensitySlider({ value, touched, onChange, size = 'md' }) {
  const trackRef = useRef(null);
  const dragRef = useRef(false);
  const min = 1, max = 10;
  const pct = ((value - min) / (max - min)) * 100;
  const big = size === 'lg';

  function valueAt(clientX) {
    const r = trackRef.current.getBoundingClientRect();
    const ratio = (clientX - r.left) / r.width;
    const raw = min + Math.max(0, Math.min(1, ratio)) * (max - min);
    return Math.round(raw);
  }

  function start(clientX) {
    dragRef.current = true;
    const v = valueAt(clientX);
    if (v !== value) onChange(v);
  }
  function move(clientX) {
    if (!dragRef.current) return;
    const v = valueAt(clientX);
    if (v !== value) onChange(v);
  }
  function stop() { dragRef.current = false; }

  function onPointerDown(e) {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    start(e.clientX);
    const onMove = (ev) => move(ev.clientX);
    const onUp = () => {
      stop();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp')   { e.preventDefault(); onChange(Math.min(max, value + 1)); }
    if (e.key === 'ArrowLeft'  || e.key === 'ArrowDown') { e.preventDefault(); onChange(Math.max(min, value - 1)); }
    if (e.key === 'Home') { e.preventDefault(); onChange(min); }
    if (e.key === 'End')  { e.preventDefault(); onChange(max); }
  }

  // intensity colour: stays accent at low, blends toward wave-peak at high
  const fillStops = `linear-gradient(90deg,
    color-mix(in oklab, var(--accent) 65%, transparent) 0%,
    var(--accent) 60%,
    var(--wave-peak) 100%)`;

  return (
    <div className={`intensity ${big ? 'lg' : ''}`}>
      <div className="intensity-readout">
        <span
          className="intensity-num"
          style={{ opacity: touched ? 1 : 0.25 }}
          aria-live="polite"
        >
          {value}
          <span className="intensity-unit">/10</span>
        </span>
      </div>

      <div
        ref={trackRef}
        className="intensity-track"
        role="slider"
        tabIndex={0}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      >
        <div className="intensity-track-bg" />
        <div className="intensity-track-fill" style={{ width: `${pct}%`, background: fillStops }} />
        {/* tick marks at every integer */}
        <div className="intensity-ticks" aria-hidden>
          {Array.from({ length: 10 }, (_, i) => (
            <span key={i} className="intensity-tick" style={{ left: `${(i / 9) * 100}%` }} />
          ))}
        </div>
        <div
          className="intensity-thumb"
          style={{ left: `${pct}%` }}
          aria-hidden
        >
          <span className="intensity-thumb-dot" />
        </div>
      </div>

      <div className="scale-rail" style={{ marginTop: big ? 14 : 8 }}>
        <span>Barely there</span>
        <span>Unbearable</span>
      </div>
    </div>
  );
}

window.IntensitySlider = IntensitySlider;

// ─── Lock screen ─────────────────────────────────────────────

function LockScreen({ onOpen }) {
  return (
    <div className="lock">
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', paddingTop: 30 }}>
        <div className="lock-date">Tuesday, May 12</div>
        <div className="lock-time">6:48</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
        <div style={{ padding: '0 18px', fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)' }}>
          Notification Center
        </div>
        <button className="lock-notif" onClick={onOpen} type="button">
          <AppIcon size={38} radius={10} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h4>
              <span className="wordmark" style={{ fontSize: 16 }}>WAVE</span>
              <span className="ts">now</span>
            </h4>
            <p>Your typical 7pm window is 15 minutes out. Open when you still have agency.</p>
          </div>
        </button>
      </div>
      <div className="lock-hint">
        <div className="arrow" />
        <div>Swipe up to open</div>
      </div>
    </div>
  );
}

window.LockScreen = LockScreen;

// ─── Home ────────────────────────────────────────────────────
//
// The user has just opened the app. They are not OK. Per the WAVE
// design doc: italic-serif prompt centered, tap-anywhere full-bleed,
// crisis line at the bottom. The wave behind everything is the shared
// canvas — no inline wave widgets here.

function HomeScreen({ onStart, onDashboard, onHistory, tweaks }) {
  return (
    <div className="screen">
      {/* Full-bleed tap zone — entire screen starts the session */}
      <button
        type="button"
        className="tap-zone"
        onClick={onStart}
        aria-label="Start session"
      />

      <div className="topbar" style={{ position: 'relative', zIndex: 2 }}>
        <span className="wordmark">WAVE</span>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="nav-link" onClick={(e) => { e.stopPropagation(); onDashboard?.(); }}>
            Dashboard
          </button>
          <button type="button" className="nav-link" onClick={(e) => { e.stopPropagation(); onHistory?.(); }}>
            History
          </button>
          <span className="pill"><span className="dot"/>On-device</span>
        </div>
      </div>

      <div className="screen-body" style={{
        position: 'relative', zIndex: 2, paddingTop: 28,
        alignItems: 'center', textAlign: 'center', justifyContent: 'center',
      }}>
        <div style={{ flex: 1 }} />
        <h1 className="display big serif" style={{ maxWidth: 320, fontStyle: 'italic' }}>
          Something's rising.<br/>Let's watch it.
        </h1>
        <p className="lede" style={{ marginTop: 14, maxWidth: 300 }}>
          A wave you don't have to fight. Just watch it crest and pass.
        </p>
        <div style={{ flex: 1 }} />

        <div className="tap-hint">Tap anywhere</div>

        <div className="crisis-line" style={{ marginTop: 22 }}>
          In crisis? Call or text 988 · SAMHSA 1-800-662-HELP
        </div>
      </div>
    </div>
  );
}

window.HomeScreen = HomeScreen;

// ─── Intake (carousel of 3 quick taps) ───────────────────────

const MAT_OPTIONS = [
  { v: 'buprenorphine', l: 'Buprenorphine / Suboxone' },
  { v: 'naltrexone',    l: 'Naltrexone (oral)' },
  { v: 'vivitrol',      l: 'Vivitrol (injection)' },
  { v: 'methadone',     l: 'Methadone' },
  { v: 'none',          l: 'Not on MAT' },
];
const DOSE_OPTIONS = [
  { v: 'on_time', l: 'Yes, on time' },
  { v: 'late',    l: 'Yes, but late' },
  { v: 'missed',  l: 'Missed dose' },
];
const DOSE_LATE_OPTIONS = [
  { v: '1-2',  l: '1–2 hours late' },
  { v: '3-5',  l: '3–5 hours late' },
  { v: '6+',   l: '6+ hours late' },
];
const TRIGGER_OPTIONS = [
  { v: 'social',   l: 'Social situation' },
  { v: 'stress',   l: 'Stress · emotions' },
  { v: 'physical', l: 'Physical sensation' },
  { v: 'unknown',  l: "Don't know · other" },
];

function IntakeScreen({ intake, setIntake, onContinue, onBack, tweaks }) {
  const step = intake.step;
  const setStep = (s) => setIntake({ ...intake, step: s });

  const total = intake.mat && intake.mat !== 'none' ? 4 : 3;
  const visibleStep = intake.mat === 'none' && step > 1 ? step - 1 : step;

  function next() {
    if (step === 0) { if (intake.intensity != null) setStep(1); return; }
    if (step === 1) {
      if (!intake.mat) return;
      if (intake.mat === 'none') setStep(3); // skip dose step
      else setStep(2);
      return;
    }
    if (step === 2) {
      if (!intake.dose) return;
      if (intake.dose === 'late' && !intake.doseLate) return;
      setStep(3);
      return;
    }
    if (step === 3) { if (intake.trigger) onContinue(); }
  }

  function back() {
    if (step === 0) onBack();
    else if (step === 3 && intake.mat === 'none') setStep(1);
    else setStep(step - 1);
  }

  return (
    <div className="screen">
      <div className="topbar">
        <button className="back-link" onClick={back}>
          <Icon name="arrow-left" size={16} />
          <span>Back</span>
        </button>
        <span className="crumb">Intake · {Math.min(visibleStep + 1, total)} / {total}</span>
        <span style={{ width: 60 }} />
      </div>

      <div className="screen-body">
        {step === 0 ? <IntakeIntensity intake={intake} setIntake={setIntake} /> : null}
        {step === 1 ? <IntakeMat intake={intake} setIntake={setIntake} /> : null}
        {step === 2 ? <IntakeDose intake={intake} setIntake={setIntake} /> : null}
        {step === 3 ? <IntakeTrigger intake={intake} setIntake={setIntake} /> : null}

        <div className="spacer-grow" />
        <button
          className="btn primary"
          style={{ alignSelf: 'stretch' }}
          onClick={next}
          disabled={
            (step === 0 && intake.intensity == null) ||
            (step === 1 && !intake.mat) ||
            (step === 2 && (!intake.dose || (intake.dose === 'late' && !intake.doseLate))) ||
            (step === 3 && !intake.trigger)
          }
        >
          {step === 3 ? 'Continue to session' : 'Continue'}
          <Icon name="arrow-right" size={18} />
        </button>
      </div>
    </div>
  );
}

// Labels per integer (the doc's "barely there → all-consuming")
const INTENSITY_LABELS = [
  'barely there', 'faint', 'noticing it', 'present',
  'hard to ignore', 'pulling', 'strong', 'loud', 'urgent', 'all-consuming',
];
window.INTENSITY_LABELS = INTENSITY_LABELS;

function IntakeIntensity({ intake, setIntake }) {
  const value = intake.intensity ?? 5;
  const touched = intake.intensity != null;

  // Drag-the-wave: any pointer in the zone sets the score. Y position
  // maps to score (top of zone = 10, bottom = 1). Real-time updates
  // flow into intake.intensity → app's cravingScore → the shared wave
  // canvas amplitude.
  const zoneRef = useRef(null);

  function scoreAt(clientY) {
    const r = zoneRef.current.getBoundingClientRect();
    const t = (clientY - r.top) / r.height;            // 0 at top, 1 at bottom
    const inv = 1 - Math.max(0, Math.min(1, t));        // 0 at bottom, 1 at top
    return Math.max(1, Math.min(10, Math.round(1 + inv * 9)));
  }

  function onPointerDown(e) {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const set = (y) => {
      const s = scoreAt(y);
      if (s !== intake.intensity) setIntake({ ...intake, intensity: s });
    };
    set(e.clientY);
    const onMove = (ev) => set(ev.clientY);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  return (
    <>
      <span className="eyebrow">Question 1 · intensity</span>
      <h1 className="display serif">How strong is it,<br/>right now?</h1>
      <div style={{ marginTop: 8 }}>
        <p className="lede" style={{ margin: 0 }}>Drag the wave up or down.</p>
        <p className="lede" style={{ margin: '4px 0 0', fontStyle: 'italic', color: 'var(--ink-mute)' }}>
          {touched ? 'Let go when it feels right.' : 'Up is stronger. There\'s no wrong answer.'}
        </p>
      </div>

      <div style={{ flex: 1, minHeight: 320, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {/* Pointer-capturing drag zone — full bleed within this column */}
        <div
          ref={zoneRef}
          className="drag-zone"
          role="slider"
          tabIndex={0}
          aria-valuemin={1}
          aria-valuemax={10}
          aria-valuenow={value}
          onPointerDown={onPointerDown}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); setIntake({ ...intake, intensity: Math.min(10, value + 1) }); }
            if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); setIntake({ ...intake, intensity: Math.max(1, value - 1) }); }
          }}
        />

        <div className={`drag-readout ${touched ? 'touched' : ''}`}>
          <span className="num">{touched ? value : '·'}</span>
          {touched ? <span className="denom">/10</span> : null}
          <span className="label">
            {touched ? INTENSITY_LABELS[value - 1] : 'tap and drag the wave'}
          </span>
        </div>
      </div>
    </>
  );
}

function IntakeMat({ intake, setIntake }) {
  return (
    <>
      <span className="eyebrow">Question 2 · MAT</span>
      <h1 className="display">What medication are you on?</h1>
      <p className="lede">This is the thing every other urge-surfing app misses.</p>
      <div style={{ height: 4 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {MAT_OPTIONS.map(o => (
          <button
            key={o.v}
            className="chip list"
            aria-pressed={intake.mat === o.v}
            onClick={() => setIntake({ ...intake, mat: o.v })}
          >{o.l}</button>
        ))}
      </div>
    </>
  );
}

function IntakeDose({ intake, setIntake }) {
  return (
    <>
      <span className="eyebrow">Question 3 · today's dose</span>
      <h1 className="display">Did you take today's dose?</h1>
      <p className="lede">A 7/10 at hour 4 isn't the same as a 7/10 at hour 22.</p>
      <div style={{ height: 4 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {DOSE_OPTIONS.map(o => (
          <button
            key={o.v}
            className="chip list"
            aria-pressed={intake.dose === o.v}
            onClick={() => setIntake({ ...intake, dose: o.v, doseLate: o.v === 'late' ? intake.doseLate : null })}
          >{o.l}</button>
        ))}
      </div>

      {intake.dose === 'late' ? (
        <div style={{ marginTop: 6 }}>
          <span className="eyebrow" style={{ display: 'block', marginBottom: 8 }}>About how late?</span>
          <div className="chip-grid cols-3" style={{ gap: 6 }}>
            {DOSE_LATE_OPTIONS.map(o => (
              <button
                key={o.v}
                className="chip"
                style={{ padding: '12px 4px', fontSize: 13 }}
                aria-pressed={intake.doseLate === o.v}
                onClick={() => setIntake({ ...intake, doseLate: o.v })}
              >{o.l}</button>
            ))}
          </div>
          <p className="hint" style={{ marginTop: 8 }}>
            Best guess — WAVE uses this to set the acknowledgment, not to grade you.
          </p>
        </div>
      ) : null}
    </>
  );
}

function IntakeTrigger({ intake, setIntake }) {
  return (
    <>
      <span className="eyebrow">Last question · trigger</span>
      <h1 className="display">What set this off?</h1>
      <p className="lede">Best guess. You can change your mind later.</p>
      <div style={{ height: 4 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {TRIGGER_OPTIONS.map(o => (
          <button
            key={o.v}
            className="chip list"
            aria-pressed={intake.trigger === o.v}
            onClick={() => setIntake({ ...intake, trigger: o.v })}
          >{o.l}</button>
        ))}
      </div>
    </>
  );
}

window.IntakeScreen = IntakeScreen;

// ─── Safety ──────────────────────────────────────────────────

function SafetyScreen({ onResolved, onExit }) {
  return (
    <div className="screen">
      <div className="topbar"><span className="crumb">Before we start</span></div>
      <div className="screen-body">
        <span className="eyebrow">Safety check</span>
        <h1 className="display">Have you used today?</h1>
        <p className="lede">
          We ask so the session knows what to say next. There's no right answer and no judgment.
        </p>
        <div style={{ height: 4 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button className="chip list" onClick={() => onResolved({ used: false })}>No, not today</button>
          <button className="chip list" onClick={() => onResolved({ used: true })}>Yes, earlier today</button>
          <button className="chip list" onClick={() => onResolved({ used: true })}>Yes, within the last hour</button>
        </div>

        <div className="spacer-grow" />

        <div className="card" style={{ background: 'var(--surface-mute)', border: '1px solid var(--border-soft)' }}>
          <div className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
            <span style={{ marginTop: 2, color: 'var(--accent)' }}><Icon name="shield" /></span>
            <div>
              <div style={{ fontWeight: 500, marginBottom: 4 }}>If you're in crisis</div>
              <p className="hint" style={{ margin: 0 }}>
                Call or text <b>988</b> (Suicide &amp; Crisis Lifeline), or call SAMHSA at <b>1-800-662-HELP</b>. WAVE is a support tool — not a substitute for a counselor or prescriber.
              </p>
              <button className="btn ghost" style={{ padding: 0, marginTop: 8 }} onClick={onExit}>
                Connect me to someone now →
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

window.SafetyScreen = SafetyScreen;
