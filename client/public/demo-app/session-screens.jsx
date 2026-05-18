// session-screens.jsx — the chunk player, check-in chat, reflection,
// dashboard, and breath-loader. Continues from screens.jsx.

const { useEffect: useEffect2, useRef: useRef2, useState: useState2, useMemo: useMemo2 } = React;

// ─── Breath loader (between chunks, also "generating") ───────

function BreathLoader({ label = 'Building your next chunk', sublabel = 'Settle in. Slow breath if it helps.' }) {
  return (
    <div className="screen">
      <div className="topbar"><span className="crumb">Loading</span></div>
      <div className="breath">
        <div className="breath-orb" />
        <div className="center-col" style={{ gap: 6 }}>
          <h2 className="section" style={{ fontWeight: 500 }}>{label}</h2>
          <p className="lede" style={{ textAlign: 'center', maxWidth: 240 }}>{sublabel}</p>
        </div>
      </div>
    </div>);

}

window.BreathLoader = BreathLoader;

// ─── MAT-aware acknowledgment copy ───────────────────────────
// Generated on-device from the user's MAT answer. The banner is a
// statement of fact — never a judgment — about how the medication is
// or isn't buffering the craving they're feeling.
const MAT_ACK = {
  buprenorphine: {
    label: 'Suboxone',
    body: "Your Suboxone is in your system right now. What you're feeling at this intensity would be far louder without it. Work with what's left.",
  },
  methadone: {
    label: 'Methadone',
    body: "Your methadone is steady underneath this. What you're feeling isn't withdrawal — it's the urge on top. We can meet just that.",
  },
  naltrexone: {
    label: 'Naltrexone',
    body: "Naltrexone is blocking the reward right now. Whatever this craving is promising, the receptor isn't open. Stay with the wave.",
  },
  vivitrol: {
    label: 'Vivitrol',
    body: "Vivitrol is still active. The reward isn't going to land — that's the chemistry. Let's let the urge crest without chasing it.",
  },
  none: {
    label: 'No medication',
    body: "No medication is buffering this — you're meeting it fully. That's harder, and it counts more.",
  },
};
function matAckFor(mat) { return MAT_ACK[mat] || null; }

// ─── Chunk player ────────────────────────────────────────────
//
// A chunk is a sequence of segments: { type: 'text', content } or
// { type: 'pause', sec } or { type: 'breath', phase, sec }.
// We advance through them; the wave's height & breath phase reflect
// the active segment.

const CHUNKS = [
{
  id: 1,
  badge: 'Chunk 1 of 5 · Settle',
  title: 'Notice it. Don\'t fight it.',
  ack: 'Your Suboxone is working right now. What you\'re feeling at a 7 would be a 9 or 10 without it. Let\'s work with what\'s left.',
  segments: [
  { type: 'text', content: "You're here. That's already the hardest part." },
  { type: 'pause', sec: 3 },
  { type: 'text', content: 'Notice where the craving lives in your body. Don\'t fix it. Just notice.' },
  { type: 'breath', phase: 'inhale', sec: 4 },
  { type: 'breath', phase: 'hold', sec: 2 },
  { type: 'breath', phase: 'exhale', sec: 6 },
  { type: 'text', content: 'Cravings rise. They peak. They fall. Like a wave.' },
  { type: 'pause', sec: 2 }]

},
{
  id: 2,
  badge: 'Chunk 2 of 5 · Ride',
  title: 'It will peak. Then it falls.',
  ack: 'This is the part where most people grit their teeth. Don\'t. Soften, instead.',
  segments: [
  { type: 'text', content: 'Stay with the wave. You don\'t have to make it smaller.' },
  { type: 'breath', phase: 'inhale', sec: 4 },
  { type: 'breath', phase: 'exhale', sec: 6 },
  { type: 'text', content: 'Notice: the craving and you are not the same thing.' },
  { type: 'pause', sec: 2 }]

}];


window.CHUNKS = CHUNKS;

