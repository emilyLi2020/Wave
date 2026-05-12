# models/

Ad-hoc model experiments and smoke tests for WAVE. **Nothing in this folder ships to users** — the production session path runs Gemma 4 E2B-it via `transformers.js` + WebGPU in the browser (web demo) or LiteRT on-device (mobile, post-hackathon). For the per-model contract see [`../docs/models.md`](../docs/models.md); for the training/eval pipeline see [`../docs/model-training.md`](../docs/model-training.md).

## Setup

This folder supports **two interchangeable workflows** — pick whichever you already have installed:

- **uv** (recommended, fastest) — uses `pyproject.toml` + `.python-version`, auto-downloads Python 3.11, installs into `models/.venv`.
- **conda** — uses `environment.yml`, creates a `wave-models` env in your conda installation.

Both produce the same Python 3.11 environment with the same package versions.

### Single source of truth: `pyproject.toml`

`pyproject.toml` is the source of truth for the dependency list. `environment.yml` is auto-generated from it by `sync_env.py` and carries an `# AUTO-GENERATED` header to make that obvious. **Never edit `environment.yml` by hand** — your changes will be overwritten the next time someone runs the sync script.

When you add or change a dependency:

1. Edit `[project].dependencies` in `pyproject.toml`.
2. Run the sync script (works from either env):
   ```bash
   uv run python sync_env.py     # if you use uv
   python sync_env.py            # if you use conda (any Python 3.11+ works)
   ```
3. Commit `pyproject.toml`, `uv.lock`, and `environment.yml` together.

The script has zero third-party deps, so it runs from a bare conda env or a fresh uv venv.

## Setup (uv)

