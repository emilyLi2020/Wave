/* eslint-disable no-console */
/**
 * Smoke-tests the two LLM endpoints the new session loop depends on:
 *
 *   POST /api/chunk     — JSON-in, JSON-out (structured-output `{ lines: string[] }`)
 *   POST /api/checkin   — JSON-in, SSE-out (text deltas + optional `end_conversation` tool event)
 *
 * Run against a live `pnpm run dev` on http://localhost:3000:
 *
 *   node scripts/test-llm-endpoints.mjs
 *
 * Skips cleanly if OPENAI_API_KEY is not configured (route returns 500 with a
 * specific error code).
 */

const BASE = process.env.WAVE_BASE_URL ?? "http://localhost:3000";

const PROFILE = {
  matType: "buprenorphine",
  medicationStatus: "on_time",
  trigger: "stress",
  triggerOther: null,
  usedSubstanceToday: false,
};

const INTAKE_INTENSITY = 7;

let totalAssertions = 0;
let failedAssertions = 0;

function assert(condition, label, detail) {
  totalAssertions += 1;
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failedAssertions += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function postJson(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* leave json null */
  }
  return { status: res.status, text, json };
}

async function postSSE(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => "");
    throw new Error(`SSE request failed: ${res.status} ${errText}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let frameEnd;
    while ((frameEnd = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, frameEnd);
      buffer = buffer.slice(frameEnd + 2);
      let event = "message";
      const dataLines = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      const data = dataLines.join("\n");
      events.push({ event, data });
    }
  }
  return events;
}

// ---------------------------------------------------------------------------
// Test 1 — chunk 1 (no history)
// ---------------------------------------------------------------------------

async function testChunk1() {
  console.log("\n[1] /api/chunk  chunk=1, no history");
  const result = await postJson("/api/chunk", {
    context: {
      chunkNumber: 1,
      intakeIntensity: INTAKE_INTENSITY,
      profile: PROFILE,
      sessionHistory: [],
    },
  });
  assert(result.status === 200, `HTTP 200 (got ${result.status})`, result.text.slice(0, 200));
  if (result.status !== 200) return null;
  assert(Array.isArray(result.json?.lines), "response has `lines` array");
  assert(result.json?.lines?.length === 6, `lines.length === 6 (got ${result.json?.lines?.length})`);
  for (const [idx, line] of (result.json?.lines ?? []).entries()) {
    assert(typeof line === "string" && line.trim().length >= 12, `line[${idx}] is non-trivial string`);
  }
  console.log("  ---- lines ----");
  for (const [idx, line] of (result.json?.lines ?? []).entries()) {
    console.log(`  ${String(idx + 1).padStart(2, "0")}  ${line}`);
  }
  return result.json?.lines ?? null;
}

// ---------------------------------------------------------------------------
// Test 2 — chunk 2 (with prior chunk + check-in in history)
// ---------------------------------------------------------------------------

async function testChunk2(chunk1Lines) {
  console.log("\n[2] /api/chunk  chunk=2, history=chunk1 + check-in 1");
  const sessionHistory = [
    { kind: "chunk", chunkNumber: 1, lines: chunk1Lines ?? ["Welcome — let's begin."] },
    {
      kind: "checkIn",
      chunkNumber: 1,
      cravingScore: 6,
      obstacleCategory: "mind_wandering",
      turns: [
        { role: "patient", content: "6/10" },
        { role: "agent", content: "Thanks for that. How is it sitting in your body right now?" },
        { role: "patient", content: "Tight in my chest, kind of restless." },
        {
          role: "agent",
          content:
            "That tightness makes sense — your nervous system is doing a lot. Want to try one slow exhale before we keep going?",
        },
        { role: "patient", content: "Yeah, ok, ready to continue." },
      ],
    },
  ];

  const result = await postJson("/api/chunk", {
    context: {
      chunkNumber: 2,
      intakeIntensity: INTAKE_INTENSITY,
      profile: PROFILE,
      sessionHistory,
    },
  });
  assert(result.status === 200, `HTTP 200 (got ${result.status})`, result.text.slice(0, 200));
  if (result.status !== 200) return;
  assert(Array.isArray(result.json?.lines) && result.json.lines.length === 6, "6 lines back");
  console.log("  ---- lines ----");
  for (const [idx, line] of (result.json?.lines ?? []).entries()) {
    console.log(`  ${String(idx + 1).padStart(2, "0")}  ${line}`);
  }
}

// ---------------------------------------------------------------------------
// Test 3 — check-in Turn 1 (just the score)
// ---------------------------------------------------------------------------

async function testCheckInTurn1() {
  console.log("\n[3] /api/checkin  turn 1 (patient sends score 7/10)");
  const ctx = {
    chunkNumber: 1,
    cravingScore: 7,
    scoreHistory: [],
    obstacleHint: null,
    profile: PROFILE,
    intakeIntensity: INTAKE_INTENSITY,
    sessionHistory: [{ kind: "chunk", chunkNumber: 1, lines: ["Welcome.", "Settle in."] }],
  };
  const events = await postSSE("/api/checkin", {
    history: [{ role: "patient", content: "7/10" }],
    context: ctx,
  });
  const deltas = events.filter((e) => e.event === "delta");
  const dones = events.filter((e) => e.event === "done");
  const ends = events.filter((e) => e.event === "end_conversation");
  const errors = events.filter((e) => e.event === "error");
  assert(errors.length === 0, "no error events", errors.map((e) => e.data).join(" / "));
  assert(deltas.length > 0, `received delta events (got ${deltas.length})`);
  assert(dones.length === 1, `exactly one done event (got ${dones.length})`);
  assert(ends.length === 0, "no premature end_conversation on turn 1");
  let finalText = "";
  if (dones[0]) {
    try {
      finalText = JSON.parse(dones[0].data).text ?? "";
    } catch {
      /* leave empty */
    }
  }
  assert(finalText.length > 20, `agent reply has substance (len=${finalText.length})`);
  console.log(`  ---- agent reply ----\n  ${finalText}`);
  return finalText;
}

// ---------------------------------------------------------------------------
// Test 4 — drive a short conversation that should end with endConversation
// ---------------------------------------------------------------------------

async function testCheckInEndConversation(firstAgentReply) {
  console.log("\n[4] /api/checkin  late turn — patient signals readiness");
  const ctx = {
    chunkNumber: 1,
    cravingScore: 7,
    scoreHistory: [],
    obstacleHint: null,
    profile: PROFILE,
    intakeIntensity: INTAKE_INTENSITY,
    sessionHistory: [{ kind: "chunk", chunkNumber: 1, lines: ["Welcome.", "Settle in."] }],
  };
  const history = [
    { role: "patient", content: "7/10" },
    { role: "agent", content: firstAgentReply || "Thanks. How is it landing in your body right now?" },
    { role: "patient", content: "Tight in my chest, kinda restless." },
    {
      role: "agent",
      content:
        "That tightness makes sense — your nervous system is doing a lot. Anything else getting in the way?",
    },
    { role: "patient", content: "No, I think I'm good. Ready to keep going." },
  ];

  const events = await postSSE("/api/checkin", { history, context: ctx });
  const ends = events.filter((e) => e.event === "end_conversation");
  const errors = events.filter((e) => e.event === "error");
  const dones = events.filter((e) => e.event === "done");
  assert(errors.length === 0, "no error events", errors.map((e) => e.data).join(" / "));
  assert(dones.length === 1, "exactly one done event");
  assert(
    ends.length === 1,
    `endConversation tool fired (got ${ends.length})`,
    "model did not call the tool — readiness phrasing may need to be stronger"
  );
  if (ends[0]) {
    let parsed = null;
    try {
      parsed = JSON.parse(ends[0].data);
    } catch {
      /* leave null */
    }
    console.log(`  ---- end_conversation payload ----\n  ${JSON.stringify(parsed, null, 2)}`);
    assert(typeof parsed?.cravingScore === "number", "endConversation echoes cravingScore");
    assert(
      parsed?.obstacleCategory === null ||
        typeof parsed?.obstacleCategory === "string",
      "endConversation includes obstacleCategory (string or null)"
    );
  }
}

// ---------------------------------------------------------------------------
// Test 4a — server MUST suppress endConversation on the first agent turn
// (regression: model was sometimes firing the tool right after the score,
// which short-circuited the check-in and skipped the conversation entirely)
// ---------------------------------------------------------------------------

async function testCheckInNoEarlyEnd() {
  console.log("\n[4a] /api/checkin  demoMode=true, only score sent — no early end");
  const ctx = {
    chunkNumber: 1,
    cravingScore: 7,
    scoreHistory: [],
    obstacleHint: null,
    profile: PROFILE,
    intakeIntensity: INTAKE_INTENSITY,
    sessionHistory: [{ kind: "chunk", chunkNumber: 1, lines: ["Welcome.", "Settle in."] }],
    demoMode: true,
  };
  const history = [{ role: "patient", content: "7/10" }];
  const events = await postSSE("/api/checkin", { history, context: ctx });
  const ends = events.filter((e) => e.event === "end_conversation");
  const deltas = events.filter((e) => e.event === "delta");
  const errors = events.filter((e) => e.event === "error");
  assert(errors.length === 0, "no error events", errors.map((e) => e.data).join(" / "));
  assert(
    ends.length === 0,
    `no end_conversation on first agent turn (got ${ends.length})`,
    "server-side early-end guard may be missing",
  );
  assert(deltas.length > 0, `agent produced text (got ${deltas.length} delta events)`);
}

// ---------------------------------------------------------------------------
// Test 4b — demo mode forces endConversation after one free-text patient turn
// ---------------------------------------------------------------------------

async function testCheckInDemoMode() {
  console.log(
    "\n[4b] /api/checkin  demoMode=true — closing turn is text only (no tool, client backstop drives the jump)",
  );
  const ctx = {
    chunkNumber: 2,
    cravingScore: 5,
    scoreHistory: [6],
    obstacleHint: null,
    profile: PROFILE,
    intakeIntensity: INTAKE_INTENSITY,
    sessionHistory: [
      { kind: "chunk", chunkNumber: 1, lines: ["Welcome.", "Settle in."] },
      { kind: "chunk", chunkNumber: 2, lines: ["Body scan.", "Notice the chest."] },
    ],
    demoMode: true,
  };
  // score + 1 agent reply + 1 free-text patient reply — the model's next
  // output should be the endConversation tool call, not more text.
  const history = [
    { role: "patient", content: "5/10" },
    {
      role: "agent",
      content:
        "5 out of 10 — thanks for that. How was the body scan for you?",
    },
    { role: "patient", content: "Still a bit tight in my chest." },
  ];

  const events = await postSSE("/api/checkin", { history, context: ctx });
  const ends = events.filter((e) => e.event === "end_conversation");
  const deltas = events.filter((e) => e.event === "delta");
  const errors = events.filter((e) => e.event === "error");
  const dones = events.filter((e) => e.event === "done");
  // New demo contract: tool is unavailable in demo mode and the
  // client-side backstop in CheckInChat synthesizes the end-conversation
  // signal after the AI's 2nd text turn finishes streaming. So we
  // expect text-only here — no end_conversation event.
  assert(errors.length === 0, "no error events", errors.map((e) => e.data).join(" / "));
  assert(dones.length === 1, "exactly one done event");
  assert(
    ends.length === 0,
    `no end_conversation event in demo mode (got ${ends.length}); the client backstop drives the jump`,
  );
  assert(
    deltas.length > 0,
    `closing turn includes hand-off text (got ${deltas.length} text deltas)`,
  );
  // Quick eyeball on the closing reply (each delta data is a
  // JSON-encoded string fragment).
  const closing = deltas
    .map((e) => {
      try {
        const parsed = JSON.parse(e.data);
        return typeof parsed === "string" ? parsed : "";
      } catch {
        return "";
      }
    })
    .join("");
  console.log(`  ---- closing reply ----\n  ${closing.slice(0, 240)}`);
}

// ---------------------------------------------------------------------------
// Test 5 — invalid bodies (schema validation)
// ---------------------------------------------------------------------------

async function testValidation() {
  console.log("\n[5] schema validation (both routes)");

  // 5a — /api/chunk without context
  const a = await postJson("/api/chunk", { foo: "bar" });
  assert(a.status === 400, `/api/chunk rejects missing context (got ${a.status})`);
  assert(a.json?.error === "invalid_request", "/api/chunk error code is invalid_request");

  // 5b — /api/chunk with chunkNumber out of range
  const b = await postJson("/api/chunk", {
    context: {
      chunkNumber: 9,
      intakeIntensity: INTAKE_INTENSITY,
      profile: PROFILE,
      sessionHistory: [],
    },
  });
  assert(b.status === 400, `/api/chunk rejects chunkNumber=9 (got ${b.status})`);

  // 5c — /api/checkin missing context
  const c = await postJson("/api/checkin", { history: [] });
  assert(c.status === 400, `/api/checkin rejects missing context (got ${c.status})`);

  // 5d — /api/checkin with cravingScore out of range
  const d = await postJson("/api/checkin", {
    history: [{ role: "patient", content: "12/10" }],
    context: {
      chunkNumber: 1,
      cravingScore: 12,
      scoreHistory: [],
      obstacleHint: null,
      profile: PROFILE,
      intakeIntensity: INTAKE_INTENSITY,
      sessionHistory: [],
    },
  });
  assert(d.status === 400, `/api/checkin rejects cravingScore=12 (got ${d.status})`);
}

// ---------------------------------------------------------------------------

(async () => {
  const start = Date.now();
  let chunk1Lines = null;
  try {
    chunk1Lines = await testChunk1();
    await testChunk2(chunk1Lines);
    const reply = await testCheckInTurn1();
    await testCheckInEndConversation(reply);
    await testCheckInNoEarlyEnd();
    await testCheckInDemoMode();
    await testValidation();
  } catch (err) {
    failedAssertions += 1;
    console.error("\n[FATAL]", err);
  }
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(
    `\n=== ${totalAssertions - failedAssertions}/${totalAssertions} assertions passed in ${elapsed}s ===`
  );
  process.exit(failedAssertions === 0 ? 0 : 1);
})();
