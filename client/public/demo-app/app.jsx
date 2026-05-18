// app.jsx — WAVE interactive prototype, the state machine + frame.

const { useState: useStateA, useEffect: useEffectA } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "dark",
  "frame": "web",
  "demoSpeed": true,
  "startScreen": "lock",
  "matPreset": "auto"
}/*EDITMODE-END*/;

// 'auto' follows the OS color scheme. Anywhere we need a concrete
// light/dark answer we run the theme through this resolver — never
// compare `tweaks.theme === 'dark'` directly.
function resolveTheme(theme) {
  if (theme === 'dark' || theme === 'light') return theme;
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'dark';
}

// ─── Theme toggle ────────────────────────────────────────────
// Round in-product button that flips light <-> dark. If currently on
// 'auto', resolves the current side first and flips to the explicit
// opposite, so the next click toggles cleanly.
function ThemeToggle({ theme, onChange, dark }) {
  const resolved = resolveTheme(theme);
  const next = resolved === 'dark' ? 'light' : 'dark';
  const isDark = resolved === 'dark';
  return (
    <button
      type="button"
      className="theme-toggle"
      data-dark={dark ? '1' : '0'}
      onClick={() => onChange(next)}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
    >
      {isDark ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}

function applyTheme(tweaks) {
  const root = document.documentElement;
  const resolved = resolveTheme(tweaks.theme || 'dark');
  root.setAttribute('data-theme', resolved);
  root.setAttribute('data-frame', tweaks.frame || 'iphone');
}

// ─── Main app ────────────────────────────────────────────────

function WaveApp() {
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [phase, setPhase] = useStateA(tweaks.startScreen || 'lock');
  const [intake, setIntake] = useStateA({
    step: 0, intensity: null, mat: null, dose: null, doseLate: null, trigger: null,
  });
  const [usedToday, setUsedToday] = useStateA(false);
  const [chunkIdx, setChunkIdx] = useStateA(0);
  const [scores, setScores] = useStateA([]);
  const [plan, setPlan] = useStateA('');

  // Wave atmosphere state — written by chunk player + checkin, read by canvas.
  const [breathDelta, setBreathDelta] = useStateA(0);
  const [listening, setListening] = useStateA(false);

  useEffectA(() => { applyTheme(tweaks); }, [tweaks.theme, tweaks.frame]);

  useEffectA(() => {
    if (tweaks.theme !== 'auto') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme(tweaks);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [tweaks.theme]);

  useEffectA(() => {
    function onSkip(e) { if (e?.detail?.to) setPhase(e.detail.to); }
    window.addEventListener('wave-skip', onSkip);
    return () => window.removeEventListener('wave-skip', onSkip);
  }, []);

  // Clear breath/listening whenever we leave their owning screens.
  useEffectA(() => {
    if (phase !== 'chunk') setBreathDelta(0);
    if (phase !== 'checkin') setListening(false);
  }, [phase]);

  function resetSession() {
    setIntake({ step: 0, intensity: null, mat: null, dose: null, doseLate: null, trigger: null });
    setUsedToday(false);
    setChunkIdx(0);
    setScores([]);
    setPlan('');
    setBreathDelta(0);
    setListening(false);
  }

  // ─── Phase transitions (no between-chunk loaders) ──
  function startSession() { resetSession(); setPhase('intake'); }
  function intakeContinue() { setPhase('safety'); }
  function safetyResolved(o) { setUsedToday(o.used); setPhase('chunk'); }
  function chunkComplete() { setPhase('checkin'); }
  function checkInComplete(r) {
    // Score was already appended at the moment of commit (see
    // onScoreCommit). Here we just advance the state machine.
    if (chunkIdx + 1 >= CHUNKS.length) {
      setPhase('reflection');
    } else {
      setChunkIdx(chunkIdx + 1);
      setPhase('chunk');
    }
  }
  function onScoreCommit(score) {
    // The instant the voice loop parses a score, write it into the
    // session log. The shared wave canvas reads from `currentIntensity`
    // (= last scores[]) so its amplitude smoothly drops in real time.
    setScores((prev) => [...prev, score]);
  }
  function reflectionDone(planChoice) { setPlan(planChoice); setPhase('done'); }

  const intakeIntensity = intake.intensity ?? null;
  const currentIntensity = scores.length ? scores[scores.length - 1] :
                           (intakeIntensity ?? null);

  const isLock = phase === 'lock';
  const resolvedTheme = resolveTheme(tweaks.theme);
  const isDarkFrame = resolvedTheme === 'dark';
  const isWeb = tweaks.frame === 'web';

  // Effective MAT — tweak override or intake answer.
  const effectiveMat = tweaks.matPreset && tweaks.matPreset !== 'auto'
    ? tweaks.matPreset
    : intake.mat;

  // Wave context — read by the persistent <WaveCanvas/> behind every screen.
  const waveCtx = {
    screen: phase,
    cravingScore: currentIntensity,
    intakeIntensity,
    breathDelta,
    listening,
    motion: 1,
    dark: isDarkFrame,
  };

  // Lock surface picks per frame.
  const lockNode = isWeb
    ? <WebLockToast onOpen={() => setPhase('home')} />
    : <LockScreen onOpen={() => setPhase('home')} />;

  const screenNode = phase === 'lock' ? lockNode : (
    phase === 'home' ? (
      <HomeScreen
        onStart={startSession}
        onDashboard={() => setPhase('dashboard')}
        onHistory={() => setPhase('history')}
        tweaks={tweaks}
      />
    ) : phase === 'intake' ? (
      <IntakeScreen
        intake={intake}
        setIntake={setIntake}
        onContinue={intakeContinue}
        onBack={() => setPhase('home')}
        tweaks={tweaks}
      />
    ) : phase === 'safety' ? (
      <SafetyScreen onResolved={safetyResolved} onExit={() => setPhase('home')} />
    ) : phase === 'chunk' ? (
      <ChunkPlayer
        chunkIndex={chunkIdx}
        intensity={currentIntensity ?? 5}
        mat={effectiveMat}
        tweaks={tweaks}
        onBreath={setBreathDelta}
        onComplete={chunkComplete}
      />
    ) : phase === 'checkin' ? (
      <CheckInScreen
        chunkNumber={chunkIdx + 1}
        priorScores={scores}
        intakeIntensity={intakeIntensity ?? 5}
        tweaks={tweaks}
        onListening={setListening}
        onScoreCommit={onScoreCommit}
        onComplete={checkInComplete}
      />
    ) : phase === 'reflection' ? (
      <ReflectionScreen
        scores={scores}
        intakeIntensity={intakeIntensity ?? 5}
        tweaks={tweaks}
        onDone={reflectionDone}
      />
    ) : phase === 'done' ? (
      <DoneScreen
        plan={plan}
        scores={scores}
        intakeIntensity={intakeIntensity ?? 5}
        onDashboard={() => setPhase('dashboard')}
        onHome={() => { resetSession(); setPhase('home'); }}
      />
    ) : phase === 'dashboard' ? (
      <DashboardScreen onBack={() => { resetSession(); setPhase('home'); }} tweaks={tweaks} />
    ) : phase === 'history' ? (
      <HistoryScreen onBack={() => setPhase('home')} />
    ) : null
  );

  const themeCorner = !isLock && (
    <ThemeToggle theme={tweaks.theme} onChange={(v) => setTweak('theme', v)} dark={isDarkFrame} />
  );

  return (
    <WaveContext.Provider value={waveCtx}>
      <div className="app-root">
        <div className="stage">
          {isWeb ? (
            <WebShell dark={isDarkFrame} tweaks={tweaks} cornerSlot={themeCorner}>
              {screenNode}
            </WebShell>
          ) : (
            <IOSDevice width={402} height={874} dark={isDarkFrame} cornerSlot={themeCorner}>
              {screenNode}
            </IOSDevice>
          )}
          <div className="stage-caption">
            WAVE · interactive prototype · {labelFor(phase)}
          </div>
        </div>

        <TweaksPanel title="Tweaks">
          <TweakSection label="Surface">
            <TweakRadio
              label="Frame"
              value={tweaks.frame}
              options={[{ value: 'iphone', label: 'iPhone' }, { value: 'web', label: 'Web' }]}
              onChange={(v) => setTweak('frame', v)}
            />
            <TweakRadio
              label="Theme"
              value={tweaks.theme}
              options={[
                { value: 'dark',  label: 'Dark' },
                { value: 'light', label: 'Light' },
                { value: 'auto',  label: 'Auto' },
              ]}
              onChange={(v) => setTweak('theme', v)}
            />
          </TweakSection>

          <TweakSection label="Demo">
            <TweakToggle
              label="Fast demo speed"
              value={tweaks.demoSpeed}
              onChange={(v) => setTweak('demoSpeed', v)}
            />
            <TweakSelect
              label="MAT preset"
              value={tweaks.matPreset || 'auto'}
              options={[
                { value: 'auto',          label: 'From intake' },
                { value: 'buprenorphine', label: 'Suboxone' },
                { value: 'methadone',     label: 'Methadone' },
                { value: 'naltrexone',    label: 'Naltrexone' },
                { value: 'vivitrol',      label: 'Vivitrol' },
                { value: 'none',          label: 'Not on MAT' },
              ]}
              onChange={(v) => setTweak('matPreset', v)}
            />
            <TweakSelect
              label="Jump to screen"
              value={phase}
              options={[
                { value: 'lock',        label: 'Lock + notification' },
                { value: 'home',        label: 'Home' },
                { value: 'intake',      label: 'Intake' },
                { value: 'safety',      label: 'Safety' },
                { value: 'chunk',       label: 'Chunk player' },
                { value: 'checkin',     label: 'Check-in (voice)' },
                { value: 'reflection',  label: 'Reflection' },
                { value: 'done',        label: 'Done' },
                { value: 'dashboard',   label: 'Dashboard' },
                { value: 'history',     label: 'History' },
              ]}
              onChange={(v) => {
                if (v === 'intake') resetSession();
                if (v === 'chunk' && !scores.length) setChunkIdx(0);
                setPhase(v);
              }}
            />
            <TweakButton
              label="Reset to lock screen"
              secondary
              onClick={() => { resetSession(); setPhase('lock'); }}
            />
          </TweakSection>
        </TweaksPanel>
      </div>
    </WaveContext.Provider>
  );
}

function labelFor(phase) {
  return ({
    lock: 'Lock screen + prophylactic ping',
    home: 'Home',
    intake: 'Intake',
    safety: 'Safety check',
    chunk: 'Chunk player',
    checkin: 'Adaptive check-in (voice)',
    reflection: 'Reflection',
    done: 'Session complete',
    dashboard: 'Dashboard',
    history: 'History',
  })[phase] || phase;
}

ReactDOM.createRoot(document.getElementById('root')).render(<WaveApp />);
