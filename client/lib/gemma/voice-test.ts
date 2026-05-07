import {
  generateGemmaVoiceTestTurn,
  type ChatMessage,
} from "@/lib/gemma/local-runtime";

const MAX_VOICE_TEST_ATTEMPTS = 1;

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

export async function generateVoiceTestReply(
  options: GenerateVoiceTestReplyOptions,
): Promise<GenerateVoiceTestReplyResult> {
  const startedAt = performance.now();
  const history = options.history.map(toGemmaMessage);

  for (let attempt = 0; attempt < MAX_VOICE_TEST_ATTEMPTS; attempt += 1) {
    try {
      const result = await generateGemmaVoiceTestTurn(
        history,
        {
          maxNewTokens: 90,
          signal: options.signal,
          onDelta: options.onDelta,
        },
        buildMockCheckInSystemPrompt(),
      );

      if (result.text.trim().length > 0) {
        return {
          text: result.text,
          source: "model",
          elapsedMs: Math.round(performance.now() - startedAt),
          errorMessage: null,
        };
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      return {
        text: "I heard you. The local Gemma check-in reply failed, but the voice loop kept running.",
        source: "fallback",
        elapsedMs: Math.round(performance.now() - startedAt),
        errorMessage:
          err instanceof Error ? err.message : "Unknown Gemma voice-test error.",
      };
    }
  }

  return {
    text: "I heard you. The local Gemma check-in reply was empty, but the voice loop kept running.",
    source: "fallback",
    elapsedMs: Math.round(performance.now() - startedAt),
    errorMessage: "Gemma returned an empty voice-test reply.",
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

function toGemmaMessage(turn: VoiceTestTurn): ChatMessage {
  return {
    role: turn.role,
    content: turn.content,
  };
}
