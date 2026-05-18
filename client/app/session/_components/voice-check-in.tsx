"use client";

/**
 * Voice-driven multi-turn check-in — re-skinned to the interactive
 * prototype's check-in screen:
 *
 *   - crumb "Check-in N of 5"
 *   - big italic-serif score readout (value /10 + intensity word) that
 *     glow-flashes when a new score is committed
 *   - the prototype's 88 px voice orb (ring stack), state-driven
 *   - a mono status label under the orb
 *   - chat-bubble transcript with a typing indicator while streaming
 *   - a quiet "Skip →" control bottom-right
 *
 * All of the real plumbing is unchanged: the wllama check-in generator,
 * Whisper STT, Kokoro TTS, barge-in, the `endConversation` gate, the
 * `CheckIn` payload, and `SessionHistoryEntry` downstream. Only the
 * presentation moved — the ambient ocean is the shared WaveSkin canvas
 * behind the route, so this screen carries no inline wave widget.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  streamCheckInTurn,
  type CheckInChatTurnPayload,
  type EndConversationSignal,
} from "@/lib/gemma/checkin";
import { extractCravingScore } from "@/lib/session/extract-craving-score";
import {
  useCheckInVoiceLoop,
  type CheckInVoiceLoopStatus,
  type VoiceCheckInGenerator,
  type VoiceCheckInTurnEvent,
  type VoiceTranscriptTurn,
} from "@/lib/voice/use-check-in-voice-loop";
import type {
  CheckInContextPayload,
  SessionHistoryEntry,
} from "@/lib/prompts/schemas";
import type {
  CheckIn,
  CheckInTurn,
  ChunkNumber,
  SessionUserProfile,
} from "@/types/session";

interface Props {
  chunkNumber: ChunkNumber;
  priorScores: number[];
  intakeIntensity: number;
  profile: SessionUserProfile;
  sessionHistory: readonly SessionHistoryEntry[];
  demoMode: boolean;
  onComplete: (checkIn: CheckIn) => void;
}

const CHECK_IN_OPENER =
  "How intense is the craving right now? Give me a number from 1 to 10.";

const INTENSITY_LABELS = [
  "barely there",
  "faint",
  "noticing it",
  "present",
  "hard to ignore",
  "pulling",
  "strong",
  "loud",
  "urgent",
  "all-consuming",
];

function intensityLabel(score: number): string {
  return INTENSITY_LABELS[Math.max(0, Math.min(9, Math.round(score) - 1))];
}

const STATUS_COPY: Record<CheckInVoiceLoopStatus, string> = {
  idle: "Tap to start",
  warming: "Warming up the voice…",
  recording: "You're speaking",
  transcribing: "Transcribing…",
  thinking: "Thinking…",
  speaking: "Wave is speaking",
  error: "Something interrupted us",
};

export function VoiceCheckIn({
  chunkNumber,
  priorScores,
  intakeIntensity,
  profile,
  sessionHistory,
  demoMode,
  onComplete,
}: Props) {
  const [startedAt] = useState(() => Date.now());
  const completedRef = useRef(false);
  const cravingScoreRef = useRef<number | null>(null);
  const turnsRef = useRef<CheckInTurn[]>([]);
  const [displayedScore, setDisplayedScore] = useState<number | null>(null);
  const [scoreFlash, setScoreFlash] = useState(false);
  const flashTimerRef = useRef<number | null>(null);

  // Commit a freshly-heard score and trigger the glow-flash. Driven by
  // the turn-complete event (not an effect) so it stays a single render.
  const commitScore = useCallback((score: number) => {
    setDisplayedScore(score);
    setScoreFlash(true);
    if (flashTimerRef.current !== null) {
      window.clearTimeout(flashTimerRef.current);
    }
    flashTimerRef.current = window.setTimeout(() => {
      setScoreFlash(false);
      flashTimerRef.current = null;
    }, 900);
  }, []);

  useEffect(() => {
    return () => {
      if (flashTimerRef.current !== null) {
        window.clearTimeout(flashTimerRef.current);
      }
    };
  }, []);

  const resolveActiveScore = useCallback((): number => {
    return (
      cravingScoreRef.current ??
      priorScores[priorScores.length - 1] ??
      intakeIntensity
    );
  }, [priorScores, intakeIntensity]);

  const buildContext = useCallback(
    (activeScore: number): CheckInContextPayload => ({
      chunkNumber,
      cravingScore: activeScore,
      scoreHistory: [...priorScores, activeScore],
      obstacleHint: null,
      profile: {
        matType: profile.matType,
        medicationStatus: profile.medicationStatus,
        trigger: profile.trigger,
        triggerOther: profile.triggerOther,
        usedSubstanceToday: profile.usedSubstanceToday,
      },
      intakeIntensity,
      sessionHistory: [...sessionHistory],
      demoMode,
    }),
    [
      chunkNumber,
      demoMode,
      intakeIntensity,
      priorScores,
      profile,
      sessionHistory,
    ],
  );

  const finalizeCheckIn = useCallback(
    (signal: EndConversationSignal) => {
      if (completedRef.current) return;
      completedRef.current = true;

      const finalScore = signal.cravingScore ?? resolveActiveScore();

      const checkIn: CheckIn = {
        chunkNumber,
        cravingScore: finalScore,
        turns: turnsRef.current.map(
          (t, idx): CheckInTurn => ({
            index: idx + 1,
            role: t.role,
            content: t.content,
            via: t.via,
            atLatencyMs: t.atLatencyMs,
          }),
        ),
        obstacleCategory: signal.obstacleCategory,
        readyToContinue: chunkNumber === 5 ? null : true,
        startedAt,
        endedAt: Date.now(),
      };
      onComplete(checkIn);
    },
    [chunkNumber, onComplete, resolveActiveScore, startedAt],
  );

  const generate = useMemo<VoiceCheckInGenerator>(
    () => async (history, { signal, onDelta }) => {
      const llmHistory: CheckInChatTurnPayload[] = history.map((t) => ({
        role: t.role,
        content: t.content,
      }));
      const result = await streamCheckInTurn({
        history: llmHistory,
        context: buildContext(resolveActiveScore()),
        signal,
        onDelta,
      });
      return {
        text: result.text,
        source: result.source,
        elapsedMs: 0,
        endConversation: result.endConversation,
      };
    },
    [buildContext, resolveActiveScore],
  );

  const handleTurnComplete = useCallback(
    (event: VoiceCheckInTurnEvent) => {
      const turnIndex = turnsRef.current.length;
      const userTurn: CheckInTurn = {
        index: turnIndex + 1,
        role: "patient",
        content: event.user,
        via: "patient",
      };
      const agentTurn: CheckInTurn = {
        index: turnIndex + 2,
        role: "agent",
        content: event.assistant,
        via: event.source,
        atLatencyMs: event.latencyMs,
      };
      turnsRef.current = [...turnsRef.current, userTurn, agentTurn];

      if (event.turnIndex === 1) {
        const extracted = extractCravingScore(event.user);
        if (extracted !== null) {
          cravingScoreRef.current = extracted;
          commitScore(extracted);
        } else {
          commitScore(resolveActiveScore());
        }
      }

      if (event.endConversation) {
        finalizeCheckIn(event.endConversation);
      }
    },
    [commitScore, finalizeCheckIn, resolveActiveScore],
  );

  const handleError = useCallback((err: Error) => {
    if (typeof console !== "undefined") {
      console.error("[wave] VoiceCheckIn error", err);
    }
  }, []);

  const loop = useCheckInVoiceLoop({
    generate,
    opener: CHECK_IN_OPENER,
    onTurnComplete: handleTurnComplete,
    onError: handleError,
    enableBargeIn: true,
  });

  // Auto-start: the check-in begins on its own the moment this screen
  // mounts (matches the prototype — no "Start" tap). The hook speaks the
  // opener through Kokoro, then listens. Earlier gestures in the session
  // (intake/safety/chunk) already unlocked audio; if the mic can't be
  // acquired the hook surfaces `errorMessage` and the control below
  // becomes a tap-to-enable fallback.
  const autoStartedRef = useRef(false);
  const setHandsFreeEnabled = loop.setHandsFreeEnabled;
  useEffect(() => {
    if (autoStartedRef.current) return;
    autoStartedRef.current = true;
    void setHandsFreeEnabled(true);
  }, [setHandsFreeEnabled]);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [loop.transcript]);

  const displayedIntensity =
    displayedScore ??
    priorScores[priorScores.length - 1] ??
    intakeIntensity;

  // Map the real loop status → the prototype's three-state orb grammar.
  const listeningLike =
    loop.status === "recording" ||
    loop.status === "transcribing" ||
    loop.status === "thinking" ||
    (loop.status === "idle" && loop.handsFreeEnabled) ||
    loop.status === "warming";
  const orbState: "idle" | "speaking" | "listening" =
    loop.status === "speaking"
      ? "speaking"
      : listeningLike
        ? "listening"
        : "idle";

  const statusLabel =
    loop.status === "idle" && loop.handsFreeEnabled
      ? "Listening"
      : STATUS_COPY[loop.status];

  // Auto-started, so the control is a Stop. It only becomes a manual
  // affordance if the patient stopped, or the mic/permission errored.
  const buttonLabel = loop.handsFreeEnabled
    ? "Stop"
    : loop.errorMessage
      ? "Enable microphone"
      : "Resume";
  const buttonDisabled =
    loop.status === "warming" ||
    loop.status === "transcribing" ||
    loop.status === "thinking";

  return (
    <div className="screen">
      <div className="topbar">
        <span className="crumb">Check-in {chunkNumber} of 5</span>
      </div>

      <div className="screen-body" style={{ paddingTop: 8, gap: 18 }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 14,
          }}
        >
          <span className={`score-readout ${scoreFlash ? "is-updating" : ""}`}>
            {displayedIntensity}
            <span className="denom">/10</span>
            <span className="word">{intensityLabel(displayedIntensity)}</span>
          </span>

          <div className="voice-orb" data-state={orbState}>
            <span className="voice-orb-ring" />
            <span className="voice-orb-ring r2" />
            <span className="voice-orb-core" />
          </div>
          <div className="voice-orb-label">{statusLabel}</div>
        </div>

        <div ref={scrollRef} className="voice-transcript">
          {loop.transcript.length === 0 ? (
            <p className="voice-empty">
              On-device · Whisper transcribes you, Kokoro replies in voice.
              Nothing leaves this device.
            </p>
          ) : (
            <div className="chat-scroll">
              {loop.transcript.map((turn) => (
                <ChatBubble key={turn.id} turn={turn} />
              ))}
            </div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <button
            type="button"
            onClick={() => {
              void loop.setHandsFreeEnabled(!loop.handsFreeEnabled);
            }}
            disabled={buttonDisabled}
            aria-pressed={loop.handsFreeEnabled}
            className="btn"
            style={loop.handsFreeEnabled ? { borderColor: "var(--danger)" } : undefined}
          >
            {buttonLabel}
          </button>

          <button
            type="button"
            className="btn ghost"
            style={{
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 11,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              padding: "6px 10px",
            }}
            onClick={() =>
              finalizeCheckIn({
                cravingScore: resolveActiveScore(),
                obstacleCategory: null,
              })
            }
          >
            Skip →
          </button>
        </div>

        {loop.errorMessage ? (
          <p
            role="alert"
            style={{
              margin: 0,
              fontSize: 13,
              color: "var(--danger)",
            }}
          >
            {loop.errorMessage}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ChatBubble({ turn }: { turn: VoiceTranscriptTurn }) {
  const isAgent = turn.role === "agent";
  return (
    <div className={`bubble ${isAgent ? "agent" : "patient"}`}>
      {turn.content === "" ? (
        <span className="dot-typing">
          <span />
          <span />
          <span />
        </span>
      ) : (
        turn.content
      )}
    </div>
  );
}
