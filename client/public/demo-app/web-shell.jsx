// web-shell.jsx — desktop / web frame for the WAVE prototype.
//
// Mirrors the IOSDevice wrapper, but renders:
//   • A faux browser window (Chrome-style chrome at top)
//   • A full-bleed soft wave canvas behind the content
//   • A centered content column (max-width ~720px) that floats above
//
// All existing screen components render inside as-is. A
// `data-frame="web"` attribute on <html> triggers CSS overrides in
// styles.css that relax paddings, scale up type, and adapt the topbar
// rail for desktop reading.

const { useEffect: useEffectWS, useState: useStateWS } = React;

function WebShell({ children, dark = false, tweaks, cornerSlot = null }) {
  // Fixed 1280×800 laptop-browser-window canvas. We scale the whole
  // shell down to fit narrow viewports so the proportions stay stable
  // — same dimensions on a 14" laptop and a 32" monitor.
  const wrapRef = useEffectWS.length === 0 ? null : null; // (just to satisfy linter)
  const containerRef = React.useRef(null);
  const [scale, setScale] = useStateWS(1);

  useEffectWS(() => {
    function fit() {
      const el = containerRef.current;
      if (!el) return;
      const avail = el.getBoundingClientRect();
      // Available space, minus a caption row underneath (~60px).
      const w = avail.width;
      const h = window.innerHeight - 80;
      const s = Math.min(1, w / 1280, h / 800);
      setScale(s > 0 ? s : 1);
    }
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  return (
    <div ref={containerRef} className="web-shell-fit-wrap" style={{
      width: '100%',
      height: 800 * scale,
      display: 'flex',
      justifyContent: 'center',
    }}>
      <div
        className={`web-shell${dark ? ' is-dark' : ''}`}
        style={{ transform: `scale(${scale})`, transformOrigin: 'top center' }}
      >
        <WebBrowserChrome url="wave.app" title="WAVE" />
        <div className="web-viewport">
          {/* Shared wave canvas — full bleed behind every screen */}
          <WaveCanvas />

          {/* Content column floats above the wave. */}
          <div className="web-content" style={{ position: 'relative', zIndex: 2 }}>
            {children}
          </div>

          {cornerSlot && (
            <div style={{
              position: 'absolute', top: 16, right: 20, zIndex: 5,
            }}>
              {cornerSlot}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Browser chrome — simplified Chrome window, no shadows on the
//     parent (the shell does its own framing). ───────────────────

function WebBrowserChrome({ url = 'wave.app', title = 'WAVE' }) {
  return (
    <div className="web-chrome">
      <div className="web-chrome-bar">
        <div className="web-chrome-traffic">
          <span style={{ background: '#ff5f57' }} />
          <span style={{ background: '#febc2e' }} />
          <span style={{ background: '#28c840' }} />
        </div>

        <div className="web-chrome-tabs">
          <div className="web-chrome-tab active">
            <span className="web-chrome-favicon">
              <svg width="11" height="6" viewBox="0 0 28 16">
                <path d="M1 11 C 4 11 6 4 10 4 C 14 4 16 11 20 11 C 24 11 25 7 27 7"
                  fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </span>
            <span className="web-chrome-tab-title">{title}</span>
            <span className="web-chrome-tab-x">×</span>
          </div>
          <div className="web-chrome-new-tab">+</div>
        </div>
      </div>

      <div className="web-chrome-toolbar">
        <div className="web-chrome-nav">
          <ChromeBtn d="M15 6l-6 6 6 6" />
          <ChromeBtn d="M9 6l6 6-6 6" />
          <ChromeBtn d="M4 12a8 8 0 1 0 2.34-5.66M4 4v4h4" />
        </div>
        <div className="web-chrome-url">
          <span className="web-chrome-lock">
            <svg width="11" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </span>
          <span className="web-chrome-url-text">https://{url}</span>
        </div>
        <div className="web-chrome-nav">
          <ChromeBtn d="M12 5v14M5 12h14" />
          <ChromeBtn d="M5 6h14M5 12h14M5 18h14" />
        </div>
      </div>
    </div>
  );
}

function ChromeBtn({ d }) {
  return (
    <button className="web-chrome-btn" type="button">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={d} />
      </svg>
    </button>
  );
}

window.WebShell = WebShell;

// ─── Web lock-screen replacement: a browser notification toast ──
//
// On phones the "lock screen" is the OS surface a user sees first.
// There's no analogue on web, so we mock a quiet desktop landing
// page (greeting, time) with a browser-style notification toast
// sliding in from the upper-right. Clicking the toast opens the app.

function WebLockToast({ onOpen }) {
  const [now, setNow] = useStateWS(() => formatNow());
  useEffectWS(() => {
    const t = setInterval(() => setNow(formatNow()), 30 * 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="web-lock">
      <div className="web-lock-stage">
        <div className="web-lock-time">{now.time}</div>
        <div className="web-lock-date">{now.date}</div>

        <p className="web-lock-quiet">
          You don't need to click anything until you do.
        </p>
      </div>

      <button className="web-lock-toast" type="button" onClick={onOpen}>
        <div className="web-lock-toast-icon">
          <AppIcon size={36} radius={10} />
        </div>
        <div className="web-lock-toast-body">
          <div className="web-lock-toast-head">
            <span className="web-lock-toast-app">WAVE</span>
            <span className="web-lock-toast-dot">·</span>
            <span className="web-lock-toast-source">wave.app</span>
            <span className="web-lock-toast-ts">now</span>
          </div>
          <div className="web-lock-toast-title">Your typical 7pm window is 15 minutes out.</div>
          <div className="web-lock-toast-body-text">
            Open WAVE while you still have agency.
          </div>
          <div className="web-lock-toast-actions">
            <span className="web-lock-toast-btn primary">Open</span>
            <span className="web-lock-toast-btn">Snooze 10 min</span>
          </div>
        </div>
        <span className="web-lock-toast-x" aria-hidden>×</span>
      </button>
    </div>
  );
}

function formatNow() {
  const d = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const date = d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  return { time, date };
}

window.WebLockToast = WebLockToast;
