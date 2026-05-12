# WAVE - Model Training

> How WAVE produces the demo multitask LoRA and the future specialized LoRAs
> documented in [`models.md`](./models.md).

---

## 0. Current Strategy

The browser demo trains and ships one LoRA:

```
lora-wave-session
```

That LoRA is merged into the Gemma ONNX artifact before it is loaded by
Transformers.js. We are choosing this because browser LoRA hot-swapping is not
yet mature enough for a reliable PWA demo.

We still collect data under specialized future adapter IDs:

- `lora-phase-narration`
- `lora-check-in-1`
- `lora-check-in-2`
- `lora-check-in-3`
- `lora-check-in-4`
- `lora-check-in-5`
- `lora-reflection`

Each specialized set has a **target** row count in `client/lib/training/lora-specs.ts` (phase narration: 10; each check-in: 20; `lora-reflection`: 48). Those same rows

1. **Demo path:** combine all ready/approved rows into
   `lora-wave-session.jsonl` and fine-tune one multitask LoRA.
2. **Demonstration/future path:** fine-tune each specialized adapter separately
   for offline evaluation and to show the intended native/mobile architecture.

No crisis or intake safety surface is fine-tuned.

---

## 1. Human Seed Collection

The developer-only UI at `client/app/training/` is the source of truth for
human-written seed examples.

Per specialized set:

- Target: see per-LoRA `targetCount` in `lora-specs.ts` (10 for `lora-phase-narration`, 20 for each check-in, 48 for `lora-reflection`).
- Draft rows are allowed but are never exported by default.
- Inputs and outputs are validated by the Zod schemas in
  `client/lib/training/lora-specs.ts`.
- Coverage is tracked on a per-LoRA grid: **phase narration** uses `chunkNumber × startingIntensityBand` (5 phases × two intake bands: 7-10 vs 1-6). **Check-ins** use `medicationStatus × trigger` (plus scripted dialogue axes). **Reflection** uses the same `medicationStatus × trigger` axes with **three** `matType` variants per cell (see `client/scripts/generate-lora-reflection-grid.ts`) for 48 total rows.

The UI stores rows as JSON files under:

```
client/data/training-seeds/<lora-id>.json
```

These files contain synthetic clinical dialogue only. Do not paste real patient
notes or identifiable health information.

---

## 2. Export Layout

The export page provides two JSONL paths.

### 2.1 Combined Demo Export

```
GET /api/training/export?format=jsonl
```

Downloads:

```
lora-wave-session.jsonl
```

Each row uses ShareGPT-style messages:

```json
{
  "messages": [
    {
      "role": "user",
      "content": "{\"surface\":\"lora-check-in-1\",\"input\":{...}}"
    },
    {
      "role": "assistant",
      "content": "{\"reply\":\"...\",\"endConversation\":{...}}"
    }
  ]
}
```

The `surface` wrapper lets one multitask adapter learn which specialized
behavior it should produce.

### 2.2 Specialized Demonstration Exports

```
GET /api/training/export?format=jsonl&loraId=<lora-id>
```

Downloads one JSONL file for a future specialized adapter, for example:

```
lora-check-in-3.jsonl
```

These exports are used for offline proof-of-concept training and evaluation.
They are not mounted in the browser demo.

---

## 3. Optional Synthetic Expansion

For the hackathon demo, the minimum training source is the **158** human-written
rows:

```
lora-phase-narration: 10 (5 chunks × 2 intake bands)
+ 5 check-in sets × 20 = 100
+ lora-reflection: 48 (16 medStatus × trigger cells × 3 mat variants)
= 158 examples
```

If time allows, a larger Gemma model running on a developer workstation can
expand those rows into additional synthetic examples. Synthetic expansion is
not required before the first demo LoRA.

If expansion is used, every generated row must pass:

1. JSON parse against the relevant output schema.
2. Shared tone rules: no toxic positivity, no substance naming outside safety
   contexts, no pharmacology directives.
3. Surface-specific invariants from `client/lib/training/lora-specs.ts`.
4. Clinician spot-check before it can be included in a training run.

For the implemented `models/` pipelines (deterministic phase narration expansion,
gap-targeted session synthetics with local validators and deduplication), see
[`models/SYNTHETIC_DATASET_GENERATION.md`](../models/SYNTHETIC_DATASET_GENERATION.md)
and [`models/SYNTHETIC_DATA.md`](../models/SYNTHETIC_DATA.md).

---

## 4. Train / Test Split

For the demo LoRA:

- Input file: `lora-wave-session.jsonl`.
- Split: 80 / 20.
- Stratify by `surface`, `medicationStatus`, and `trigger` when possible; for rows with `surface: "phase_narration"`, also stratify by `chunkNumber` and `startingIntensityBand`.
- Freeze the test split before training.

For specialized demonstration LoRAs:

- Input file: `<lora-id>.jsonl`.
- Split: 80 / 20.
- Stratify by `medicationStatus` and `trigger` for check-in and reflection rows; for `lora-phase-narration` exports, stratify by `chunkNumber` and `startingIntensityBand`.

