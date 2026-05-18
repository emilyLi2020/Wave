"use client";

/**
 * Voice-driven multi-turn check-in.
 *
 * Replaces the text-based {@link CheckInChat} in the clinical session
 * flow. The patient speaks their craving score, hears each agent turn
 * via Kokoro TTS, and continues until the wllama check-in generator
 * emits an `endConversation` signal (parsed out of the response_format
 * json_schema reply — see `generateWllamaCheckIn`).
 *
 * Output contract is identical to `CheckInChat`: same `Props`, same
 * `CheckIn` shape on `onComplete`, same `SessionHistoryEntry` plumbing
 * downstream. The session-machine swap is mechanical.
 */

import { useCallback, useMemo, useRef, useState } from "react";

import {
  streamCheckInTurn,
  type CheckInChatTurnPayload,
  type EndConversationSignal,
} from "@/lib/gemma/checkin";
import { extractCravingScore } from "@/lib/session/extract-craving-score";
import {
  useCheckInVoiceLoop,
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
import { AnimatedWave } from "./animated-wave";

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

      // Prefer the model's final cravingScore over the running ref; the
      // model has been listening to the whole conversation and may have
      // updated its estimate.
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

  // Adapt streamCheckInTurn (which uses the wllama generator under the
  // hood) into the hook's generator shape.
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
      // Record both sides of the turn for the eventual CheckIn payload.
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

      // First patient turn: extract craving score from the transcription.
      // Fallback hierarchy lives in `resolveActiveScore` so subsequent
      // turns reuse whatever's most recent.
      if (event.turnIndex === 1) {
        const extracted = extractCravingScore(event.user);
        if (extracted !== null) {
          cravingScoreRef.current = extracted;
          setDisplayedScore(extracted);
        } else {
          // Couldn't pick a number out — show whatever we'd ground the
          // LLM on so the wave UI still moves.
          setDisplayedScore(resolveActiveScore());
        }
      }

      if (event.endConversation) {
        finalizeCheckIn(event.endConversation);
      }
    },
    [finalizeCheckIn, resolveActiveScore],
  );

  const handleError = useCallback((err: Error) => {
    // Log only — the hook surfaces a user-visible errorMessage already.
    if (typeof console !== "undefined") {
      console.error("[wave] VoiceCheckIn error", err);
    }
  }, []);

  const loop = useCheckInVoiceLoop({
    generate,
    opener: CHECK_IN_OPENER,
    onTurnComplete: handleTurnComplete,
    onError: handleError,
    // Full hands-free loop: the patient can interrupt the assistant
    // mid-sentence, same as /models/voice-test. The ambient bed is
    // ducked by the session machine while this surface is mounted so
    // it can't self-trigger the mic.
    enableBargeIn: true,
  });

  const containerRef = useRef<HTMLDivElement>(null);
  // Auto-scroll the transcript on new turns.
  if (containerRef.current) {
    const el = containerRef.current;
    queueMicrotask(() =>
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }),
    );
  }

  const displayedIntensity =
    displayedScore ??
    priorScores[priorScores.length - 1] ??
    intakeIntensity;

  const buttonLabel = loop.handsFreeEnabled
    ? "Stop check-in"
    : "Start check-in";
  const buttonDisabled =
    loop.status === "warming" ||
    loop.status === "transcribing" ||
    loop.status === "thinking";

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground/60">
          Check-in {chunkNumber} of 5
        </h2>
        <p className="text-xs text-foreground/50">
          Wave height: {displayedIntensity}/10
        </p>
      </header>

      <AnimatedWave mode="ambient" intensity={displayedIntensity} />

      <div
        ref={containerRef}
        className="max-h-[420px] min-h-[280px] space-y-3 overflow-y-auto rounded-2xl border border-border bg-surface p-4"
      >
        {loop.transcript.length === 0 ? (
          <p className="text-sm text-foreground/50">
            Tap start, then speak when you're ready. The assistant will ask
            for your craving score first.
          </p>
        ) : null}
        {loop.transcript.map((turn) => (
          <ChatBubble key={turn.id} turn={turn} />
        ))}
        {loop.status === "thinking" || loop.status === "transcribing" ? (
          <ShimmerLine />
        ) : null}
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
        <LevelMeter
          rms={loop.level.rms}
          peak={loop.level.peak}
          active={loop.handsFreeEnabled}
          status={loop.status}
        />
        <button
          type="button"
          onClick={() => {
            void loop.setHandsFreeEnabled(!loop.handsFreeEnabled);
          }}
          disabled={buttonDisabled}
          className={`w-full rounded-full px-5 py-3 text-sm font-semibold transition disabled:opacity-50 ${
            loop.handsFreeEnabled
              ? "bg-danger text-danger-foreground hover:opacity-90"
              : "bg-accent text-accent-foreground hover:opacity-90"
          }`}
          aria-pressed={loop.handsFreeEnabled}
        >
          {buttonLabel}
        </button>
      </div>

      {loop.errorMessage ? (
        <p
          className="rounded-2xl border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger"
          role="alert"
        >
          {loop.errorMessage}
        </p>
      ) : null}
    </div>
  );
}

function ChatBubble({ turn }: { turn: VoiceTranscriptTurn }) {
  const isAgent = turn.role === "agent";
  return (
    <div
      className={`flex ${isAgent ? "justify-start" : "justify-end"} animate-fade-in-up`}
    >
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isAgent
            ? "rounded-tl-sm bg-surface-muted text-foreground/90"
            : "rounded-tr-sm bg-accent text-accent-foreground"
        }`}
      >
        {turn.content || <ShimmerLine inline />}
      </div>
    </div>
  );
}

function ShimmerLine({ inline = false }: { inline?: boolean }) {
  return (
    <span
      className={`${inline ? "inline-flex" : "flex"} items-center gap-1 text-xs text-foreground/50 animate-shimmer`}
      aria-live="polite"
    >
      <span className="h-1 w-1 rounded-full bg-foreground/40" />
      <span className="h-1 w-1 rounded-full bg-foreground/40" />
      <span className="h-1 w-1 rounded-full bg-foreground/40" />
      <span className="ml-1">still with you...</span>
    </span>
  );
}

function LevelMeter({
  rms,
  peak,
  active,
  status,
}: {
  rms: number;
  peak: number;
  active: boolean;
  status: string;
}) {
  const width = Math.min(100, Math.round(rms * 500));
  const stateLabel = !active
    ? "off"
    : status === "speaking"
      ? "assistant speaking"
      : status === "recording"
        ? "you're speaking"
        : status === "thinking"
          ? "thinking..."
          : "listening";
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-foreground/55">
        <span>Microphone</span>
        <span>{stateLabel}</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-background">
        <div
          className="h-full bg-accent transition-[width] duration-100"
          style={{ width: `${width}%` }}
        />
      </div>
      <p className="mt-2 font-mono text-xs text-foreground/40">
        rms {rms.toFixed(3)} · peak {peak.toFixed(3)}
      </p>
    </div>
  );
}
