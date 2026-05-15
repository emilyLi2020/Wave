"use client";

/**
 * Empirical probe for wllama's structured-output and tool-calling modes
 * with the WAVE Gemma fine-tune. Three independent buttons:
 *
 *  1. JSON schema (strict) — chunk lines. Asks the model to produce
 *     6 narration lines via the actual chunk prompt. Validates against
 *     `chunkLinesJsonSchema`.
 *  2. JSON schema (strict) — reflection card. Same shape, different
 *     schema + prompt.
 *  3. Tool calling — endConversation tool. Feeds a canned 4-turn
 *     check-in history ending in the patient saying "Yes, ready." and
 *     asks the model to call `endConversation` (auto tool_choice).
 *     Tests both non-streaming and streaming so we know which delta
 *     shape we'd consume in production check-in.
 *
 * Each test surfaces raw output, parsed result, latency, and a
 * PASS/FAIL verdict so the empirical question is settled without a
 * full session run.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { buildChunkPrompt } from "@/lib/prompts/chunk-generator";
import { buildCheckInPrompt } from "@/lib/prompts/check-in";
import { buildReflectionPrompt } from "@/lib/prompts/reflection";
import {
  chunkLinesJsonSchema,
  chunkLinesSchema,
  reflectionJsonSchema,
  reflectionPayloadSchema,
  type CheckInContextPayload,
  type ChunkGenerationContextPayload,
  type ReflectionContext,
} from "@/lib/prompts/schemas";
import {
  describeWaveWllamaSource,
  loadWaveWllama,
  WAVE_GGUF_DEFAULT_N_CTX,
  type WllamaInstance,
} from "@/lib/wllama";

const PATIENT_PROFILE = {
  matType: "buprenorphine" as const,
  medicationStatus: "on_time" as const,
  trigger: "stress" as const,
  triggerOther: null,
  usedSubstanceToday: false,
};

const CHUNK_CONTEXT: ChunkGenerationContextPayload = {
  chunkNumber: 2,
  intakeIntensity: 7,
  profile: PATIENT_PROFILE,
  sessionHistory: [
    {
      kind: "chunk",
      chunkNumber: 1,
      lines: [
        "Welcome back. Showing up is the practice.",
        "Find a position your body can rest in for a few minutes.",
        "Urges arrive like waves — they build, crest, and fall.",
        "Notice what is already here in the body, without fixing it.",
        "Let your breath be ordinary for one slow round.",
        "When you're ready we'll move into the body together.",
      ],
    },
  ],
};

const REFLECTION_CONTEXT: ReflectionContext = {
  intakeIntensity: 7,
  matType: "buprenorphine",
  medicationStatus: "on_time",
  trigger: "stress",
  usedSubstanceToday: false,
  bodyLocation: "chest",
  currentIntensity: 4,
  endingIntensity: 3,
  durationSeconds: 600,
};

const CHECK_IN_CONTEXT: CheckInContextPayload = {
  chunkNumber: 2,
  cravingScore: 6,
  scoreHistory: [7, 6],
  obstacleHint: null,
  profile: PATIENT_PROFILE,
  intakeIntensity: 7,
  sessionHistory: [
    {
      kind: "chunk",
      chunkNumber: 1,
      lines: CHUNK_CONTEXT.sessionHistory[0]!.kind === "chunk"
        ? (CHUNK_CONTEXT.sessionHistory[0]! as { lines: string[] }).lines
        : [],
    },
  ],
  demoMode: false,
};

// 4-turn history ending in clear affirmative readiness — should
// trigger endConversation per the prompt's protocol.
const READY_HISTORY: Array<{ role: "user" | "assistant"; content: string }> = [
  { role: "user", content: "About a 6." },
  {
    role: "assistant",
    content:
      "Six is a little lower than where you started. Where did you notice the urge most during the last chunk?",
  },
  { role: "user", content: "Mostly in my chest." },
  {
    role: "assistant",
    content:
      "Chest is useful information. Try noticing the edges of that pressure for one breath, without pushing it away. What changes?",
  },
  { role: "user", content: "It softened a little." },
  {
    role: "assistant",
    content:
      "Softening a little is worth noticing — you stayed with the urge instead of leaving it. Ready to continue with the sound anchor?",
  },
  { role: "user", content: "Yes, ready." },
];

const END_CONVERSATION_TOOL = {
  type: "function" as const,
  function: {
    name: "endConversation",
    description:
      "End the WAVE check-in after the patient is ready to continue.",
    parameters: {
      type: "object" as const,
      additionalProperties: false,
      required: ["cravingScore", "obstacleCategory"],
      properties: {
        cravingScore: { type: "integer", minimum: 1, maximum: 10 },
        obstacleCategory: {
          type: "string",
          enum: [
            "none",
            "cannot_visualize",
            "mind_wandering",
            "urge_overwhelming",
            "breath_tight",
            "breath_anxiety",
            "gave_in",
            "guilt_failure",
            "physical_discomfort",
            "sleepiness",
          ],
        },
      },
    },
  },
};

type Verdict = "pass" | "fail" | "partial";

interface ProbeResult {
  verdict: Verdict;
  reason: string;
  rawText: string;
  parsed?: unknown;
  toolCalls?: Array<{ name: string; arguments: string; parsed?: unknown }>;
  finishReason?: string | null;
  rawTokens?: string[];
  elapsedMs: number;
}

type ProbeName =
  | "chunk"
  | "reflection"
  | "tools-batch"
  | "tools-stream"
  | "raw-tokens";

interface LoadState {
  phase: "idle" | "loading" | "ready" | "error";
  message: string;
  percent: number;
}

const INITIAL_LOAD: LoadState = { phase: "idle", message: "Not loaded.", percent: 0 };

export function SchemaProbeClient() {
  const wllamaRef = useRef<WllamaInstance | null>(null);
  const [load, setLoad] = useState<LoadState>(INITIAL_LOAD);
  const [running, setRunning] = useState<ProbeName | null>(null);
  const [results, setResults] = useState<Partial<Record<ProbeName, ProbeResult>>>(
    {},
  );

  useEffect(() => () => undefined, []);

  const loadModel = useCallback(async () => {
    if (load.phase === "loading" || load.phase === "ready") return;
    const sourceLabel = describeWaveWllamaSource();
    setLoad({
      phase: "loading",
      message: `Loading ${sourceLabel}…`,
      percent: 0,
    });
    try {
      const wllama = await loadWaveWllama({
        nCtx: WAVE_GGUF_DEFAULT_N_CTX,
        onProgress: ({ percent }) => {
          setLoad({
            phase: "loading",
            message: `Downloading ${sourceLabel} ${percent}%`,
            percent,
          });
        },
      });
      wllamaRef.current = wllama;
      setLoad({
        phase: "ready",
        message: "Model ready.",
        percent: 100,
      });
    } catch (err) {
      setLoad({
        phase: "error",
        message: err instanceof Error ? err.message : String(err),
        percent: 0,
      });
    }
  }, [load.phase]);

  // ── Probe 1: chunk JSON schema (strict) ─────────────────────────────
  const probeChunkSchema = useCallback(async () => {
    const wllama = wllamaRef.current;
    if (!wllama || running) return;
    setRunning("chunk");
    const started = performance.now();
    try {
      const prompt = buildChunkPrompt(CHUNK_CONTEXT);
      const out = await wllama.createChatCompletion({
        messages: [
          { role: "system", content: prompt.systemPrompt },
          { role: "user", content: prompt.userPrompt },
        ],
        temperature: 0,
        top_k: 1,
        max_tokens: 400,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "WaveChunkLines",
            schema: chunkLinesJsonSchema,
            strict: true,
          },
        },
      });
      const elapsedMs = performance.now() - started;
      const rawText = out.choices?.[0]?.message?.content ?? "";
      let parsed: unknown;
      let verdict: Verdict = "fail";
      let reason = "";
      try {
        parsed = JSON.parse(rawText);
        const validation = chunkLinesSchema.safeParse(parsed);
        if (validation.success) {
          verdict = "pass";
          reason = `Got 6 lines matching schema in ${Math.round(elapsedMs)}ms.`;
        } else {
          verdict = "partial";
          reason = `Valid JSON but schema mismatch: ${validation.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ")}`;
        }
      } catch (err) {
        verdict = "fail";
        reason = `JSON.parse failed: ${err instanceof Error ? err.message : String(err)}`;
      }
      setResults((prev) => ({
        ...prev,
        chunk: { verdict, reason, rawText, parsed, elapsedMs },
      }));
    } catch (err) {
      setResults((prev) => ({
        ...prev,
        chunk: {
          verdict: "fail",
          reason: `wllama threw: ${err instanceof Error ? err.message : String(err)}`,
          rawText: "",
          elapsedMs: performance.now() - started,
        },
      }));
    } finally {
      setRunning(null);
    }
  }, [running]);

  // ── Probe 2: reflection JSON schema (strict) ───────────────────────
  const probeReflectionSchema = useCallback(async () => {
    const wllama = wllamaRef.current;
    if (!wllama || running) return;
    setRunning("reflection");
    const started = performance.now();
    try {
      const prompt = buildReflectionPrompt(REFLECTION_CONTEXT);
      const out = await wllama.createChatCompletion({
        messages: [
          { role: "system", content: prompt.systemPrompt },
          { role: "user", content: prompt.userPrompt },
        ],
        temperature: 0,
        top_k: 1,
        max_tokens: 500,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "WaveReflection",
            schema: reflectionJsonSchema,
            strict: true,
          },
        },
      });
      const elapsedMs = performance.now() - started;
      const rawText = out.choices?.[0]?.message?.content ?? "";
      let parsed: unknown;
      let verdict: Verdict = "fail";
      let reason = "";
      try {
        parsed = JSON.parse(rawText);
        const validation = reflectionPayloadSchema.safeParse(parsed);
        if (validation.success) {
          verdict = "pass";
          reason = `Valid reflection in ${Math.round(elapsedMs)}ms.`;
        } else {
          verdict = "partial";
          reason = `Valid JSON but schema mismatch: ${validation.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ")}`;
        }
      } catch (err) {
        verdict = "fail";
        reason = `JSON.parse failed: ${err instanceof Error ? err.message : String(err)}`;
      }
      setResults((prev) => ({
        ...prev,
        reflection: { verdict, reason, rawText, parsed, elapsedMs },
      }));
    } catch (err) {
      setResults((prev) => ({
        ...prev,
        reflection: {
          verdict: "fail",
          reason: `wllama threw: ${err instanceof Error ? err.message : String(err)}`,
          rawText: "",
          elapsedMs: performance.now() - started,
        },
      }));
    } finally {
      setRunning(null);
    }
  }, [running]);

  // ── Probe 3a: tool calling — non-streaming ──────────────────────────
  const probeToolsBatch = useCallback(async () => {
    const wllama = wllamaRef.current;
    if (!wllama || running) return;
    setRunning("tools-batch");
    const started = performance.now();
    try {
      const { systemPrompt, contextBlock } = buildCheckInPrompt(
        CHECK_IN_CONTEXT,
        { agentTurnsInHistory: 2 },
      );
      // Merge contextBlock into the first user turn so Gemma's chat
      // template doesn't fail on two consecutive user messages.
      const [first, ...rest] = READY_HISTORY;
      const messages = [
        { role: "system" as const, content: systemPrompt },
        {
          role: "user" as const,
          content: `${contextBlock}\n\n${first!.content}`,
        },
        ...rest,
      ];
      const out = await wllama.createChatCompletion({
        messages,
        temperature: 0,
        top_k: 1,
        max_tokens: 300,
        tools: [END_CONVERSATION_TOOL],
        tool_choice: "auto",
      });
      const elapsedMs = performance.now() - started;
      const choice = out.choices?.[0];
      const message = choice?.message;
      const finishReason = choice?.finish_reason ?? null;
      const rawText = message?.content ?? "";
      const toolCalls = (message?.tool_calls ?? []).map((tc) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(tc.function.arguments);
        } catch {
          parsed = null;
        }
        return {
          name: tc.function.name,
          arguments: tc.function.arguments,
          parsed,
        };
      });
      let verdict: Verdict = "fail";
      let reason: string;
      if (toolCalls.length === 0) {
        verdict = "fail";
        reason = `No tool_calls emitted. Model wrote: "${rawText.slice(0, 120)}..."`;
      } else {
        const end = toolCalls.find((tc) => tc.name === "endConversation");
        if (!end) {
          verdict = "partial";
          reason = `Got ${toolCalls.length} tool_calls but no endConversation.`;
        } else if (
          end.parsed &&
          typeof (end.parsed as { cravingScore?: unknown }).cravingScore ===
            "number"
        ) {
          verdict = "pass";
          reason = `endConversation tool fired in ${Math.round(elapsedMs)}ms with valid args.`;
        } else {
          verdict = "partial";
          reason = "endConversation fired but arguments didn't parse.";
        }
      }
      setResults((prev) => ({
        ...prev,
        "tools-batch": {
          verdict,
          reason: `${reason} finish_reason=${finishReason ?? "null"}.`,
          rawText,
          toolCalls,
          finishReason,
          elapsedMs,
        },
      }));
    } catch (err) {
      setResults((prev) => ({
        ...prev,
        "tools-batch": {
          verdict: "fail",
          reason: `wllama threw: ${err instanceof Error ? err.message : String(err)}`,
          rawText: "",
          elapsedMs: performance.now() - started,
        },
      }));
    } finally {
      setRunning(null);
    }
  }, [running]);

  // ── Probe 3b: tool calling — streaming ──────────────────────────────
  const probeToolsStream = useCallback(async () => {
    const wllama = wllamaRef.current;
    if (!wllama || running) return;
    setRunning("tools-stream");
    const started = performance.now();
    try {
      const { systemPrompt, contextBlock } = buildCheckInPrompt(
        CHECK_IN_CONTEXT,
        { agentTurnsInHistory: 2 },
      );
      // Merge contextBlock into the first user turn so Gemma's chat
      // template doesn't fail on two consecutive user messages.
      const [first, ...rest] = READY_HISTORY;
      const messages = [
        { role: "system" as const, content: systemPrompt },
        {
          role: "user" as const,
          content: `${contextBlock}\n\n${first!.content}`,
        },
        ...rest,
      ];
      let textAcc = "";
      const toolCallsAcc: Record<
        number,
        { id?: string; name?: string; arguments: string }
      > = {};
      const stream = await wllama.createChatCompletion({
        messages,
        temperature: 0,
        top_k: 1,
        max_tokens: 300,
        tools: [END_CONVERSATION_TOOL],
        tool_choice: "auto",
        stream: true,
        onData: (chunk) => {
          const delta = chunk.choices?.[0]?.delta;
          if (delta?.content) textAcc += delta.content;
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (!toolCallsAcc[tc.index]) {
                toolCallsAcc[tc.index] = { arguments: "" };
              }
              const slot = toolCallsAcc[tc.index]!;
              if (tc.id) slot.id = tc.id;
              if (tc.function?.name) slot.name = tc.function.name;
              if (tc.function?.arguments) {
                slot.arguments += tc.function.arguments;
              }
            }
          }
        },
      });
      // Drain in case onData doesn't fire for every chunk
      for await (const _chunk of stream as AsyncIterable<unknown>) {
        // no-op
      }
      const elapsedMs = performance.now() - started;
      const assembled = Object.values(toolCallsAcc).map((slot) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(slot.arguments);
        } catch {
          parsed = null;
        }
        return {
          name: slot.name ?? "(unknown)",
          arguments: slot.arguments,
          parsed,
        };
      });
      let verdict: Verdict = "fail";
      let reason: string;
      if (assembled.length === 0) {
        verdict = "fail";
        reason = `No tool_call deltas in stream. Streamed text: "${textAcc.slice(0, 120)}..."`;
      } else {
        const end = assembled.find((tc) => tc.name === "endConversation");
        if (end?.parsed) {
          verdict = "pass";
          reason = `Streamed tool_call assembled in ${Math.round(elapsedMs)}ms with valid args.`;
        } else {
          verdict = "partial";
          reason = "tool_call deltas arrived but didn't assemble into valid JSON.";
        }
      }
      setResults((prev) => ({
        ...prev,
        "tools-stream": {
          verdict,
          reason,
          rawText: textAcc,
          toolCalls: assembled,
          elapsedMs,
        },
      }));
    } catch (err) {
      setResults((prev) => ({
        ...prev,
        "tools-stream": {
          verdict: "fail",
          reason: `wllama threw: ${err instanceof Error ? err.message : String(err)}`,
          rawText: "",
          elapsedMs: performance.now() - started,
        },
      }));
    } finally {
      setRunning(null);
    }
  }, [running]);

  // ── Probe 4: Raw tokens with Gemma 4 template + explicit tool format ─
  // Uses Gemma 4's ACTUAL chat template (`<|think|>` for system, `<|turn>`
  // for role open, `<turn|>` for close — per the wllama warmup log
  // emitted on model load). Explicitly instructs the fine-tune to emit
  // `<|tool_call>...<tool_call|>` literally so we can distinguish
  // "model forgot tool emission" from "wllama's chat template + auto
  // tools dispatch isn't compatible with Gemma 4".
  //
  // Calls raw `createCompletion` with `logprobs: 1` to get every token
  // string the model emitted, no filtering, no chat-completion auto
  // tool-call detection. If the fine-tune retained tool emission, we'll
  // see `<|tool_call>` show up in the token stream regardless of
  // whether llama.cpp's server-context has a Gemma 4 tool parser.
  const probeRawTokens = useCallback(async () => {
    const wllama = wllamaRef.current;
    if (!wllama || running) return;
    setRunning("raw-tokens");
    const started = performance.now();
    try {
      const { systemPrompt, contextBlock } = buildCheckInPrompt(
        CHECK_IN_CONTEXT,
        { agentTurnsInHistory: 2 },
      );

      // Strong, explicit Gemma 4 native tool-call instruction appended
      // to the system prompt. If the fine-tune was trained on this
      // format at all, the model should comply when the patient
      // affirms readiness.
      const augmentedSystem = `${systemPrompt}

<gemma4_native_tool_format>
When you need to call the endConversation tool, emit EXACTLY this token sequence on a new line — literal, no markdown, no escapes:

<|tool_call>endConversation({"cravingScore": <int 1-10>, "obstacleCategory": "<one of: none, cannot_visualize, mind_wandering, urge_overwhelming, breath_tight, breath_anxiety, gave_in, guilt_failure, physical_discomfort, sleepiness>"})<tool_call|>

The system parses those literal tokens out of your output. Do not paraphrase. Pair the tool call with a brief warm closing sentence BEFORE the tool tokens.
</gemma4_native_tool_format>`;

      const [first, ...rest] = READY_HISTORY;
      // Gemma 4's chat template (observed in wllama's load-time warmup
      // log): `<|think|>\n{system}<turn|>` for the system message, then
      // `<|turn>role\n{content}<turn|>` for every user/model turn.
      // Final prompt ends with `<|turn>model\n` so the model continues
      // from the model role.
      const formattedTurns: string[] = [
        `<|think|>\n${augmentedSystem}\n\n${contextBlock}\n\n${first!.content}<turn|>`,
      ];
      for (const turn of rest) {
        const role = turn.role === "assistant" ? "model" : "user";
        formattedTurns.push(`<|turn>${role}\n${turn.content}<turn|>`);
      }
      const prompt = `${formattedTurns.join("\n")}\n<|turn>model\n`;

      const out = await wllama.createCompletion({
        prompt,
        temperature: 0,
        top_k: 1,
        max_tokens: 300,
        logprobs: 1,
        ...({ abortSignal: undefined } as { abortSignal?: AbortSignal }),
      });
      const elapsedMs = performance.now() - started;
      const choice = out.choices?.[0];
      const rawText = choice?.text ?? "";
      const rawTokens = choice?.logprobs?.tokens ?? [];
      const finishReason = choice?.finish_reason ?? null;

      // Look for any Gemma 4 native tool markers in the raw token stream.
      // `<|tool_call>` and `<tool_call|>` are single tokens in the GGUF
      // vocabulary (confirmed by the `<|tool_response>` token id 50 from
      // the load log). If the fine-tune retained tool emission they'll
      // appear as discrete tokens here.
      const nativeToolTokens = rawTokens.filter((t) => {
        return (
          t === "<|tool_call>" ||
          t === "<tool_call|>" ||
          t === "<|tool_response>" ||
          t === "<tool_response|>"
        );
      });
      const looseMarkers = rawTokens.filter((t) => {
        const lower = t.toLowerCase();
        return (
          lower.includes("tool_call") ||
          lower.includes("endconversation") ||
          lower.includes("function")
        );
      });
      const rawContainsToolCall = rawText.includes("<|tool_call>");

      let verdict: Verdict;
      let reason: string;
      if (nativeToolTokens.length > 0) {
        verdict = "pass";
        reason = `Found ${nativeToolTokens.length} native Gemma 4 tool token(s): ${nativeToolTokens.join(", ")}. Fine-tune retains tool emission.`;
      } else if (rawContainsToolCall) {
        verdict = "partial";
        reason = `Raw text contains "<|tool_call>" substring but not as a discrete token — model emitted it as plain text (lost the native token mapping). Check tokens below.`;
      } else if (looseMarkers.length > 0) {
        verdict = "partial";
        reason = `${looseMarkers.length} loose tool-shaped token(s): ${looseMarkers.slice(0, 4).join(" | ")}. No native <|tool_call> tokens. finish_reason=${finishReason ?? "null"}.`;
      } else {
        verdict = "fail";
        reason = `${rawTokens.length} tokens, none tool-shaped. Fine-tune emits only plain narration even with explicit native-format instruction. finish_reason=${finishReason ?? "null"}.`;
      }

      setResults((prev) => ({
        ...prev,
        "raw-tokens": {
          verdict,
          reason,
          rawText,
          rawTokens,
          finishReason,
          elapsedMs,
        },
      }));
    } catch (err) {
      setResults((prev) => ({
        ...prev,
        "raw-tokens": {
          verdict: "fail",
          reason: `wllama threw: ${err instanceof Error ? err.message : String(err)}`,
          rawText: "",
          elapsedMs: performance.now() - started,
        },
      }));
    } finally {
      setRunning(null);
    }
  }, [running]);

  const canRun = load.phase === "ready" && running === null;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:space-y-8 sm:p-6 lg:p-8">
      <header>
        <p className="text-xs uppercase tracking-wide text-foreground/50">
          Probe · wllama structured output + tools
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          Verify JSON schema + function calling on the WAVE fine-tune
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-foreground/70">
          Three independent checks. Run them in order. The chunk +
          reflection probes use <code>response_format: {`{`} type:
          &quot;json_schema&quot;, strict: true {`}`}</code>; the tool
          probes use <code>tools</code> + <code>tool_choice:
          &quot;auto&quot;</code> with an <code>endConversation</code>{" "}
          tool definition.
        </p>
      </header>

      <div className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-semibold tracking-tight">Model</h3>
          <span className="text-[10px] uppercase tracking-wide text-foreground/50">
            {load.phase}
          </span>
        </div>
        <p className="mt-3 text-xs text-foreground/70">{load.message}</p>
        <button
          type="button"
          disabled={load.phase === "loading" || load.phase === "ready"}
          onClick={loadModel}
          className="mt-3 inline-flex items-center rounded-md border border-border bg-surface-muted px-3 py-1.5 text-xs font-medium text-foreground/80 disabled:cursor-not-allowed disabled:opacity-50 hover:border-accent/60 hover:text-foreground"
        >
          {load.phase === "loading"
            ? `Loading… ${load.percent || 0}%`
            : load.phase === "ready"
              ? "Loaded"
              : load.phase === "error"
                ? "Retry"
                : "Load"}
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <ProbeButton
          label="1. Chunk JSON schema"
          subtitle="strict, 6 narration lines"
          disabled={!canRun}
          running={running === "chunk"}
          onClick={probeChunkSchema}
        />
        <ProbeButton
          label="2. Reflection JSON schema"
          subtitle="strict, structured card"
          disabled={!canRun}
          running={running === "reflection"}
          onClick={probeReflectionSchema}
        />
        <ProbeButton
          label="3a. Tools (batch)"
          subtitle="endConversation, non-streaming"
          disabled={!canRun}
          running={running === "tools-batch"}
          onClick={probeToolsBatch}
        />
        <ProbeButton
          label="3b. Tools (stream)"
          subtitle="endConversation, streamed deltas"
          disabled={!canRun}
          running={running === "tools-stream"}
          onClick={probeToolsStream}
        />
        <ProbeButton
          label="4. Raw tokens"
          subtitle="createCompletion + logprobs, no tool processing"
          disabled={!canRun}
          running={running === "raw-tokens"}
          onClick={probeRawTokens}
        />
      </div>

      {(
        [
          "chunk",
          "reflection",
          "tools-batch",
          "tools-stream",
          "raw-tokens",
        ] as const
      ).map((key) => {
        const result = results[key];
        if (!result) return null;
        return <ResultCard key={key} title={titleFor(key)} result={result} />;
      })}
    </div>
  );
}

function titleFor(key: ProbeName): string {
  switch (key) {
    case "chunk":
      return "Chunk JSON schema";
    case "reflection":
      return "Reflection JSON schema";
    case "tools-batch":
      return "Tool calling (batch)";
    case "tools-stream":
      return "Tool calling (stream)";
    case "raw-tokens":
      return "Raw tokens (createCompletion)";
  }
}

function ProbeButton({
  label,
  subtitle,
  disabled,
  running,
  onClick,
}: {
  label: string;
  subtitle: string;
  disabled: boolean;
  running: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-2xl border border-border bg-surface p-4 text-left transition disabled:opacity-50 hover:border-accent disabled:hover:border-border"
    >
      <p className="text-sm font-semibold">{running ? `Running…` : label}</p>
      <p className="mt-1 text-xs text-foreground/55">{subtitle}</p>
    </button>
  );
}

function ResultCard({
  title,
  result,
}: {
  title: string;
  result: ProbeResult;
}) {
  const tone =
    result.verdict === "pass"
      ? "border-emerald-200 bg-emerald-50 text-emerald-950"
      : result.verdict === "partial"
        ? "border-amber-200 bg-amber-50 text-amber-950"
        : "border-red-200 bg-red-50 text-red-950";
  const verdictLabel = result.verdict.toUpperCase();
  return (
    <section className="rounded-2xl border border-border bg-surface-muted/30 p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-base font-semibold tracking-tight sm:text-lg">
          {title}
        </h2>
        <span className="text-[11px] text-foreground/55">
          {result.elapsedMs.toFixed(0)} ms
        </span>
      </div>
      <p
        className={`mt-3 rounded-md border px-3 py-2 text-xs font-medium ${tone}`}
      >
        {verdictLabel} · {result.reason}
      </p>
      {result.toolCalls ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-foreground/70">
            Tool calls ({result.toolCalls.length})
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-muted/50 px-3 py-2 text-xs leading-relaxed text-foreground/85">
            {JSON.stringify(result.toolCalls, null, 2)}
          </pre>
        </details>
      ) : null}
      {result.rawText.length > 0 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-foreground/70">
            Raw output ({result.rawText.length} chars)
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-muted/50 px-3 py-2 text-xs leading-relaxed text-foreground/85">
            {result.rawText}
          </pre>
        </details>
      ) : null}
      {result.parsed !== undefined ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-foreground/70">
            Parsed
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-muted/50 px-3 py-2 text-xs leading-relaxed text-foreground/85">
            {JSON.stringify(result.parsed, null, 2)}
          </pre>
        </details>
      ) : null}
      {result.rawTokens && result.rawTokens.length > 0 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-foreground/70">
            Raw tokens ({result.rawTokens.length})
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-muted/50 px-3 py-2 text-[11px] leading-relaxed text-foreground/85">
            {result.rawTokens
              .map((t, i) => `${i.toString().padStart(3, " ")}: ${JSON.stringify(t)}`)
              .join("\n")}
          </pre>
        </details>
      ) : null}
    </section>
  );
}
