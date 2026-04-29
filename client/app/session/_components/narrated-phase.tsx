"use client";

/**
 * @deprecated Legacy NarratedPhase wrapper for the JSON-narration
 * phases (med-ack and reflection). The five-chunk session shell no
 * longer mounts a generic per-phase wrapper; reflection is rendered
 * directly by `session-machine.tsx` and med-ack was folded into the
 * multi-turn check-in chat. Slated for removal in a follow-up cleanup
 * PR. Do not import from here in new code.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

import { generateJSON } from "@/lib/gemma/session";
import type {
  JSONNarrationPhase,
  PhaseInputMap,
  PhasePayloadMap,
} from "@/lib/prompts/schemas";

interface Props<P extends JSONNarrationPhase> {
  phase: P;
  input: PhaseInputMap[P];
  /**
   * Render the narration once it's available. The render function receives
   * the typed payload plus a `source` flag so the UI can mark fallback copy.
   */
  children: (
    payload: PhasePayloadMap[P],
    source: "model" | "fallback",
  ) => ReactNode;
  /**
   * The placeholder shown while generateJSON is running. Defaults to a
   * short "writing…" string handled by NarrationCard, but a parent can
   * override (e.g. to keep the wave animation visible).
   */
  loadingFallback?: ReactNode;
}

/**
 * Generic narrated-phase shell. Calls generateJSON on mount + when the
 * input changes, aborts in-flight calls when the phase unmounts, and
 * hands the validated payload to the render prop. The model-vs-fallback
 * provenance is forwarded so the UI can show a subtle "offline narration"
 * badge when the scripted bank is in use (PRD.md > Risk Areas > WebGPU).
 */
export function NarratedPhase<P extends JSONNarrationPhase>({
  phase,
  input,
  children,
  loadingFallback,
}: Props<P>) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; payload: PhasePayloadMap[P]; source: "model" | "fallback" }
  >({ kind: "loading" });
  const requestKeyRef = useRef(0);

  useEffect(() => {
    const requestId = ++requestKeyRef.current;
    const controller = new AbortController();
    setState({ kind: "loading" });

    void generateJSON(phase, input, { signal: controller.signal })
      .then((result) => {
        if (requestId !== requestKeyRef.current) return;
        setState({
          kind: "ready",
          payload: result.payload,
          source: result.source,
        });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (typeof console !== "undefined") {
          console.error(`[wave] narrated-phase error for ${phase}`, err);
        }
      });

    return () => {
      controller.abort();
    };
  }, [phase, input]);

  if (state.kind === "loading") {
    return <>{loadingFallback}</>;
  }
  return <>{children(state.payload, state.source)}</>;
}
