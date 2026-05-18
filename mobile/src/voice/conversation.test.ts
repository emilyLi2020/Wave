// Off-device test for the voice-loop conversation/turn logic.
// No jest, no simulator, no voice — run directly:
//   node mobile/src/voice/conversation.test.ts
// (Node 24 strips the TS types.) Exercises exactly the reported bugs:
// transcript overwrite and "2nd turn didn't respond".

import assert from "node:assert/strict";
import {
  ConversationController,
  extractToolCall,
  sanitizeForVoice,
} from "./conversation.ts";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`FAIL  ${name}`);
    console.error(e);
    process.exitCode = 1;
  }
}

// A scripted LLM: returns the next canned reply per call, recording the
// user text it was given so we can assert multi-turn context is passed.
function scriptedSend(replies: string[]) {
  const seen: string[] = [];
  let i = 0;
  const send = async (userText: string) => {
    seen.push(userText);
    return replies[i++] ?? "(no more scripted replies)";
  };
  return { send, seen };
}

await test("single turn appends user + assistant", async () => {
  const c = new ConversationController();
  const { send } = scriptedSend(["Thanks for sharing. How's your chest now?"]);
  await c.runTurn("My craving is about a six", send);
  assert.equal(c.messages.length, 2);
  assert.deepEqual(
    c.messages.map((m) => m.role),
    ["user", "assistant"],
  );
  assert.equal(c.messages[0].text, "My craving is about a six");
  assert.equal(c.messages[1].text, "Thanks for sharing. How's your chest now?");
});

await test("2nd turn ACCUMULATES, does not overwrite (the bug)", async () => {
  const c = new ConversationController();
  const { send, seen } = scriptedSend([
    "Okay, a six. What's happening in your body?",
    "That tightness makes sense. Are you ready to keep going?",
  ]);
  await c.runTurn("about a six", send);
  await c.runTurn("my chest feels tight", send);
  // 2 turns => 4 messages, in order, nothing overwritten.
  assert.equal(c.messages.length, 4, "history must accumulate to 4 messages");
  assert.deepEqual(
    c.messages.map((m) => `${m.role}:${m.text}`),
    [
      "user:about a six",
      "assistant:Okay, a six. What's happening in your body?",
      "user:my chest feels tight",
      "assistant:That tightness makes sense. Are you ready to keep going?",
    ],
  );
  // Turn 2 actually invoked the LLM with the 2nd transcript.
  assert.deepEqual(seen, ["about a six", "my chest feels tight"]);
});

await test("3 turns stay ordered", async () => {
  const c = new ConversationController();
  const { send } = scriptedSend(["r1", "r2", "r3"]);
  await c.runTurn("u1", send);
  await c.runTurn("u2", send);
  await c.runTurn("u3", send);
  assert.equal(c.messages.length, 6);
  assert.deepEqual(
    c.messages.map((m) => m.text),
    ["u1", "r1", "u2", "r2", "u3", "r3"],
  );
});

await test("empty / whitespace transcript is skipped (no LLM call)", async () => {
  const c = new ConversationController();
  const { send, seen } = scriptedSend(["should not be used"]);
  const r1 = await c.runTurn("", send);
  const r2 = await c.runTurn("   ", send);
  assert.equal(r1, null);
  assert.equal(r2, null);
  assert.equal(c.messages.length, 0);
  assert.equal(seen.length, 0);
});

await test("tool call is parsed and stripped from the spoken reply", async () => {
  const c = new ConversationController();
  const { send } = scriptedSend([
    "You did real work today. Take care.\nendConversation{cravingScore:4,obstacleCategory:none}",
  ]);
  const r = await c.runTurn("yeah I'm ready", send);
  assert.ok(r);
  assert.equal(r.reply, "You did real work today. Take care.");
  assert.equal(r.tool, "endConversation{cravingScore:4,obstacleCategory:none}");
  // The visible assistant message must NOT contain the tool literal.
  assert.ok(!c.messages[1].text.includes("endConversation"));
  assert.equal(
    c.messages[1].tool,
    "endConversation{cravingScore:4,obstacleCategory:none}",
  );
});

