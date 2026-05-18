// Off-device test for the streaming sentence chunker.
//   node mobile/src/voice/sentence-buffer.test.ts
import assert from "node:assert/strict";
import { SentenceChunkBuffer, AsyncTextChunkStream } from "./sentence-buffer.ts";

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

await test("emits a sentence only once it's complete", () => {
  const b = new SentenceChunkBuffer();
  assert.deepEqual(b.push("Take a "), []);
  assert.deepEqual(b.push("breath"), []);
  assert.deepEqual(b.push(". Notice "), ["Take a breath."]);
  assert.deepEqual(b.flush(), ["Notice"]);
});

await test("splits multiple sentences from one delta", () => {
  const b = new SentenceChunkBuffer();
  assert.deepEqual(b.push("One. Two! Three? Four"), [
    "One.",
    "Two!",
    "Three?",
  ]);
  assert.deepEqual(b.flush(), ["Four"]);
});

await test("long run with no sentence end breaks at a soft boundary", () => {
  const b = new SentenceChunkBuffer(8);
  const out = b.push(
    "one two three four five six seven, eight nine ten eleven twelve",
  );
  assert.equal(out.length, 1);
  assert.ok(out[0].endsWith(","), `expected soft-boundary cut, got "${out[0]}"`);
});

await test("flush on empty / whitespace yields nothing", () => {
  const b = new SentenceChunkBuffer();
  assert.deepEqual(b.push("   "), []);
  assert.deepEqual(b.flush(), []);
});

await test("AsyncTextChunkStream: enqueue before and after a reader", async () => {
  const s = new AsyncTextChunkStream();
  s.enqueue("a");
  const it = s[Symbol.asyncIterator]();
  assert.deepEqual(await it.next(), { value: "a", done: false });
  const pending = it.next(); // reader waits
  s.enqueue("b");
  assert.deepEqual(await pending, { value: "b", done: false });
  s.close();
  assert.deepEqual(await it.next(), { value: undefined, done: true });
});

await test("AsyncTextChunkStream: drains queued then closes", async () => {
  const s = new AsyncTextChunkStream();
  s.enqueue("x");
  s.enqueue("y");
  s.close();
  const got: string[] = [];
  for await (const c of s) got.push(c);
  assert.deepEqual(got, ["x", "y"]);
});

console.log(`\n${passed} passed${process.exitCode ? " (with FAILURES)" : ""}`);
