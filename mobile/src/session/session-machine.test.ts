// Off-device test for the session reducer + the demo/standard run
// length (the toggle on Home). Run directly:
//   node mobile/src/session/session-machine.test.ts
// (Node 24 strips the TS types; this module has only type imports.)

import assert from "node:assert/strict";

import {
  initialState,
  reducer,
  DEMO_TOTAL_CHUNKS,
  STANDARD_TOTAL_CHUNKS,
  type State,
  type IntakeAnswers,
} from "./session-machine.ts";

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`FAIL  ${name}\n`, e);
    process.exitCode = 1;
  }
}

const intake = (demoMode: boolean): IntakeAnswers => ({
  intakeIntensity: 7,
  matType: "buprenorphine",
  medicationStatus: "on_time",
  trigger: "stress",
  triggerOther: null,
  demoMode,
});

function runFullFlow(demoMode: boolean): State {
  let s = initialState();
  s = reducer(s, { type: "intakeSubmitted", answers: intake(demoMode) });
  s = reducer(s, {
    type: "safetyResolved",
    outcome: { kind: "proceed", usedSubstanceToday: false },
  });
  // loop chunk → check-in until the reducer routes to reflection.
  let guard = 0;
  while (s.phase !== "reflection" && guard++ < 20) {
    assert.equal(s.phase, "loadingChunk", `expected loadingChunk, got ${s.phase}`);
    const n = s.currentChunk;
    s = reducer(s, {
      type: "chunkGenerated",
      chunk: { id: n, title: "t", segments: [{ type: "text", content: "x" }] },
      lines: ["x"],
      source: "model",
    });
    assert.equal(s.phase, "chunk");
    s = reducer(s, { type: "chunkCompleted" });
    assert.equal(s.phase, "checkIn");
    s = reducer(s, {
      type: "checkInCompleted",
      checkIn: {
        chunkNumber: n,
        cravingScore: 5,
        turns: [],
        obstacleCategory: null,
        readyToContinue: n >= s.totalChunks ? null : true,
        startedAt: 0,
        endedAt: 0,
      },
    });
  }
  return s;
}

test("intakeSubmitted: demo sets totalChunks = 2", () => {
  const s = reducer(initialState(), {
    type: "intakeSubmitted",
    answers: intake(true),
  });
  assert.equal(s.demoMode, true);
  assert.equal(s.totalChunks, DEMO_TOTAL_CHUNKS);
  assert.equal(s.totalChunks, 2);
  assert.equal(s.phase, "safety");
});

test("intakeSubmitted: standard sets totalChunks = 5", () => {
  const s = reducer(initialState(), {
    type: "intakeSubmitted",
    answers: intake(false),
  });
  assert.equal(s.totalChunks, STANDARD_TOTAL_CHUNKS);
  assert.equal(s.totalChunks, 5);
});

test("demo flow reaches reflection after exactly 2 check-ins", () => {
  const s = runFullFlow(true);
  assert.equal(s.phase, "reflection");
  assert.equal(s.checkIns.length, 2);
});

test("standard flow reaches reflection after exactly 5 check-ins", () => {
  const s = runFullFlow(false);
  assert.equal(s.phase, "reflection");
  assert.equal(s.checkIns.length, 5);
});

test("safety handoff short-circuits to safetyHandoff", () => {
  let s = reducer(initialState(), {
    type: "intakeSubmitted",
    answers: intake(true),
  });
  s = reducer(s, { type: "safetyResolved", outcome: { kind: "handoff" } });
  assert.equal(s.phase, "safetyHandoff");
  assert.equal(s.outcome, "safety_exited");
});

test("sessionHistory accumulates chunk + checkIn entries", () => {
  const s = runFullFlow(true);
  // 2 rounds → 2 chunk + 2 checkIn entries.
  assert.equal(s.sessionHistory.filter((e) => e.kind === "chunk").length, 2);
  assert.equal(s.sessionHistory.filter((e) => e.kind === "checkIn").length, 2);
});

test("nextStepPicked + sessionFinished close the session", () => {
  let s = runFullFlow(true);
  s = reducer(s, { type: "nextStepPicked", choice: "water" });
  assert.equal(s.pickedNextStep, "water");
  s = reducer(s, { type: "sessionFinished" });
  assert.equal(s.phase, "done");
  assert.equal(s.outcome, "completed");
});

console.log(`\nsession-machine: ${passed} passed`);
