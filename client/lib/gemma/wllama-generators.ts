// wllama-backed replacements for the three ONNX Gemma generators that drive
// the clinical session flow (chunk narration, multi-turn check-in,
// reflection). Each function has the same signature as its
// `generateGemma{Chunk,CheckIn,Reflection}` counterpart in
// `./local-runtime.ts` so the callers in `lib/gemma/{chunk,checkin,session}.ts`
// can swap engines by changing one import line.
//
// All three share one wllama instance via `preloadWaveWllama()` so we only
// pay the ~3.2 GB load once across the whole app.
//
// Structured-output strategy:
//   - chunk/reflection: `response_format: { type: 'json_object' }` forces
//     llama.cpp to emit valid JSON. The caller's existing `JSON.parse` +
//     Zod validation pipeline still applies as a defense in depth.
//   - check-in: `response_format: { type: 'json_schema', json_schema }` with
//     a strict schema that wraps the patient-facing reply alongside the
//     optional endConversation signal. We trade streaming for reliable end
//     detection — full JSON has to land before we can extract `reply` for
//     TTS. Acceptable for a turn-based conversation; revisit if first-audio
//     latency hurts the voice UX (Session 3 work).

import { preloadWaveWllama } from "@/lib/wllama";
import { buildCheckInPrompt } from "@/lib/prompts/check-in";
import { buildChunkPrompt } from "@/lib/prompts/chunk-generator";
import { buildInsightsPrompt } from "@/lib/prompts/insights";
import { buildReflectionPrompt } from "@/lib/prompts/reflection";
import {
  chunkLinesJsonSchema,
  reflectionJsonSchema,
  type CheckInContextPayload,
  type ChunkGenerationContextPayload,
  type ReflectionContext,
} from "@/lib/prompts/schemas";
import type {
  CheckInChatTurnPayload,
  EndConversationSignal,
} from "@/lib/gemma/checkin";
import type { ObstacleCategory } from "@/types/session";
import type { Session } from "@/types/models";

interface GenerateOptions {
  maxNewTokens: number;
  signal?: AbortSignal;
  onDelta?: (accumulated: string) => void;
}

export interface LocalCheckInResult {
  text: string;
  endConversation: EndConversationSignal | null;
}

export interface LocalChunkResult {
  text: string;
}

const CHECK_IN_TOOL_NONE_OBSTACLE = "none" as const;
const ALLOWED_OBSTACLES: readonly ObstacleCategory[] = [
  "cannot_visualize",
  "mind_wandering",
  "urge_overwhelming",
  "breath_tight",
  "breath_anxiety",
  "gave_in",
  "guilt_failure",
  "physical_discomfort",
  "sleepiness",
];
const CHECK_IN_TOOL_OBSTACLES = [
  CHECK_IN_TOOL_NONE_OBSTACLE,
  ...ALLOWED_OBSTACLES,
] as const;

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

// ────────────────────────────────────────────────────────────────────────
// Chunk narration
// ────────────────────────────────────────────────────────────────────────

export async function generateWllamaChunk(
  context: ChunkGenerationContextPayload,
  options: GenerateOptions,
): Promise<LocalChunkResult> {
  throwIfAborted(options.signal);
  const wllama = await preloadWaveWllama();
  throwIfAborted(options.signal);

  const prompt = buildChunkPrompt(context);
  const messages: ChatMessage[] = [
    { role: "system", content: prompt.systemPrompt },
    { role: "user", content: prompt.userPrompt },
  ];

  const out = await wllama.createChatCompletion({
    messages,
    max_tokens: Math.max(options.maxNewTokens, 260),
    temperature: 0,
    top_k: 1,
    // Strict json_schema — verified working on the fine-tune via
    // /models/wllama-schema-probe. Loose json_object mode failed in
    // production with array-comma syntax errors because llama.cpp does
    // not strictly enforce JSON shape in that mode for our GGUF.
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "WaveChunkLines",
        schema: chunkLinesJsonSchema,
        strict: true,
      },
    },
    // wllama's non-streaming type doesn't declare `abortSignal` but the
    // runtime checks it in `getRespose()` regardless. Cast keeps abort
    // working without forcing a streaming code path we don't need.
    ...({ abortSignal: options.signal } as { abortSignal?: AbortSignal }),
  });
  throwIfAborted(options.signal);

  const raw = out.choices?.[0]?.message?.content ?? "";
  return { text: extractFirstJsonObject(raw) };
}

// ────────────────────────────────────────────────────────────────────────
// Reflection (final structured card after check-in 5)
// ────────────────────────────────────────────────────────────────────────