There is no dev split for the MVP process. The human seed review covers the
clinical side; the held-out test set covers output validity and invariants.

---

## 5. Training Recipe

One QLoRA run is used for `lora-wave-session`.

- Framework: Unsloth + TRL + QLoRA.
- Base: `google/gemma-4-E2B-it`.
- Target modules: `q_proj, k_proj, v_proj, o_proj, gate_proj, up_proj,
  down_proj`.
- Rank / alpha / dropout: 16 / 32 / 0.05 for the demo LoRA.
- Optimizer: AdamW, lr `2e-4` with cosine schedule, warmup 3%.
- Epochs: 3. Save the final checkpoint.
- Dataset format: ShareGPT-style `messages`, using the Gemma chat template.

Specialized demonstration LoRAs use the same recipe unless a later experiment
documents a reason to change rank or dropout.

---

## 6. Exporting Runtime Artifacts

### Browser Demo

The shipped browser demo does not load separate adapter files. After training:

1. Load the Gemma base model.
2. Load the `lora-wave-session` PEFT adapter.
3. Merge the adapter into the base weights.
4. Export a single ONNX artifact for Transformers.js + WebGPU.
5. Point `client/lib/gemma/local-runtime.ts` at the merged model artifact.

This avoids storing multiple full ONNX models in memory and avoids unsupported
browser adapter hot-swapping.

### Future Native/Mobile

When the target runtime has production-ready adapter APIs, the specialized
adapters can be exported separately and selected by rule-based routing:

- check-in 1 -> `lora-check-in-1`
- check-in 2 -> `lora-check-in-2`
- check-in 3 -> `lora-check-in-3`
- check-in 4 -> `lora-check-in-4`
- check-in 5 -> `lora-check-in-5`
- phases 1-5 narration -> `lora-phase-narration`
- reflection -> `lora-reflection`
- crisis/intake safety -> no LoRA

---

## 7. Eval Harness

Run the eval against the same runtime artifact the product uses.

### Demo LoRA Checks

For `lora-wave-session`, the held-out test set must pass:

1. JSON validity: first-try parse rate >= 98%.
2. Safety lexicon: 100%.
3. Surface invariants: 100%.
4. Routing correctness: outputs honor the input `surface`.
5. Latency: p95 within the browser demo budget on the reference WebGPU laptop.

### Specialized LoRA Checks

For specialized demonstration adapters:

1. JSON validity: first-try parse rate >= 98%.
2. Safety lexicon: 100%.
3. Surface invariants: 100%.
4. Latency: record-only unless the adapter is being proposed for a runtime.

---

## 8. Ship Gates

To ship or update the demo LoRA:

- [ ] `lora-wave-session.jsonl` was exported from ready/approved rows only.
- [ ] Each specialized source set has 20 ready/approved examples, or the PR
      explains why a set is intentionally under target.
- [ ] The 80 / 20 split is committed or reproducible with a logged seed.
- [ ] Eval report shows pass on JSON validity, safety lexicon, surface
      invariants, routing correctness, and latency.
- [ ] The merged ONNX artifact hash is recorded in the adapter/model manifest.
- [ ] Clinician reviewer initials are named for the reviewed seed set.

To ship a specialized LoRA in a future runtime:

- [ ] Its own split and eval report pass.
- [ ] Runtime support can load the adapter without full model reload.
- [ ] Rule-based routing selects the adapter; the model never selects its own
      LoRA.
- [ ] Crisis and intake safety remain no-LoRA surfaces.

---

## 9. Directory Map

```
client/app/training/                  # developer-only seed collection UI
client/app/api/training/export/route.ts
                                      # specialized and combined JSONL export
client/lib/training/lora-specs.ts     # form specs + Zod validators
client/data/training-seeds/
  lora-phase-narration.json
  lora-check-in-1.json
  lora-check-in-2.json
  lora-check-in-3.json
  lora-check-in-4.json
  lora-check-in-5.json
  lora-reflection.json

client/synthetix/                     # future generated-data pipeline
  runs/
    lora-wave-session/<run-id>/
      train.jsonl
      test.jsonl
      adapter/
      merged-onnx/
      eval.json
```

---

## 10. Intentional Non-Goals

- No browser runtime LoRA hot-swapping for the demo.
- No separate merged ONNX model per specialized LoRA in the demo.
- No model involvement in intake safety routing.
- No LoRA for crisis triage.
- No RLHF for the MVP.
- No real patient data in training seeds.

---

## 11. Alignment With The Rest Of The Repo

- `docs/models.md` defines what ships and what is future/demo-only.
- `PRD.md > Medication-Aware Prompt Logic` defines medication-aware clinical
  constraints.
- `AGENTS.md > Domain Constraints` defines safety, tone, privacy, and crisis
  boundaries.
- `client/lib/gemma/local-runtime.ts` is the browser runtime boundary that will
  load the merged demo artifact.
- `client/lib/prompts/schemas.ts` remains the product-side validation contract
  for generated outputs.