function ChunkPlayer({ chunkIndex, intensity, mat, tweaks, onBreath, onComplete }) {
  const chunk = CHUNKS[chunkIndex] || CHUNKS[CHUNKS.length - 1];
  const [segIdx, setSegIdx] = useState2(0);
  const [bannerVisible, setBannerVisible] = useState2(chunkIndex === 0);
  const [bannerLeaving, setBannerLeaving] = useState2(false);
  const seg = chunk.segments[segIdx];
  const speedMul = tweaks.demoSpeed ? 0.5 : 1;

  // Auto-advance segments
  useEffect2(() => {
    if (!seg) return;
    const sec = seg.sec ?? 4;
    const ms = sec * 1000 * speedMul;
    const t = setTimeout(() => {
      if (segIdx + 1 >= chunk.segments.length) onComplete();
      else setSegIdx(segIdx + 1);
    }, ms);
    return () => clearTimeout(t);
  }, [segIdx, chunk.id]);

  // Push breath delta up to the shared wave canvas so amplitude
  // ripples ±0.08 around the score baseline.
  useEffect2(() => {
    if (!onBreath) return;
    if (!seg || seg.type !== 'breath') { onBreath(0); return; }
    if (seg.phase === 'inhale' || seg.phase === 'hold') onBreath(+1);
    else if (seg.phase === 'exhale') onBreath(-1);
    else onBreath(0);
  }, [segIdx, chunk.id]);

  // MAT banner auto-dismiss (~7s).
  useEffect2(() => {
    if (!bannerVisible) return;
    const t1 = setTimeout(() => setBannerLeaving(true), 7000 * speedMul);
    const t2 = setTimeout(() => setBannerVisible(false), 7600 * speedMul);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  const breathPhase = seg && seg.type === 'breath' ? seg.phase : null;
  const breathSec = seg && seg.type === 'breath' ? seg.sec : 0;

  const total = chunk.segments.length;
  const pct = (segIdx + 1) / total * 100;

  const lastTextSeg = useMemo2(() => {
    for (let i = segIdx; i >= 0; i--) {
      if (chunk.segments[i].type === 'text') return chunk.segments[i];
    }
    return null;
  }, [segIdx, chunk.id]);

  const breathLabel = breathPhase === 'inhale' ? 'Breathe in' :
    breathPhase === 'hold' ? 'Hold' :
    breathPhase === 'exhale' ? 'Breathe out' : null;

  const ack = matAckFor(mat) || matAckFor('buprenorphine');
  const chunkLabel = `Chunk ${chunk.id} of 5 · ${chunk.badge.split('·')[1]?.trim() || 'Settle'}`;

  return (
    <div className="screen">
      {/* Thin glowing progress bar */}
      <div style={{ padding: '8px 22px 0' }}>
        <div className="thin-progress"><span style={{ width: `${pct}%` }} /></div>
      </div>

      <div className="topbar" style={{ justifyContent: 'center' }}>
        <span className="crumb" style={{ letterSpacing: '0.28em' }}>{chunkLabel.toUpperCase()}</span>
      </div>

      <div className="screen-body" style={{ paddingTop: 6 }}>
        {/* Center column — minimal chrome. The shared wave does the rest. */}

        {bannerVisible ? (
          <div className={`mat-banner ${bannerLeaving ? 'dismissing' : ''}`}>
            <div className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
              <span style={{ marginTop: 2, color: 'var(--wave-glow)' }}><Icon name="pill" /></span>
              <div>
                <div className="eyebrow accent" style={{ marginBottom: 6 }}>Medication-aware · {ack.label}</div>
                <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.5, color: 'var(--wave-crest)' }}>{ack.body}</p>
              </div>
            </div>
          </div>
        ) : null}

        <div style={{ flex: 1 }} />

        {/* Centered italic-serif guidance + breath label */}
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {breathLabel ? (
            <div className="serif" style={{
              fontSize: 28, color: 'var(--wave-crest)',
              textShadow: '0 0 24px rgba(92,225,214,0.4)',
              transition: 'opacity 600ms ease',
            }}>
              {breathLabel} <span style={{ fontFamily: 'Geist Mono, monospace', fontStyle: 'normal', fontSize: 13, color: 'var(--ink-faint)', letterSpacing: '0.22em', marginLeft: 8 }}>· {breathSec}s</span>
            </div>
          ) : null}

          <div className="serif" style={{
            fontSize: 22, lineHeight: 1.35, color: 'var(--ink)', maxWidth: 340, margin: '0 auto',
            opacity: lastTextSeg ? 1 : 0.4,
            transition: 'opacity 600ms ease',
            textWrap: 'pretty',
          }}>
            {lastTextSeg ? lastTextSeg.content : '\u00A0'}
          </div>
        </div>

        <div style={{ flex: 1 }} />

        {/* Skip control bottom-right — ends the chunk and advances
            to the check-in. */}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn ghost"
            style={{
              fontFamily: 'Geist Mono, monospace',
              fontSize: 11, letterSpacing: '0.22em',
              textTransform: 'uppercase',
              padding: '6px 10px',
            }}
            onClick={onComplete}
          >
            Skip to check-in →
          </button>
        </div>
      </div>
    </div>
  );
}

window.ChunkPlayer = ChunkPlayer;

// ─── Check-in (voice) ────────────────────────────────────────
//
// Voice-driven, multi-turn check-in. Mirrors the real client's
// VoiceCheckIn (lib/voice/use-check-in-voice-loop.ts):
//
//   tap Start → warming (model spin-up)
//             → speaking (Kokoro TTS opener)
//             → listening (VAD waiting for speech)
//             → recording (VAD detected speech, capturing)
//             → transcribing (Whisper)
//             → thinking   (wllama LLM generating)
//             → speaking   (Kokoro TTS streams reply)
//             → loop until model emits endConversation
//
// The prototype simulates the whole loop with a scripted exchange so
// reviewers can experience the state transitions and visual feedback
// without needing a real mic / GPU. Status copy and timings are tuned
// to feel like the production loop (~500ms transcribe, ~900ms LLM
// time-to-first-token, TTS playback while text streams in).

const VOICE_OPENER =
"How intense is the craving right now? Give me a number from 1 to 10.";

