# WAVE — Model Training

> How we produce every LoRA in [`models.md`](./models.md).
> Data collection, synthetic data generation, clinician spot-check, train /
> test split, QLoRA training, eval harness, ship gates, and release.
>
> This document is the **how**. It is intentionally free of per-model
> specifics — those live in `models.md`. Any time we add or change a LoRA,
> `models.md` is the file we update; this file changes only when the
> *process* changes.

---

## 0. Thought process

The core insight driving this plan is that **clinical tone is narrow and
checkable**. For any given (medication, status, phase, trigger) combination
there is a small band of acceptable responses, and most bad responses fail
one of a handful of concrete rules — toxic-positivity lexicon, substance
naming, pharmacology directives, wrong hotline number, missing numeric
drop. That makes it a good fit for supervised fine-tuning on a small,
clinician-approved synthetic dataset rather than a heavy RLHF loop.

We also want WAVE to run on-device with zero LLM network calls. That
constrains us to a small base model (Gemma 4 E2B) and forces real
specialization to live in LoRA adapters, not in the base weights.

From those two observations the pipeline falls out:

1. A **clinician writes a small seed set** of good examples per LoRA. The
   seed set exists to show the generator what "good" looks like — it is
   not meant to cover the whole stack of clinical situations.
2. A **larger Gemma** (only ever on the developer workstation, never
   shipped) expands the seed set into a few hundred synthetic examples
   per LoRA, sampled across the stack axes the LoRA cares about.
3. A **clinician spot-checks** a sample of the generated examples in a
   small review UI and leaves free-text feedback on anything wrong.
4. If anything was flagged, we **regenerate** with the feedback folded
   into the generator prompt, and spot-check again. We repeat until one
   spot-check passes with **zero flagged problems**. Typically 1–3
   iterations.
5. We take the clean synthetic set, do an **80 / 20 stratified
   train / test split**, and run **one** QLoRA job on the train split.
6. We run a **small automated eval harness** on the held-out 20 % test
   split. Four checks, all automated, no human-in-the-loop at this step.
7. If the adapter passes the eval, we ship it. If it fails, the surface
   falls back to base + prompt and we regenerate / retrain or drop the
   LoRA from the release.

No dev set, no early stopping, no checkpoint selection, no iterative
fine-tuning, no RLHF, no delta-vs-base A/B scoring. The spot-check is the
clinical eval, the harness is the technical eval, and both must be clean
before release.

---

## 1. What we need to collect up front

Per LoRA, before any generation happens:

1. **A small human-written seed set.** 15–40 structured (input → JSON
   output) examples per LoRA, hand-written by a clinician or a
   domain-informed developer. Committed as typed TypeScript under
   `client/synthetix/seeds/<lora-id>.ts` so the seed set is reviewable
   in a normal code review.

2. **The LoRA's Zod schemas** from `models.md` (one schema for the
   input, one for the output). These are already defined per LoRA and
   live in `client/lib/prompts/schemas.ts`.

3. **The LoRA's stack axes.** The typed enumerations the generator
   samples from — e.g. for `lora-check-in-1`, the axes are `matType`,
   `medicationStatus`, `trigger`, `intensityBucket`, `scoreTrend`, and
   `obstacleCategory`. The
   stack axes live under `client/synthetix/stacks/<lora-id>.ts`. They
   do **not** need to be enumerated exhaustively; they are just the
   bag the generator samples inputs from.

4. **The LoRA's hard safety invariants.** Copied verbatim from the
   corresponding section of `models.md` into
   `client/synthetix/invariants/<lora-id>.ts`. These are executable
   predicates (e.g. `output.encouragement !== "celebrating"`), not
   prose.

5. **The shared tone rules.** One file, not per-LoRA:
   `client/synthetix/tone-rules.ts`. Encodes the toxic-positivity
   lexicon, the substance-name blocklist, and the pharmacology-directive
   allow-list from `AGENTS.md > Domain Constraints`.

6. **The reference clinical sources.** Seed material the generator is
   allowed to draw on: MBRP facilitator guide excerpts, SAMHSA TIP 63
   paragraphs, FDA MAT labels (Suboxone, Naltrexone, Vivitrol,
   Methadone), and MI transcripts. Stored as plain text under
   `client/synthetix/corpus/` with a short provenance header on each
   file.

---

## 2. Synthetic data generation

The generator is a larger Gemma 4 model running on the developer's
workstation. It **never ships to users**. Preference order:

1. **Gemma 4 31B-it** if the dev has an A100 / H100-class GPU.
2. **Gemma 4 26B-A4B-it** (MoE with 4 B active) on consumer GPUs.
3. **Gemma 4 E4B-it** on laptops and smaller dev machines.

Any of the three is fine for data generation — they are all the same
model family, so style drift is small. The only reason to prefer a
larger one is higher variety at temperature 0.7.

