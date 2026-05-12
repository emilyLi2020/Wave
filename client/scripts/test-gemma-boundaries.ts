/* eslint-disable no-console */
import assert from "node:assert/strict";

import {
  DEFAULT_LINE_PAUSE_SECONDS,
  generateChunk,
} from "@/lib/gemma/chunk";
import { streamCheckInTurn } from "@/lib/gemma/checkin";
import { generateInsights } from "@/lib/gemma/insights";
import { generateReflection } from "@/lib/gemma/session";
import { buildChunkPrompt } from "@/lib/prompts/chunk-generator";
import { fallbackChunk } from "@/lib/prompts/fallback-bank";
import {
  CHUNK_LINE_COUNT,
  chunkLinesSchema,
  type CheckInContextPayload,
  type ChunkGenerationContextPayload,
  type ReflectionContext,
} from "@/lib/prompts/schemas";
import type { Session } from "@/types/models";
import type { ChunkNumber } from "@/types/session";

let passed = 0;
let failed = 0;

const VALID_CHUNK_LINES = [
  "Settle your body into the surface holding you right now.",
  "Notice the urge without arguing with it or obeying it.",
  "Let your next breath arrive at its own natural pace.",
  "The wave can be here while you stay here with it.",
  "Name one sensation in the body and give it room.",
  "Stay with this moment, just this one, before moving on.",
] as const;

const PROFILE = {
  matType: "buprenorphine" as const,
  medicationStatus: "on_time" as const,
  trigger: "stress" as const,
  triggerOther: null,
  usedSubstanceToday: false,
};

const CHUNK_CONTEXT: ChunkGenerationContextPayload = {
  chunkNumber: 1,
  intakeIntensity: 7,
  profile: PROFILE,
  sessionHistory: [],
};

const CHECK_IN_CONTEXT: CheckInContextPayload = {
  chunkNumber: 2,
  cravingScore: 6,
  scoreHistory: [7, 6],
  obstacleHint: null,
  profile: PROFILE,
  intakeIntensity: 7,
  sessionHistory: [
    {
      kind: "chunk",
      chunkNumber: 1,
      lines: [...VALID_CHUNK_LINES],
    },
  ],
  demoMode: false,
};

const REFLECTION_CONTEXT: ReflectionContext = {
  intakeIntensity: 7,
  matType: "buprenorphine",
  medicationStatus: "on_time",
  trigger: "stress",
  usedSubstanceToday: false,
  bodyLocation: "other",
  currentIntensity: 3,
  endingIntensity: 3,
  durationSeconds: 720,
};

const SESSIONS: Session[] = [
  {
    id: "s1",
    startedAt: "2026-04-30T12:00:00.000Z",
    endedAt: "2026-04-30T12:12:00.000Z",
    intakeIntensity: 7,
    endingIntensity: 3,
    medicationStatus: "on_time",
    trigger: "stress",
    bodyScanLocation: "chest",
    outcome: "completed",
    usedSubstanceToday: false,
  },
];

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(err);
  }
}

async function withoutConsoleWarn<T>(fn: () => Promise<T>): Promise<T> {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    return await fn();
  } finally {
    console.warn = originalWarn;
  }
}

function assertChunkShape(chunkNumber: ChunkNumber, lines: readonly string[]) {
  assert.equal(lines.length, CHUNK_LINE_COUNT);
  assert.equal(chunkLinesSchema.safeParse({ lines }).success, true);

  const chunk = fallbackChunk(chunkNumber);
  assert.equal(chunk.lines.length, CHUNK_LINE_COUNT);
  assert.equal(chunkLinesSchema.safeParse(chunk).success, true);
}