function buildVoiceScript(priorScore) {
  // Mirrors the agent-reply branches in the production prompt, voiced
  // for spoken delivery. The patient's first reply ("about a seven")
  // sets the score; subsequent turns probe and gently close.
  const patientScore = 7;
  const drop = priorScore - patientScore;
  let firstAgentReply;
  if (drop >= 2) {
    firstAgentReply = `Okay — a seven. That's down from ${priorScore}. Notice it without grading it. Where in your body do you feel it most right now?`;
  } else if (drop >= 1) {
    firstAgentReply = `Down a notch from ${priorScore} to a seven. Small wins count. Where in your body is the craving loudest right now?`;
  } else if (drop === 0) {
    firstAgentReply = `Holding at a seven. That's not failure — surfing is staying upright, not making the wave smaller. Where in your body is it loudest?`;
  } else {
    firstAgentReply = `Up from ${priorScore} to a seven. Worth pausing here. Where in your body is it loudest right now?`;
  }
  return [
  { role: "agent", content: VOICE_OPENER },
  { role: "patient", content: "About a seven.", score: patientScore },
  { role: "agent", content: firstAgentReply },
  { role: "patient", content: "Mostly in my chest. Tight, like a held breath." },
  { role: "agent", content: "Got it. The chest is where the wave is breaking right now. We'll take that into the next chunk. Ready to continue?" },
  { role: "patient", content: "Yeah. Let's go." },
  { role: "agent", content: "Okay, surfing on.", end: true }];

}

const STATUS_COPY = {
  idle: "Tap to start",
  warming: "Warming up the voice…",
  speaking: "Wave is speaking",
  listening: "Listening",
  recording: "You're speaking",
  transcribing: "Transcribing…",
  thinking: "Thinking…",
  done: "Done"
};

const INTENSITY_LABELS_FALLBACK = [
  'barely there', 'faint', 'noticing it', 'present',
  'hard to ignore', 'pulling', 'strong', 'loud', 'urgent', 'all-consuming',
];
function intensityLabel(score) {
  const arr = window.INTENSITY_LABELS || INTENSITY_LABELS_FALLBACK;
  return arr[Math.max(0, Math.min(9, score - 1))];
}