### 2.1 Generator prompt structure

For a given LoRA, the generator is called with a prompt built from:

```
[ System ]
  You are generating training data for the <lora-id> LoRA in WAVE.
  Return JSON only, matching the schema below.
  Tone rules (from AGENTS.md > Domain Constraints):
    - No toxic-positivity lexicon: <list>
    - Never name a substance: <blocklist>
    - Never emit a pharmacology directive: <allow-list>
  LoRA-specific invariants:
    <paste from client/synthetix/invariants/<lora-id>.ts>
  Previous issues to avoid (only present if this is a regenerate round):
    <bullet list of clinician feedback strings from the last spot-check>

[ Reference clinical sources ]
  <excerpts from client/synthetix/corpus/ relevant to this LoRA>

[ Human seed examples ]
  <the full seed set from client/synthetix/seeds/<lora-id>.ts>

[ Input schema ]
  <from client/lib/prompts/schemas.ts>

[ Output schema ]
  <from client/lib/prompts/schemas.ts>

[ User ]
  Generate <K> new (input, output) pairs. Each input should be a
  plausible draw from the stack axes; vary them uniformly. Each output
  must match the output schema exactly and must not reuse wording from
  the seed set.
```

Generator settings: `temperature=0.7`, `top_p=0.95`, JSON-only decoding.
`K` is the total target size for the LoRA (see `models.md` per-LoRA size
columns).

### 2.2 Pre-filter

Before the clinician sees anything, every generated example is run
through a cheap pre-filter:

1. **JSON parse.** Must parse against the LoRA's Zod output schema. If
   not, drop it and mark the slot for a re-roll.
2. **Tone rules.** Must not contain any toxic-positivity string,
   substance name, or pharmacology directive. If it does, drop it.
3. **Hard safety invariants.** LoRA-specific predicates from
   `invariants/<lora-id>.ts`. If any fail, drop it.

Only examples that pass the pre-filter are shown to the clinician in
the spot-check UI. This keeps the clinician's time focused on tone
and clinical judgment, not on obvious malformed outputs.

### 2.3 Output layout

Each generation round writes to:

```
client/synthetix/runs/<lora-id>/<run-id>/
  generator-prompt.md          # the exact prompt that was used
  generated.jsonl              # all examples that passed the pre-filter
  prefilter-drops.jsonl        # examples that were dropped, for debugging
  stack-coverage.json          # how many examples hit each stack cell
```

`<run-id>` is an ISO date + sequence number, e.g. `2026-04-17-001`.

---

## 3. Clinician spot-check

A small local Next.js page at `client/app/synthetix-review/`, gated to
the dev team (no public route), loads `generated.jsonl` for a given
`(lora-id, run-id)` and samples examples uniformly across stack cells.

### 3.1 Sample size

**~30 examples per LoRA per round.** Not every generated example — the
point of the spot-check is fast, focused clinical judgment. The sample
is drawn with a seeded RNG so the same run is reviewed against the same
30 examples if the same reviewer reopens it.

### 3.2 Controls

For each sampled example the clinician sees the structured input and
the generated output and picks one of:

- **Looks good.** This example is clinically acceptable.
- **Has a problem.** Opens a free-text feedback field. The clinician
  writes what is wrong — e.g. *"uses the word alcohol"*, *"says the
  patient should increase their dose"*, *"tone feels shaming"*,
  *"encouragement is 'celebrating' during the peak phase"*,
  *"the reflection line doesn't include the ending intensity number"*.
- **Skip / unsure.** Move on.

### 3.3 Spot-check result

A round **passes clean** when every sampled example is "Looks good" —
zero problems flagged. The review UI writes one file:

```
client/synthetix/runs/<lora-id>/<run-id>/spotcheck.json
{
  "runId": "2026-04-17-001",
  "sampledCount": 30,
  "sampleIndices": [41, 87, 102, ...],
  "reviewerInitials": "JS",
  "reviewedAt": "...",
  "pass": true,
  "problems": []             // each entry = { index, feedback }
}
```

If `pass: false`, every `problems[].feedback` string is what drives the
next round.

---

## 4. Regenerate with feedback

If the spot-check failed, we re-run the generator with all feedback
strings from the failing round folded into the prompt's **"Previous
issues to avoid"** block (§2.1). We reuse the same seed set, the same
stack axes, and the same target size `K`; we write to a new
`<run-id>` so the history is preserved.

Then we spot-check the new batch.

Repeat until a spot-check passes clean. Typically 1–3 iterations per
LoRA. If a LoRA needs more than five iterations, something is wrong —
usually it means the seed set is too narrow or the invariants are
under-specified, and the right move is to go back to §1 rather than
keep regenerating.

---

## 5. Train / test split

