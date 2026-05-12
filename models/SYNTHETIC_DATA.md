# WAVE Synthetic Data Generation

This document explains how WAVE generates synthetic draft rows for the unified
`lora-wave-session` LoRA experiment. The script is
`generate_wave_session_synthetic.py`.

For the broader picture (including deterministic phase-narration expansion,
shared validators, and how we scope “clinical accuracy”), see
[`SYNTHETIC_DATASET_GENERATION.md`](SYNTHETIC_DATASET_GENERATION.md).

Synthetic rows are clinical-adjacent training drafts. They are not
clinician-authored examples, and they must remain labeled as synthetic in every
training and evaluation report.

## When To Generate

Run synthetic generation only after EDA shows a meaningful imbalance. The
current normalized dataset is heavily weighted toward check-in turns, so the
first-generation target is to fill underrepresented surfaces:

- `phase_narration`
- `reflection`
- optionally rare final check-in turns

Do not generate rows simply to make the dataset larger. Generate only to fill a
specific coverage gap.

## Inputs

The generator expects the normalized dataset from:

```powershell
cd models
python prepare_wave_session_dataset.py
```

The normalizer can write:

```text
models/datasets/lora-wave-session-normalized.jsonl
```

That normalized file is intentionally treated as a regenerable intermediate and
does not need to be kept once `lora-wave-session-expanded.jsonl` exists.

Each row should already use the unified training shape:

```json
{
  "input": {
    "surface": "phase_narration",
    "prompt": "...",
    "metadata": { "...": "..." }
  },
  "output": { "...": "..." }
}
```

## Final Dataset Composition

The current expanded training dataset is
`models/datasets/lora-wave-session-expanded.jsonl`.

- Total rows: `4,277`
- User-provided / source rows: `1,632`
  - `1,574` draft source rows
  - `58` ready source rows
- Accepted synthetic draft rows: `2,645`

By surface:

| Surface | User-provided rows | Synthetic rows | Total rows |
| --- | ---: | ---: | ---: |
| `check_in` | 1,534 | 0 | 1,534 |
| `phase_narration` | 50 | 1,503 | 1,553 |
| `reflection` | 48 | 1,142 | 1,190 |

This composition should be disclosed in any training, evaluation, or competition
writeup that uses the expanded dataset.

## Dry Coverage Pass

Start with a no-API pass. This computes gaps and writes audit artifacts without
calling OpenAI:

```powershell
cd models
python generate_wave_session_synthetic.py
```

Outputs:

- `datasets/lora-wave-session-coverage-plan.json`
- `datasets/lora-wave-session-expanded.jsonl`
- `datasets/lora-wave-session-synthetic-report.json`
- `datasets/lora-wave-session-synthetic-quality-audit.md`

In no-API mode, the expanded file may match the input dataset. That is expected.

## OpenAI Key Handling

The script reads an OpenAI API key from the process environment or from the
configured env file. It never prints the key or writes it to an artifact.

Preferred:

```powershell
$env:OPENAI_API_KEY="..."
python generate_wave_session_synthetic.py --generate --max-accepted 20
```

If using an env file, pass it explicitly:

```powershell
python generate_wave_session_synthetic.py --generate --max-accepted 20 --env-path "..\client\.env.local"
```

Never commit API keys. Never copy key values into reports, markdown, or dataset
metadata.

## OpenAI Defaults

The current generator defaults are:

- Model: `gpt-5-mini`
- Endpoint: Chat Completions (`/v1/chat/completions`)
- Reasoning effort: `minimal`
- Concurrency: `50`
- Batch size per generation request: `20`
- Temperature: OpenAI default, because GPT-5 family Chat Completions can reject
  non-default temperature values
- Output format: JSON object

The Chat Completions parameter for reasoning is `reasoning_effort`, not nested
`reasoning: { "effort": ... }`. The nested form is used by the Responses API.
`gpt-5-mini` does not support `none`, so the default is `minimal`.

To override reasoning effort:

```powershell
python generate_wave_session_synthetic.py --generate --max-accepted 20 --reasoning-effort low
```

To increase or reduce parallel request volume:

```powershell
python generate_wave_session_synthetic.py --generate --max-accepted 304 --concurrency 20
```

The current default target is to make `phase_narration` and `reflection` roughly
match the existing check-in count, using `--target-phase 1534` and
`--target-reflection 1534`.

The script still serializes local acceptance and deduplication after generation
responses return, so concurrent requests cannot admit duplicate rows.

## Generation Strategy

The OpenAI model is only a draft generator. It does not decide what enters the
training set.

The script:

1. Computes coverage gaps by `surface`, `sourceLoraId`, `chunkNumber`,
   `medicationStatus`, `trigger`, and final-turn status.