[uv](https://docs.astral.sh/uv/) reads `pyproject.toml` + `.python-version`, downloads the right CPython if missing, and installs everything into `models/.venv` in one step.

If you don't have `uv` yet:

```powershell
# Windows (PowerShell)
irm https://astral.sh/uv/install.ps1 | iex
```

```bash
# macOS / Linux
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### Create the env

```bash
cd models
uv sync                       # creates .venv, installs torch + transformers + jupyter
```

`uv sync` will auto-download CPython 3.11 the first time. Subsequent runs are near-instant when nothing changed.

### Run the notebook

You don't need to manually `activate` the venv — `uv run` does it for you:

```bash
uv run jupyter lab            # or: uv run jupyter notebook
```

If you prefer an activated shell:

```powershell
# Windows (PowerShell)
.venv\Scripts\Activate.ps1
jupyter lab
```

```bash
# macOS / Linux
source .venv/bin/activate
jupyter lab
```

### GPU (optional)

`uv sync` installs the CPU build of PyTorch from PyPI, which is fine for the smoke test. If you have an NVIDIA GPU and want CUDA, swap the wheel after the first sync (pick the index URL that matches your CUDA toolkit — `cu124`, `cu121`, etc.):

```bash
uv pip install --index-url https://download.pytorch.org/whl/cu124 --upgrade torch
```

### Updating deps

Edit `pyproject.toml`, then:

```bash
uv sync
```

To start over:

```bash
# remove .venv and reinstall
rm -rf .venv && uv sync       # PowerShell: Remove-Item -Recurse -Force .venv; uv sync
```

## Setup (conda)

For collaborators who already have conda set up. Conda only owns Python itself; everything heavy (PyTorch, transformers, jupyter) is installed via pip inside the env.

### One-time: switch conda to the libmamba solver

If you haven't already, swap conda's default solver to `libmamba`. It's 10–100× faster than the classic solver and is the default in newer conda installs anyway:

```bash
conda install -n base conda-libmamba-solver -y
conda config --set solver libmamba
```

### Create and activate the env

```bash
cd models
conda env create -f environment.yml      # creates the `wave-models` env (~2 min)
conda activate wave-models
jupyter lab
```

If `environment.yml` changed since you last set up:

```bash
conda env update -f environment.yml --prune
```

If you ever need to start over:

```bash
conda env remove -n wave-models
```

> Reminder: `environment.yml` is generated from `pyproject.toml`. If you need to add or change a package, edit `pyproject.toml` and run `python sync_env.py` (see *Single source of truth* above) — don't edit `environment.yml` directly.

### Hugging Face auth

Gemma weights are gated — accept the license at <https://huggingface.co/google/gemma-4-E2B-it> once and either run `huggingface-cli login` in your shell or paste a token in the notebook's auth cell.

## LoRA Experiments

### Phase narration

Generate draft synthetic rows from the first clinician seed file:

```powershell
cd models
uv run python generate_phase_narration_synthetic.py --source "C:\Users\Bill\Downloads\lora-phase-narration-clinician.jsonl"
```

This writes:

- `datasets/lora-phase-narration-synthetic-draft.jsonl` - 40 synthetic draft
  rows only.
- `datasets/lora-phase-narration-expanded.jsonl` - the 10 source rows plus the
  40 synthetic draft rows.

Synthetic rows are deterministic for the same `--seed`, marked `draft`, and
carry provenance notes because they need clinician review before they should be
treated as ready training data.

`train_phase_narration_lora.py` trains the future `lora-phase-narration`
adapter from clinician seed JSONL and writes a frozen split plus eval report
under `models/runs/lora-phase-narration/<timestamp>/`.

The trainer does not feed bare JSON inputs to Gemma. It wraps every example in
the same shape the app uses for chunk generation: a WAVE system prompt, a
chunk-specific user task, and an assistant response that is strict
`{"lines":[...]}` JSON. That mirrors the production JSON-mode contract
(`generateText` + `Output.object()` / schema validation in AI SDK terminology)
instead of teaching the model to analyze raw clinical data.

First validate the dataset and split without loading Gemma:

```powershell
cd models
uv run python train_phase_narration_lora.py --data "C:\Users\Bill\Downloads\lora-phase-narration-clinician.jsonl" --dry-run
```

To run an experimental split that includes synthetic draft rows:

```powershell
uv run python train_phase_narration_lora.py --data "datasets\lora-phase-narration-expanded.jsonl" --include-drafts --dry-run
```

Then run the full QLoRA experiment against whichever dataset you want to test:

```powershell
uv run python train_phase_narration_lora.py --data "C:\Users\Bill\Downloads\lora-phase-narration-clinician.jsonl"
```

The script accepts both raw training-seed JSONL and the ShareGPT-style
`messages` JSONL emitted by `/api/training/export`. It records:

- `train.jsonl` and `test.jsonl` - the reproducible held-out split.
- `adapter/` - the PEFT LoRA adapter and tokenizer files.
- `eval.json` - generation metrics on the held-out set: JSON validity, six-line
  schema pass rate, patient-facing style pass rate, safety pass rate,
  medication-directive pass rate, p95 latency, token F1, and ROUGE-L. It also
  evaluates base Gemma on the same held-out prompts and records base-vs-LoRA
  deltas for completion NLL, perplexity, schema/style/safety pass rates, and a
  composite `loraWaveScore` out of 100.
- `run-config.json` - model, split seed, data counts, and hyperparameters.

On Windows, the script automatically re-launches itself in Python UTF-8 mode
before importing TRL. That avoids a known `cp1252` import crash in TRL's bundled
chat-template files.

### Unified session synthetic data

`generate_wave_session_synthetic.py` creates targeted synthetic draft rows for
the unified `lora-wave-session` dataset only where EDA shows coverage gaps. It
uses an OpenAI model as a draft generator, then applies local duplicate,
schema, safety, and medical-quality gates before accepting any row.

Read the full process, commands, and disclosure rules in
[`SYNTHETIC_DATA.md`](SYNTHETIC_DATA.md).

For a single narrative on **both** synthetic paths (phase templates vs unified
session gap-fill), how they connect to `prepare_wave_session_dataset.py`, and
how clinical safeguards are layered, see
[`SYNTHETIC_DATASET_GENERATION.md`](SYNTHETIC_DATASET_GENERATION.md).

## Notebooks

- `01_gemma4_smoke_test.ipynb` — downloads the smallest Gemma 4 (`google/gemma-4-E2B-it`) and runs one generic and one WAVE-style prompt to confirm the base model works on this machine before any LoRA work begins.
