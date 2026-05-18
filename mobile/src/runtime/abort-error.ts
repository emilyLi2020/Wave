// Hermes has no `DOMException`. The ported web code used
// `new DOMException("Aborted", "AbortError")` + `err instanceof
// DOMException` for cancellation, which throws
// `ReferenceError: Property 'DOMException' doesn't exist` on device the
// moment any generator's catch path is taken — surfacing as a bogus
// "generation error" even when the model produced output fine.
//
// This is the Hermes-safe equivalent: a plain Error subclass named
// "AbortError" plus a duck-typed guard.

export class AbortError extends Error {
  constructor(message = "Aborted") {
    super(message);
    this.name = "AbortError";
  }
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}
