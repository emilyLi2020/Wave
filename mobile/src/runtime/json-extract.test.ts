// Off-device test for the noisy-LLM JSON extractor.
// No jest, no simulator — run directly:
//   node mobile/src/runtime/json-extract.test.ts
// (Node 24 strips the TS types.)
//
// Covers exactly the failure that forced "scripted fallback": stock
// Gemma 4 wrapping its JSON in ```json fences, prose, reasoning, and
// emitting more than one brace block.

import assert from "node:assert/strict";

import { extractFirstJsonObject } from "./json-extract.ts";

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

// The shape the chunk boundary needs.
const CHUNK = { lines: ["a", "b", "c", "d", "e", "f"] };
const j = JSON.stringify(CHUNK);

test("bare object", () => {
  assert.deepEqual(JSON.parse(extractFirstJsonObject(j)), CHUNK);
});

test("```json fenced", () => {
  const raw = "```json\n" + j + "\n```";
  assert.deepEqual(JSON.parse(extractFirstJsonObject(raw)), CHUNK);
});

test("prose before + after", () => {
  const raw = `Sure! Here is the narration:\n\n${j}\n\nLet me know if you want changes.`;
  assert.deepEqual(JSON.parse(extractFirstJsonObject(raw)), CHUNK);
});

test("reasoning then a SECOND brace block (the scripted-fallback bug)", () => {
  // Old slice(first {, last }) swept both → JSON.parse threw.
  const raw =
    `Thinking: the patient is at a 7 {note: high}.\n` +
    `${j}\n` +
    `Also consider: {alt: "ignore"}`;
  assert.deepEqual(JSON.parse(extractFirstJsonObject(raw)), CHUNK);
});

test("braces inside string values don't miscount", () => {
  const obj = { reply: "use {this} and { that }", endConversation: null };
  const raw = "```json " + JSON.stringify(obj) + " ```";
  assert.deepEqual(JSON.parse(extractFirstJsonObject(raw)), obj);
});

test("nested object (check-in endConversation)", () => {
  const obj = {
    reply: "Okay, a six.",
    endConversation: { cravingScore: 6, obstacleCategory: "urge_overwhelming" },
  };
  const raw = `Here:\n${JSON.stringify(obj)}\nThanks.`;
  assert.deepEqual(JSON.parse(extractFirstJsonObject(raw)), obj);
});

test("escaped quote inside string", () => {
  // Raw JSON written literally so the \" escape stays intact.
  const raw = '{"reply": "she said \\"hi\\" then left", "endConversation": null}';
  assert.equal(extractFirstJsonObject(`noise ${raw} noise`), raw);
  assert.equal(JSON.parse(raw).reply, 'she said "hi" then left');
});

test("no JSON at all → trimmed text (parse will fail → fallback)", () => {
  assert.equal(extractFirstJsonObject("  totally not json  "), "totally not json");
});

test("unterminated object → from first brace (parse fails → fallback)", () => {
  const raw = 'prefix {"lines": ["a","b"';
  assert.equal(extractFirstJsonObject(raw), '{"lines": ["a","b"');
});

console.log(`\njson-extract: ${passed} passed`);
