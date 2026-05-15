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

const MAX_VOICE_TEST_ATTEMPTS = 1;
const VOICE_TEST_MAX_TOKENS = 220;

export interface MockVoiceCheckInSession {
  title: string;
  checkInNumber: number;
  intakeIntensity: number;
  currentScore: number;
  matType: string;
  medicationStatus: string;
  trigger: string;
  usedSubstanceToday: boolean;
  priorChunk: string;
  nextPhase: string;
  opener: string;
}

export const MOCK_VOICE_CHECK_IN_SESSION: MockVoiceCheckInSession = {
  title: "Mock Check-in 2 after body scan",
  checkInNumber: 2,
  intakeIntensity: 7,
  currentScore: 6,
  matType: "Buprenorphine / Suboxone",
  medicationStatus: "took today's dose on time",
  trigger: "stress",
  usedSubstanceToday: false,
  priorChunk:
    "The patient just completed a short body scan and was invited to notice where the urge shows up without fighting it.",
  nextPhase: "the sound anchor",
  opener:
    "How intense is the craving now, rate from 1 to 10?",
};

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

function buildMockCheckInSystemPrompt(): string {
  const mock = MOCK_VOICE_CHECK_IN_SESSION;
  return [
    "You are WAVE's developer-only voice check-in test.",
    "This is a mocked check-in session used only to test STT, local Gemma, and TTS. It is not medical advice.",
    "",
    "<mock_session_context>",
    `Scenario: ${mock.title}`,
    `Check-in: ${mock.checkInNumber} of 5`,
    `Intake craving: ${mock.intakeIntensity} / 10`,
    `Current expected score: about ${mock.currentScore} / 10`,
    `Medication context: ${mock.matType}, ${mock.medicationStatus}`,
    `Trigger: ${mock.trigger}`,
    `Used substance today: ${mock.usedSubstanceToday ? "yes" : "no"}`,
    `Prior chunk: ${mock.priorChunk}`,
    `Next phase after this check-in: ${mock.nextPhase}`,
    `The assistant already opened with: "${mock.opener}"`,
    "</mock_session_context>",
    "",
    "<conversation_rules>",
    "- Treat the user's spoken turns as patient replies inside this mock WAVE check-in.",
    "- Keep every reply to 1-3 short spoken sentences, plain prose, no markdown, no lists.",
    "- Validate first. Do not offer a technique before reflecting what the patient said.",
    "- Ask one concrete question at a time.",
    "- If the patient gives only a score, reflect the score and ask where the urge is showing up or what stood out during the body scan.",
    "- If the patient names a body sensation, offer one brief body-based practice, then ask what they notice.",
    "- If the patient reports how the practice landed, ask whether they are ready to continue with the next phase.",
    "- If the patient clearly says they are ready, give a warm hand-off with no question.",
    "- Never prescribe medication, recommend a dose change, or shame a missed dose.",
    "- Do not use toxic positivity, exclamation points, em dashes, bracketed stage directions, or implementation details.",
    "- If the patient mentions active suicidality, overdose risk, trouble breathing, or being physically unwell after substance use, pause the mock check-in and tell them to contact emergency services, 988, or SAMHSA's National Helpline at 1-800-662-HELP.",
    "</conversation_rules>",
  ].join("\n");
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
