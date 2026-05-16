/**
 * Reflection boundary for the mounted session flow.
 *
 * Chunk narration, check-ins, and insights each have their own Gemma
 * boundary. This file now only owns the final structured reflection
 * card shown after check-in 5.
 */

import { generateWllamaReflection as generateGemmaReflection } from "@/runtime/litert-generators";
import { fallbackReflection } from "@/lib/prompts/fallback-bank";
import {
  reflectionPayloadSchema,
  type ReflectionContext,
  type ReflectionPayload,
} from "@/lib/prompts/schemas";

const MAX_MODEL_ATTEMPTS = 2;
type GemmaReflectionGenerator = typeof generateGemmaReflection;

function sanitizePatientFacingText(text: string): string {
  return text
    .replace(/\]\s*\[/g, " ")
    .replace(/[\[\]]/g, "")
    .replace(/[–—]/g, ",")
    .replace(/\s+([,.;:?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeStructuredPayload<T>(value: T): T {
  if (typeof value === "string") {
    return sanitizePatientFacingText(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeStructuredPayload(item)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        sanitizeStructuredPayload(entry),
      ]),
    ) as T;
  }
  return value;
}

export type GenerateReflectionResult = {
  payload: ReflectionPayload;
  source: "model" | "fallback";
  attempts: number;
};

export interface ReflectionTitle {
  /** Stable index for the progress title. */
  index: number;
  /** Short human-readable section heading. */
  text: string;
}

export interface GenerateReflectionOptions {
  /**
   * Optional AbortSignal so a phase that gets cancelled, for example
   * when the patient leaves the session early, does not finish a stale
   * model call.
   */
  signal?: AbortSignal;
  /**
   * Called with small synthetic progress milestones while Gemma is
   * composing the structured reflection.
   */
  onTitle?: (title: ReflectionTitle) => void;
  /**
   * Optional generator override for tests and non-browser smoke checks.
   * Production callers use the local Gemma runtime import above.
   */
  generate?: GemmaReflectionGenerator;
}

export async function generateReflection(
  input: ReflectionContext,
  options: GenerateReflectionOptions = {},
): Promise<GenerateReflectionResult> {
  let attempts = 0;
  let lastError: unknown = null;
  const generate = options.generate ?? generateGemmaReflection;

  while (attempts < MAX_MODEL_ATTEMPTS) {
    attempts += 1;
    try {
      if (attempts === 1) {
        options.onTitle?.({ index: 0, text: "Reading the session arc" });
        options.onTitle?.({ index: 1, text: "Choosing next steps" });
      }

      const result = await generate(input, {
        signal: options.signal,
        maxNewTokens: 260,
      });

      const payload: unknown = JSON.parse(result.text);
      const validated = reflectionPayloadSchema.safeParse(payload);
      if (!validated.success) {
        lastError = validated.error;
        continue;
      }

      return {
        payload: sanitizeStructuredPayload(validated.data),
        source: "model",
        attempts,
      };
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw err;
      }
      lastError = err;
    }
  }

  if (typeof console !== "undefined") {
    console.warn(
      `[wave] generateReflection falling back after ${attempts} attempts`,
      lastError,
    );
  }

  options.onTitle?.({ index: 0, text: "Pulling a saved reflection" });

  return {
    payload: sanitizeStructuredPayload(fallbackReflection(input)),
    source: "fallback",
    attempts,
  };
}