await test("a turn arriving mid-flight is queued, then runs (serialized)", async () => {
  const c = new ConversationController();
  const order: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((res) => (release = res));
  let call = 0;
  const send = async (u: string) => {
    order.push(`start:${u}`);
    if (call++ === 0) await gate; // hold turn 1 in flight
    order.push(`end:${u}`);
    return `reply-to-${u}`;
  };
  const t1 = c.runTurn("first", send);
  const t2 = c.runTurn("second", send); // arrives while turn 1 in flight
  // turn 2 must be queued (not started) until turn 1 finishes
  assert.deepEqual(order, ["start:first"]);
  release();
  await Promise.all([t1, t2]);
  assert.deepEqual(order, [
    "start:first",
    "end:first",
    "start:second",
    "end:second",
  ]);
  assert.deepEqual(
    c.messages.map((m) => m.text),
    ["first", "reply-to-first", "second", "reply-to-second"],
  );
});

await test("only the LATEST queued turn runs (latest-wins)", async () => {
  const c = new ConversationController();
  let release!: () => void;
  const gate = new Promise<void>((res) => (release = res));
  let call = 0;
  const send = async (u: string) => {
    if (call++ === 0) await gate;
    return `R(${u})`;
  };
  const t1 = c.runTurn("a", send);
  c.runTurn("b", send); // queued
  c.runTurn("c", send); // replaces b
  release();
  await t1;
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(
    c.messages.map((m) => m.text),
    ["a", "R(a)", "c", "R(c)"],
    "b should have been superseded by c",
  );
});

await test("extractToolCall: no tool => reply passthrough", () => {
  const { reply, tool } = extractToolCall("  just a normal reply  ");
  assert.equal(reply, "just a normal reply");
  assert.equal(tool, null);
});

await test("sanitizeForVoice strips emoji", () => {
  assert.equal(
    sanitizeForVoice("Hello! How can I help you today? 😊"),
    "Hello! How can I help you today?",
  );
  assert.equal(sanitizeForVoice("Nice 👍🏽 work 🎉"), "Nice work");
});

await test("sanitizeForVoice strips markdown", () => {
  assert.equal(
    sanitizeForVoice("**Tip:** try _box breathing_ now"),
    "Tip: try box breathing now",
  );
  assert.equal(
    sanitizeForVoice("# Heading\n- one\n- two\n> quote"),
    "Heading one two quote",
  );
  assert.equal(
    sanitizeForVoice("see [the guide](https://x.com/y) please"),
    "see the guide please",
  );
});

await test("sanitizeForVoice strips double quotes, keeps apostrophes", () => {
  assert.equal(
    sanitizeForVoice('He said "take a breath" and it’s okay'),
    "He said take a breath and it’s okay",
  );
  assert.equal(
    sanitizeForVoice("Don't worry, you're doing fine."),
    "Don't worry, you're doing fine.",
  );
});

await test("sanitizeForVoice keeps normal prose + punctuation intact", () => {
  const s = "A six, and it's still in your chest — that's worth naming.";
  assert.equal(sanitizeForVoice(s), s);
});

await test("runTurn stores the sanitized reply (no emoji/markdown)", async () => {
  const c = new ConversationController();
  const { send } = scriptedSend(["**Hey!** I hear you 😊 Take a breath."]);
  const r = await c.runTurn("hi", send);
  assert.ok(r);
  assert.equal(r.reply, "Hey! I hear you Take a breath.");
  assert.equal(c.messages[1].text, "Hey! I hear you Take a breath.");
  assert.ok(!/[*_😊]/.test(c.messages[1].text));
});

await test("reset clears history", async () => {
  const c = new ConversationController();
  const { send } = scriptedSend(["r1"]);
  await c.runTurn("u1", send);
  assert.equal(c.messages.length, 2);
  c.reset();
  assert.equal(c.messages.length, 0);
});

console.log(`\n${passed} passed${process.exitCode ? " (with FAILURES)" : ""}`);
