/**
 * /api/narrate/stream — TEMPORARY scaffolding (streaming text phases).
 *
 * @deprecated The five-chunk session rewrite removed the body-scan
 * and wave-rise/peak/fall streaming surfaces from the session shell
 * (PRD § Session Structure). Their replacement is the scripted Chunk
 * 4 breathing copy plus the multi-turn check-in chat streaming via
 * `/api/checkin`. This route is no longer wired into the session
 * page; slated for `git rm` in a follow-up cleanup PR.
 *
 * Companion to /api/narrate. This handler covers the four narration
 * phases that stream plain prose into the UI: body-scan and the three
 * wave sub-phases. It calls OpenAI gpt-5-mini through the Responses API
 * with `stream: true` and proxies the resulting
 * `response.output_text.delta` events to the browser as Server-Sent
 * Events.
 *
 * Wire format (SSE):
 *   event: delta
 *   data: {"text": "<chunk>"}
 *
 *   event: done
 *   data: {"text": "<full aggregated text>"}
 *
 *   event: error
 *   data: {"message": "..."}
 *
 * The client (`generateText` in `client/lib/gemma/session.ts`) treats
 * the absence of a `done` event as a stream error and either retries
 * once or falls through to the scripted text bank.
 *
 * Deletion plan:
 *   - When the in-browser Gemma + LoRA stack ships, delete this whole
 *     route (alongside /api/narrate, the `openai` dep, and the
 *     OPENAI_API_KEY env var). The streaming surface in
 *     `generateText()` will swap to a transformers.js TextStreamer;
 *     the wire format above is internal to the route + boundary pair
 *     and goes away with them.
 */

import { NextResponse } from "next/server";
import OpenAI from "openai";

import { buildBodyScanPrompt } from "@/lib/prompts/body-scan";
import {
  buildWaveFallPrompt,
  buildWavePeakPrompt,
  buildWaveRisePrompt,
} from "@/lib/prompts/wave";
import {
  narrateStreamRequestSchema,
  type NarrateStreamRequest,
} from "@/lib/prompts/schemas";

export const runtime = "nodejs";
// Disable Next.js caching for this route — every request is a fresh
// model call and the response is a live event stream.
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

function buildPromptFor(req: NarrateStreamRequest) {
  switch (req.phase) {
    case "body-scan":
      return buildBodyScanPrompt(req.input);
    case "wave-rise":
      return buildWaveRisePrompt(req.input);
    case "wave-peak":
      return buildWavePeakPrompt(req.input);
    case "wave-fall":
      return buildWaveFallPrompt(req.input);
    default: {
      const _exhaustive: never = req;
      throw new Error(`Unknown phase: ${String(_exhaustive)}`);
    }
  }
}

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = narrateStreamRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const req = parsed.data;
  const { systemPrompt, userPrompt } = buildPromptFor(req);

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

  // Bridge the patient's `fetch` abort signal (e.g. they navigated
  // away mid-stream) into the upstream OpenAI request so we don't
  // keep generating tokens nobody will see.
  const onClientAbort = () => upstreamAbort.abort();
  request.signal.addEventListener("abort", onClientAbort, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let aggregated = "";
      let finished = false;
      try {
        const events = await client.responses.create({
          model: MODEL,
          input: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          text: { format: { type: "text" } },
          stream: true,
          // Streaming text phases use the smallest reasoning budget the
          // gpt-5 family exposes. `minimal` skips deliberation but
          // keeps a tiny budget for response planning, which is enough
          // for short conversational narration. The trade-off is the
          // whole point: first delta token in <500ms so the UI can
          // start typing immediately. Per OpenAI Responses API docs:
          // supported values are none/minimal/low/medium/high/xhigh.
          reasoning: { effort: "minimal" as const },
        }, { signal: upstreamAbort.signal });

        for await (const event of events) {
          if (event.type === "response.output_text.delta") {
            aggregated += event.delta;
            controller.enqueue(
              encoder.encode(sseFrame("delta", { text: event.delta })),
            );
          } else if (event.type === "response.output_text.done") {
            // Prefer the model's own final text when it's available;
            // fall back to our locally aggregated buffer.
            const finalText = event.text ?? aggregated;
            aggregated = finalText;
          } else if (event.type === "response.completed") {
            finished = true;
            controller.enqueue(
              encoder.encode(sseFrame("done", { text: aggregated })),
            );
            break;
          } else if (event.type === "response.failed" ||
                     event.type === "response.incomplete") {
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

        if (!finished && aggregated.length > 0) {
          // Stream ended without an explicit response.completed event
          // but we did get text; emit a done frame so the client can
          // resolve cleanly.
          controller.enqueue(
            encoder.encode(sseFrame("done", { text: aggregated })),
          );
        } else if (!finished) {
          controller.enqueue(
            encoder.encode(
              sseFrame("error", { message: "stream_ended_without_text" }),
            ),
          );
        }
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") {
          // Patient navigated away. No need to push an error frame —
          // the client is gone.
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
          // Already closed; nothing to do.
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
