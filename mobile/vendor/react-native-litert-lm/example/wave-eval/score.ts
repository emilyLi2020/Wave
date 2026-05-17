/**
 * score.ts — on-device port of eval/run.mjs scoring (Layer 3).
 *
 * Same gates as the committed Layer 1 harness so device results are directly
 * comparable: broken-quant signatures, surface-structure, and a
 * paraphrase-robust bag-of-words cosine vs the LiteRT reference (char/word
 * edit distance kept informational). Dependency-free.
 */

export type WavePrompt = {
  key: string;
  maxNewTokens: number;
  systemPrompt: string;
  userPrompt: string;
};

export type WaveRef = {
  key: string;
  input_tokens: number;
  output_tokens: number;
  tokens_per_second: number;
  output: string;
};

export type WaveScore = {
  key: string;
  chars: number;
  cosine: number;
  charDist: number;
  wordDist: number;
  padToken: boolean;
  unicodeLoop: boolean;
  toolTokens: boolean;
  structureOk: boolean;
  notes: string[];
  pass: boolean;
};

function normWs(s: string): string {
  return String(s).replace(/\s+/g, " ").trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array(b.length + 1);
  let cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

function normEditDistance(a: string, b: string): number {
  const x = normWs(a).toLowerCase();
  const y = normWs(b).toLowerCase();
  const denom = Math.max(x.length, y.length) || 1;
  return levenshtein(x, y) / denom;
}

const STOP = new Set(
  (
    "a an the of to in on at is are was were be been being and or " +
    "but if then so as it its this that these those you your we our they them their " +
    "i me my for with from into out up down over under not no yes do does did can will " +
    "would could should may might just about like what when where how which who"
  ).split(" "),
);

function tokenize(s: string): string[] {
  return normWs(s)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function bowCosine(a: string, b: string): number {
  const va = new Map<string, number>();
  const vb = new Map<string, number>();
  for (const t of tokenize(a)) if (!STOP.has(t)) va.set(t, (va.get(t) || 0) + 1);
  for (const t of tokenize(b)) if (!STOP.has(t)) vb.set(t, (vb.get(t) || 0) + 1);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [, c] of va) na += c * c;
  for (const [, c] of vb) nb += c * c;
  for (const [t, c] of va) if (vb.has(t)) dot += c * (vb.get(t) as number);
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d ? dot / d : 0;
}

function wordEditDistance(a: string, b: string): number {
  const wa = tokenize(a);
  const wb = tokenize(b);
  const vocab = new Map<string, string>();
  const enc = (arr: string[]) =>
    arr
      .map((t) => {
        if (!vocab.has(t)) vocab.set(t, String.fromCharCode(0xe000 + vocab.size));
        return vocab.get(t) as string;
      })
      .join("");
  const ea = enc(wa);
  const eb = enc(wb);
  const denom = Math.max(ea.length, eb.length) || 1;
  return levenshtein(ea, eb) / denom;
}

function detectGarbage(text: string) {
  const padHits = (text.match(/<pad>/gi) || []).length;
  const padToken = padHits >= 3;
  const unicodeLoop =
    /([^\sA-Za-z0-9])\1{11,}/u.test(text) || /ˌ{6,}/u.test(text);
  return { padToken, unicodeLoop };
}

function tryParseLooseJson(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  const s = candidate.indexOf("{");
  const e = candidate.lastIndexOf("}");
  if (s === -1 || e === -1 || e < s) return null;
  try {
    return JSON.parse(candidate.slice(s, e + 1));
  } catch {
    return null;
  }
}

function surfaceGate(key: string, text: string) {
  const notes: string[] = [];
  let structureOk = true;
  if (key === "reflection") {
    const obj = tryParseLooseJson(text);
    if (!obj) {
      structureOk = false;
      notes.push("reflection: NOT valid JSON");
    } else {
      const hasKeys =
        obj.insight != null &&
        obj.journalPromptQuestion != null &&
        obj.nextSteps &&
        ["one", "two", "three", "four"].every((k) => obj.nextSteps[k] != null);
      if (!hasKeys) {
        structureOk = false;
        notes.push("reflection: JSON missing WAVE schema keys");
      }
      if (obj.insight && !/\d/.test(String(obj.insight)))
        notes.push("reflection: insight has no numeric endingIntensity (soft)");
    }
  } else {
    const t = text.trim();
    if (t.length < 40) {
      structureOk = false;
      notes.push(`${key}: output too short (${t.length} chars)`);
    }
    if (
      /\bI('?m| am) (a|an) (large )?language model\b|\bI cannot\b.*\bAI\b|as an AI\b/i.test(
        t,
      )
    ) {
      structureOk = false;
      notes.push(`${key}: base-Gemma assistant-disclaimer voice`);
    }
  }
  return { structureOk, notes };
}

/** Score one surface against its LiteRT reference. Mirrors eval/run.mjs gates. */
export function scoreOutput(
  key: string,
  text: string,
  ref: WaveRef | undefined,
): WaveScore {
  const garbage = detectGarbage(text);
  const gate = surfaceGate(key, text);
  const charDist = ref ? normEditDistance(text, ref.output) : 1;
  const wordDist = ref ? wordEditDistance(text, ref.output) : 1;
  const cosine = ref ? bowCosine(text, ref.output) : 0;
  const toolTokens =
    text.includes("<|tool_call>") && text.includes("<tool_call|>");

  const isJson = key === "reflection";
  const simFail = ref
    ? isJson
      ? charDist >= 0.4 || cosine < 0.55
      : cosine < 0.45
    : true;

  const pass =
    !garbage.padToken &&
    !garbage.unicodeLoop &&
    gate.structureOk &&
    text.trim().length > 0 &&
    !simFail;

  return {
    key,
    chars: text.trim().length,
    cosine,
    charDist,
    wordDist,
    padToken: garbage.padToken,
    unicodeLoop: garbage.unicodeLoop,
    toolTokens,
    structureOk: gate.structureOk,
    notes: gate.notes,
    pass,
  };
}

/** Combined prompt = systemPrompt + blank line + userPrompt (matches Layer 1). */
export function combinedPrompt(p: WavePrompt): string {
  return `${p.systemPrompt.replace(/\s+$/, "")}\n\n${p.userPrompt}`;
}
