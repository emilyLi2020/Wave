"use client";

/**
 * Session shell for the five-chunk urge surfing flow.
 *
 *   intake → safety → loop(loadingChunk → chunk N → check-in N) for N=1..5 → reflection → done
 *
 * Both the chunk narration and the check-in agent are now LLM-driven.
 *   - Each chunk's lines come from `generateChunk()`. The generator
 *     receives the patient profile + the FULL prior session history
 *     (every prior chunk's lines + every prior check-in's transcript)
 *     so the new narration can ground itself in what the patient has
 *     already heard and said.
 *   - Each check-in is a multi-turn LLM conversation that ends when
 *     the model calls the `endConversation` tool. There is no
 *     regex-based readiness gate — the chat surface treats the tool
 *     call as the "we're done" signal.
 *
 * The ambient audio bed is mounted ONCE here at the shell so it never
 * restarts on a chunk → check-in → chunk transition (PRD § Risk Areas
 * #6, audio continuity invariant). It starts on the intake "Continue"
 * gesture (which doubles as the audio-context unlock) and fades out at
 * the reflection screen.
 */

import Link from "next/link";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";

import { AmbientAudioBed, type AmbientAudioBedHandle } from "./ambient-audio-bed";
import { ChunkPlayer } from "./chunk-player";
import { VoiceCheckIn } from "./voice-check-in";
import { IntakeForm, type IntakeAnswers } from "./intake-form";
import { NarrationCard } from "./narration-card";
import { NextStepChips } from "./next-step-chips";
import { ReflectionProgress } from "./reflection-progress";
import { RelaxingLoader } from "./relaxing-loader";
import { SafetyHandoff } from "./safety-handoff";
import { SafetyScreen, type SafetyOutcome } from "./safety-screen";
import { ScoreArc } from "./score-arc";

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
      // Hand off to the chunk loader. The RelaxingLoader stays on
      // screen with soft breath cues until the next scripted chunk is
      // ready. There is no fixed-duration countdown.
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

  // Drive chunk generation whenever we enter the loadingChunk phase.
  // The RelaxingLoader is the patient-facing cover during this wait.
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

  const showAmbientToggle =
    state.phase === "loadingChunk" ||
    state.phase === "chunk" ||
    state.phase === "checkIn";

  // Footer "Skip ahead" — only meaningful during the chunk player and
  // the voice check-in (intake & safety stay required; loading has
  // nothing to skip). Chunk → jump to the check-in. Check-in → close
  // it with the score we already have for this chunk (last reported
  // score, or intake intensity before the first check-in) and no
  // obstacle, so session history, scoring and the reflection all stay
  // valid without holding the patient in the conversation.
  const canSkipAhead =
    state.phase === "chunk" || state.phase === "checkIn";

  const handleSkipAhead = () => {
    if (state.phase === "chunk") {
      dispatch({ type: "chunkCompleted" });
      return;
    }
    if (state.phase === "checkIn") {
      const now = Date.now();
      dispatch({
        type: "checkInCompleted",
        checkIn: {
          chunkNumber: state.currentChunk,
          cravingScore: currentIntensity,
          turns: [],
          obstacleCategory: null,
          readyToContinue: state.currentChunk === 5 ? null : true,
          startedAt: now,
          endedAt: now,
        },
      });
    }
  };

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

  return (
    <div className="space-y-8">
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

      {state.phase === "safetyHandoff" ? <SafetyHandoff /> : null}

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
        <div className="space-y-4">
          <ScoreArc scores={priorScores} intakeIntensity={intakeIntensity} />
          <ReflectionPhaseBlock
            reflectionContext={reflectionContext}
            onPickNextStep={(choice) => {
              dispatch({ type: "nextStepPicked", choice });
              dispatch({ type: "sessionFinished" });
            }}
          />
        </div>
      ) : null}

      {state.phase === "done" ? (
        <article className="rounded-2xl border border-border bg-surface p-8 text-center">
          <h2 className="text-xl font-semibold">
            You stayed for the whole wave.
          </h2>
          <p className="mt-2 text-foreground/70">
            {state.pickedNextStep
              ? `Heading to: ${state.pickedNextStep}.`
              : "That's a complete session."}
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <Link
              href="/dashboard"
              className="rounded-full bg-accent px-5 py-2.5 text-accent-foreground font-medium hover:opacity-90"
            >
              See dashboard →
            </Link>
            <Link
              href="/"
              className="rounded-full border border-border px-5 py-2.5 hover:border-accent hover:text-accent"
            >
              Home
            </Link>
          </div>
        </article>
      ) : null}

      <SessionFooter
        phase={state.phase}
        canSkipAhead={canSkipAhead}
        onSkipAhead={handleSkipAhead}
      />
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