export async function generateWllamaReflection(
  input: ReflectionContext,
  options: GenerateOptions,
): Promise<LocalChunkResult> {
  throwIfAborted(options.signal);
  const wllama = await preloadWaveWllama();
  throwIfAborted(options.signal);

  const prompt = buildReflectionPrompt(input);
  const messages: ChatMessage[] = [
    { role: "system", content: prompt.systemPrompt },
    { role: "user", content: prompt.userPrompt },
  ];

  const out = await wllama.createChatCompletion({
    messages,
    max_tokens: Math.max(options.maxNewTokens, 260),
    temperature: 0,
    top_k: 1,
    // Strict json_schema for the same reason as chunk above —
    // verified via /models/wllama-schema-probe.
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "WaveReflection",
        schema: reflectionJsonSchema,
        strict: true,
      },
    },
    ...({ abortSignal: options.signal } as { abortSignal?: AbortSignal }),
  });
  throwIfAborted(options.signal);

  const raw = out.choices?.[0]?.message?.content ?? "";
  return { text: extractFirstJsonObject(raw) };
}

// ────────────────────────────────────────────────────────────────────────
// Insights (cross-session patterns card, /insights page)
// ────────────────────────────────────────────────────────────────────────
//
// Insights wasn't part of the fine-tune training mix, so the WAVE Gemma is
// running this prompt as a generic chat model. Quality is best-effort —
// rely on the Zod validation in `lib/gemma/insights.ts` to catch malformed
// shapes.

export async function generateWllamaInsights(
  sessions: readonly Session[],
  options: GenerateOptions,
): Promise<LocalChunkResult> {
  throwIfAborted(options.signal);
  const wllama = await preloadWaveWllama();
  throwIfAborted(options.signal);

  const prompt = buildInsightsPrompt([...sessions]);
  const messages: ChatMessage[] = [
    { role: "system", content: prompt.systemPrompt },
    { role: "user", content: prompt.userPrompt },
  ];

  const out = await wllama.createChatCompletion({
    messages,
    max_tokens: Math.max(options.maxNewTokens, 620),
    temperature: 0,
    top_k: 1,
    response_format: { type: "json_object" },
    ...({ abortSignal: options.signal } as { abortSignal?: AbortSignal }),
  });
  throwIfAborted(options.signal);

  const raw = out.choices?.[0]?.message?.content ?? "";
  return { text: extractFirstJsonObject(raw) };
}

// ────────────────────────────────────────────────────────────────────────
// Multi-turn check-in (returns patient-facing reply + optional end signal)
// ────────────────────────────────────────────────────────────────────────

const CHECK_IN_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    reply: {
      type: "string",
      description:
        "The patient-facing prose to speak this turn. 1-3 short sentences, no markdown, no lists.",
    },
    endConversation: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["cravingScore", "obstacleCategory"],
          properties: {
            cravingScore: { type: "integer", minimum: 1, maximum: 10 },
            obstacleCategory: {
              type: "string",
              enum: [...CHECK_IN_TOOL_OBSTACLES],
            },
          },
        },
        { type: "null" },
      ],
      description:
        "Set ONLY when this check-in is complete and the patient is ready to continue. Use null otherwise.",
    },
  },
  required: ["reply", "endConversation"],
} as const;

export interface CheckInJsonOutput {
  reply: string;
  endConversation: {
    cravingScore: number;
    obstacleCategory: string;
  } | null;
}