function CheckInScreen({ chunkNumber, priorScores, intakeIntensity, tweaks, onListening, onScoreCommit, onComplete }) {
  const [status, setStatus] = useState2('idle');
  const [handsFree, setHandsFree] = useState2(false);
  const [transcript, setTranscript] = useState2([]); // {id, role, content, streaming}
  const [committedScore, setCommittedScore] = useState2(null);
  const [scoreFlash, setScoreFlash] = useState2(false);
  const scrollRef = useRef2(null);
  const timersRef = useRef2([]);
  const mountedRef = useRef2(true);
  const completedRef = useRef2(false);

  const priorScore = priorScores[priorScores.length - 1] ?? intakeIntensity;
  const latestScore = committedScore ?? priorScore;
  const script = useMemo2(() => buildVoiceScript(priorScore), [priorScore]);

  const speed = tweaks.demoSpeed ? 0.55 : 1;
  const ms = (n) => Math.round(n * speed);

  function later(fn, dur) {
    const id = setTimeout(() => { if (mountedRef.current) fn(); }, ms(dur));
    timersRef.current.push(id);
    return id;
  }
  function clearTimers() {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }

  useEffect2(() => () => { mountedRef.current = false; clearTimers(); }, []);

  // Auto-start the check-in on mount — no Start button. The flow
  // begins as soon as the user lands on this screen, matching the
  // doc's "voice-only, no buttons" spec.
  useEffect2(() => {
    setStatus('warming');
    later(() => runStep(0), 700);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push listening state to the shared wave canvas. The canvas adds a
  // high-frequency surface ripple while listening.
  useEffect2(() => {
    if (!onListening) return;
    const live = status === 'listening' || status === 'recording';
    onListening(live);
  }, [status]);

  // Score readout flash on commit + push the new score up so the
  // shared wave canvas drops to the new amplitude immediately.
  useEffect2(() => {
    if (committedScore == null) return;
    setScoreFlash(true);
    onScoreCommit?.(committedScore);
    const t = setTimeout(() => setScoreFlash(false), 900);
    return () => clearTimeout(t);
  }, [committedScore]);

  // Auto-scroll transcript on new content.
  useEffect2(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [transcript]);

  // ─── Scripted loop driver ───────────────────────────────────
  function streamAgentTurn(turn, onDone) {
    setStatus('speaking');
    const id = `t-${Math.random().toString(36).slice(2, 8)}`;
    setTranscript((t) => [...t, { id, role: 'agent', content: '', streaming: true }]);
    const words = turn.content.split(/(\s+)/);
    let i = 0;
    const tick = () => {
      i += 1;
      const shown = words.slice(0, i).join('');
      setTranscript((t) => t.map((x) => x.id === id ? { ...x, content: shown } : x));
      if (i < words.length) {
        later(tick, 110 + Math.random() * 80);
      } else {
        setTranscript((t) => t.map((x) => x.id === id ? { ...x, streaming: false } : x));
        later(() => onDone(), 320);
      }
    };
    later(tick, 180);
  }

  function runUserTurn(turn, onDone) {
    setStatus('listening');
    later(() => {
      setStatus('recording');
      later(() => {
        setStatus('transcribing');
        later(() => {
          const id = `t-${Math.random().toString(36).slice(2, 8)}`;
          setTranscript((t) => [...t, { id, role: 'patient', content: turn.content }]);
          if (turn.score != null) setCommittedScore(turn.score);
          onDone();
        }, 620);
      }, 1700);
    }, 700);
  }

  function runStep(i) {
    if (!mountedRef.current || completedRef.current) return;
    const turn = script[i];
    if (!turn) return;
    if (turn.role === 'agent') {
      streamAgentTurn(turn, () => {
        if (turn.end) {
          completedRef.current = true;
          setStatus('done');
          later(() => onComplete({ score: latestScore, turns: transcript }), 700);
          return;
        }
        later(() => runStep(i + 1), 240);
      });
    } else {
      runUserTurn(turn, () => {
        setStatus('thinking');
        later(() => runStep(i + 1), 950 + Math.random() * 400);
      });
    }
  }

  function toggleHandsFree() {
    if (handsFree) {
      clearTimers();
      setHandsFree(false);
      setStatus('idle');
      return;
    }
    setHandsFree(true);
    setStatus('warming');
    later(() => runStep(0), 700);
  }

  const isLive = handsFree && status !== 'idle' && status !== 'done';

  // Map runtime status → orb state grammar. Orb stays 'listening'
  // through transcribe + thinking so the user reads "still mine" until
  // the agent speaks.
  const orbState = (status === 'speaking') ? 'speaking'
    : (status === 'listening' || status === 'recording' || status === 'transcribing' || status === 'thinking') ? 'listening'
    : 'idle';

  return (
    <div className="screen">
      <div className="topbar">
        <span className="crumb">Check-in {chunkNumber} of 5</span>
      </div>

      <div className="screen-body" style={{ paddingTop: 8, gap: 18 }}>
        {/* Score readout — italic serif, glow-flashes on commit. */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          <span className={`score-readout ${scoreFlash ? 'is-updating' : ''}`}>
            {latestScore}<span className="denom">/10</span>
            <span className="word">{intensityLabel(latestScore)}</span>
          </span>

          {/* Voice orb — 88px ring stack, state-driven */}
          <div className="voice-orb" data-state={orbState}>
            <span className="voice-orb-ring" />
            <span className="voice-orb-ring r2" />
            <span className="voice-orb-core" />
          </div>
          <div className="voice-orb-label">{STATUS_COPY[status] || ''}</div>
        </div>

        <div ref={scrollRef} className="voice-transcript">
          {transcript.length === 0 ?
            <p className="voice-empty">
              On-device · Whisper transcribes you, Kokoro replies in voice. Nothing leaves the phone.
            </p> :
            <div className="chat-scroll">
              {transcript.map((t) =>
                <div key={t.id} className={`bubble ${t.role}`}>
                  {t.content === '' ?
                    <span className="dot-typing"><span /><span /><span /></span> :
                    t.content}
                </div>
              )}
            </div>
          }
        </div>

        {/* Skip — advances to the next chunk (or reflection if this
            was the final check-in). Uses the latest committed score
            so the wave amplitude continues correctly into the next
            chunk; falls back to the prior score if nothing committed. */}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn ghost"
            style={{
              fontFamily: 'Geist Mono, monospace',
              fontSize: 11, letterSpacing: '0.22em',
              textTransform: 'uppercase',
              padding: '6px 10px',
            }}
            onClick={() => {
              clearTimers();
              completedRef.current = true;
              onComplete({ score: latestScore, turns: transcript });
            }}
          >
            Skip →
          </button>
        </div>
      </div>
    </div>);

}

// ─── Voice card: live waveform bars + status label ──────────
//
// One <canvas-free> visualizer driven entirely by rAF. The animation
// pattern is keyed off `status`, not real audio — it conveys "the
// system is doing X" rather than literal mic amplitude. Bars taper
// toward the edges via a center-weighted envelope so it reads as a
// voiceprint rather than a row of indicator LEDs.
function VoiceCard({ status, live }) {
  const ref = useRef2(null);
  useEffect2(() => {
    const el = ref.current;
    if (!el) return;
    const bars = Array.from(el.querySelectorAll('.vbar'));
    const N = bars.length;
    const start = performance.now();
    let raf;
    // Per-bar internal phase so neighbors don't move in lockstep.
    const seed = bars.map((_, i) => i * 0.61 + Math.sin(i * 1.7) * 0.4);
    const tick = (now) => {
      const t = (now - start) / 1000;
      for (let i = 0; i < N; i++) {
        const c = (N - 1) / 2;
        const d = Math.abs(i - c) / c; // 0 at center → 1 at edges
        const env = Math.pow(1 - d, 0.55); // edge taper
        const phase = seed[i];
        let h;
        switch (status) {
          case 'recording':{
              // Tall, irregular peaks — modelled as two sines beating
              // against each other, edges fall off naturally.
              const a = Math.sin(t * 3.4 + phase * 1.1);
              const b = Math.cos(t * 1.7 - phase * 0.7);
              h = 0.18 + 0.78 * env * Math.abs(a * 0.7 + b * 0.4);
              break;
            }
          case 'speaking':{
              // Smoother, more periodic — voice-like cadence.
              const a = Math.sin(t * 2.3 + phase);
              const b = Math.sin(t * 0.9 + phase * 0.5);
              h = 0.16 + 0.58 * env * Math.abs(a * 0.7 + b * 0.35);
              break;
            }
          case 'listening':{
              // Quiet, slow breath — barely moving, like a hot mic.
              h = 0.10 + 0.06 * env * (1 + Math.sin(t * 1.8 + phase));
              break;
            }
          case 'thinking':{
              // Travelling shimmer — wave moves through the bars.
              h = 0.12 + 0.18 * env * (0.5 + 0.5 * Math.sin(t * 2.2 - i * 0.55));
              break;
            }
          case 'transcribing':{
              // Faster shimmer, smaller amplitude.
              h = 0.10 + 0.14 * env * (0.5 + 0.5 * Math.sin(t * 3.4 - i * 0.7));
              break;
            }
          case 'warming':{
              h = 0.10 + 0.05 * env;
              break;
            }
          case 'done':{
              // Settle to flat as the loop closes.
              h = 0.07 * env + 0.04;
              break;
            }
          default:{// idle
              h = 0.06 * env + 0.03;
            }
        }
        bars[i].style.height = `${Math.max(8, Math.min(100, h * 100))}%`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [status]);

  return (
    <div className={`voice-card ${status} ${live ? 'live' : ''}`}>
      <div ref={ref} className="voice-viz" aria-hidden>
        {Array.from({ length: 17 }).map((_, i) =>
        <span key={i} className="vbar" />
        )}
      </div>
      <div className="voice-status">
        <span className={`voice-dot ${status}`} />
        <span>{STATUS_COPY[status] || ''}</span>
      </div>
    </div>);

}

// ─── Mic button (Start / Stop) ──────────────────────────────
function MicButton({ handsFree, status, onToggle }) {
  const isLive = handsFree && status !== 'idle' && status !== 'done';
  const label = handsFree ? 'Stop check-in' : 'Start check-in';
  const disabled = false;
  return (
    <div className="mic-wrap">
      <button
        type="button"
        className={`mic-btn ${handsFree ? 'on' : 'off'} ${status}`}
        onClick={onToggle}
        disabled={disabled}
        aria-pressed={handsFree}
        aria-label={label}>
        
        <span className="mic-rings" aria-hidden>
          <span /><span /><span />
        </span>
        <span className="mic-glyph" aria-hidden>
          {handsFree ? <StopGlyph /> : <MicGlyph />}
        </span>
      </button>
      <div className="mic-label">{label}</div>
      {isLive ?
      <div className="mic-hint">Speak naturally — pauses are fine. Tap to end.</div> :

      <div className="mic-hint subtle">Whisper · wllama · Kokoro · all on-device</div>
      }
    </div>);

}

function MicGlyph() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="3" width="6" height="12" rx="3" fill="currentColor" stroke="none" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
      <path d="M9 21h6" />
    </svg>);

}

function StopGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24"
    fill="currentColor" stroke="none">
      <rect x="6" y="6" width="12" height="12" rx="2.5" />
    </svg>);

}

window.CheckInScreen = CheckInScreen;

// ─── Reflection ──────────────────────────────────────────────

function ReflectionScreen({ scores, intakeIntensity, tweaks, onDone }) {
  const [stage, setStage] = useState2('thinking'); // thinking → ready → planning → suggestions
  const [plan, setPlan] = useState2('');
  const titles = [
  'Re-reading your check-ins',
  'Comparing to your last session',
  'Looking for what worked',
  'Writing your reflection'];

  const [titleIdx, setTitleIdx] = useState2(0);

  useEffect2(() => {
    if (stage !== 'thinking') return;
    if (titleIdx >= titles.length) {setStage('ready');return;}
    const t = setTimeout(() => setTitleIdx(titleIdx + 1), 750);
    return () => clearTimeout(t);
  }, [titleIdx, stage]);

  const finalScore = scores[scores.length - 1] ?? intakeIntensity;
  const drop = intakeIntensity - finalScore;

  return (
    <div className="screen">
      <div className="topbar"><span className="crumb">Closing · reflection</span></div>
      <div className="screen-body">
        <ScoreArc scores={[intakeIntensity, ...scores]} accent="var(--accent)" />

        {stage === 'thinking' ?
        <div className="card flush">
            <span className="eyebrow accent">Writing reflection</span>
            <ul className="thinking-list" style={{ marginTop: 8 }}>
              {titles.map((t, i) =>
            <li key={i} className={i < titleIdx ? 'done' : i === titleIdx ? 'active' : ''}>
                  <span className="marker" />
                  <span>{t}</span>
                </li>
            )}
            </ul>
          </div> :
        null}

        {stage === 'ready' || stage === 'planning' ?
        <div className="card flush">
            <span className="eyebrow accent">Reflection</span>
            <h2 className="section" style={{ marginTop: 6, fontFamily: "Geist" }}>
              {drop >= 2 ? `Your craving fell ${drop} points across five chunks.` :
            drop >= 1 ? `Your craving dropped ${drop} point — and you stayed.` :
            'You stayed for the whole wave. That counts.'}
            </h2>
            <p className="lede" style={{ marginTop: 8 }}>
              On Suboxone days like today, sessions like this typically drop another <b>1.4 points</b> in the next 20 minutes. The wave is still falling.
            </p>
            <p className="hint" style={{ marginTop: 10, fontStyle: 'italic' }}>
              When you noticed it in your chest, you stopped fighting it — that's when it started moving.
            </p>
          </div> :
        null}

        {stage === 'ready' ?
        <div className="card flush">
            <span className="eyebrow">Next 10 minutes · your plan</span>
            <textarea
            className="plan-area"
            style={{ marginTop: 10 }}
            placeholder="Drink water · step outside · text someone safe…"
            value={plan}
            onChange={(e) => setPlan(e.target.value)} />
          
            <div className="btn-row" style={{ marginTop: 10, justifyContent: 'flex-end' }}>
              <button className="btn ghost" onClick={() => setStage('suggestions')}>No ideas — show options</button>
              <button className="btn primary" onClick={() => onDone(plan.trim())} disabled={plan.trim().length < 2}>
                Use my plan
              </button>
            </div>
          </div> :
        null}

        {stage === 'suggestions' ?
        <div className="card flush">
            <span className="eyebrow">Pick one. Or write your own.</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
              {[
            'Glass of water + step outside for two minutes',
            'Text the person you trust most: "today is a hard one"',
            'Eat something small — a piece of fruit or toast',
            'Lie down for 10 minutes with a podcast you trust'].
            map((s, i) =>
            <button key={i} className="chip list" onClick={() => onDone(s)}>{s}</button>
            )}
            </div>
            <button className="btn ghost" style={{ marginTop: 8, padding: 0 }} onClick={() => setStage('ready')}>← Back to my plan</button>
          </div> :
        null}
      </div>
    </div>);

}

function ScoreArc({ scores, accent }) {
  // Render a 10-point baseline with the scores connected.
  const W = 320,H = 120,PADX = 14,PADY = 16;
  const n = scores.length;
  const x = (i) => PADX + i / Math.max(1, n - 1) * (W - PADX * 2);
  const y = (s) => H - PADY - (s - 1) / 9 * (H - PADY * 2);
  const points = scores.map((s, i) => `${x(i).toFixed(1)},${y(s).toFixed(1)}`).join(' ');
  const dPath = scores.map((s, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(s).toFixed(1)}`).join(' ');
  const areaPath = `${dPath} L ${x(n - 1).toFixed(1)} ${H - PADY} L ${x(0).toFixed(1)} ${H - PADY} Z`;
  return (
    <div className="arc-card">
      <div className="row between" style={{ marginBottom: 8 }}>
        <span className="eyebrow">Craving · this session</span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--fg-faint)', letterSpacing: '0.06em' }}>
          {scores[0]} → {scores[n - 1]}
        </span>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block' }}>
        <defs>
          <linearGradient id="arcgrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={accent} stopOpacity="0.35" />
            <stop offset="1" stopColor={accent} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* gridlines */}
        {[1, 5, 10].map((v) =>
        <line key={v} x1={PADX} x2={W - PADX} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeDasharray="2 4" />
        )}
        <path d={areaPath} fill="url(#arcgrad)" />
        <path d={dPath} fill="none" stroke={accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {scores.map((s, i) =>
        <g key={i}>
            <circle cx={x(i)} cy={y(s)} r="4" fill="var(--surface)" stroke={accent} strokeWidth="2" />
            <text x={x(i)} y={y(s) - 10} textAnchor="middle" fontFamily="Geist Mono, monospace" fontSize="10" fill="var(--fg-faint)">{s}</text>
          </g>
        )}
      </svg>
      <div className="arc-axis"><span>Intake</span><span>Chunk 1</span><span>2</span><span>3</span><span>4</span><span>End</span></div>
    </div>);

}

window.ReflectionScreen = ReflectionScreen;

// ─── Done / dashboard handoff ────────────────────────────────

function DoneScreen({ plan, scores, intakeIntensity, onDashboard, onHome }) {
  // The wave is at its lowest. Calm horizon only. Copy adapts to the
  // actual drop direction — never moralizes when the score held or
  // rose. Per the doc: "Never reference outcomes."
  const finalScore = scores && scores.length ? scores[scores.length - 1] : intakeIntensity;
  const drop = (intakeIntensity ?? 0) - (finalScore ?? 0);
  const eyebrow = drop >= 2 ? 'The wave passed'
    : drop >= 1 ? 'The wave eased'
    : drop === 0 ? 'You watched the wave'
    : 'The wave is still here';
  const headline = drop >= 2 ? 'You stayed with it.'
    : drop >= 1 ? 'You stayed with it.'
    : drop === 0 ? 'You stayed for the whole wave.'
    : 'You met it.';

  // Demo duration — in the real product this is computed from session
  // start. Keeping it static here so it always reads sensibly.
  const duration = '12:40';
  const arc = scores && scores.length
    ? `${intakeIntensity} → ${finalScore}`
    : `${intakeIntensity ?? '—'}`;

  return (
    <div className="screen">
      <div className="topbar"><span className="crumb" style={{ letterSpacing: '0.28em' }}>{eyebrow.toUpperCase()}</span></div>
      <div className="screen-body" style={{ alignItems: 'center', textAlign: 'center', justifyContent: 'center', gap: 24 }}>
        <div style={{ flex: 1 }} />

        <h1 className="display big serif" style={{ maxWidth: 320 }}>{headline}</h1>

        <div style={{ display: 'flex', gap: 32, justifyContent: 'center', marginTop: 8 }}>
          <div style={{ textAlign: 'center' }}>
            <div className="eyebrow">Duration</div>
            <div className="serif" style={{ fontSize: 40, color: 'var(--wave-crest)', marginTop: 4, lineHeight: 1, textShadow: '0 0 16px rgba(92,225,214,0.4)' }}>
              {duration}
            </div>
          </div>
          <div style={{ width: 1, background: 'var(--ink-ghost)' }} />
          <div style={{ textAlign: 'center' }}>
            <div className="eyebrow">Intensity</div>
            <div className="serif" style={{ fontSize: 40, color: 'var(--wave-crest)', marginTop: 4, lineHeight: 1, textShadow: '0 0 16px rgba(92,225,214,0.4)' }}>
              {arc}
            </div>
          </div>
        </div>

        {plan ? (
          <p className="lede" style={{ maxWidth: 300, marginTop: 4 }}>
            Heading to: <b style={{ color: 'var(--ink)', fontStyle: 'italic' }}>{plan}</b>
          </p>
        ) : (
          <p className="lede" style={{ marginTop: 4, fontStyle: 'italic' }}>Want to note what you saw?</p>
        )}

        <div style={{ flex: 1 }} />

        <div className="btn-stack" style={{ alignSelf: 'stretch' }}>
          <button className="btn primary" onClick={onDashboard}>See your dashboard <Icon name="arrow-right" size={16} /></button>
          <button className="btn ghost" onClick={onHome}>Done</button>
        </div>
      </div>
    </div>);
}

window.DoneScreen = DoneScreen;

// ─── Dashboard ───────────────────────────────────────────────
//
// A simple Tue/Wed/.../Mon week timeline showing the drop on
// medication vs missed-dose days.

const WEEK = [
{ d: 'Tue', start: 8, end: 4, med: 'on' },
{ d: 'Wed', start: 6, end: 2, med: 'on' },
{ d: 'Thu', start: 9, end: 8, med: 'miss' },
{ d: 'Fri', start: 7, end: 4, med: 'on' },
{ d: 'Sat', start: 8, end: 3, med: 'on' },
{ d: 'Sun', start: 6, end: 5, med: 'late' },
{ d: 'Mon', start: 7, end: 3, med: 'on' }];


function DashboardScreen({ onBack, tweaks }) {
  const onMed = WEEK.filter((w) => w.med === 'on');
  const offMed = WEEK.filter((w) => w.med !== 'on');
  const avgDropOn = avg(onMed.map((w) => w.start - w.end));
  const avgDropOff = avg(offMed.map((w) => w.start - w.end));

  return (
    <div className="screen">
      <div className="topbar">
        <button className="back-link" onClick={onBack}><Icon name="arrow-left" size={16} /><span>Home</span></button>
        <span className="crumb">Dashboard</span>
        <span style={{ width: 60 }} />
      </div>
      <div className="screen-body">
        <span className="eyebrow accent">Your last 7 sessions</span>
        <h1 className="display">Adherence becomes something you can see.</h1>

        <div className="stat-row">
          <div className="stat">
            <div className="num">{avgDropOn.toFixed(1)}<span className="unit">pts</span></div>
            <div className="label">Avg drop · on med</div>
          </div>
          <div className="stat">
            <div className="num">{avgDropOff.toFixed(1)}<span className="unit">pts</span></div>
            <div className="label">Avg drop · missed</div>
          </div>
        </div>

        <div className="card flush">
          <div className="row between" style={{ marginBottom: 12 }}>
            <span className="eyebrow">Cravings · start → end</span>
            <span className="mono" style={{ fontSize: 10, color: 'var(--fg-faint)' }}>1-10 scale</span>
          </div>
          <WeekChart week={WEEK} />
          <div className="row" style={{ marginTop: 12, justifyContent: 'center', gap: 16, fontSize: 11, color: 'var(--fg-faint)' }}>
            <span className="row" style={{ gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--accent)' }} /> On time</span>
            <span className="row" style={{ gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--warn)' }} /> Late</span>
            <span className="row" style={{ gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--danger)' }} /> Missed</span>
          </div>
        </div>

        <div className="card flush" style={{ borderColor: 'color-mix(in oklab, var(--accent) 30%, transparent)' }}>
          <span className="eyebrow accent">Pattern WAVE noticed</span>
          <p style={{ margin: '8px 0 0', fontSize: 15, lineHeight: 1.45 }}>
            Your craving windows cluster between <b>6:30–7:15pm</b>. We'll start pinging you 15 minutes before — Thursday excluded, you said you're at group then.
          </p>
        </div>
      </div>
    </div>);

}

function WeekChart({ week }) {
  const W = 320,H = 140,PADX = 10,PADY = 14;
  const colW = (W - PADX * 2) / week.length;
  const y = (s) => H - PADY - (s - 1) / 9 * (H - PADY * 2);
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H + 18}`} preserveAspectRatio="none" style={{ display: 'block' }}>
      <defs>
        <linearGradient id="drop" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0.7" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0.15" />
        </linearGradient>
      </defs>
      {[1, 5, 10].map((v) =>
      <line key={v} x1={PADX} x2={W - PADX} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeDasharray="2 4" />
      )}
      {week.map((w, i) => {
        const cx = PADX + colW * (i + 0.5);
        const color = w.med === 'on' ? 'var(--accent)' : w.med === 'late' ? 'var(--warn)' : 'var(--danger)';
        return (
          <g key={i}>
            <line x1={cx} x2={cx} y1={y(w.start)} y2={y(w.end)} stroke="url(#drop)" strokeWidth="6" strokeLinecap="round" />
            <circle cx={cx} cy={y(w.start)} r="4" fill="var(--surface)" stroke={color} strokeWidth="2" />
            <circle cx={cx} cy={y(w.end)} r="5" fill={color} />
            <text x={cx} y={H + 14} textAnchor="middle" fontFamily="Geist Mono, monospace" fontSize="10" fill="var(--fg-faint)">{w.d}</text>
          </g>);

      })}
    </svg>);

}

function avg(xs) {return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;}

window.DashboardScreen = DashboardScreen;

// ─── History ────────────────────────────────────────────────
//
// Past sessions list. Each row reads as a tiny score-arc + the MAT
// state for that session. Mock data here mirrors what the on-device
// session log would surface in the real app — last ~10 sessions,
// most recent first. Tapping a row would open the full session
// reflection (not wired in the prototype).

const SESSION_HISTORY = [
  { date: 'Today',         time: '6:48pm', start: 8, end: 3, mat: 'on',   plan: 'Glass of water + step outside', dur: '12:40' },
  { date: 'Yesterday',     time: '7:02pm', start: 7, end: 4, mat: 'on',   plan: 'Texted Maria',                  dur: '11:05' },
  { date: 'Sun, May 10',   time: '7:14pm', start: 6, end: 5, mat: 'late', plan: 'Sat outside, watched the wave', dur: '09:22' },
  { date: 'Sat, May 9',    time: '6:32pm', start: 8, end: 3, mat: 'on',   plan: 'Glass of water + apple',         dur: '14:18' },
  { date: 'Fri, May 8',    time: '5:55pm', start: 7, end: 4, mat: 'on',   plan: 'Step outside · two minutes',     dur: '10:47' },
  { date: 'Thu, May 7',    time: '6:48pm', start: 9, end: 8, mat: 'miss', plan: '— no plan saved —',              dur: '08:30' },
  { date: 'Wed, May 6',    time: '6:18pm', start: 6, end: 2, mat: 'on',   plan: 'Lay down with podcast',          dur: '15:02' },
  { date: 'Tue, May 5',    time: '7:24pm', start: 8, end: 4, mat: 'on',   plan: 'Glass of water + step outside', dur: '12:50' },
];

function HistoryScreen({ onBack, onOpenSession }) {
  return (
    <div className="screen">
      <div className="topbar">
        <button className="back-link" onClick={onBack}>
          <Icon name="arrow-left" size={16} /><span>Home</span>
        </button>
        <span className="crumb" style={{ letterSpacing: '0.28em' }}>HISTORY</span>
        <span style={{ width: 60 }} />
      </div>

      <div className="screen-body">
        <span className="eyebrow accent">Local · on-device</span>
        <h1 className="display serif">Every wave you watched.</h1>
        <p className="lede">
          Eight sessions in the last ten days. The wave has fallen in seven of them.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
          {SESSION_HISTORY.map((s, i) => (
            <HistoryRow key={i} s={s} onOpen={() => onOpenSession?.(s)} />
          ))}
        </div>
      </div>
    </div>
  );
}

// One session row. The mini-arc draws an ease-out drop from `start`
// to `end` so the user reads "watch how it fell" at a glance.
function HistoryRow({ s, onOpen }) {
  const W = 92, H = 32, PAD = 4;
  // Six points: start + four imagined + end, with ease-out drop.
  const pts = [];
  const N = 6;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    // ease-out cubic → faster fall early, settles late
    const e = 1 - Math.pow(1 - t, 3);
    const score = s.start + (s.end - s.start) * e;
    const x = PAD + (i / (N - 1)) * (W - PAD * 2);
    const y = H - PAD - ((score - 1) / 9) * (H - PAD * 2);
    pts.push([x, y]);
  }
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const drop = s.start - s.end;
  const matLabel = s.mat === 'on' ? 'On med' : s.mat === 'late' ? 'Late' : 'Missed';
  const matColor = s.mat === 'on' ? 'var(--wave-glow)' : s.mat === 'late' ? 'var(--warm)' : 'var(--danger)';
  return (
    <button
      type="button"
      className="card flush"
      onClick={onOpen}
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto auto',
        gap: 14,
        alignItems: 'center',
        textAlign: 'left',
        cursor: 'pointer',
        background: 'color-mix(in oklab, var(--bg-mid) 60%, transparent)',
        padding: '14px 16px',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 92 }}>
        <span style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 500 }}>{s.date}</span>
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-mute)', letterSpacing: '0.12em', marginTop: 2 }}>
          {s.time}
        </span>
      </div>

      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
        <path d={path} fill="none" stroke="var(--wave-glow)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={pts[0][0]}      cy={pts[0][1]}      r="2.4" fill="var(--surface)" stroke="var(--wave-glow)" strokeWidth="1.4" />
        <circle cx={pts[N-1][0]}    cy={pts[N-1][1]}    r="3"   fill="var(--wave-crest)" />
      </svg>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', minWidth: 64 }}>
        <span className="serif" style={{ fontSize: 18, color: 'var(--wave-crest)', lineHeight: 1 }}>
          {s.start} → {s.end}
        </span>
        <span className="mono" style={{ fontSize: 10, color: 'var(--ink-faint)', letterSpacing: '0.14em', marginTop: 3 }}>
          {drop > 0 ? `−${drop} PTS` : drop < 0 ? `+${-drop} PTS` : 'HELD'}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, minWidth: 56 }}>
        <span style={{
          fontFamily: 'Geist Mono, monospace', fontSize: 9.5, letterSpacing: '0.18em',
          textTransform: 'uppercase', color: matColor,
          padding: '3px 8px',
          border: `1px solid color-mix(in oklab, ${matColor} 35%, transparent)`,
          borderRadius: 999,
          background: `color-mix(in oklab, ${matColor} 10%, transparent)`,
        }}>{matLabel}</span>
        <span className="mono" style={{ fontSize: 10, color: 'var(--ink-faint)', letterSpacing: '0.1em' }}>
          {s.dur}
        </span>
      </div>
    </button>
  );
}

window.HistoryScreen = HistoryScreen;