# Convert the PEFT-merged Gemma 4 fine-tune to a MediaPipe `.task` file (Mac handoff)

> **⚠️ DEAD END as of 2026-05-14 — read this before running anything below.**
>
> The procedure documented here was executed on a Mac (2026-05-14). It produced
> a structurally valid bundle (`Maelstrome/lora-wave-session-r32` →
> `mediapipe/model.litertlm`, 4.7 GB) — but the bundle's outer container is
> `LITERTLM`-magic, **not** `TFL3`-magic as this doc predicted. No version of
> `@mediapipe/tasks-genai` (stable `0.10.27` or nightly `0.10.36-rc.20260514`)
> registers a `LITERTLM` format matcher; both reject the file with
> `Error: No model format matched.` Renaming `.litertlm` → `.task` doesn't help
> (the matcher inspects bytes, not extension).
>
> **Root cause: no public Gemma 4 fine-tune → web-`.task` path exists.** Google
> staff (tylermullen) confirmed on
> [HF litert-community/TranslateGemma-4B-IT discussion #1](https://huggingface.co/litert-community/TranslateGemma-4B-IT/discussions/1):
> *"The pre-converted models we have so far are '-web.task' format, which we
> don't have any fine-tuning notebooks or colabs for, and probably won't be
> able to make any time soon. Note that most of the documentation on our
> website for model conversion will point you to a different converter which
> will not work for this purpose."*
>
> Full writeup with reproduction + community-issue links:
> [`postmortems/mediapipe-finetune.md`](postmortems/mediapipe-finetune.md).
> Web-shipping route for the fine-tune is now wllama/GGUF — see
> [`wllama.md`](wllama.md). Mobile via LiteRT-LM is still viable for the
> `.litertlm` bundle this doc produces.
>
> The steps below are preserved for archival reference (and in case Google
> ships a `LITERTLM` web consumer or a fine-tune→`-web.task` recipe later).

---

**Why this exists**: Google's `litert-converter` Python wheel ships only for
`manylinux_2_27_x86_64` and `macosx_12_0_arm64`. There is no Windows wheel, so
the conversion can't run on the dev machine where the fine-tune was trained.
Run this on an Apple Silicon Mac (M1+), then ship the resulting `.task` file
back to Windows.

**What you get**: a ~2 GB `.task` (or `.litertlm`) file that loads in the
browser via `@mediapipe/tasks-genai` and runs through LiteRT-LM's WebGPU
kernels — bypassing the `onnxruntime-web` fp16 overflow bug that blocked the
ONNX path. Validated working with base Gemma 4 on this exact code path:
phase 2.5s, check-in 1.0s, reflection 1.5s — all coherent. _**Update
2026-05-14**: the prediction "what you get" turned out wrong for fine-tunes —
see banner above. The base `gemma-4-E2B-it-web.task` works because Google
built it internally with an unpublished recipe; running the steps below on a
fine-tuned checkpoint produces a `LITERTLM` file with no browser consumer._

**Time**: ~20 min if no surprises (mostly the conversion run itself).

---

## What you need

- Apple Silicon Mac (M1 / M2 / M3 / M4). x86 Intel Macs do NOT have a wheel
  either — `litert-converter` is `macosx_12_0_arm64` only.
- macOS 12+ (Monterey or newer).
- ~12 GB free disk (10 GB for the merged checkpoint, ~2 GB for the output).
- `uv` installed: `curl -LsSf https://astral.sh/uv/install.sh | sh`
  (`brew install uv` works too)
- The merged PEFT checkpoint from Windows (10 GB of `.safetensors` + configs).

---

## Step 1 — Get the merged checkpoint onto the Mac

The PEFT-merged Gemma 4 fine-tune lives at `models/runs/merge-peft/` on the
Windows machine. Three options to transfer it:

### Option A — pull from HuggingFace if you've already pushed it

```bash
cd ~/wave-mediapipe          # any working directory
mkdir -p models/runs
hf download Maelstrome/lora-wave-session-r32-merged \
  --local-dir models/runs/merge-peft
```

(Note: the comment in `docs/onnx-windows-handoff.md` warns that the
**Unsloth-saved** version of this repo is corrupt. Make sure the version on
HF is the PEFT re-merge, not the original Unsloth save. Verify with the
diagnose step below before converting.)

### Option B — scp from Windows over the local network

From the Mac, with Windows running OpenSSH server:

```bash
scp -r <windows-user>@<windows-host>:/e/Github/Wave/models/runs/merge-peft \
  ./models/runs/merge-peft
```

### Option C — sneakernet via external drive

Copy `e:\Github\Wave\models\runs\merge-peft\` to a USB drive, plug into Mac,
copy to `./models/runs/merge-peft/`.

### Verify the checkpoint is the working PEFT-merge (not the corrupt Unsloth one)

```bash
# Should contain at minimum: config.json, generation_config.json,
# tokenizer.json, chat_template.jinja, and several .safetensors shards.
ls -lh models/runs/merge-peft/

# Quick smoke test — load in plain PyTorch and generate two tokens.
# If this prints coherent output, the checkpoint is good. If it prints
# 100% <pad> tokens, you grabbed the corrupt Unsloth save by mistake.
uv run --with "transformers>=5.5,<6" --with torch python -c "
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
m = AutoModelForCausalLM.from_pretrained('models/runs/merge-peft', torch_dtype=torch.float16)
t = AutoTokenizer.from_pretrained('models/runs/merge-peft')
ids = t.apply_chat_template([{'role':'user','content':'What is the capital of France? Answer in one sentence.'}], add_generation_prompt=True, return_tensors='pt')
out = m.generate(ids, max_new_tokens=16, do_sample=False)
print(t.decode(out[0][ids.shape[1]:], skip_special_tokens=True))
"
# Expected: "The capital of France is Paris." (give or take)
```

---

## Step 2 — Install `litert-torch-nightly` in a clean venv

Nightly because Gemma 4 support hasn't graduated to the stable release as of
2026-05-14. Stable `mediapipe` and stable `litert-torch` do NOT have Gemma 4.

```bash
cd ~/wave-mediapipe                                        # the dir from step 1
uv venv .venv-litert --python 3.11
source .venv-litert/bin/activate

# Note: pre-releases must be enabled. The nightly wheel set requires Linux or
# macOS-arm64 (which is why we can't do this on Windows).
uv pip install --prerelease=allow \
  litert-torch-nightly \
  ai-edge-litert-nightly \
  "torch>=2.11.0"
```

Verify the CLI loads:

```bash
litert-torch --help
litert-torch export_hf --help
```

If `--help` doesn't print cleanly, see "Troubleshooting" at the bottom.

---

## Step 3 — Convert the fine-tune

The conversion command, with our paths:

```bash
litert-torch export_hf \
  --model=models/runs/merge-peft \
  --output_dir=models/runs/litertlm-finetune \
  --externalize_embedder \
  --jinja_chat_template_override=litert-community/gemma-4-E2B-it-litert-lm
```

Flag notes (based on Google's [Gemma 4 LiteRT page](https://ai.google.dev/edge/litert-lm/models/gemma-4)):

- `--model` accepts a local directory OR a HF repo ID. Local works.
- `--externalize_embedder` stores the embed-tokens table as a separate
  segment of the bundle so the runtime can lazy-load it. This is what the
  published `gemma-4-E2B-it-web.task` does.
- `--jinja_chat_template_override` pulls the chat template from Google's
  reference HF repo (`litert-community/gemma-4-E2B-it-litert-lm`). Our merged
  checkpoint has its own `chat_template.jinja`, but the override matches
  what `@mediapipe/tasks-genai` is tuned for. Don't change unless you have a
  reason.

Run it and wait. The conversion is CPU-bound (no GPU needed). On an M-series
Mac it should take 5–20 minutes for an E2B model.

The output directory should contain:
- A `.task` file (web-ready bundle) AND/OR a `.litertlm` file
- Possibly metadata sidecars

Look for the file named like `*-web.task` or just `*.task` — that's the
WebGPU/web-deployable variant. Approximate expected size: 1.5–2.5 GB.

---

## Step 4 — Sanity-check the produced file

```bash
ls -lh models/runs/litertlm-finetune/
file models/runs/litertlm-finetune/*.task     # should say "data"
xxd models/runs/litertlm-finetune/*.task | head -1
# Expected: at offset 4 you should see `TFL3` (the TensorFlow Lite Flatbuffer
# magic identifier). That's the same magic the base model uses.
```

If the magic bytes match the base model's, you have a structurally valid
output.

---

## Step 5 — Ship the `.task` file back to Windows

The `.task` file is platform-agnostic bytes. Any transfer works:

```bash
# Option A — scp back
scp models/runs/litertlm-finetune/*.task \
  <user>@<windows-host>:/e/Github/Wave/models/mediapipe/lora-wave-session-r32-it-web.task

# Option B — push to a private HF repo and pull from Windows
hf upload Maelstrome/lora-wave-session-r32-mediapipe \
  models/runs/litertlm-finetune . --create-repo --private

# Option C — sneakernet
cp models/runs/litertlm-finetune/*.task /Volumes/USBDRIVE/
```

---

## Step 6 — On Windows: test in the browser

Place the `.task` file at `e:/Github/Wave/models/mediapipe/<some-name>.task`,
then:

```powershell
# Terminal 1 — local-hf static server (already configured to mount this dir)
cd client
pnpm exec tsx scripts/serve-local-hf.ts
# Will serve any file at /mediapipe/<filename> with CORS + range requests.

# Terminal 2 — Next.js
cd client
pnpm dev

# Browser
# http://localhost:3000/models/mediapipe-test?model=http://localhost:8765/mediapipe/<your-file>.task
# Click Load (downloads once, cached after) -> Run all 3 tasks.
```

`/models/mediapipe-test` already supports `?model=<url>` to override the
default model URL. The base Gemma 4 page worked end-to-end; if the fine-tune
file is valid + has matching chat template, this will just work.

Expected: coherent WAVE outputs, ~1–3 seconds per task, exactly like the base
model demo on this same page. The fine-tune should sound MORE on-script
(matches Wave's training data) than the base.

If it works, swap `client/app/models/mediapipe-test/client.tsx`'s
`DEFAULT_MODEL_URL` to point at the new file (or push to HF and use the HF
URL), then update `client/lib/gemma/local-runtime.ts` to use MediaPipe for
the production runtime and close issue #6.

---

## Troubleshooting

**`ImportError: cannot import name 'types' from 'ai_edge_litert.aot.core'`** —
the bundled `ai-edge-litert` version doesn't match what `litert-torch` wants.
Explicitly install `ai-edge-litert-nightly` (see Step 2). On the dev Windows
machine, this is what blocked us; on Mac it should resolve because the
matching nightly wheels exist.

**`ValueError: Unknown special model: GEMMA_4_E2B`** — you're hitting the
**stable** `mediapipe` converter instead of `litert-torch-nightly`. The
stable one doesn't have Gemma 4. Make sure `which litert-torch` points to the
`.venv-litert` install, not a system one.

**Conversion takes >30 min** — normal for an E2B model on CPU. M3/M4 may be
faster. There's no GPU/MPS path in this converter as of 2026-05-14.

**`.task` file is suspiciously small (<500 MB)** — probably an export that
didn't include the weights (only the graph metadata). Re-run; if it persists,
inspect the magic bytes; if they're not `TFL3` at offset 4, the converter
failed silently. Check stderr.

**MediaPipe page errors with `INVALID_ARGUMENT` or similar at load time** —
the chat template in the `.task` bundle doesn't match what
`@mediapipe/tasks-genai` expects. Re-run conversion without
`--jinja_chat_template_override` to use the checkpoint's own template, or
double-check that the override repo is reachable from Mac during conversion.

**Output is repeated `<pad>` tokens** — you converted the corrupt
Unsloth-merged checkpoint. Go back to Step 1 and verify the checkpoint with
the smoke test before re-running conversion.

---

## What I tried on Windows before writing this doc

For completeness and so you don't repeat the same dead-ends if the Mac path
also runs into trouble:

- ONNX export iterations v3 → v4 → v5 → v6 → v7: progressively fused
  `FastGelu`, rewrote `Pow(x, 2) → Mul(x, x)`, fused 227/242 RMSNorms into
  `SimplifiedLayerNormalization`, wrapped remaining 15 in fp32 `Cast` pairs.
  All produce coherent output on Node CPU; all still `len=0` on
  `onnxruntime-web` WebGPU. Root cause is `onnxruntime-web`'s fp16 kernel
  per [microsoft/onnxruntime#26732](https://github.com/microsoft/onnxruntime/issues/26732),
  not our export.
- MediaPipe runtime (base Gemma 4 E2B `.task` from `litert-community`)
  produces coherent output on the same WAVE prompts at 1–2.5 s/task. This is
  why the conversion path is worth the cross-platform pain.
- `mediapipe` 0.10.35 stable converter supports Gemma 1/2/3 (270M/1B/4B/12B/27B)
  but NOT Gemma 4. `litert-torch-nightly` is the only public path with
  Gemma 4 support today; it requires Linux or macOS-arm64.

## File references

- Browser test page: [`client/app/models/mediapipe-test/`](../client/app/models/mediapipe-test/)
- Local-hf server (with `/mediapipe/<file>` mount): [`client/scripts/serve-local-hf.ts`](../client/scripts/serve-local-hf.ts)
- The merged checkpoint to convert: `models/runs/merge-peft/`
- The base Gemma 4 `.task` for comparison: `models/mediapipe/gemma-4-E2B-it-web.task` (1.86 GB)
- Background on why ONNX failed: [`docs/onnx-webgpu-divergence.md`](onnx-webgpu-divergence.md)
- Original training/merge pipeline: [`docs/onnx-windows-handoff.md`](onnx-windows-handoff.md)
- Issue #6: <https://github.com/emilyLi2020/Wave/issues/6>