2. Builds deterministic scenario seeds for each gap.
3. Sends source-grounded prompts with nearby clinician examples and the exact
   output schema.
4. Receives JSON draft candidates.
5. Runs local duplicate, schema, safety, and quality gates.
6. Writes only accepted drafts to the synthetic draft JSONL.
7. Merges accepted drafts with the normalized dataset into an expanded dataset.

Use a small capped run first:

```powershell
python generate_wave_session_synthetic.py --generate --max-accepted 20
```

Run the full current coverage target:

```powershell
python generate_wave_session_synthetic.py --generate --max-accepted 304
```

Then inspect:

```text
datasets/lora-wave-session-synthetic-report.json
datasets/lora-wave-session-synthetic-quality-audit.md
```

Only increase `--max-accepted` after the rejection reasons and accepted examples
look reasonable.

## Duplicate Rejection

The generator cannot guarantee uniqueness. The local pipeline enforces practical
uniqueness through deterministic checks:

- `canonical_json_hash`: sorted JSON hash of stable input/output content.
- `normalized_text_hash`: lowercased patient-facing output with punctuation and
  spacing normalized.
- `scenario_hash`: prevents repeated scenario seeds.
- 5-gram Jaccard similarity: rejects high-overlap rows within the same surface.
- ROUGE-L similarity: rejects rows too close to existing same-surface outputs.
- Batch-level insertion: every accepted draft is immediately added to the dedup
  index, so later candidates in the same run are checked against it.

Default thresholds:

- Short output 5-gram Jaccard: `0.65`
- Long output 5-gram Jaccard: `0.55`
- ROUGE-L: `0.72`

These thresholds reject practical duplicates. They do not prove absolute
semantic uniqueness.

## Medical-Quality Gates

Synthetic candidates must pass every local quality gate before acceptance:

- Valid JSON object.
- Exact surface schema.
- No toxic positivity.
- No shame language.
- No medication directives.
- No crisis routing.
- No hallucinated pharmacology.
- Surface invariants:
  - phase narration has exactly six lines.
  - reflection has a numeric ending intensity and four next-step chips.
  - check-in turns have the correct `endConversation` state.
- Distributional length check against original rows from the same surface.
- Rubric score at or above the configured threshold, default `85`.

The generated quality audit explains the method and records thresholds, counts,
accepted rows by surface, rejection reasons, and limitations.

## Test-Set Rule

Do not put synthetic rows in the final frozen test set when clinician-source rows
are available. Synthetic rows can be used in training experiments, but the final
base-vs-LoRA claim should disclose the synthetic composition and evaluate on
clinician-source held-out examples where possible.

## Training With Expanded Data

After review, train against the expanded dataset:

```powershell
python train_wave_session_lora.py --data "datasets\lora-wave-session-expanded.jsonl" --dry-run
```

Then run a short training attempt before a full run:

```powershell
python train_wave_session_lora.py --data "datasets\lora-wave-session-expanded.jsonl" --max-steps 25
```

If synthetic rows are included in a competition result, the result summary must
state:

- how many synthetic rows were accepted
- which surfaces they targeted
- what duplicate and quality thresholds were used
- whether the final test split contained synthetic rows
- that synthetic rows are drafts, not clinician-authored examples

## Main Artifacts

- `generate_wave_session_synthetic.py`: pipeline implementation.
- `datasets/lora-wave-session-coverage-plan.json`: gap plan.
- `datasets/lora-wave-session-expanded.jsonl`: normalized plus accepted synthetic rows.
- `datasets/lora-wave-session-synthetic-report.json`: machine-readable summary.
- `datasets/lora-wave-session-synthetic-quality-audit.md`: human-readable audit.

## Regenerable Intermediates

To keep `models/datasets/` small, these large intermediate files are not kept by
default:

- `lora-wave-session-normalized.jsonl`
- `lora-wave-session-synthetic-draft.jsonl`

Regenerate the normalized source rows:

```powershell
python prepare_wave_session_dataset.py
```

Extract accepted synthetic rows from the expanded dataset if needed:

```powershell
python -c "import json; from pathlib import Path; src=Path('datasets/lora-wave-session-expanded.jsonl'); out=Path('datasets/lora-wave-session-synthetic-draft.jsonl'); rows=[json.loads(line) for line in src.read_text(encoding='utf-8').splitlines() if line.strip()]; out.write_text('\n'.join(json.dumps(row, ensure_ascii=False, separators=(',',':')) for row in rows if row.get('input',{}).get('metadata',{}).get('sourceStatus')=='synthetic_draft') + '\n', encoding='utf-8')"
```
