"use client";

/**
 * @deprecated Legacy StreamedNarration wrapper for the body-scan and
 * three wave sub-phases. The streaming surface for the new flow is the
 * multi-turn check-in chat (`check-in-chat.tsx` + `streamCheckInTurn`
 * in `client/lib/gemma/checkin.ts`); the chunk meditation copy is
 * scripted, not streamed. Slated for removal in a follow-up cleanup
 * PR. Do not import from here in new code.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

import { generateText } from "@/lib/gemma/session";
import type {
  PhaseInputMap,
  TextNarrationPhase,
} from "@/lib/prompts/schemas";

interface Props<P extends TextNarrationPhase> {
  phase: P;
  input: PhaseInputMap[P];
  /**
   * Render the narration. Called continuously while text streams in
   * (`isStreaming = true`) and once more when the stream completes
   * (`isStreaming = false`). The `source` flag is only meaningful when
   * `isStreaming` is false; during streaming it is always "model" and
   * the UI should not lean on it.
   */
  children: (
    text: string,
    source: "model" | "fallback",
    isStreaming: boolean,
  ) => ReactNode;
  /**
   * Placeholder rendered before the first delta arrives. Defaults to
   * NarrationCard's built-in loading copy via the consumer.
   */
  loadingFallback?: ReactNode;
}

type State =
  | { kind: "loading" }
  | { kind: "streaming"; text: string }
  | { kind: "ready"; text: string; source: "model" | "fallback" };

/**
 * Streaming companion to NarratedPhase. Wraps generateText() and
 * surfaces partial text to the render prop as it arrives. Aborts
 * in-flight requests when the phase unmounts so the patient never sees
 * a stale stream after navigating away.
 *
 * The parent is expected to pass a stable `input` object — wave phases
 * snapshot waveContext at phase entry so live slider movement does not
 * re-trigger the stream. Body-scan does the same with the picked
 * region.
 */
export function StreamedNarration<P extends TextNarrationPhase>({
  phase,
  input,
  children,
  loadingFallback,
}: Props<P>) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const requestKeyRef = useRef(0);

  useEffect(() => {
    const requestId = ++requestKeyRef.current;
    const controller = new AbortController();
    setState({ kind: "loading" });

    void generateText(phase, input, {
      signal: controller.signal,
      onDelta: (accumulated) => {
        if (requestId !== requestKeyRef.current) return;
        setState({ kind: "streaming", text: accumulated });
      },
    })
      .then((result) => {
        if (requestId !== requestKeyRef.current) return;
        setState({
          kind: "ready",
          text: result.text,
          source: result.source,
        });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (typeof console !== "undefined") {
          console.error(`[wave] streamed-narration error for ${phase}`, err);
        }
      });

    return () => {
      controller.abort();
    };
  }, [phase, input]);

  if (state.kind === "loading") {
    return <>{loadingFallback}</>;
  }
  if (state.kind === "streaming") {
    return <>{children(state.text, "model", true)}</>;
  }
  return <>{children(state.text, state.source, false)}</>;
}
