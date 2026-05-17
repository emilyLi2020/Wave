#!/usr/bin/env node
/**
 * eval/run.mjs — Layer 1 CLI smoke test for the WAVE LiteRT-LM bundle.
 *
 * Implements "Layer 1 — CLI smoke" from issue #1 §6: run the pre-merged
 * `.litertlm` bundle directly through the `litert-lm` CLI and check whether
 * the fine-tune signal survives on the LiteRT runtime BEFORE touching any RN
 * wrapper or device build.
 *
 * Reality vs issue #1 §6: the issue assumed a 5-prompt set with a tool-call
 * check_in. The actual canonical assets committed alongside the bundle
 * (Maelstrome/lora-wave-session-r32/mediapipe/{wave-prompts,wave-outputs}.json)
 * have THREE prompts — `phase`, `checkin`, `reflection` — and the reference
 * `checkin` output is plain clinical prose with NO `<|tool_call>` tokens. The
 * mediapipe README is authoritative ("Use as a sanity-check ... not a strict
 * equality check"), so this harness follows the real assets and reports the
 * tool-token presence as INFO, not a hard failure.
 *
 * Usage:
 *   node eval/run.mjs --model /path/to/model.litertlm        # live run
 *   node eval/run.mjs --from-dir scratch/eval/out             # re-score captured raw outputs
 *
 * Options:
 *   --model <path>       Path to the .litertlm bundle (required unless --from-dir)
 *   --from-dir <dir>     Score pre-captured <key>.raw.txt instead of invoking the CLI
 *   --litert-lm <bin>    litert-lm binary (default: "litert-lm" on PATH)
 *   --backend cpu|gpu    Inference backend (default: cpu)
 *   --max-num-tokens N   KV cache size (default: 4096 — matches mediapipe README)
 *   --out <dir>          Where to write raw outputs + results.json (default: eval/out)
 *   --prompts <file>     Prompt set (default: eval/wave-prompts.json)
 *   --refs <file>        Reference outputs (default: eval/wave-outputs.json)
 *
 * Exit code 0 iff every prompt passes; 1 otherwise. Prints a pass/fail matrix.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const a = {
    model: null,
    fromDir: null,
    litertLm: 'litert-lm',
    backend: 'cpu',
    maxNumTokens: 4096,
    out: join(HERE, 'out'),
    prompts: join(HERE, 'wave-prompts.json'),
    refs: join(HERE, 'wave-outputs.json'),
  };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    switch (k) {
      case '--model': a.model = v; i++; break;
      case '--from-dir': a.fromDir = v; i++; break;
      case '--litert-lm': a.litertLm = v; i++; break;
      case '--backend': a.backend = v; i++; break;
      case '--max-num-tokens': a.maxNumTokens = Number(v); i++; break;
      case '--out': a.out = v; i++; break;
      case '--prompts': a.prompts = v; i++; break;
      case '--refs': a.refs = v; i++; break;
      case '-h': case '--help':
        console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace('#!/usr/bin/env node\n/**', ''));
        process.exit(0);
      default:
        throw new Error(`Unknown arg: ${k}`);
    }
  }
  return a;
}

/** Collapse all whitespace to single spaces and trim — for fair fuzzy compare. */
function normWs(s) {
  return String(s).replace(/\s+/g, ' ').trim();
}

