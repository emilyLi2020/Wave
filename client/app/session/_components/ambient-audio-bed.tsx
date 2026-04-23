"use client";

/**
 * Continuous ambient audio bed for the urge surfing session.
 *
 * Synthesized client-side via Web Audio API (PRD § Session Runtime
 * Requirements rule 6, AGENTS.md > Tech Stack > "session path makes
 * zero LLM network requests"). The audio is:
 *
 *   - A 4-second pink-noise AudioBuffer looped indefinitely as the
 *     ocean texture. Pink noise (1/f spectrum) sounds more like
 *     surf / wind than white noise and avoids the harsh top-end
 *     hiss of an unfiltered noise source.
 *   - A slow LFO (~0.06 Hz, ~16-second period) oscillator routed
 *     into a GainNode that modulates the noise amplitude in a slow
 *     in-out swell, mimicking the rise and fall of waves.
 *   - A master gain at ~0.2 so the bed is present but never the
 *     loudest thing in the room.
 *
 * Lifecycle
 *
 *   - The component is mounted ONCE at the session-shell level and
 *     stays mounted across every chunk → check-in → chunk transition.
 *     Audio continuity is the key guarantee here (PRD Risk Area #6).
 *   - The graph is built lazily on the first call to `start()` so we
 *     respect the browser's autoplay policy. The session machine
 *     calls `start()` from a click handler (the Begin Session button)
 *     and from then on the bed plays uninterrupted until `fade()`
 *     is called, which the reflection screen does to wind down.
 *
 * Controls
 *
 *   The bed exposes an imperative handle (`AmbientAudioBedHandle`):
 *     - `start()`: build the graph if needed and ramp gain to target.
 *     - `fade(seconds)`: linear-ramp gain to zero over `seconds`,
 *                        suspend the AudioContext on completion.
 *     - `setMuted(muted)`: instant mute toggle for the UI button.
 *
 * Privacy
 *
 *   No audio leaves the device. There is no microphone capture, no
 *   uploads, no remote audio asset — every sample is generated on
 *   the user's machine.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

export interface AmbientAudioBedHandle {
  /** Lazy-build the graph and ramp the master gain to its target. */
  start: () => Promise<void>;
  /** Linear-ramp master gain to zero over `seconds`, then suspend. */
  fade: (seconds: number) => Promise<void>;
  /** Instant mute / unmute (preserves the underlying graph). */
  setMuted: (muted: boolean) => void;
}

const TARGET_GAIN = 0.2;
const NOISE_BUFFER_SECONDS = 4;
const LFO_FREQUENCY_HZ = 0.06;
const LFO_DEPTH = 0.55;
const FADE_IN_SECONDS = 1.2;

interface Props {
  /** Hidden in some surfaces (e.g. intake) where the toggle would distract. */
  showMuteButton?: boolean;
}

