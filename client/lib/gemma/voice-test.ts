// Voice-loop LLM runtime for the developer voice-test page
// (`/models/voice-test`). Generates patient-facing replies from the WAVE
// fine-tune GGUF via the shared wllama instance in @/lib/wllama/wave-instance.
// The clinical session uses the same shared wllama instance through its own
// generators in @/lib/gemma/wllama-generators.

import {
  getWaveWllamaLoadState,
  preloadWaveWllama,
  subscribeWaveWllamaLoad,
  type WaveWllamaLoadState,
} from "@/lib/wllama";
import {
  buildMockCheckInSystemPrompt,
  MOCK_VOICE_CHECK_IN_SESSION,
  type MockVoiceCheckInSession,
} from "@/lib/gemma/voice-test-prompt";

// Re-exported so existing importers of voice-test.ts keep working; the
// definitions now live in the pure ./voice-test-prompt module.
export {
  buildMockCheckInSystemPrompt,
  MOCK_VOICE_CHECK_IN_SESSION,
  type MockVoiceCheckInSession,
};

const MAX_VOICE_TEST_ATTEMPTS = 1;
const VOICE_TEST_MAX_TOKENS = 220;

export interface VoiceTestTurn {
  role: "user" | "assistant";
  content: string;
}

export interface GenerateVoiceTestReplyOptions {
  history: readonly VoiceTestTurn[];
  signal?: AbortSignal;
  onDelta?: (accumulated: string) => void;
}

export interface GenerateVoiceTestReplyResult {
  text: string;
  source: "model" | "fallback";
  elapsedMs: number;
  errorMessage: string | null;
}

// Re-exported under the page's local name so voice-test-client.tsx can stay
// unchanged. Both names point at the same shared singleton in @/lib/wllama.
export type VoiceTestLlmLoadState = WaveWllamaLoadState;

export function getVoiceTestLlmLoadState(): VoiceTestLlmLoadState {
  return getWaveWllamaLoadState();
}

export function subscribeVoiceTestLlmLoad(
  listener: (state: VoiceTestLlmLoadState) => void,
): () => void {
  return subscribeWaveWllamaLoad(listener);
}

export const preloadVoiceTestLlm = preloadWaveWllama;

export async function generateVoiceTestReply(
  options: GenerateVoiceTestReplyOptions,
): Promise<GenerateVoiceTestReplyResult> {
  const startedAt = performance.now();

  for (let attempt = 0; attempt < MAX_VOICE_TEST_ATTEMPTS; attempt += 1) {
    try {
      const wllama = await preloadVoiceTestLlm();
      throwIfAborted(options.signal);

      // Gemma's chat template requires strict user/assistant alternation
      // starting from `user`. The mock check-in seeds the transcript with an
      // assistant opener for UX, but that synthetic turn isn't a real model
      // response — drop any leading assistant turn(s) before handing the
      // history to wllama. The opener is still in the system prompt's
      // <mock_session_context>, so the model knows it was said.
      const historyForLlm = dropLeadingAssistant(options.history);
      if (historyForLlm.length === 0) {
        return {
          text: "",
          source: "fallback",
          elapsedMs: Math.round(performance.now() - startedAt),
          errorMessage: "No user turn yet; nothing to reply to.",
        };
      }

      const messages = [
        { role: "system" as const, content: buildMockCheckInSystemPrompt() },
        ...historyForLlm.map(toChatMessage),
      ];

      let accumulated = "";
      const stream = await wllama.createChatCompletion({
        messages,
        max_tokens: VOICE_TEST_MAX_TOKENS,
        temperature: 0,
        top_k: 1,
        stream: true,
        abortSignal: options.signal,
        onData: (chunk) => {
          const delta = chunk.choices?.[0]?.delta?.content;
          if (typeof delta !== "string" || delta.length === 0) return;
          accumulated += delta;
          options.onDelta?.(sanitizeVoiceTestText(accumulated));
        },
      });

      for await (const _chunk of stream) {
        if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      }

      const text = sanitizeVoiceTestText(accumulated);
      if (text.length > 0) {
        return {
          text,
          source: "model",
          elapsedMs: Math.round(performance.now() - startedAt),
          errorMessage: null,
        };
      }
    } catch (err) {
      if (isAbortError(err)) {
        throw new DOMException("Aborted", "AbortError");
      }
      return {
        text: "I heard you. The local Gemma check-in reply failed, but the voice loop kept running.",
        source: "fallback",
        elapsedMs: Math.round(performance.now() - startedAt),
        errorMessage:
          err instanceof Error ? err.message : "Unknown wllama voice-test error.",
      };
    }
  }

  return {
    text: "I heard you. The local Gemma check-in reply was empty, but the voice loop kept running.",
    source: "fallback",
    elapsedMs: Math.round(performance.now() - startedAt),
    errorMessage: "wllama returned an empty voice-test reply.",
  };
}

function toChatMessage(turn: VoiceTestTurn): {
  role: "user" | "assistant";
  content: string;
} {
  return { role: turn.role, content: turn.content };
}

function dropLeadingAssistant(
  history: readonly VoiceTestTurn[],
): VoiceTestTurn[] {
  let i = 0;
  while (i < history.length && history[i].role === "assistant") i += 1;
  return history.slice(i);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

function isAbortError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return true;
  if (err instanceof Error && err.name === "WllamaAbortError") return true;
  return false;
}

function sanitizeVoiceTestText(text: string): string {
  return text
    .replace(/<\|think\|>[\s\S]*?<\/?\|think\|>/g, "")
    .replace(/<\|think\|>[\s\S]*$/g, "")
    .replace(/\]\s*\[/g, " ")
    .replace(/[\[\]{}]/g, "")
    .replace(/[–—]/g, ",")
    .replace(/\s+([,.;:?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