function ReflectionPhaseBlock({
  reflectionContext,
  onPickNextStep,
}: {
  reflectionContext: ReflectionContext;
  onPickNextStep: (choice: string) => void;
}) {
  const [phaseInput] = useState<ReflectionContext>(reflectionContext);
  const [state, setState] = useState<ReflectionState>({
    kind: "loading",
    titles: [],
  });

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

  if (state.kind === "loading") {
    return <ReflectionProgress titles={state.titles} />;
  }

  return (
    <ReflectionPlanAndSuggestions
      payload={state.payload}
      source={state.source}
      onPickNextStep={onPickNextStep}
    />
  );
}

function ReflectionPlanAndSuggestions({
  payload,
  source,
  onPickNextStep,
}: {
  payload: ReflectionPayload;
  source: "model" | "fallback";
  onPickNextStep: (choice: string) => void;
}) {
  const [stage, setStage] = useState<"askPlan" | "suggestions">("askPlan");
  const [ownPlanDraft, setOwnPlanDraft] = useState("");
  const nextStepOptions = [
    payload.nextSteps.one,
    payload.nextSteps.two,
    payload.nextSteps.three,
    payload.nextSteps.four,
  ];

  const trimmedPlan = ownPlanDraft.trim();
  const canUseOwnPlan = trimmedPlan.length >= 2;

  return (
    <NarrationCard
      title="Reflection"
      badge="Closing"
      loading={false}
      source={source}
      footer={
        stage === "askPlan" ? (
          <div className="space-y-3">
            <p className="text-sm text-foreground/70">
              What feels doable in the next 10 minutes? Name anything that fits,
              even a tiny step. If nothing comes to mind, you can see four
              gentle ideas to pick from.
            </p>
            <label className="block text-xs font-medium text-foreground/55">
              Your plan (optional)
              <textarea
                value={ownPlanDraft}
                onChange={(event) => setOwnPlanDraft(event.target.value)}
                rows={2}
                maxLength={160}
                placeholder="e.g. drink water, step outside, text someone safe"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground/90 focus:outline-none focus:border-accent"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!canUseOwnPlan}
                onClick={() => onPickNextStep(trimmedPlan)}
                className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 transition disabled:cursor-not-allowed disabled:opacity-40"
              >
                Use my plan
              </button>
              <button
                type="button"
                onClick={() => setStage("suggestions")}
                className="rounded-full border border-border bg-surface-muted px-4 py-2 text-sm font-medium text-foreground/85 hover:border-accent hover:text-accent transition"
              >
                No ideas, show suggestions
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-foreground/70">
              Four gentle options. Pick one, or go back to write your own.
            </p>
            <NextStepChips
              options={nextStepOptions}
              onPick={onPickNextStep}
            />
            <button
              type="button"
              onClick={() => setStage("askPlan")}
              className="text-xs text-foreground/55 hover:text-accent underline-offset-2 hover:underline"
            >
              Back to my own plan
            </button>
          </div>
        )
      }
    >
      <div className="space-y-3">
        <p>{payload.insight}</p>
        <p className="text-sm text-foreground/70">
          {payload.journalPromptQuestion}
        </p>
      </div>
    </NarrationCard>
  );
}

function SessionFooter({
  phase,
  canSkipAhead,
  onSkipAhead,
}: {
  phase: Phase;
  canSkipAhead: boolean;
  onSkipAhead: () => void;
}) {
  if (phase === "done" || phase === "safetyHandoff") return null;
  return (
    <div className="flex items-center justify-between pt-4">
      {canSkipAhead ? (
        <button
          type="button"
          onClick={onSkipAhead}
          className="text-sm text-foreground/60 transition hover:text-accent focus:text-accent focus:outline-none"
        >
          Skip ahead →
        </button>
      ) : (
        <span />
      )}
      <Link
        href="/"
        className="text-sm text-foreground/60 hover:text-accent"
      >
        Leave session →
      </Link>
    </div>
  );
}
