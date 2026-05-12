---
license: gemma
base_model: unsloth/gemma-4-E2B-it
library_name: peft
tags:
- gemma
- gemma-4
- lora
- peft
- unsloth
- clinical
- wellness
- structured-output
- json
- sft
- trl
language:
- en
datasets:
- Maelstrome/lora-wave-session-dataset
pipeline_tag: text-generation
---

# lora-wave-session

A unified LoRA adapter on top of **Gemma 4 E2B Instruct** that handles three structured-output surfaces for the WAVE wellness/companion app:

- **`check_in`** — multi-turn patient check-in with structured turn sequencing
- **`phase_narration`** — six-line patient-facing phase narration
- **`reflection`** — reflection plan with a concrete next step

All three surfaces emit strict JSON, no markdown, no analysis voice, in patient-facing tone.

## Provenance and intended use

Trained for the WAVE app, a wellness/reflection tool — not a medical device, not clinical decision support, not a substitute for professional advice. Use under the [Gemma Terms of Use](https://ai.google.dev/gemma/terms).

## Try it

🌊 **Interactive demo:** [`Maelstrome/lora-wave-session-demo`](https://huggingface.co/spaces/Maelstrome/lora-wave-session-demo) — Gradio Space with surface-specific example prompts.

## Quickstart (PEFT + Unsloth)

```python
from unsloth import FastModel

model, tokenizer = FastModel.from_pretrained(
    model_name="Maelstrome/lora-wave-session",  # PEFT auto-loads base
    max_seq_length=3072,
    load_in_4bit=True,
)
```

Or with vanilla PEFT:

```python
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer

base = AutoModelForCausalLM.from_pretrained("unsloth/gemma-4-E2B-it")
tok = AutoTokenizer.from_pretrained("unsloth/gemma-4-E2B-it")
model = PeftModel.from_pretrained(base, "Maelstrome/lora-wave-session")
```

For a one-file 4-bit GGUF deployable with llama.cpp / Ollama / wllama, see [`Maelstrome/lora-wave-session-gguf`](https://huggingface.co/Maelstrome/lora-wave-session-gguf).

## Example prompts

The model expects a system prompt establishing it as **WAVE**, plus a per-surface user prompt with `<surface>`, `<patient_context>`, and `<task>` blocks. Output is strict JSON.

### `phase_narration` (six-line meditation)

User prompt:

```
<surface>phase_narration</surface>
<chunk>Number 5 of 5 - Close. Purpose: invite comparison to the start, normalize any outcome, and prepare for a final check-in.</chunk>
<patient_context>{"chunkNumber":5,"matType":"none","medicationStatus":"none","startingIntensityBand":"1-6","trigger":"unknown","usedSubstanceToday":false}</patient_context>
<task>Generate exactly 6 patient-facing narration lines. Return only strict JSON. Schema: {"lines":["...", ...]}</task>
```

Expected output (set `max_new_tokens >= 224`):

```json
{"lines":["You've made it to the end of this practice.","Check in with your urge now — has anything shifted?","...","...","...","..."]}
```

### `reflection` (post-session card)

User prompt:

```
<surface>reflection</surface>
<patient_context>{"durationSeconds":780,"endingIntensity":2,"intakeIntensity":7,"matType":"buprenorphine","medicationStatus":"on_time","sessionsCount":12,"trigger":"stress","usedSubstanceToday":false}</patient_context>
<task>Write the post-session reflection card. Return only strict JSON. Schema: {"insight":"...","journalPromptQuestion":"...","nextSteps":{"a":"...","b":"...","c":"...","d":"..."}}</task>
```

### `check_in` (multi-turn)

User prompt:

```
<surface>check_in</surface>
<specialized_surface>lora-check-in-1</specialized_surface>
<patient_context>{"intakeIntensity":7,"matType":"buprenorphine","trigger":"stress"}</patient_context>
<task>Open turn 1: ask the patient to rate their current urge intensity 1-10. Schema: {"reply":"...","endConversation":null}</task>
```

## Training

| | |
|---|---|
| Base | `unsloth/gemma-4-E2B-it` |
| Method | QLoRA (4-bit) |
| Adapter rank / alpha / dropout | 16 / 32 / 0 |
| Target modules | q/k/v/o + gate/up/down (language layers only) |
| Vision/audio layers | Frozen |
| Optimizer | adamw_8bit |
| LR | 2e-4, linear schedule |
| Warmup | 64 steps (~5%) |
| Weight decay | 0.001 |
| Max grad norm | 0.3 |
| Batch / grad-accum | 1 / 8 (effective 8) |
| Max sequence length | 3072 |
| Epochs | 3 (1,284 steps) |
| Chat template | `gemma-4` (non-thinking, leading `<bos>` stripped) |
| Response masking | `train_on_responses_only` (Gemma 4 markers) |
| Hardware | Single RTX 5080 (16 GB) |
| Backend | Unsloth 2026.5.2 + Torch 2.10.0 + CUDA 12.8 |

Loss curve: 1.55 (step 1) → 0.76 (avg first 50) → 0.148 (steps 400-500) → 0.112 (last 100). Min 0.0146 at step 1,203. Smooth monotonic decrease, no divergence.

## Evaluation

### Held-out validation (n=428, completion-only)

| Metric | Value |
|---|---|
| Completion NLL | 4.704 |
| Completion PPL | 110.4 |

Surface coverage: `check_in 165`, `phase_narration 155`, `reflection 108`.

### Generation sanity (n=8 from held-out test)

| Metric | Value |
|---|---|
| JSON validity | 100% (8/8) |
| Schema pass | 100% (8/8) |
| Safety pass | 100% |
| Medical-directive pass | 100% |
| Style / no-markdown / no-analysis-voice | 100% |
| Phase 6-line pass | 100% |
| Reflection next-step pass | 100% |
| Check-in turn sequence pass | 100% |
| Mean tokens/sec (Python QLoRA path) | 10.1 |

> **Generation-time tip:** `phase_narration` outputs need a budget of **≥ 224 new tokens** (256 recommended). Test outputs needed up to 207 tokens for the six-line JSON to complete cleanly. `check_in` is fine at 96, `reflection` at 192.

## Dataset

[`Maelstrome/lora-wave-session-dataset`](https://huggingface.co/datasets/Maelstrome/lora-wave-session-dataset) — 4,277 examples across three surfaces, stratified 80/10/10 by `splitKey` (seed `7`).

Status mix: 62% `synthetic_draft`, 37% `draft`, 1% `ready`. No real PHI.

## Limitations

- **Wellness scope only.** Do not use for medical diagnosis, crisis triage, or clinical decision support.
- Trained mostly on synthetic and draft-status data, not clinician-validated production data.
- Outputs are constrained-format JSON. The model is not optimized for open-ended chat.
- Training data is English; multilingual behavior was not measured.
- Phase narration needs a per-surface generation budget ≥ 224 tokens or it will be truncated.

## License

Gemma Terms of Use. See [https://ai.google.dev/gemma/terms](https://ai.google.dev/gemma/terms).

### Framework versions

- PEFT 0.19.1
- Unsloth 2026.5.2
- Transformers 5.5.0
- Torch 2.10.0+cu128
