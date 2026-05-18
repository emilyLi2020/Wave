"use client";

/**
 * Session shell for the five-chunk urge surfing flow.
 *
 *   intake → safety → loop(loadingChunk → chunk N → check-in N) for N=1..5 → reflection → done
 *
 * The visual flow mirrors the interactive prototype (/demo): immersive
 * full-bleed screens over the WaveSkin ocean, no card/heading chrome.
 * `loadingChunk` is presented as the prototype's breath orb so the
 * unavoidable chunk-generation wait reads as part of the meditation
 * rather than a system interstitial.
 *
 * Both the chunk narration and the check-in agent are LLM-driven (real
 * Whisper / Kokoro / wllama) — only the presentation changed here, not
 * the reducer or the model plumbing.
 *
 * The ambient audio bed is mounted ONCE here so it never restarts on a
 * chunk → check-in → chunk transition (PRD § Risk Areas #6). It starts
 * on the intake "Continue" gesture and fades out at the reflection
 * screen.
 */

import Link from "next/link";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";

import { AmbientAudioBed, type AmbientAudioBedHandle } from "./ambient-audio-bed";
import { ChunkPlayer } from "./chunk-player";
import { VoiceCheckIn } from "./voice-check-in";
import { IntakeForm, type IntakeAnswers } from "./intake-form";
import { RelaxingLoader } from "./relaxing-loader";
import { SafetyHandoff } from "./safety-handoff";
import { SafetyScreen, type SafetyOutcome } from "./safety-screen";
import { ScoreArc } from "./score-arc";

import {
  MEDICATION_LABEL,
  OUTCOME_LABEL,
  TRIGGER_LABEL,
} from "@/lib/data/mock-sessions";
import { recordCompletedSession } from "@/lib/sessions/completed-store";
import { generateChunk } from "@/lib/gemma/chunk";
import {
  generateReflection,
  type ReflectionTitle,
} from "@/lib/gemma/session";
import {
  createWhisperSpeechToTextEngine,
  preloadKokoroTextToSpeech,
} from "@/lib/voice";
import type {
  ReflectionContext,
  ReflectionPayload,
  SessionHistoryEntry,
} from "@/lib/prompts/schemas";
import type { SessionOutcome } from "@/types/models";
import type {
  CheckIn,
  Chunk,
  ChunkNumber,
  SessionUserProfile,
} from "@/types/session";

type Phase =
  | "intake"
  | "safety"
  | "safetyHandoff"
  | "loadingChunk"
  | "chunk"
  | "checkIn"
  | "reflection"
  | "done";

interface State {
  phase: Phase;
  startedAt: string;
  intake: IntakeAnswers | null;
  usedSubstanceToday: boolean;
  currentChunk: ChunkNumber;
  /** The generated chunk for `currentChunk`, or null while loading. */
  generatedChunk: Chunk | null;
  /** Provenance for the most recently generated chunk (for DevTools). */
  generatedChunkSource: "model" | "fallback" | null;
  checkIns: CheckIn[];
  /**
   * Cross-chunk conversation log. One entry per completed chunk
   * (kind: "chunk", lines = the LLM-generated narration that played)
   * and one per completed check-in (kind: "checkIn", with the
   * cravingScore + obstacleCategory + full transcript). Forwarded to
   * BOTH the chunk generator and the check-in chat so each new
   * surface grounds itself in everything that has already happened.
   */
  sessionHistory: SessionHistoryEntry[];
  outcome: SessionOutcome | null;
  pickedNextStep: string | null;
  demoMode: boolean;
}

type Action =
  | { type: "intakeSubmitted"; answers: IntakeAnswers }
  | { type: "safetyResolved"; outcome: SafetyOutcome }
  | {
      type: "chunkGenerated";
      chunk: Chunk;
      lines: string[];
      source: "model" | "fallback";
    }
  | { type: "chunkCompleted" }
  | { type: "checkInCompleted"; checkIn: CheckIn }
  | { type: "nextStepPicked"; choice: string }
  | { type: "sessionFinished" };

