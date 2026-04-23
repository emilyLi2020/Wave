/**
 * /api/checkin — TEMPORARY scaffolding (multi-turn check-in chat).
 *
 * Streams the next agent turn for the multi-turn check-in chat. The
 * production WAVE session path runs Gemma 4 E2B-it + a check-in LoRA
 * fully in the browser via @huggingface/transformers + WebGPU
 * (PRD.md > Backend Needed?, AGENTS.md > Tech Stack). This Route
 * Handler exists only until that in-browser stack lands; it stands in
 * by calling OpenAI gpt-5-mini server-side using the same
 * WAVE_SYSTEM_PROMPT and buildCheckInPrompt() that the Gemma path
 * will use.
 *
 * Tool calling
 *   The check-in agent has exactly one tool: `endConversation`. The
 *   model calls it when it judges the conversation is complete (the
 *   patient has confirmed readiness for the next chunk, or — at
 *   Check-in 5 — has shared a closing 'carry forward' reply). When
 *   the upstream stream emits the function-call output item, this
 *   route forwards it as a dedicated SSE `end_conversation` event
 *   carrying the tool args (cravingScore + obstacleCategory). The
 *   client treats that event as the readiness gate.
 *
 * Wire format (SSE):
 *   event: delta
 *   data: {"text": "<chunk>"}
 *
 *   event: end_conversation
 *   data: {"cravingScore": 7, "obstacleCategory": "mind_wandering" | null}
 *
 *   event: done
 *   data: {"text": "<full aggregated text>"}
 *
 *   event: error
 *   data: {"message": "..."}
 *
 * `end_conversation` may arrive before, after, or interleaved with
 * the final `done`. The client is responsible for treating
 * `end_conversation` as the canonical "check-in is over" signal —
 * `done` only marks the end of the streamed text.
 *
 * Security:
 *   - `OPENAI_API_KEY` is read only from `process.env` (server-side).
 *   - This route never logs the patient's chat content or the model's
 *     reply. PHI-adjacent payloads must not leave the request lifetime.
 */

import { NextResponse } from "next/server";
import OpenAI from "openai";

import { buildCheckInPrompt } from "@/lib/prompts/check-in";
import {
  checkInRequestSchema,
  type CheckInRequest,
} from "@/lib/prompts/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = "gpt-5-mini";

let cachedClient: OpenAI | null = null;
function getClient(): OpenAI {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set. Copy client/.env.local.example to client/.env.local and fill it in. This is temporary scaffolding; see docs/gemma-capabilities.md.",
    );
  }
  cachedClient = new OpenAI({ apiKey });
  return cachedClient;
}

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

type ResponseInputItem =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string };

function buildResponseInput(req: CheckInRequest): ResponseInputItem[] {
  const { systemPrompt, contextBlock } = buildCheckInPrompt(req.context);

  const items: ResponseInputItem[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: contextBlock },
  ];

  for (const turn of req.history) {
    if (turn.role === "agent") {
      items.push({ role: "assistant", content: turn.content });
    } else {
      items.push({ role: "user", content: turn.content });
    }
  }

  return items;
}

const END_CONVERSATION_TOOL = {
  type: "function" as const,
  name: "endConversation",
  description:
    "Call this exactly once when the check-in conversation is complete and the patient is ready to move into the next chunk (or, at Check-in 5, has shared a final 'carry forward' reply). After calling, the system advances out of the check-in surface; do not produce any further text.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["cravingScore", "obstacleCategory"],
    properties: {
      cravingScore: {
        type: "integer",
        minimum: 1,
        maximum: 10,
        description:
          "The craving score the patient reported at the start of this check-in (the slider value). Echo it back so the system has it.",
      },
      obstacleCategory: {
        type: ["string", "null"],
        enum: [
          "cannot_visualize",
          "mind_wandering",
          "urge_overwhelming",
          "breath_tight",
          "breath_anxiety",
          "gave_in",
          "guilt_failure",
          "physical_discomfort",
          "sleepiness",
          null,
        ],
        description:
          "Your best classification of what got in the way during the chunk that just finished, or null if no clear obstacle came up.",
      },
    },
  },
};

interface EndConversationArgs {
  cravingScore: number;
  obstacleCategory: string | null;
}

