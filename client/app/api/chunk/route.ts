/**
 * /api/chunk — TEMPORARY scaffolding (LLM-generated meditation chunks).
 *
 * The five-chunk session rewrite (PRD § Session Structure) replaces
 * the static `session-script.ts` bank with per-chunk LLM generation.
 * This route is the server side of that swap: it takes a chunk number
 * + patient profile + the full prior session history, calls
 * gpt-5-mini with a strict JSON schema, and returns
 * `{ lines: string[] }` of fixed length. The client wraps each line
 * as a `text` segment and inserts a default-length `pause` segment
 * between consecutive lines (pause durations are a runtime concern,
 * not part of the model contract).
 *
 * Deletion plan:
 *   - When the in-browser Gemma + LoRA stack ships, delete this whole
 *     route alongside /api/checkin and /api/narrate. The client-side
 *     `generateChunk()` boundary in client/lib/gemma/chunk.ts is the
 *     only call site that has to change; the schema + prompt builder
 *     in client/lib/prompts/ stay.
 *
 * Security:
 *   - `OPENAI_API_KEY` is read only from `process.env` (server-side).
 *   - This route never logs the patient's intake fields, the model
 *     output, or the API key. PHI-adjacent payloads must not leave
 *     the request lifetime.
 */

import { NextResponse } from "next/server";
import OpenAI from "openai";

import { buildChunkPrompt } from "@/lib/prompts/chunk-generator";
import {
  chunkGenerationRequestSchema,
  chunkLinesSchema,
  CHUNK_LINES_JSON_SCHEMA_NAME,
  chunkLinesJsonSchema,
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

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = chunkGenerationRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { context } = parsed.data;
  const { systemPrompt, userPrompt } = buildChunkPrompt(context);

  let client: OpenAI;
  try {
    client = getClient();
  } catch (err) {
    return NextResponse.json(
      { error: "openai_not_configured", message: (err as Error).message },
      { status: 500 },
    );
  }

  try {
    const response = await client.responses.create({
      model: MODEL,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      text: {
        format: {
          type: "json_schema",
          name: CHUNK_LINES_JSON_SCHEMA_NAME,
          strict: true,
          schema: chunkLinesJsonSchema,
        },
      },
      // Chunk narration is creative but bounded; keep reasoning at
      // `low` so the patient doesn't sit on a black screen.
      reasoning: { effort: "low" as const },
    });

    const text = response.output_text;
    if (!text) {
      return NextResponse.json(
        { error: "model_returned_empty" },
        { status: 502 },
      );
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { error: "model_returned_invalid_json" },
        { status: 502 },
      );
    }

    const validated = chunkLinesSchema.safeParse(payload);
    if (!validated.success) {
      return NextResponse.json(
        { error: "model_failed_schema", issues: validated.error.issues },
        { status: 502 },
      );
    }

    return NextResponse.json({
      lines: sanitizeChunkLines(validated.data.lines),
    });
  } catch (err) {
    return NextResponse.json(
      { error: "openai_call_failed", message: (err as Error).message },
      { status: 502 },
    );
  }
}

function sanitizeChunkLines(lines: readonly string[]): string[] {
  return lines.map((line) =>
    line
      .replace(/\]\s*\[/g, " ")
      .replace(/[\[\]]/g, "")
      .replace(/[–—]/g, ",")
      .replace(/\s+([,.;:?])/g, "$1")
      .replace(/\s+/g, " ")
      .trim(),
  );
}
