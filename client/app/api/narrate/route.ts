/**
 * /api/narrate — TEMPORARY scaffolding (JSON phases only).
 *
 * @deprecated for the `med-ack` phase. The five-chunk session rewrite
 * (PRD § Session Structure) folded medication-aware copy into the
 * multi-turn check-in chat at `/api/checkin`; med-ack is no longer
 * called by the session shell. The `reflection` phase still uses this
 * route via the streaming reflection sibling at
 * `/api/narrate/reflection-stream`. Slated for cleanup once the
 * in-browser Gemma stack ships.
 *
 * The production WAVE session path is offline-first and runs Gemma 4
 * E2B-it in the browser via @huggingface/transformers + WebGPU
 * (PRD.md > Backend Needed?, AGENTS.md > Tech Stack). This Route Handler
 * exists only until that in-browser stack lands; it stands in by calling
 * OpenAI gpt-5-mini server-side using the same prompt templates and Zod
 * schemas the Gemma path will use.
 *
 * Scope: this route handles the two structured-JSON phases —
 * `med-ack` and `reflection`. The four streaming text phases
 * (body-scan, wave-rise, wave-peak, wave-fall) live at
 * `/api/narrate/stream`.
 *
 * Deletion plan:
 *   - When the in-browser Gemma + LoRA stack ships, rip out
 *     `client/app/api/narrate/`, the `openai` dependency, and the
 *     `OPENAI_API_KEY` env var. The client-side `generateJSON()` and
 *     `generateText()` boundaries in `client/lib/gemma/session.ts` are
 *     the only call sites that have to change.
 *
 * Security:
 *   - `OPENAI_API_KEY` is read only from `process.env` (server-side).
 *   - This route never logs the patient's intake fields, the model
 *     output, or the API key. PHI-adjacent payloads must not leave the
 *     request lifetime.
 */

import { NextResponse } from "next/server";
import OpenAI from "openai";

import { buildMedAckPrompt } from "@/lib/prompts/medication-ack";
import { buildReflectionPrompt } from "@/lib/prompts/reflection";
import {
  PHASE_SCHEMAS,
  narrateRequestSchema,
  type NarrateRequest,
} from "@/lib/prompts/schemas";

export const runtime = "nodejs";

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

function buildPromptFor(req: NarrateRequest) {
  switch (req.phase) {
    case "med-ack":
      return buildMedAckPrompt(req.input);
    case "reflection":
      return buildReflectionPrompt(req.input);
    default: {
      const _exhaustive: never = req;
      throw new Error(`Unknown phase: ${String(_exhaustive)}`);
    }
  }
}

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = narrateRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const req = parsed.data;
  const schemaSpec = PHASE_SCHEMAS[req.phase];
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
          name: schemaSpec.jsonSchemaName,
          strict: true,
          schema: schemaSpec.jsonSchema,
        },
      },
      // Reflection gets `medium` reasoning effort for a deeper synthesis
      // of the session arc. The other JSON phase (med-ack) stays at the
      // default `low` effort to keep the opener snappy. See the project
      // plan for the trade-off.
      ...(req.phase === "reflection"
        ? { reasoning: { effort: "medium" as const } }
        : {}),
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

    const validated = schemaSpec.zod.safeParse(payload);
    if (!validated.success) {
      return NextResponse.json(
        { error: "model_failed_schema", issues: validated.error.issues },
        { status: 502 },
      );
    }

    return NextResponse.json(validated.data);
  } catch (err) {
    return NextResponse.json(
      { error: "openai_call_failed", message: (err as Error).message },
      { status: 502 },
    );
  }
}
