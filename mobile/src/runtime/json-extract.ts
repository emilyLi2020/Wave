// Pure, dependency-free JSON extraction for noisy LLM output.
//
// Split out of litert-generators.ts (which imports the native
// react-native-litert-lm and so can't run under Node) specifically so
// this — the function that decides whether stock Gemma's output is
// usable or gets thrown away into the scripted fallback — is unit
// -testable off-device. The production path re-exports this exact
// symbol; there is no second copy.

// String-aware scan of the balanced object that opens at `text[from]`
// (which must be "{"). Returns its slice, or null if never closed.
// Braces inside JSON string values don't miscount.
function balancedFrom(text: string, from: number): string | null {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(from, i + 1);
    }
  }
  return null;
}

// Returns the first balanced top-level object in `text` that actually
// `JSON.parse`s.
//
// Stock Gemma 4 is verbose: reasoning prose, ```json fences, and often
// more than one brace block — including pseudo-braces in the reasoning
// itself ("the patient is at a 7 {note: high}"). A naive slice(first
// "{", last "}") swept everything → parse error → two strikes →
// scripted fallback (the "why is it scripted" symptom). Even "first
// balanced object" is wrong when reasoning braces precede the real
// JSON. So: walk every "{", take its balanced span, and return the
// first span that is valid JSON. Schema validation at the call site is
// the second guard. If none parse, hand back the first-brace slice so
// JSON.parse throws meaningfully and the two-strikes fallback engages.
export function extractFirstJsonObject(text: string): string {
  const first = text.indexOf("{");
  if (first === -1) return text.trim();
  for (let i = text.indexOf("{"); i !== -1; i = text.indexOf("{", i + 1)) {
    const span = balancedFrom(text, i);
    if (span == null) break; // no balanced close anywhere past here
    try {
      JSON.parse(span);
      return span;
    } catch {
      /* not valid JSON here — try the next "{" */
    }
  }
  const firstSpan = balancedFrom(text, first);
  return firstSpan ?? text.slice(first).trim();
}
