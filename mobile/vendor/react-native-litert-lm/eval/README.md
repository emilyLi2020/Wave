# `eval/` — WAVE LiteRT-LM bundle verification harness

Layer 1 of the three-layer testing strategy in
[issue #1 §6](https://github.com/IdkwhatImD0ing/react-native-litert-lm/issues/1):
**CLI smoke test** of the pre-merged `.litertlm` bundle, run directly through
the `litert-lm` CLI — no device, no React Native build. This is the mandatory
first checkpoint: it answers, in seconds, whether the fine-tune signal survived
the conversion to a LiteRT bundle *before* any wrapper or device work.

## Files

| File | What |
|---|---|
| `wave-prompts.json` | Canonical prompt set, copied verbatim from `Maelstrome/lora-wave-session-r32/mediapipe/wave-prompts.json`. Three surfaces: `phase`, `checkin`, `reflection`. Each has `systemPrompt` + `userPrompt` + `maxNewTokens`. |
| `wave-outputs.json` | Reference outputs the **LiteRT build itself** produced on `wave-prompts.json` at conversion time (greedy: `topK=1, temperature=0, maxTokens=4096`). Per the upstream mediapipe README this is a sanity-check baseline, *not* a strict-equality oracle. |
| `run.mjs` | Zero-dependency Node runner + scorer. Invokes `litert-lm run` per prompt (or re-scores captured outputs) and prints a pass/fail matrix. |
| `LAYER1_RESULTS.md` | Captured results + side-by-side evidence + the §3 decision. |

## Running

```bash
# 1. Install the CLI (once)
uv tool install litert-lm

# 2. Download the bundle (~4.95 GB, public repo, no auth)
hf download Maelstrome/lora-wave-session-r32 mediapipe/model.litertlm --local-dir scratch

# 3. Live run + score (CPU; ~13 s/prompt on an M-series Mac)
node eval/run.mjs --model scratch/mediapipe/model.litertlm

# …or re-score previously captured raw outputs without re-running inference
node eval/run.mjs --from-dir scratch/eval/out
```

`run.mjs` exits `0` iff every prompt passes. Raw outputs and `results.json`
land in `eval/out/` (git-ignored).

## What "pass" means (issue #1 §3 decision criterion)

> - Outputs are fine-tune flavored (match ground truth, **or** noticeably
>   non-base-Gemma) → no wrapper change needed. **Done.**
> - Outputs are generic Gemma-4 base behavior, or pad-token garbage → bundle is
>   broken → go to §7 (re-merge with `wi8` in the Wave repo).

Concretely, each surface must:

1. Exit `0`, produce non-empty output.
2. Show **no broken-quant signatures** — no `<pad>` spew, no garbage Unicode
   loops (`ˌˌˌ…`). These are the `dynamic_wi4_afp32` failure mode the issue
   warns about for rank-32 LoRA.
3. Be **structurally correct** for its surface — `reflection` must be valid
   JSON in the WAVE schema (`insight` / `journalPromptQuestion` /
   `nextSteps.{one..four}`); `phase` / `checkin` must be coherent WAVE clinical
   prose, not a base-Gemma refusal/assistant-disclaimer voice.
4. Be **content-faithful to the LiteRT reference**, scored with a
   paraphrase-robust metric (see below).

## Metric note — why not raw edit distance

Issue #1 §6 suggested "normalized edit distance < 0.4 vs the baseline". For the
**structured JSON** surface (`reflection`) that strict char-level gate is kept.
For the **free-prose** surfaces (`phase`, `checkin`) character-level Levenshtein
is the wrong instrument: it punishes synonyms and word-order that are
clinically irrelevant. Both the upstream mediapipe README ("not a strict
equality check — sampling settings shift outputs token-by-token") and the WAVE
training report ("clinically equivalent… word choice differs but pose, safety,
structure are the same"; token-F1 ≈ 0.43 even in the *training* eval) say so.

So `run.mjs` gates prose on a **bag-of-words cosine similarity** (stop-worded,
paraphrase-robust) and reports char- and word-level edit distance as
*informational* columns only.

## Known discrepancies vs the issue text (followed the real artifacts)

- **3 prompts, not 5.** Issue §6 described "5 prompts: 2 phase_narration, 2
  reflection, 1 check_in tool-call". The committed canonical asset has three
  (`phase`, `checkin`, `reflection`). The mediapipe README is authoritative;
  this harness follows the real asset.
- **No `<|tool_call>` tokens in the `checkin` reference.** Issue §6 made tool
  tokens a hard acceptance criterion. The committed reference `checkin` output
  is plain clinical prose with no tool tokens — and correctly so: the WAVE
  system prompt makes agent turn #1 text-only ("never call endConversation on
  your FIRST agent turn"). `run.mjs` reports tool-token presence as
  **informational**, never a failure.
- **`phase` emits prose, not `{"lines":[...]}` JSON.** The production `phase`
  `userPrompt` requests strict 6-line JSON, but *both* the LiteRT reference and
  our run produce prose. Our output is therefore consistent with ground truth
  (Layer 1 passes), but this prompt↔output gap is a **model/conversion-pipeline
  concern, not a wrapper concern** (issue §5). If the Wave app's phase renderer
  expects JSON, address it in the Wave repo (§7 re-merge / prompt-template),
  not in this RN package.