async function main() {
await test("chunk boundary returns model output and wraps interleaved pauses", async () => {
  let calls = 0;
  const result = await generateChunk({
    context: CHUNK_CONTEXT,
    generate: async (context, options) => {
      calls += 1;
      assert.equal(context.chunkNumber, 1);
      assert.equal(options.maxNewTokens, 260);
      return { text: JSON.stringify({ lines: VALID_CHUNK_LINES }) };
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.source, "model");
  assert.equal(result.attempts, 1);
  assert.deepEqual(result.lines, [...VALID_CHUNK_LINES]);
  assert.equal(result.chunk.id, 1);
  assert.equal(result.chunk.segments.length, CHUNK_LINE_COUNT * 2 - 1);
  assert.equal(result.chunk.segments[0]?.type, "text");
  assert.deepEqual(result.chunk.segments[1], {
    type: "pause",
    duration: DEFAULT_LINE_PAUSE_SECONDS,
  });
});

await test("chunk boundary trims valid overlong line arrays to six lines", async () => {
  const extraLine = "This seventh line should never reach the chunk player.";
  const result = await generateChunk({
    context: CHUNK_CONTEXT,
    generate: async () => ({
      text: JSON.stringify({ lines: [...VALID_CHUNK_LINES, extraLine] }),
    }),
  });

  assert.equal(result.source, "model");
  assert.equal(result.lines.length, CHUNK_LINE_COUNT);
  assert.equal(result.lines.includes(extraLine), false);
});

await test("chunk boundary retries invalid packed lines then falls back", async () => {
  let calls = 0;
  const result = await withoutConsoleWarn(() =>
    generateChunk({
      context: { ...CHUNK_CONTEXT, chunkNumber: 3 },
      generate: async () => {
        calls += 1;
        return {
          text: JSON.stringify({
            lines: VALID_CHUNK_LINES.map((line) => `${line} / packed beat`),
          }),
        };
      },
    }),
  );

  assert.equal(calls, 2);
  assert.equal(result.source, "fallback");
  assert.equal(result.attempts, 2);
  assertChunkShape(3, result.lines);
});

await test("check-in boundary streams sanitized model text and end signal", async () => {
  const deltas: string[] = [];
  const endSignals: unknown[] = [];
  const result = await streamCheckInTurn({
    history: [{ role: "patient", content: "6" }],
    context: CHECK_IN_CONTEXT,
    onDelta: (text) => deltas.push(text),
    onEndConversation: (signal) => endSignals.push(signal),
    generate: async (_history, _context, options) => {
      options.onDelta?.("Ready [when you are] — no rush.");
      return {
        text: "Ready [when you are] — no rush.",
        endConversation: { cravingScore: 6, obstacleCategory: null },
      };
    },
  });

  assert.equal(result.source, "model");
  assert.equal(result.attempts, 1);
  assert.equal(result.text, "Ready when you are, no rush.");
  assert.deepEqual(deltas, ["Ready when you are, no rush."]);
  assert.deepEqual(endSignals, [{ cravingScore: 6, obstacleCategory: null }]);
});

await test("check-in boundary accepts end signal with empty visible reply", async () => {
  const result = await streamCheckInTurn({
    history: [{ role: "patient", content: "yes" }],
    context: CHECK_IN_CONTEXT,
    generate: async () => ({
      text: "",
      endConversation: {
        cravingScore: 5,
        obstacleCategory: "mind_wandering",
      },
    }),
  });

  assert.equal(result.source, "model");
  assert.equal(result.text, "");
  assert.deepEqual(result.endConversation, {
    cravingScore: 5,
    obstacleCategory: "mind_wandering",
  });
});

await test("check-in boundary retries empty replies then falls back", async () => {
  let calls = 0;
  const deltas: string[] = [];
  const result = await withoutConsoleWarn(() =>
    streamCheckInTurn({
      history: [{ role: "patient", content: "6" }],
      context: CHECK_IN_CONTEXT,
      onDelta: (text) => deltas.push(text),
      generate: async () => {
        calls += 1;
        return { text: " ", endConversation: null };
      },
    }),
  );

  assert.equal(calls, 2);
  assert.equal(result.source, "fallback");
  assert.equal(result.attempts, 2);
  assert.equal(result.endConversation, null);
  assert.equal(result.text.length > 0, true);
  assert.deepEqual(deltas, [result.text]);
});

await test("reflection boundary validates, sanitizes, and emits progress titles", async () => {
  const titles: string[] = [];
  const result = await generateReflection(REFLECTION_CONTEXT, {
    onTitle: (title) => titles.push(title.text),
    generate: async (_input, options) => {
      assert.equal(options.maxNewTokens, 260);
      return {
        text: JSON.stringify({
          insight: "You stayed [with it] — and the wave moved.",
          journalPromptQuestion:
            "What is one sign from today you could notice again?",
          nextSteps: {
            one: "Drink water",
            two: "Text safe person",
            three: "Walk one block",
            four: "Rest 10 min",
          },
        }),
      };
    },
  });

  assert.equal(result.source, "model");
  assert.equal(result.attempts, 1);
  assert.deepEqual(titles, ["Reading the session arc", "Choosing next steps"]);
  assert.equal(result.payload.insight, "You stayed with it, and the wave moved.");
  assert.equal(
    result.payload.journalPromptQuestion,
    "What is one sign from today you could notice again?",
  );
  assert.deepEqual(result.payload.nextSteps, {
    one: "Drink water",
    two: "Text safe person",
    three: "Walk one block",
    four: "Rest 10 min",
  });
});

await test("reflection boundary retries invalid output then falls back", async () => {
  let calls = 0;
  const titles: string[] = [];
  const result = await withoutConsoleWarn(() =>
    generateReflection(REFLECTION_CONTEXT, {
      onTitle: (title) => titles.push(title.text),
      generate: async () => {
        calls += 1;
        return {
          text:
            calls === 1
              ? "{not valid json"
              : JSON.stringify({
                  insight: "too short",
                  journalPromptQuestion: "Too short?",
                  nextSteps: { one: "one" },
                }),
        };
      },
    }),
  );

  assert.equal(calls, 2);
  assert.equal(result.source, "fallback");
  assert.equal(result.attempts, 2);
  assert.equal(titles.includes("Pulling a saved reflection"), true);
  assert.equal(Object.values(result.payload.nextSteps).length, 4);
  assert.equal(result.payload.journalPromptQuestion.endsWith("?"), true);
});

await test("insights boundary parses validated local Gemma cards", async () => {
  const payload = await generateInsights(SESSIONS, {
    generate: async (sessions, options) => {
      assert.equal(sessions.length, 1);
      assert.equal(options.maxNewTokens, 620);
      return {
        text: JSON.stringify({
          insights: [
            {
              tag: "Time pattern",
              title: "Stress sessions are showing up around midday",
              body: "Your session log shows stress was present in this sample. This card stays descriptive and grounded in the provided sessions.",
            },
            {
              tag: "Medication",
              title: "On-time medication days show a completed session",
              body: "This sample includes an on-time-dose day with a completed session and a four-point intensity drop.",
            },
            {
              tag: "Body cue",
              title: "Chest sensations were named during this session",
              body: "The body region in this sample was the chest, so this card names that signal without turning it into advice.",
            },
          ],
        }),
      };
    },
  });

  assert.equal(payload.insights.length, 3);
});

await test("insights boundary rejects malformed card payloads", async () => {
  await assert.rejects(
    () =>
      generateInsights(SESSIONS, {
        generate: async () => ({
          text: JSON.stringify({ insights: [{ tag: "x" }] }),
        }),
      }),
    /unexpected shape/,
  );
});

await test("prompt and fallback contracts cover every chunk number", () => {
  for (const chunkNumber of [1, 2, 3, 4, 5] as ChunkNumber[]) {
    assertChunkShape(chunkNumber, fallbackChunk(chunkNumber).lines);
    const prompt = buildChunkPrompt({ ...CHUNK_CONTEXT, chunkNumber });
    assert.match(prompt.systemPrompt, /CHUNK NARRATION OUTPUT/);
    assert.match(prompt.userPrompt, /exactly 6 lines/i);
    assert.match(prompt.userPrompt, new RegExp(`Number ${chunkNumber} of 5`, "i"));
  }
});

console.log(`\n${passed}/${passed + failed} Gemma boundary tests passed`);
process.exit(failed === 0 ? 0 : 1);
}

void main();
