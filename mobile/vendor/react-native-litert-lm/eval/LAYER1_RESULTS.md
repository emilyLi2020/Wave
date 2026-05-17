# Layer 1 — CLI smoke results (WAVE pre-merged bundle)

**Verdict: ✅ PASS on all three surfaces. The fine-tune survived conversion to
the LiteRT bundle. No wrapper change required; the runtime-LoRA path (issue #1
§4) is _not_ needed.**

## Environment

| | |
|---|---|
| Date | 2026-05-16 |
| Bundle | `Maelstrome/lora-wave-session-r32/mediapipe/model.litertlm` |
| Bundle size | 5,071,689,680 B (≈ 4.72 GiB) — **wi8-class** (the suspect `wi4` variants in the same HF repo are the ~2.4 GB `litert-lm*/` ones; issue §3/§7) |
| Runtime | `litert-lm` 0.11.0 (PyPI, via `uv tool install`) |
| Decoding | `--temperature 0 --top-k 1 --seed 7 --max-num-tokens 4096 --backend cpu` (greedy; matches the mediapipe README's reference settings `topK:1, temperature:0, maxTokens:4096`) |
| Prompt rendering | `systemPrompt + "\n\n" + userPrompt` as a single templated user turn (Gemma 4 has no system role; mirrors MediaPipe's single-string `generateResponse`) |
| Host | Apple Silicon, CPU backend |
| Performance | ≈ 13 s/prompt, peak RSS ≈ 0.7 GB — comfortably on-device-viable for Layer 3 |

## Matrix

```
key         exit chars  cosine↑  chrD↓  wrdD↓  pad  garb  tool  struct  PASS
phase       0    800    0.670    0.570  0.688  no   no    no    ok      PASS ✅
checkin     0    398    0.485    0.548  0.690  no   no    no    ok      PASS ✅
reflection  0    485    0.606    0.371  0.542  no   no    no    ok      PASS ✅
```

- `cosine` — paraphrase-robust bag-of-words similarity vs the LiteRT reference (**gate**).
- `chrD` / `wrdD` — normalized char / word edit distance (**informational**; see `README.md` "Metric note").
- `pad` / `garb` — broken-quant signatures (`<pad>` spew / Unicode loops). **None present → quant intact.**
- `tool` — `<|tool_call>` tokens present. Informational; reference has none either (correct: turn #1 is text-only by design).
- `struct` — surface-correct (reflection = valid WAVE-schema JSON; phase/checkin = WAVE clinical prose, no base-Gemma refusal voice).

## Evidence — reference vs our run (paraphrased, clinically identical)

**reflection** — near-identical; exact WAVE JSON schema; correct `7 → 3`:

- ref: `{"insight":"You navigated a very intense urge, moving from a 7 down to a 3 over ten minutes…","journalPromptQuestion":"What did you notice in your chest…","nextSteps":{"one":"Drink a full glass of water","two":"Stretch your arms overhead slowly","three":"Text a trusted person a short check-in","four":"Lie down for 10 minutes without trying to sleep"}}`
- ours: `{"insight":"You noticed the stress building in your chest and stayed with it long enough for it to shift from a 7 to a 3…","journalPromptQuestion":"What did you notice in your body when the intensity dropped?","nextSteps":{"one":"Drink a full glass of water","two":"Stretch your shoulders and neck gently","three":"Text a trusted person a quick check-in","four":"Lie down for 10 min without looking at screens"}}`

**checkin** — same clinical turn: thank for the 7/10 score, "same intensity as
when started", names stress trigger + on-time medication, ends on an open
obstacle question (ours follows the system prompt's obstacle-list instruction
even more literally than the reference).

**phase** — same body-scan: identical top-down sweep
(head → eyes/forehead → jaw/throat → chest/stomach → hands → legs/feet →
contact with the floor), same "observe, don't fix the sensation" framing, same
handoff close.

These are textbook paraphrases of the same fine-tuned artifacts — **not**
base-Gemma behavior, **not** pad/garbage, **not** the `wi4` rank-32 collapse the
issue warned about.

## Decision (issue #1 §3 / §10)

Layer 1 **passes** and outputs match ground truth → per §3: **the pre-merged
bundle is shippable as-is through the existing wrapper API**
(`loadModel(path, …)` + `sendMessage` / `sendMessageAsync`). No new `LLMConfig`
fields, no xcframework rebuild, no `maceip/LiteRT-LM` fork (§4 out of scope —
it was gated on §3 *and* §7 both failing; §3 passed).

## One honest caveat (model-pipeline, not wrapper)

The production `phase` `userPrompt` requests strict 6-line `{"lines":[…]}`
JSON, but **both** the LiteRT reference and our run emit prose. Our output is
consistent with ground truth (Layer 1 passes), but if the Wave app's `phase`
renderer expects JSON, that gap lives in the conversion/training pipeline
(issue §5: "a model-pipeline concern, not a wrapper concern") and should be
fixed in the Wave repo (the §7 `wi8` re-merge / prompt-template work), not in
this React Native package. `checkin` and `reflection` are production-ready.

## Next (issue #1 §10)

- **Layer 2** — wrapper unit + Nitro compile (TS typecheck, pod lint, example
  prebuild, `xcodebuild` sim, `gradle assembleDebug`). No wrapper code changed,
  so this is a regression check that the unchanged package still builds.
- **Layer 3** — on-device: add a "Run Wave eval suite" path to `example/App.tsx`
  that `downloadModel`s the bundle, runs the 3 prompts via `sendMessageAsync`,
  and re-uses this harness's scoring on-device.