export const AmbientAudioBed = forwardRef<AmbientAudioBedHandle, Props>(
  function AmbientAudioBed({ showMuteButton = true }, ref) {
    const audioContextRef = useRef<AudioContext | null>(null);
    const noiseSourceRef = useRef<AudioBufferSourceNode | null>(null);
    const masterGainRef = useRef<GainNode | null>(null);
    const lfoRef = useRef<OscillatorNode | null>(null);
    const lfoGainRef = useRef<GainNode | null>(null);
    const startedRef = useRef(false);
    const [muted, setMutedState] = useState(false);

    const teardown = useCallback(() => {
      try {
        noiseSourceRef.current?.stop();
      } catch {
        // Already stopped.
      }
      try {
        lfoRef.current?.stop();
      } catch {
        // Already stopped.
      }
      noiseSourceRef.current?.disconnect();
      lfoRef.current?.disconnect();
      lfoGainRef.current?.disconnect();
      masterGainRef.current?.disconnect();

      noiseSourceRef.current = null;
      lfoRef.current = null;
      lfoGainRef.current = null;
      masterGainRef.current = null;

      const ctx = audioContextRef.current;
      if (ctx && ctx.state !== "closed") {
        void ctx.close();
      }
      audioContextRef.current = null;
      startedRef.current = false;
    }, []);

    useEffect(() => teardown, [teardown]);

    // Safety net: if the tab is being closed / backgrounded / hidden
    // (browser closed, tab closed, switched to another tab, OS suspended
    // the tab), tear the audio graph down or suspend the context so we
    // never keep generating ocean noise for a user who is no longer
    // looking at the page. React's normal unmount cleanup does NOT run
    // reliably on tab close, so these listeners are the only correct
    // place to do this.
    useEffect(() => {
      if (typeof window === "undefined") return;

      const handlePageHide = () => {
        teardown();
      };

      const handleVisibilityChange = () => {
        const ctx = audioContextRef.current;
        if (!ctx) return;
        if (document.hidden) {
          // Suspend (not close) so the user can return and resume
          // without a gap. If they close the tab entirely, pagehide
          // fires and tears everything down for good.
          if (ctx.state === "running") {
            void ctx.suspend();
          }
        } else {
          if (ctx.state === "suspended" && !muted) {
            void ctx.resume();
          }
        }
      };

      window.addEventListener("pagehide", handlePageHide);
      window.addEventListener("beforeunload", handlePageHide);
      document.addEventListener("visibilitychange", handleVisibilityChange);

      return () => {
        window.removeEventListener("pagehide", handlePageHide);
        window.removeEventListener("beforeunload", handlePageHide);
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      };
    }, [teardown, muted]);

    useImperativeHandle(
      ref,
      (): AmbientAudioBedHandle => ({
        async start() {
          if (typeof window === "undefined") return;
          if (startedRef.current && audioContextRef.current) {
            // Already running; just unmute.
            setMutedState(false);
            if (audioContextRef.current.state === "suspended") {
              await audioContextRef.current.resume();
            }
            return;
          }

          const Ctor =
            window.AudioContext ??
            (window as typeof window & { webkitAudioContext?: typeof AudioContext })
              .webkitAudioContext;
          if (!Ctor) return;

          const ctx = new Ctor();
          audioContextRef.current = ctx;

          const noiseBuffer = ctx.createBuffer(
            1,
            ctx.sampleRate * NOISE_BUFFER_SECONDS,
            ctx.sampleRate,
          );
          fillPinkNoise(noiseBuffer.getChannelData(0));

          const noiseSource = ctx.createBufferSource();
          noiseSource.buffer = noiseBuffer;
          noiseSource.loop = true;

          const masterGain = ctx.createGain();
          masterGain.gain.setValueAtTime(0, ctx.currentTime);
          masterGain.gain.linearRampToValueAtTime(
            muted ? 0 : TARGET_GAIN,
            ctx.currentTime + FADE_IN_SECONDS,
          );

          const lfo = ctx.createOscillator();
          lfo.frequency.value = LFO_FREQUENCY_HZ;

          const lfoGain = ctx.createGain();
          // The LFO modulates around a midpoint so the master gain
          // smoothly oscillates between (1 - depth) and (1 + depth)
          // of its set value. We achieve this with a separate offset
          // node by feeding lfoGain into masterGain.gain.
          lfoGain.gain.value = TARGET_GAIN * LFO_DEPTH;

          noiseSource.connect(masterGain);
          masterGain.connect(ctx.destination);
          lfo.connect(lfoGain);
          lfoGain.connect(masterGain.gain);

          noiseSource.start();
          lfo.start();

          noiseSourceRef.current = noiseSource;
          masterGainRef.current = masterGain;
          lfoRef.current = lfo;
          lfoGainRef.current = lfoGain;
          startedRef.current = true;
        },
        async fade(seconds: number) {
          const ctx = audioContextRef.current;
          const masterGain = masterGainRef.current;
          if (!ctx || !masterGain) return;

          const now = ctx.currentTime;
          masterGain.gain.cancelScheduledValues(now);
          masterGain.gain.setValueAtTime(masterGain.gain.value, now);
          masterGain.gain.linearRampToValueAtTime(0, now + Math.max(0.05, seconds));

          await new Promise((resolve) =>
            window.setTimeout(resolve, Math.max(50, seconds * 1000 + 50)),
          );

          teardown();
        },
        setMuted(next: boolean) {
          setMutedState(next);
          const ctx = audioContextRef.current;
          const masterGain = masterGainRef.current;
          if (!ctx || !masterGain) return;
          const now = ctx.currentTime;
          masterGain.gain.cancelScheduledValues(now);
          masterGain.gain.setValueAtTime(masterGain.gain.value, now);
          masterGain.gain.linearRampToValueAtTime(
            next ? 0 : TARGET_GAIN,
            now + 0.15,
          );
        },
      }),
      [muted, teardown],
    );

    if (!showMuteButton) return null;

    return (
      <button
        type="button"
        onClick={() => {
          const next = !muted;
          setMutedState(next);
          const ctx = audioContextRef.current;
          const masterGain = masterGainRef.current;
          if (!ctx || !masterGain) return;
          const now = ctx.currentTime;
          masterGain.gain.cancelScheduledValues(now);
          masterGain.gain.setValueAtTime(masterGain.gain.value, now);
          masterGain.gain.linearRampToValueAtTime(
            next ? 0 : TARGET_GAIN,
            now + 0.15,
          );
        }}
        aria-pressed={muted}
        aria-label={muted ? "Unmute ambient sound" : "Mute ambient sound"}
        className="fixed top-4 right-4 z-30 inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface/90 text-foreground/70 backdrop-blur transition hover:text-accent hover:border-accent"
      >
        {muted ? <SpeakerMutedIcon /> : <SpeakerIcon />}
      </button>
    );
  },
);

function SpeakerIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden
    >
      <path d="M11 5L6 9H3v6h3l5 4V5z" />
      <path d="M15.5 8.5a5 5 0 010 7" />
      <path d="M18 6a8 8 0 010 12" />
    </svg>
  );
}

function SpeakerMutedIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden
    >
      <path d="M11 5L6 9H3v6h3l5 4V5z" />
      <path d="M22 9l-6 6" />
      <path d="M16 9l6 6" />
    </svg>
  );
}

/**
 * Voss-McCartney pink noise approximation. Sounds noticeably more
 * "ocean" than plain white noise and is cheap enough to compute on
 * every session start without warming a worker. Source: the standard
 * three-octave-summed white-noise trick (Allen B. Downey, "Think DSP").
 */
function fillPinkNoise(channel: Float32Array): void {
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;

  for (let i = 0; i < channel.length; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
    b6 = white * 0.115926;
    channel[i] = pink * 0.11;
  }
}