Once a spot-check is clean, we split the full generated set (not just
the 30-example sample) **80 / 20**, stratified by `matType` and
`medicationStatus` so every combination appears on both sides. The
splitter is seeded:

```ts
// client/synthetix/split.ts
export function split(
  examples: GeneratedExample[],
  seed: number,
): { train: GeneratedExample[]; test: GeneratedExample[] };
```

The test split is frozen at split time and committed to the run
directory:

```
client/synthetix/runs/<lora-id>/<run-id>/
  train.jsonl
  test.jsonl
  split-meta.json   # { seed, trainSize, testSize, strataCounts }
```

Test rows never touch training. The splitter refuses to run if the
spot-check log for this run does not say `pass: true`.

There is no dev / validation split. Three splits is more rigor than this
pipeline needs.

---

## 6. Training recipe

One QLoRA run per LoRA, on the 80 % train split.

- **Framework.** [Unsloth](https://github.com/unslothai/unsloth) + TRL
  + QLoRA, targeting `google/gemma-4-E2B-it`.
- **Target modules.** `q_proj, k_proj, v_proj, o_proj, gate_proj,
  up_proj, down_proj`.
- **Rank / alpha / dropout.** Per-LoRA; see `models.md`. The settled
  check-in and reflection surfaces use rank 16 (alpha 32) because they
  need to preserve multi-turn structure, medication-aware validation,
  and safety invariants.
- **Optimizer.** AdamW, lr `2e-4` with cosine schedule, warmup 3 %.
- **Batch size.** 8, with gradient accumulation as needed.
- **Epochs.** 3. Save the **final** checkpoint. No early stopping, no
  checkpoint selection.
- **Compute.** Each LoRA trains in 10–30 min on a single A100 40 GB on
  the sizes in `models.md`. All six MVP LoRAs fit in an afternoon on
  one GPU.
- **Artifact.** A PEFT adapter directory committed (or uploaded, if
  too large for git) under
  `client/synthetix/runs/<lora-id>/<run-id>/adapter/`.

The training script is `client/synthetix/train/<lora-id>.py`. The
Python side reads `train.jsonl` and writes the adapter directory; no
other output.

The script refuses to run unless:

- `spotcheck.json` for this run exists and has `pass: true`.
- `train.jsonl` and `test.jsonl` both exist.
- All rows in `train.jsonl` parse against the LoRA's Zod output schema.
- No row index appears in both `train.jsonl` and `test.jsonl`.

### 6.1 Exporting for the runtime

After training, we convert the PEFT adapter to the runtimes we actually
ship:

- **Web demo:** ONNX tensor pack loadable by transformers.js +
  WebGPU.
- **Mobile (future):** LiteRT adapter format.

The converters live under `client/synthetix/export/`. They are
deterministic; two runs of the converter on the same PEFT adapter must
produce byte-identical output. CI pins the converter version.

---

## 7. Eval harness (on the 20 % test split)

Small, automated, no human-in-the-loop at this step. The adapter is
loaded through the production Adapter Manager (web runtime for the
web demo, LiteRT for the mobile port) so the eval measures what ships,
not the training-time model.

### 7.1 Four checks

1. **JSON validity.** For every example in the test split, run the
   model with the test input and check whether the output parses
   against the LoRA's Zod output schema on the **first try**.
   **Pass bar:** first-try parse rate ≥ 98 %. (Runtime allows one retry;
   this metric exists to catch drift.)
2. **Safety lexicon.** For every generated output, check against the
   shared tone rules (toxic-positivity lexicon, substance-name
   blocklist, pharmacology-directive allow-list).
   **Pass bar:** 100 %.
3. **Per-surface invariants.** Run the LoRA's executable invariants
   from `invariants/<lora-id>.ts` against every generated output.
   **Pass bar:** 100 %.
4. **Latency.** Run the adapter on a 20-example subset of the test
   split on the reference machine (a modern WebGPU laptop for the web
   demo, a reference Android / iOS for the mobile port).
   **Pass bar:** p95 under the LoRA's latency budget from `models.md`.

### 7.2 Report

The harness emits one file:

```
client/synthetix/runs/<lora-id>/<run-id>/eval.json
{
  "loraId": "lora-check-in-1",
  "runId": "2026-04-17-001",
  "testSetSize": 80,
  "jsonValidityFirstTryRate": 0.9875,
  "safetyLexiconPassRate": 1.0,
  "surfaceInvariantsPassRate": 1.0,
  "p95LatencyMs": 2180,
  "pass": true
}
```

`pass` is `true` iff all four checks meet their bars. A `pass: false`
report does **not** ship — see §8.

### 7.3 Implementation

The harness lives under `client/synthetix/eval/<lora-id>.ts`. It is
TypeScript (not Python) because it needs to run the actual Adapter
Manager — the thing that actually ships — and not a training-time
Python loader that might quantize or decode differently.

---

## 8. Ship gates

Every PR that ships or updates a LoRA must include, in the PR body:

- [ ] Bumped `version` and `sha256` for this LoRA in
      `client/lib/gemma/adapter-manifest.ts`.
- [ ] Synthetix run ID
      (`client/synthetix/runs/<lora-id>/<run-id>/`) linked in the PR
      description.
- [ ] `spotcheck.json` in that run shows `pass: true` with zero
      flagged problems.
- [ ] `eval.json` in that run shows `pass: true`, with the four check
      values quoted in the PR description.
- [ ] Clinician initials on the spot-check named in the PR body.
- [ ] Clinical citation (MBRP / SAMHSA / FDA) for any change in tone
      or pharmacology claim relative to the previous adapter version.

An adapter with `spotCheckPassed: false` or `evalPassed: false` in its
run never gets added to the manifest. If those checks fail and we are
still shipping the release, that surface falls back to base Gemma +
the scripted prompt template and the LoRA is simply absent from the
manifest.

---

## 9. Directory map (developer tree, not shipped to users)

```
client/synthetix/
├── corpus/                     # reference clinical sources (MBRP, SAMHSA,
│                               # FDA labels, MI transcripts) with provenance
├── seeds/
│   └── <lora-id>.ts            # typed seed set, 15–40 examples per LoRA
├── stacks/
│   └── <lora-id>.ts            # the stack axes the generator samples from
├── invariants/
│   └── <lora-id>.ts            # executable per-LoRA invariants
├── tone-rules.ts               # shared toxic-positivity, substance-name,
│                               # pharmacology-directive rules
├── generate.ts                 # §2 Gemma-generator driver
├── split.ts                    # §5 seeded 80/20 stratified splitter
├── train/
│   └── <lora-id>.py            # §6 Unsloth + TRL + QLoRA script per LoRA
├── eval/
│   └── <lora-id>.ts            # §7 eval harness per LoRA
├── export/                     # PEFT → ONNX / PEFT → LiteRT converters
└── runs/
    └── <lora-id>/<run-id>/
        ├── generator-prompt.md
        ├── generated.jsonl
        ├── prefilter-drops.jsonl
        ├── stack-coverage.json
        ├── spotcheck.json
        ├── train.jsonl
        ├── test.jsonl
        ├── split-meta.json
        ├── adapter/            # PEFT adapter directory
        ├── adapter.onnx        # exported web adapter
        └── eval.json

client/app/synthetix-review/   # local-only Next.js UI for §3 spot-check
```

---

## 10. What changes when

- **Adding / editing a LoRA** → update `models.md`, not this file. Then
  follow this file's process end-to-end for the new adapter.
- **Changing the generator, the spot-check flow, the split, the
  training recipe, or the eval** → update this file. Bump a version
  marker in `client/synthetix/VERSION.md` so prior runs are clearly
  tied to the old process.
- **Changing a tone rule or a safety invariant** → update both
  `AGENTS.md > Domain Constraints` (the human-readable source of
  truth) and `client/synthetix/tone-rules.ts` or the relevant
  `invariants/<lora-id>.ts` file. Every previously-shipped LoRA must
  be re-evaluated against the new rule before the next release.

---

## 11. Things this process intentionally does **not** do

- **Dev / validation set.** We use train + test only. The spot-check
  covers the clinical side; the eval harness covers the technical
  side.
- **Mid-training checkpoint selection.** Save the final checkpoint,
  ship it.
- **Early stopping.** Three epochs, always.
- **RLHF.** Not for an MVP shipping on on-device Gemma.
- **Multi-stage fine-tune.** One round per LoRA. If a LoRA needs a
  second round, the seed set or the invariants were wrong — go back
  to §1.
- **A/B rubric against base.** Tempting but expensive and subjective.
  The eval harness in §7 is what we hold adapters to.
- **Any fine-tune for crisis triage.** See `models.md > Not
  fine-tuned — base model only`. This is deliberate and permanent.

---

## 12. Alignment with the rest of the repo

- `models.md` — per-model reference. Every LoRA named here has an
  entry there. Every entry there has a row in the adapter manifest.
- `PRD.md > Medication-Aware Prompt Logic` — the canonical clinical
  matrix. Seed sets and invariants must match it.
- `AGENTS.md > Domain Constraints` — the source of truth for tone
  rules and crisis handoff. `tone-rules.ts` encodes these.
- `client/lib/gemma/adapter-manager.ts` — the runtime contract that
  consumes the adapters this process produces. Today it returns prompt ids
  for temporary scaffolding; after the Gemma swap it returns LoRA ids.
- `client/lib/prompts/schemas.ts` — the Zod schemas that define the input /
  output contract every LoRA is trained against.