export async function generateWllamaCheckIn(
  history: readonly CheckInChatTurnPayload[],
  context: CheckInContextPayload,
  options: GenerateOptions,
): Promise<LocalCheckInResult> {
  throwIfAborted(options.signal);
  const wllama = await preloadWaveWllama();
  throwIfAborted(options.signal);

  const agentTurnsInHistory = history.filter((t) => t.role === "agent").length;
  const { systemPrompt, contextBlock } = buildCheckInPrompt(context, {
    agentTurnsInHistory,
  });

  const wllamaSystem = `${systemPrompt}

<output_contract>
Respond with a JSON object matching this exact schema:

{
  "reply": "<patient-facing prose, 1-3 short sentences>",
  "endConversation": null | { "cravingScore": <integer 1-10>, "obstacleCategory": "<one of: ${CHECK_IN_TOOL_OBSTACLES.join(", ")}>" }
}

Rules:
- "reply" is the visible patient-facing text the speaker will hear. Plain prose, no markdown, no lists.
- "endConversation" is null UNLESS this check-in is complete and the patient is ready to continue.
- When ending, "obstacleCategory" is "${CHECK_IN_TOOL_NONE_OBSTACLE}" when no clear obstacle is present.
- Emit nothing outside the JSON object — no preamble, no analysis, no extra keys.
</output_contract>`;

  // Gemma's chat template enforces strict user/assistant alternation
  // starting from `user`. The context block has to ride along with the
  // first patient turn (single user message) — sending it as a separate
  // user message before the history fails the template with a Jinja
  // "Conversation roles must alternate" exception, verified empirically
  // via /models/wllama-schema-probe.
  const messages: ChatMessage[] = [
    { role: "system", content: wllamaSystem },
  ];
  if (history.length > 0 && history[0]!.role === "patient") {
    messages.push({
      role: "user",
      content: `${contextBlock}\n\n${history[0]!.content}`,
    });
    for (const turn of history.slice(1)) {
      messages.push({
        role: turn.role === "agent" ? "assistant" : "user",
        content: turn.content,
      });
    }
  } else {
    // No patient turn yet (defensive: shouldn't happen in production
    // since the voice loop calls us after the first STT result). Fall
    // back to the context block as the lone user message.
    messages.push({ role: "user", content: contextBlock });
    for (const turn of history) {
      messages.push({
        role: turn.role === "agent" ? "assistant" : "user",
        content: turn.content,
      });
    }
  }

  // Single blocking JSON-schema generation. The grammar guarantees the
  // { reply, endConversation } shape; we parse the full object once, push
  // the whole reply to onDelta (the hook hands it to Kokoro, which still
  // streams audio sentence-by-sentence via its TextSplitterStream), and
  // read the reliable endConversation signal off the same parse. Token
  // streaming was intentionally not adopted here — see the file header.
  const out = await wllama.createChatCompletion({
    messages,
    max_tokens: Math.max(options.maxNewTokens, 220),
    temperature: 0,
    top_k: 1,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "wave_check_in_turn",
        schema: CHECK_IN_OUTPUT_SCHEMA,
        strict: true,
      },
    },
    ...({ abortSignal: options.signal } as { abortSignal?: AbortSignal }),
  });
  throwIfAborted(options.signal);

  const raw = out.choices?.[0]?.message?.content ?? "";
  const parsed = parseCheckInJson(raw);
  const replyText = sanitizeCheckInModelText(parsed.reply);
  options.onDelta?.(replyText);

  const endConversation = normalizeEndConversation(parsed.endConversation);
  return { text: replyText, endConversation };
}

// ────────────────────────────────────────────────────────────────────────
// helpers
// ────────────────────────────────────────────────────────────────────────

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

export function extractFirstJsonObject(text: string): string {
  // Even with response_format=json_object some llama.cpp builds emit a leading
  // BOS or trailing whitespace. Trim to the outermost {...} to keep callers'
  // JSON.parse happy.
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return text.trim();
  return text.slice(start, end + 1);
}

export function parseCheckInJson(raw: string): CheckInJsonOutput {
  const candidate = extractFirstJsonObject(raw);
  try {
    const parsed = JSON.parse(candidate) as Partial<CheckInJsonOutput>;
    const reply = typeof parsed.reply === "string" ? parsed.reply : "";
    const endConversation =
      parsed.endConversation &&
      typeof parsed.endConversation === "object" &&
      "cravingScore" in parsed.endConversation
        ? parsed.endConversation
        : null;
    return { reply, endConversation };
  } catch {
    // Model leaked plain text despite the schema. Treat the whole thing as the
    // visible reply and let the caller decide whether to retry.
    return { reply: raw.trim(), endConversation: null };
  }
}

export function normalizeEndConversation(
  signal: CheckInJsonOutput["endConversation"],
): EndConversationSignal | null {
  if (!signal) return null;
  const score = Math.round(signal.cravingScore);
  if (!Number.isFinite(score) || score < 1 || score > 10) return null;
  const obstacle = signal.obstacleCategory;
  if (obstacle === CHECK_IN_TOOL_NONE_OBSTACLE) {
    return { cravingScore: score, obstacleCategory: null };
  }
  if (ALLOWED_OBSTACLES.includes(obstacle as ObstacleCategory)) {
    return {
      cravingScore: score,
      obstacleCategory: obstacle as ObstacleCategory,
    };
  }
  return { cravingScore: score, obstacleCategory: null };
}

function sanitizeCheckInModelText(text: string): string {
  return text
    .replace(/\]\s*\[/g, " ")
    .replace(/[\[\]]/g, "")
    .replace(/[–—]/g, ",")
    .replace(/\s+([,.;:?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