function safeParseToolArgs(raw: string): EndConversationArgs | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const score = Number(parsed.cravingScore);
    const obstacle = parsed.obstacleCategory;
    if (!Number.isInteger(score) || score < 1 || score > 10) return null;
    return {
      cravingScore: score,
      obstacleCategory:
        typeof obstacle === "string" ? obstacle : obstacle === null ? null : null,
    };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = checkInRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const req = parsed.data;
  const input = buildResponseInput(req);

  // Minimum patient-message count before an `endConversation` tool
  // call is allowed to leave this route. Suppressing it server-side
  // is a safety net so a prompt-drift bug can't short-circuit the
  // check-in and jump straight to the next chunk with no conversation
  // visible to the patient.
  //
  //   demo   : score + 1 free-text reply = 2 patient messages minimum
  //   normal : score + 2 free-text replies = 3 patient messages minimum
  const patientMessageCount = req.history.filter(
    (turn) => turn.role === "patient",
  ).length;
  const minPatientMessages = req.context.demoMode ? 2 : 3;
  const toolCallAllowed = patientMessageCount >= minPatientMessages;

  let client: OpenAI;
  try {
    client = getClient();
  } catch (err) {
    return NextResponse.json(
      { error: "openai_not_configured", message: (err as Error).message },
      { status: 500 },
    );
  }

  const encoder = new TextEncoder();
  const upstreamAbort = new AbortController();
  const onClientAbort = () => upstreamAbort.abort();
  request.signal.addEventListener("abort", onClientAbort, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let aggregated = "";
      let finished = false;
      // Function-call args stream in deltas keyed by item_id; collect
      // them and parse on the matching `output_item.done`.
      const toolArgBuffer = new Map<string, string>();
      try {
        // In demo mode the agent only ever produces text — the
        // 4-turn demo pattern (user → AI text → user → AI text → jump)
        // is driven by a client-side backstop in CheckInChat that
        // synthesizes the end-conversation signal after the AI's 2nd
        // text turn completes. Removing the tool from the request
        // avoids a known failure mode where the model picks tool-only
        // OR text-only when asked to do both, leaving the patient
        // staring at a silent transition.
        const useTool = !req.context.demoMode;
        const events = await client.responses.create(
          {
            model: MODEL,
            input,
            text: { format: { type: "text" } },
            ...(useTool
              ? { tools: [END_CONVERSATION_TOOL], tool_choice: "auto" as const }
              : {}),
            stream: true,
            // Multi-turn check-in conversation. `low` (rather than
            // `minimal`) is enough budget for the model to remember
            // the multi-step rule "produce a brief closing text AND
            // call endConversation in the same turn" on the closing
            // beat — at `minimal` the model reliably picks one or the
            // other but flakes on doing both. The added latency is on
            // the order of a few hundred ms, well within the
            // patient-paced check-in rhythm.
            reasoning: { effort: "low" as const },
          },
          { signal: upstreamAbort.signal },
        );

        for await (const event of events) {
          if (event.type === "response.output_text.delta") {
            aggregated += event.delta;
            controller.enqueue(
              encoder.encode(sseFrame("delta", { text: event.delta })),
            );
          } else if (event.type === "response.output_text.done") {
            const finalText = event.text ?? aggregated;
            aggregated = finalText;
          } else if (
            event.type === "response.function_call_arguments.delta"
          ) {
            const itemId = event.item_id;
            const prev = toolArgBuffer.get(itemId) ?? "";
            toolArgBuffer.set(itemId, prev + event.delta);
          } else if (
            event.type === "response.function_call_arguments.done"
          ) {
            const itemId = event.item_id;
            const argsText =
              toolArgBuffer.get(itemId) ?? event.arguments ?? "";
            const parsedArgs = safeParseToolArgs(argsText);
            if (parsedArgs && toolCallAllowed) {
              controller.enqueue(
                encoder.encode(
                  sseFrame("end_conversation", parsedArgs),
                ),
              );
            }
            // If the tool call arrived too early we silently drop it.
            // The client will keep the check-in open; the model's
            // accompanying text (if any) still streams normally.
            toolArgBuffer.delete(itemId);
          } else if (event.type === "response.completed") {
            finished = true;
            controller.enqueue(
              encoder.encode(sseFrame("done", { text: aggregated })),
            );
            break;
          } else if (
            event.type === "response.failed" ||
            event.type === "response.incomplete"
          ) {
            controller.enqueue(
              encoder.encode(
                sseFrame("error", {
                  message: `upstream_${event.type.replace("response.", "")}`,
                }),
              ),
            );
            break;
          }
        }

        if (!finished) {
          // The model may have closed the response with only a tool
          // call and no text. Still emit `done` so the client can
          // close out the streamed-bubble state cleanly.
          controller.enqueue(
            encoder.encode(sseFrame("done", { text: aggregated })),
          );
        }
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") {
          // Patient navigated away. No frame needed.
        } else {
          controller.enqueue(
            encoder.encode(
              sseFrame("error", { message: (err as Error).message }),
            ),
          );
        }
      } finally {
        request.signal.removeEventListener("abort", onClientAbort);
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }
    },
    cancel() {
      upstreamAbort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