function initialState(): State {
  return {
    phase: "intake",
    startedAt: new Date().toISOString(),
    intake: null,
    usedSubstanceToday: false,
    currentChunk: 1,
    generatedChunk: null,
    generatedChunkSource: null,
    checkIns: [],
    sessionHistory: [],
    outcome: null,
    pickedNextStep: null,
    demoMode: false,
  };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "intakeSubmitted":
      return {
        ...state,
        intake: action.answers,
        demoMode: action.answers.demoMode,
        phase: "safety",
      };
    case "safetyResolved":
      if (action.outcome.kind === "handoff") {
        return {
          ...state,
          phase: "safetyHandoff",
          outcome: "safety_exited",
        };
      }
      return {
        ...state,
        usedSubstanceToday: action.outcome.usedSubstanceToday,
        phase: "loadingChunk",
        currentChunk: 1,
        generatedChunk: null,
      };
    case "chunkGenerated":
      // The effect that fetches the chunk may resolve after the
      // patient has navigated forward. Only honor the result if we
      // were still waiting for it.
      if (
        state.phase !== "loadingChunk" ||
        action.chunk.id !== state.currentChunk
      ) {
        return state;
      }
      return {
        ...state,
        generatedChunk: action.chunk,
        generatedChunkSource: action.source,
        phase: "chunk",
      };
    case "chunkCompleted": {
      // Append the chunk to the history snapshot the next surface
      // (the check-in chat) will read.
      const lines = state.generatedChunk
        ? state.generatedChunk.segments
            .filter((segment) => segment.type === "text")
            .map((segment) =>
              segment.type === "text" ? segment.content : "",
            )
        : [];
      const newEntry: SessionHistoryEntry = {
        kind: "chunk",
        chunkNumber: state.currentChunk,
        lines,
      };
      return {
        ...state,
        phase: "checkIn",
        sessionHistory: [...state.sessionHistory, newEntry],
      };
    }
    case "checkInCompleted": {
      const checkIns = [...state.checkIns, action.checkIn];
      const checkInEntry: SessionHistoryEntry = {
        kind: "checkIn",
        chunkNumber: action.checkIn.chunkNumber,
        cravingScore: action.checkIn.cravingScore,
        obstacleCategory: action.checkIn.obstacleCategory,
        turns: action.checkIn.turns.map((turn) => ({
          role: turn.role,
          content: turn.content,
        })),
      };
      const sessionHistory = [...state.sessionHistory, checkInEntry];

      if (action.checkIn.chunkNumber === 5) {
        return {
          ...state,
          checkIns,
          sessionHistory,
          phase: "reflection",
        };
      }
      // Hand off to the chunk loader. The breath orb stays on screen
      // with soft breath cues until the next chunk is ready. There is
      // no fixed-duration countdown.
      return {
        ...state,
        checkIns,
        sessionHistory,
        phase: "loadingChunk",
        currentChunk: (action.checkIn.chunkNumber + 1) as ChunkNumber,
        generatedChunk: null,
      };
    }
    case "nextStepPicked":
      return { ...state, pickedNextStep: action.choice };
    case "sessionFinished":
      return { ...state, phase: "done", outcome: "completed" };
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

export function SessionMachine() {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const audioRef = useRef<AmbientAudioBedHandle>(null);

  const profile: SessionUserProfile | null = useMemo(() => {
    if (!state.intake) return null;
    return {
      matType: state.intake.matType,
      medicationStatus: state.intake.medicationStatus,
      trigger: state.intake.trigger,
      triggerOther: state.intake.triggerOther,
      usedSubstanceToday: state.usedSubstanceToday,
    };
  }, [state.intake, state.usedSubstanceToday]);

  const intakeIntensity = state.intake?.intakeIntensity ?? 5;
  const priorScores = useMemo(
    () => state.checkIns.map((c) => c.cravingScore),
    [state.checkIns],
  );

  // Most recent craving rating the patient has given us. Drives the
  // ambient wave's fill height so the visualization mirrors whatever
  // number the patient just owned on the slider. Before the first
  // check-in we fall back to the intake intensity.
  const currentIntensity =
    priorScores.length > 0
      ? priorScores[priorScores.length - 1]
      : intakeIntensity;

  // Start the audio bed when the patient enters the chunk loop.
  useEffect(() => {
    if (state.phase === "loadingChunk" && state.currentChunk === 1) {
      void audioRef.current?.start();
    }
  }, [state.phase, state.currentChunk]);

  // Fade out at reflection.
  useEffect(() => {
    if (state.phase === "reflection") {
      void audioRef.current?.fade(2.5);
    }
  }, [state.phase]);

  // Duck the ambient bed to silence while the hands-free voice
  // check-in is live. With barge-in active the mic listens through the
  // assistant's speech; the continuous ambient bed (which, unlike
  // Kokoro, doesn't route through markAudioOutput) would otherwise
  // self-trigger the VAD. Restored the moment we leave the check-in.
  useEffect(() => {
    audioRef.current?.setDucked(state.phase === "checkIn");
  }, [state.phase]);

  // Drive chunk generation whenever we enter the loadingChunk phase.
  // The breath orb is the patient-facing cover during this wait.
  useEffect(() => {
    if (state.phase !== "loadingChunk") return;
    // Skip if we already have the chunk (defensive — chunkGenerated
    // already moves the phase out of loadingChunk).
    if (state.generatedChunk) return;
    if (!profile || !state.intake) return;

    const controller = new AbortController();
    let cancelled = false;

    // Warm the voice models in parallel with chunk generation so the
    // check-in surface that opens next has Whisper + Kokoro already
    // ready. Both factories are memoized singletons, so the 5× per
    // session repeated calls are no-ops after the first one.
    void createWhisperSpeechToTextEngine("onnx-community/whisper-base.en").catch(
      () => undefined,
    );
    void preloadKokoroTextToSpeech("fp32-webgpu").catch(() => undefined);

    void generateChunk({
      context: {
        chunkNumber: state.currentChunk,
        intakeIntensity: state.intake.intakeIntensity,
        profile: {
          matType: profile.matType,
          medicationStatus: profile.medicationStatus,
          trigger: profile.trigger,
          triggerOther: profile.triggerOther,
          usedSubstanceToday: profile.usedSubstanceToday,
        },
        sessionHistory: [...state.sessionHistory],
      },
      signal: controller.signal,
    })
      .then((result) => {
        if (cancelled) return;
        dispatch({
          type: "chunkGenerated",
          chunk: result.chunk,
          lines: result.lines,
          source: result.source,
        });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (typeof console !== "undefined") {
          console.error("[wave] chunk generation error", err);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    state.phase,
    state.currentChunk,
    state.generatedChunk,
    profile,
    state.intake,
    state.sessionHistory,
  ]);

  // The mute toggle is only meaningful while narration / breath cues
  // are playing. It's hidden during the check-in (bed auto-ducked).
  const showAmbientToggle =
    state.phase === "loadingChunk" || state.phase === "chunk";

  const reflectionContext: ReflectionContext | null = useMemo(() => {
    if (!profile || !state.intake || state.checkIns.length < 5) return null;
    const finalCheckIn = state.checkIns[state.checkIns.length - 1];
    const finalScore = finalCheckIn.cravingScore;
    const durationSeconds = Math.max(
      0,
      Math.round((finalCheckIn.endedAt - new Date(state.startedAt).getTime()) / 1000),
    );
    return {
      intakeIntensity: state.intake.intakeIntensity,
      matType: state.intake.matType,
      medicationStatus: state.intake.medicationStatus,
      trigger: state.intake.trigger,
      usedSubstanceToday: state.usedSubstanceToday,
      bodyLocation: "other",
      currentIntensity: finalScore,
      endingIntensity: finalScore,
      durationSeconds,
    };
  }, [
    profile,
    state.intake,
    state.checkIns,
    state.usedSubstanceToday,
    state.startedAt,
  ]);

  // When a session completes, prepend it to the on-device completed-
  // session log so it shows up at the top of History and bumps the
  // Dashboard "Sessions surfed" count. Fires once; dashboard/history
  // otherwise stay on the curated mock baseline.
  const recordedRef = useRef(false);
  useEffect(() => {
    if (state.phase !== "done" || recordedRef.current || !state.intake) {
      return;
    }
    recordedRef.current = true;
    const end =
      priorScores.length > 0
        ? priorScores[priorScores.length - 1]
        : intakeIntensity;
    recordCompletedSession({
      id: `s_${Date.now().toString(36)}`,
      date: "Just now",
      start: state.intake.intakeIntensity,
      end,
      trigger: TRIGGER_LABEL[state.intake.trigger],
      medication: MEDICATION_LABEL[state.intake.medicationStatus],
      outcome: OUTCOME_LABEL[state.outcome ?? "completed"],
    });
  }, [
    state.phase,
    state.intake,
    state.outcome,
    priorScores,
    intakeIntensity,
  ]);

  return (
    <>
      <AmbientAudioBed ref={audioRef} showMuteButton={showAmbientToggle} />

      {state.phase === "intake" ? (
        <IntakeForm
          onSubmit={(answers) =>
            dispatch({ type: "intakeSubmitted", answers })
          }
        />
      ) : null}

      {state.phase === "safety" ? (
        <SafetyScreen
          onResolved={(outcome) =>
            dispatch({ type: "safetyResolved", outcome })
          }
        />
      ) : null}

      {state.phase === "safetyHandoff" ? (
        <PhaseScreen crumb="Before we start">
          <SafetyHandoff />
        </PhaseScreen>
      ) : null}

      {state.phase === "loadingChunk" ? (
        <RelaxingLoader
          key={`loader-${state.currentChunk}`}
          pool={state.currentChunk === 1 ? "start" : "between"}
        />
      ) : null}

      {state.phase === "chunk" && state.generatedChunk ? (
        <ChunkPlayer
          key={`chunk-${state.currentChunk}`}
          chunk={state.generatedChunk}
          chunkNumber={state.currentChunk}
          matType={profile?.matType ?? "none"}
          demoMode={state.demoMode}
          currentIntensity={currentIntensity}
          onComplete={() => dispatch({ type: "chunkCompleted" })}
        />
      ) : null}

      {state.phase === "checkIn" && profile ? (
        <VoiceCheckIn
          key={`checkin-${state.currentChunk}`}
          chunkNumber={state.currentChunk}
          priorScores={priorScores}
          intakeIntensity={intakeIntensity}
          profile={profile}
          sessionHistory={state.sessionHistory}
          demoMode={state.demoMode}
          onComplete={(checkIn) =>
            dispatch({ type: "checkInCompleted", checkIn })
          }
        />
      ) : null}

      {state.phase === "reflection" && reflectionContext ? (
        <ReflectionScreen
          reflectionContext={reflectionContext}
          scores={priorScores}
          intakeIntensity={intakeIntensity}
          onPickNextStep={(choice) => {
            dispatch({ type: "nextStepPicked", choice });
            dispatch({ type: "sessionFinished" });
          }}
        />
      ) : null}

      {state.phase === "done" ? (
        <DoneScreen
          plan={state.pickedNextStep}
          intakeIntensity={intakeIntensity}
          finalScore={
            priorScores.length > 0
              ? priorScores[priorScores.length - 1]
              : intakeIntensity
          }
          durationSeconds={reflectionContext?.durationSeconds ?? null}
        />
      ) : null}
    </>
  );
}

/** Bare demo-style screen wrapper: topbar crumb + centered body. */
function PhaseScreen({
  crumb,
  children,
}: {
  crumb: string;
  children: React.ReactNode;
}) {
  return (
    <div className="screen">
      <div className="topbar">
        <span className="crumb">{crumb}</span>
      </div>
      <div className="screen-body">{children}</div>
    </div>
  );
}

type ReflectionState =
  | { kind: "loading"; titles: ReflectionTitle[] }
  | {
      kind: "ready";
      payload: ReflectionPayload;
      source: "model" | "fallback";
    };

const FALLBACK_THINKING_TITLES = [
  "Re-reading your check-ins",
  "Comparing to your last session",
  "Looking for what worked",
  "Writing your reflection",
];

function ReflectionScreen({
  reflectionContext,
  scores,
  intakeIntensity,
  onPickNextStep,
}: {
  reflectionContext: ReflectionContext;
  scores: number[];
  intakeIntensity: number;
  onPickNextStep: (choice: string) => void;
}) {
  const [phaseInput] = useState<ReflectionContext>(reflectionContext);
  const [state, setState] = useState<ReflectionState>({
    kind: "loading",
    titles: [],
  });
  const [stage, setStage] = useState<"askPlan" | "suggestions">("askPlan");
  const [ownPlanDraft, setOwnPlanDraft] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    void generateReflection(phaseInput, {
      signal: controller.signal,
      onTitle: (title) => {
        if (cancelled) return;
        setState((prev) => {
          if (prev.kind !== "loading") return prev;
          if (prev.titles.some((t) => t.index === title.index)) return prev;
          const next = [...prev.titles, title].sort(
            (a, b) => a.index - b.index,
          );
          return { kind: "loading", titles: next };
        });
      },
    })
      .then((result) => {
        if (cancelled) return;
        setState({
          kind: "ready",
          payload: result.payload,
          source: result.source,
        });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (typeof console !== "undefined") {
          console.error("[wave] reflection phase error", err);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [phaseInput]);

  const finalScore =
    scores.length > 0 ? scores[scores.length - 1] : intakeIntensity;
  const drop = intakeIntensity - finalScore;
  const headline =
    drop >= 2
      ? `Your craving fell ${drop} points across the session.`
      : drop >= 1
        ? `Your craving dropped ${drop} point, and you stayed.`
        : "You stayed for the whole wave. That counts.";

  // Streamed titles drive the thinking list; fall back to canonical
  // copy until the first title lands so the list is never empty.
  const thinkingTitles =
    state.kind === "loading" && state.titles.length > 0
      ? state.titles.map((t) => t.text)
      : FALLBACK_THINKING_TITLES;
  const completedCount =
    state.kind === "ready" ? thinkingTitles.length : state.titles.length;

  return (
    <div className="screen">
      <div className="topbar">
        <span className="crumb">Closing · reflection</span>
      </div>
      <div className="screen-body">
        <ScoreArc scores={scores} intakeIntensity={intakeIntensity} />

        {state.kind === "loading" ? (
          <div className="card flush">
            <span className="eyebrow accent">Writing reflection</span>
            <ul className="thinking-list" style={{ marginTop: 8 }}>
              {thinkingTitles.map((t, i) => (
                <li
                  key={t}
                  className={
                    i < completedCount
                      ? "done"
                      : i === completedCount
                        ? "active"
                        : ""
                  }
                >
                  <span className="marker" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <>
            <div className="card flush">
              <span className="eyebrow accent">Reflection</span>
              <h2 className="section" style={{ marginTop: 6 }}>
                {headline}
              </h2>
              <p className="lede" style={{ marginTop: 8 }}>
                {state.payload.insight}
              </p>
              <p
                className="hint"
                style={{ marginTop: 10, fontStyle: "italic" }}
              >
                {state.payload.journalPromptQuestion}
              </p>
            </div>

            {stage === "askPlan" ? (
              <div className="card flush">
                <span className="eyebrow">Next 10 minutes · your plan</span>
                <textarea
                  className="plan-area"
                  style={{ marginTop: 10 }}
                  rows={2}
                  maxLength={160}
                  placeholder="Drink water · step outside · text someone safe…"
                  value={ownPlanDraft}
                  onChange={(e) => setOwnPlanDraft(e.target.value)}
                />
                <div
                  className="btn-row"
                  style={{ marginTop: 10, justifyContent: "flex-end" }}
                >
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => setStage("suggestions")}
                  >
                    No ideas, show options
                  </button>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={ownPlanDraft.trim().length < 2}
                    onClick={() => onPickNextStep(ownPlanDraft.trim())}
                  >
                    Use my plan
                  </button>
                </div>
              </div>
            ) : (
              <div className="card flush">
                <span className="eyebrow">Pick one. Or write your own.</span>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    marginTop: 10,
                  }}
                >
                  {[
                    state.payload.nextSteps.one,
                    state.payload.nextSteps.two,
                    state.payload.nextSteps.three,
                    state.payload.nextSteps.four,
                  ].map((s) => (
                    <button
                      key={s}
                      type="button"
                      className="chip list"
                      onClick={() => onPickNextStep(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn ghost"
                  style={{ marginTop: 8, padding: 0 }}
                  onClick={() => setStage("askPlan")}
                >
                  ← Back to my plan
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function DoneScreen({
  plan,
  intakeIntensity,
  finalScore,
  durationSeconds,
}: {
  plan: string | null;
  intakeIntensity: number;
  finalScore: number;
  durationSeconds: number | null;
}) {
  const drop = intakeIntensity - finalScore;
  const eyebrow =
    drop >= 2
      ? "The wave passed"
      : drop >= 1
        ? "The wave eased"
        : drop === 0
          ? "You watched the wave"
          : "The wave is still here";
  const headline =
    drop >= 1
      ? "You stayed with it."
      : drop === 0
        ? "You stayed for the whole wave."
        : "You met it.";
  const duration =
    durationSeconds != null
      ? `${Math.floor(durationSeconds / 60)}:${String(
          durationSeconds % 60,
        ).padStart(2, "0")}`
      : "—";
  const arc = `${intakeIntensity} → ${finalScore}`;

  return (
    <div className="screen">
      <div className="topbar">
        <span className="crumb" style={{ letterSpacing: "0.28em" }}>
          {eyebrow.toUpperCase()}
        </span>
      </div>
      <div
        className="screen-body"
        style={{
          alignItems: "center",
          textAlign: "center",
          justifyContent: "center",
          gap: 24,
        }}
      >
        <div style={{ flex: 1 }} />

        <h1 className="display big serif" style={{ maxWidth: 320 }}>
          {headline}
        </h1>

        <div
          style={{
            display: "flex",
            gap: 32,
            justifyContent: "center",
            marginTop: 8,
          }}
        >
          <div style={{ textAlign: "center" }}>
            <div className="eyebrow">Duration</div>
            <div
              className="serif"
              style={{
                fontSize: 40,
                color: "var(--wave-crest)",
                marginTop: 4,
                lineHeight: 1,
                textShadow: "0 0 16px rgba(92,225,214,0.4)",
              }}
            >
              {duration}
            </div>
          </div>
          <div style={{ width: 1, background: "var(--ink-ghost)" }} />
          <div style={{ textAlign: "center" }}>
            <div className="eyebrow">Intensity</div>
            <div
              className="serif"
              style={{
                fontSize: 40,
                color: "var(--wave-crest)",
                marginTop: 4,
                lineHeight: 1,
                textShadow: "0 0 16px rgba(92,225,214,0.4)",
              }}
            >
              {arc}
            </div>
          </div>
        </div>

        {plan ? (
          <p className="lede" style={{ maxWidth: 300, marginTop: 4 }}>
            Heading to:{" "}
            <b style={{ color: "var(--ink)", fontStyle: "italic" }}>{plan}</b>
          </p>
        ) : (
          <p
            className="lede"
            style={{ marginTop: 4, fontStyle: "italic" }}
          >
            That&apos;s a complete session.
          </p>
        )}

        <div style={{ flex: 1 }} />

        <div className="btn-stack" style={{ alignSelf: "stretch" }}>
          <Link href="/dashboard" className="btn primary">
            See your dashboard →
          </Link>
          <Link href="/" className="btn ghost">
            Done
          </Link>
        </div>
      </div>
    </div>
  );
}