/** Levenshtein distance (iterative, O(n*m), two-row). */
function levenshtein(a, b) {
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

/** Normalized CHAR edit distance in [0,1] on ws-normalized, lowercased text.
 * INFORMATIONAL ONLY for free prose — penalizes synonyms/word-order that are
 * clinically irrelevant. The mediapipe README explicitly says wave-outputs.json
 * is "not a strict equality check — sampling settings shift outputs token-by-
 * token". Used as a hard gate only for structured JSON surfaces. */
function normEditDistance(a, b) {
  const x = normWs(a).toLowerCase();
  const y = normWs(b).toLowerCase();
  const denom = Math.max(x.length, y.length) || 1;
  return levenshtein(x, y) / denom;
}

const STOP = new Set(('a an the of to in on at is are was were be been being and or '
  + 'but if then so as it its this that these those you your we our they them their '
  + 'i me my for with from into out up down over under not no yes do does did can will '
  + 'would could should may might just about like what when where how which who').split(' '));

function tokenize(s) {
  return normWs(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
}

/** Bag-of-words cosine similarity in [0,1] — paraphrase-robust. The right
 * instrument for "is this the same clinical artifact" vs char-Levenshtein. */
function bowCosine(a, b) {
  const va = new Map(); const vb = new Map();
  for (const t of tokenize(a)) if (!STOP.has(t)) va.set(t, (va.get(t) || 0) + 1);
  for (const t of tokenize(b)) if (!STOP.has(t)) vb.set(t, (vb.get(t) || 0) + 1);
  let dot = 0; let na = 0; let nb = 0;
  for (const [, c] of va) na += c * c;
  for (const [, c] of vb) nb += c * c;
  for (const [t, c] of va) if (vb.has(t)) dot += c * vb.get(t);
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d ? dot / d : 0;
}

/** Normalized WORD-level edit distance in [0,1] — robust to char-level noise. */
function wordEditDistance(a, b) {
  const wa = tokenize(a); const wb = tokenize(b);
  // levenshtein() compares by charCode; map tokens to a private-use codepoint.
  const vocab = new Map();
  const enc = (arr) => arr.map((t) => {
    if (!vocab.has(t)) vocab.set(t, String.fromCharCode(0xE000 + vocab.size));
    return vocab.get(t);
  }).join('');
  const ea = enc(wa); const eb = enc(wb);
  const denom = Math.max(ea.length, eb.length) || 1;
  return levenshtein(ea, eb) / denom;
}

/**
 * Broken-quant / broken-template signatures from issue #1 §3/§6:
 *  - pad-token spew  (<pad><pad>...)        → broken chat template / tokenizer
 *  - garbage Unicode loop (ˌˌˌ… or any char run) → broken int4 (wi4) quant
 */
function detectGarbage(text) {
  const padHits = (text.match(/<pad>/gi) || []).length;
  const padToken = padHits >= 3;
  // Any single non-alphanumeric, non-space char repeated >= 12 times in a row.
  const unicodeLoop = /([^\sA-Za-z0-9])\1{11,}/u.test(text)
    // explicit ˌ (U+02CC) loop called out in the issue
    || /ˌ{6,}/u.test(text);
  return { padToken, padHits, unicodeLoop };
}

function tryParseLooseJson(text) {
  // Models sometimes wrap JSON in ```json fences or add a trailing newline.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  // Take from first { to last } to tolerate leading/trailing prose.
  const s = candidate.indexOf('{');
  const e = candidate.lastIndexOf('}');
  if (s === -1 || e === -1 || e < s) return null;
  try {
    return JSON.parse(candidate.slice(s, e + 1));
  } catch {
    return null;
  }
}

/** Per-surface "is this the WAVE fine-tune, not base Gemma / not garbage?" gate. */
function surfaceGate(key, text) {
  const notes = [];
  let structureOk = true;

  if (key === 'reflection') {
    const obj = tryParseLooseJson(text);
    if (!obj) {
      structureOk = false;
      notes.push('reflection: NOT valid JSON');
    } else {
      const hasKeys = obj.insight != null
        && obj.journalPromptQuestion != null
        && obj.nextSteps && ['one', 'two', 'three', 'four'].every((k) => obj.nextSteps[k] != null);
      if (!hasKeys) {
        structureOk = false;
        notes.push('reflection: JSON missing WAVE schema keys');
      }
      // The system prompt requires the ending intensity as a digit in `insight`.
      if (obj.insight && !/\d/.test(String(obj.insight))) {
        notes.push('reflection: insight has no numeric endingIntensity (soft)');
      }
    }
  } else {
    // phase / checkin: patient-facing prose. Base-Gemma tells: refusal,
    // assistant-meta voice, or empty. WAVE voice is calm 2nd-person clinical.
    const t = text.trim();
    if (t.length < 40) {
      structureOk = false;
      notes.push(`${key}: output too short (${t.length} chars)`);
    }
    if (/\bI('?m| am) (a|an) (large )?language model\b|\bI cannot\b.*\bAI\b|as an AI\b/i.test(t)) {
      structureOk = false;
      notes.push(`${key}: base-Gemma assistant-disclaimer voice`);
    }
  }
  return { structureOk, notes };
}

function runOne(args, prompt) {
  const combined = `${String(prompt.systemPrompt).replace(/\s+$/, '')}\n\n${prompt.userPrompt}`;
  const cliArgs = [
    'run', args.model,
    '--prompt', combined,
    '--temperature', '0',
    '--top-k', '1',
    '--seed', '7',
    '--max-num-tokens', String(args.maxNumTokens),
    '--backend', args.backend,
  ];
  const t0 = Date.now();
  const res = spawnSync(args.litertLm, cliArgs, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const elapsed = (Date.now() - t0) / 1000;
  return {
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    status: res.status,
    elapsed,
    error: res.error ? String(res.error) : null,
  };
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.model && !args.fromDir) {
    console.error('ERROR: pass --model <path/to/model.litertlm> or --from-dir <dir>');
    process.exit(2);
  }
  mkdirSync(args.out, { recursive: true });

  const prompts = JSON.parse(readFileSync(args.prompts, 'utf8'));
  const refs = JSON.parse(readFileSync(args.refs, 'utf8'));
  const refByKey = Object.fromEntries(refs.map((r) => [r.key, r]));

  const results = [];
  for (const p of prompts) {
    const key = p.key;
    const ref = refByKey[key];
    let stdout; let stderr = ''; let status = 0; let elapsed = null; let error = null;

    if (args.fromDir) {
      const f = join(args.fromDir, `${key}.raw.txt`);
      if (!existsSync(f)) { console.error(`missing captured output: ${f}`); process.exit(2); }
      stdout = readFileSync(f, 'utf8');
    } else {
      const r = runOne(args, p);
      ({ stdout, stderr, status, elapsed, error } = r);
      writeFileSync(join(args.out, `${key}.raw.txt`), stdout);
      if (stderr) writeFileSync(join(args.out, `${key}.err.txt`), stderr);
    }

    const text = stdout;
    const garbage = detectGarbage(text);
    const gate = surfaceGate(key, text);
    const charDist = ref ? normEditDistance(text, ref.output) : null;   // INFO
    const wordDist = ref ? wordEditDistance(text, ref.output) : null;   // INFO
    const cosine = ref ? bowCosine(text, ref.output) : null;            // GATE
    const toolTokens = text.includes('<|tool_call>') && text.includes('<tool_call|>');

    // §3 decision criterion: fine-tune-flavored (matches ground truth OR
    // noticeably non-base-Gemma) → PASS; pad/garbage/base-Gemma → FAIL.
    // Gate similarity on paraphrase-robust BoW cosine, not char-Levenshtein.
    // Structured JSON (reflection) also keeps the strict char gate from §6.
    const isJson = key === 'reflection';
    const simFail = cosine != null && (
      isJson ? (charDist >= 0.4 || cosine < 0.55) : (cosine < 0.45)
    );

    const hardFail =
      (status !== 0 && !args.fromDir) ||
      !!error ||
      garbage.padToken ||
      garbage.unicodeLoop ||
      !gate.structureOk ||
      text.trim().length === 0 ||
      simFail;

    results.push({
      key,
      status,
      error,
      elapsed,
      chars: text.trim().length,
      charDist,
      wordDist,
      cosine,
      padToken: garbage.padToken,
      unicodeLoop: garbage.unicodeLoop,
      toolTokens,
      structureOk: gate.structureOk,
      notes: gate.notes,
      pass: !hardFail,
    });
  }

  // ---- Pass/fail matrix ----
  const pad = (s, n) => String(s).padEnd(n);
  console.log('\nLayer 1 — CLI smoke results  (gate=cosine; charDist/wordDist=INFO)');
  console.log('='.repeat(86));
  console.log([pad('key', 11), pad('exit', 4), pad('chars', 6), pad('cosine↑', 8),
    pad('chrD↓', 6), pad('wrdD↓', 6), pad('pad', 4), pad('garb', 5),
    pad('tool', 5), pad('struct', 7), 'PASS'].join(' '));
  console.log('-'.repeat(86));
  for (const r of results) {
    const f3 = (x) => (x == null ? '-' : x.toFixed(3));
    console.log([
      pad(r.key, 11),
      pad(r.status ?? '-', 4),
      pad(r.chars, 6),
      pad(f3(r.cosine), 8),
      pad(f3(r.charDist), 6),
      pad(f3(r.wordDist), 6),
      pad(r.padToken ? 'YES' : 'no', 4),
      pad(r.unicodeLoop ? 'YES' : 'no', 5),
      pad(r.toolTokens ? 'yes' : 'no', 5),
      pad(r.structureOk ? 'ok' : 'BAD', 7),
      r.pass ? 'PASS ✅' : 'FAIL ❌',
    ].join(' '));
    for (const n of r.notes) console.log(`            · ${n}`);
  }
  console.log('-'.repeat(86));
  const allPass = results.every((r) => r.pass);
  console.log(allPass
    ? 'RESULT: ✅ all prompts pass — bundle is fine-tune-flavored on the LiteRT runtime.'
    : 'RESULT: ❌ at least one prompt failed — see notes; consider issue #1 §7 (re-merge wi8).');
  console.log('Note: `toolTok` is INFORMATIONAL. The committed reference checkin output\n'
    + 'has no <|tool_call> tokens, so absence is consistent with the reference,\n'
    + 'not a failure (see issue #1 §6 discrepancy).');

  writeFileSync(join(args.out, 'results.json'), JSON.stringify(results, null, 2));
  process.exit(allPass ? 0 : 1);
}

main();
