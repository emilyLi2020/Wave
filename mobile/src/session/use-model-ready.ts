// Model-readiness gate. The gemma boundaries (generateChunk etc.)
// self-preload the LiteRT instance, but the first call would otherwise
// block silently while the ~multi-hundred-MB bundle downloads + loads.
// This hook surfaces that as progress so the flow can show a load state.
//
// preloadWaveLiteRT is memoized in litert-generators, so calling it here
// and then calling generateChunk reuses the exact same resident instance
// (no double load).

import { useEffect, useRef, useState } from "react";

import { preloadWaveLiteRT } from "@/runtime/litert-generators";

export type ModelReadyState =
  | { status: "loading"; pct: number }
  | { status: "ready" }
  | { status: "error"; message: string };

export function useModelReady(): ModelReadyState {
  const [state, setState] = useState<ModelReadyState>({ status: "loading", pct: 0 });
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    let alive = true;
    preloadWaveLiteRT({
      onProgress: (pct) => {
        if (alive) setState({ status: "loading", pct });
      },
    })
      .then(() => {
        if (alive) setState({ status: "ready" });
      })
      .catch((err: unknown) => {
        if (alive) {
          setState({
            status: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  return state;
}
