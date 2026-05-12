---
license: gemma
base_model: unsloth/gemma-4-E2B-it
library_name: gguf
tags:
- gemma
- gemma-4
- gguf
- llama.cpp
- ollama
- quantized
- q4_k_m
- clinical
- wellness
- structured-output
- json
language:
- en
datasets:
- Maelstrome/lora-wave-session-dataset
pipeline_tag: text-generation
---

# lora-wave-session-gguf

Quantized GGUF build of [`Maelstrome/lora-wave-session`](https://huggingface.co/Maelstrome/lora-wave-session) — a Gemma 4 E2B Instruct fine-tune for the WAVE wellness/companion app.

The LoRA adapter has been merged into the base and quantized to **Q4_K_M** for deployment with llama.cpp, Ollama, wllama (browser WASM), and similar runtimes.

## Files

| File | Size | Use |
|---|---|---|
| `gemma-4-e2b-it.Q4_K_M.gguf` | 3.19 GB | Text LLM (q4_k_m). What you want for WAVE text surfaces. |
| `gemma-4-e2b-it.BF16-mmproj.gguf` | 941 MB | Vision/audio projector. Skip for text-only use. |
| `Modelfile` | 214 B | Ollama recipe |

## Try it

🌊 **Interactive demo:** [`Maelstrome/lora-wave-session-demo`](https://huggingface.co/spaces/Maelstrome/lora-wave-session-demo) — Gradio Space backed by this exact GGUF, with surface-specific example prompts.

## Quickstart

### llama.cpp

```bash
# Download
huggingface-cli download Maelstrome/lora-wave-session-gguf gemma-4-e2b-it.Q4_K_M.gguf --local-dir .

# Run
llama-cli -m gemma-4-e2b-it.Q4_K_M.gguf -p "Your prompt here" -n 256
```

### Ollama

```bash
huggingface-cli download Maelstrome/lora-wave-session-gguf gemma-4-e2b-it.Q4_K_M.gguf Modelfile --local-dir .
ollama create wave-session -f Modelfile
ollama run wave-session
```

### LM Studio / Jan / Open WebUI

Search for `Maelstrome/lora-wave-session-gguf` and pick `gemma-4-e2b-it.Q4_K_M.gguf`.

### Python (`llama-cpp-python`)

```python
from llama_cpp import Llama
from huggingface_hub import hf_hub_download

path = hf_hub_download("Maelstrome/lora-wave-session-gguf", "gemma-4-e2b-it.Q4_K_M.gguf")
llm = Llama(model_path=path, n_ctx=4096, chat_format="gemma")

resp = llm.create_chat_completion(
    messages=[{"role": "user", "content": SYSTEM_PROMPT + "\n\n" + USER_PROMPT}],
    max_tokens=256, temperature=1.0, top_p=0.95, top_k=64,
)
print(resp["choices"][0]["message"]["content"])
```

### Browser (wllama / web-llama.cpp)

The Q4_K_M GGUF can be loaded by WASM-based browser runtimes such as [wllama](https://github.com/ngxson/wllama). Note that 3.19 GB is large for a browser cache — consider gating the download behind explicit user consent.

## Example prompts

The model expects a system prompt establishing it as **WAVE**, plus a per-surface user prompt with `<surface>`, `<patient_context>`, and `<task>` blocks. Output is strict JSON.

### System prompt (use for all surfaces)

```
You are WAVE, an on-device urge surfing companion for people in Substance Use Disorder recovery.
Write patient-facing support for a structured urge surfing session.
The tone is trauma-informed, calm, concrete, nonjudgmental, and unhurried.
Do not prescribe medication. Do not tell the patient to stop or start any substance.
Output strict JSON only — no markdown, no analysis, no explanations.
```

### `phase_narration` user prompt

```
<surface>phase_narration</surface>
<chunk>Number 5 of 5 - Close. Purpose: invite comparison to the start, normalize any outcome, prepare for a final check-in.</chunk>
<patient_context>{"chunkNumber":5,"matType":"none","medicationStatus":"none","startingIntensityBand":"1-6","trigger":"unknown","usedSubstanceToday":false}</patient_context>
<task>Generate exactly 6 patient-facing narration lines. Return strict JSON. Schema: {"lines":["...", ...]}</task>
```

Run with `-n 256` (six-line outputs need ≥ 224 new tokens).

### `reflection` user prompt

```
<surface>reflection</surface>
<patient_context>{"durationSeconds":780,"endingIntensity":2,"intakeIntensity":7,"matType":"buprenorphine","medicationStatus":"on_time","sessionsCount":12,"trigger":"stress","usedSubstanceToday":false}</patient_context>
<task>Write the post-session reflection card. Return strict JSON. Schema: {"insight":"...","journalPromptQuestion":"...","nextSteps":{"a":"...","b":"...","c":"...","d":"..."}}</task>
```

### `check_in` user prompt

```
<surface>check_in</surface>
<specialized_surface>lora-check-in-1</specialized_surface>
<patient_context>{"intakeIntensity":7,"matType":"buprenorphine","trigger":"stress"}</patient_context>
<task>Open turn 1: ask the patient to rate their current urge intensity 1-10. Schema: {"reply":"...","endConversation":null}</task>
```

## Performance (RTX 5080 box)

| Test | Throughput |
|---|---|
| Prompt processing pp512 | ~296 tok/s (CPU, 8 threads) |
| Prompt processing pp1024 | ~302 tok/s |
| Token generation tg128 | ~24 tok/s |
| Token generation tg256 | ~22 tok/s |

(GPU-offload numbers were not measured — bundled llama.cpp DLL was built for CUDA 12.x against an installed CUDA 13.x toolkit.)

## Surfaces

The fine-tune targets three structured-output surfaces — strict JSON, no markdown, no analysis voice, patient-facing tone:

- **`check_in`** — multi-turn check-in (max ~96 new tokens)
- **`phase_narration`** — six-line narration (needs **≥ 224** new tokens, recommended 256)
- **`reflection`** — reflection plan with next step (max ~192 new tokens)

## Provenance and intended use

Trained for the WAVE app, a wellness/reflection tool — not a medical device, not clinical decision support, not a substitute for professional advice. Use under the [Gemma Terms of Use](https://ai.google.dev/gemma/terms).

## Limitations

- **Wellness scope only.** Do not use for medical diagnosis, crisis triage, or clinical decision support.
- Q4_K_M is a lossy quantization. For maximum fidelity, use the unquantized adapter at [`Maelstrome/lora-wave-session`](https://huggingface.co/Maelstrome/lora-wave-session).
- Training data is English; multilingual behavior was not measured.

## License

Gemma Terms of Use. See [https://ai.google.dev/gemma/terms](https://ai.google.dev/gemma/terms).
