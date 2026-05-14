# Gemma 4 E2B fine-tune → q4f16 ONNX: Windows handoff

Pick this up on the 96 GB Windows machine. The Mac kept hitting macOS's hard memory ceiling during the fp16 cast + gather quant passes; on Windows with more RAM (and ideally a CUDA GPU for `torch.onnx.export`) the whole pipeline should run in ~10 min instead of ~45 min.

## What's already known, do not re-litigate

1. **The unsloth-merged checkpoint on HF is broken.** `Maelstrome/lora-wave-session-r32-merged` produces 100% `<pad>` tokens in plain PyTorch on both fp16 and bf16. Don't use it. We have a working merge below.
2. **The LoRA adapter and the GGUF version are fine.** `Maelstrome/lora-wave-session-r32` (adapter) and `Maelstrome/lora-wave-session-r32-gguf` (90 downloads, working in llama.cpp) prove training succeeded.
3. **Every prior ONNX/MLC failure traces back to (1).** Once you re-merge with PEFT, the pipeline produces a coherent fine-tune (verified locally — see ["What we verified on Mac"](#what-we-verified-on-mac)).
4. **`onnxconverter_common.convert_float_to_float16` cannot handle the 17 GB intermediate** — it inlines every initializer into the protobuf in memory. We wrote a streaming caster ([models/cast_fp16_streaming.py](../models/cast_fp16_streaming.py)) that walks tensors one at a time. The export script ([models/export_text_onnx.py](../models/export_text_onnx.py)) is already wired to use it.
5. **The gather quantizer ([models/quantize_gather.py](../models/quantize_gather.py)) breaks weight-tying** between `embed_tokens` and `lm_head`. We patched it to skip Gather ops whose initializer is also consumed by non-Gather nodes. Don't undo that patch.
6. **transformers.js needs `num_kv_shared_layers: 0` in the exported config**, because our hand-rolled decoder graph emits 35 KV-cache layer pairs (not 15 with sharing like upstream). Patch this after copying the config.

## What we verified on Mac

| Source | Plain-PyTorch test | Verdict |
|---|---|---|
| `Maelstrome/lora-wave-session-r32-merged` (HF, unsloth merge) | 100% `<pad>` | BROKEN |
| `unsloth/gemma-4-E2B-it` (base, no LoRA) | "The capital of France is Paris." | ✅ Base is fine |
| `models/runs/merge-peft/` (PEFT re-merge on Mac) | "Take three slow, deep breaths..." | ✅ Working fine-tune |

The PEFT re-merge is on the Mac at `models/runs/merge-peft/` but **isn't in git** (too big — 9.5 GB). You have two ways to get it on Windows:

**Option A: Re-merge on Windows from scratch (fast on CUDA).** Run [models/merge_lora_peft.py](../models/merge_lora_peft.py) — it pulls the base + adapter from HF, merges, saves. Should take ~30 sec on GPU vs 17 sec on Mac CPU. Recommended.

**Option B: Push the Mac merge to HF first, then pull on Windows.** ~10 min to push. Only do this if Option A behaves differently somehow.

## Pipeline (run from repo root)

```
# 1. Re-merge the LoRA adapter onto the base via PEFT.
uv run --project models python models/merge_lora_peft.py \
  --base unsloth/gemma-4-E2B-it \
  --adapter Maelstrome/lora-wave-session-r32 \
  --out-dir models/runs/merge-peft \
  --device cuda \
  --dtype bfloat16

# 2. Sanity-check it generates coherent text (CRITICAL — gates everything else).
uv run --project models python models/diagnose_merged_base.py \
  --source-repo models/runs/merge-peft \
  --prompts "What is the capital of France? Answer in one sentence." \
            "I'm feeling anxious right now. What's one small thing I can do?" \
  --max-new-tokens 48 --device cuda --dtype bfloat16

# Expected: 2/2 prompts produce coherent text. If 0/2, STOP — the merge is broken,
# don't continue to ONNX export. Re-check adapter compatibility.

# 3. Export to q4f16 ONNX. Goes through fp32 -> fp16 (streaming) -> q4 MatMul.
#    On CUDA, torch.onnx.export may pick GPU automatically — much faster than CPU.
uv run --project models python models/export_text_onnx.py \
  --source-repo models/runs/merge-peft \
  --out-dir models/runs/onnx-export-v2 \
  --track b

# 4. Run the Gather quantizer post-pass — int4 compresses the PLE table.
#    Already patched to skip lm_head.weight (tied with embed_tokens).
uv run --project models python models/quantize_gather.py \
  models/runs/onnx-export-v2/onnx

# 5. Patch config for transformers.js (it needs no-KV-sharing to match our graph).
#    Find num_kv_shared_layers under text_config and set to 0:
#    "num_kv_shared_layers": 0,
# In python:
uv run --project models python -c "
import json
from pathlib import Path
p = Path('models/runs/onnx-export-v2/config.json')
c = json.loads(p.read_text())
c['text_config']['num_kv_shared_layers'] = 0
p.write_text(json.dumps(c, indent=2))
print('patched num_kv_shared_layers -> 0')
"
```

## Expected final state

```
models/runs/onnx-export-v2/
├── chat_template.jinja
├── config.json                           # num_kv_shared_layers: 0
├── export-manifest.json
├── generation_config.json
├── processor_config.json
├── tokenizer.json
├── tokenizer_config.json
└── onnx/
    ├── decoder_model_merged_q4f16.onnx        # ~6 MB proto
    ├── decoder_model_merged_q4f16.onnx_data   # ~2.9 GB
    ├── embed_tokens_q4f16.onnx                # <1 KB proto
    └── embed_tokens_q4f16.onnx_data           # ~216 MB
```

**Total: ~3.2 GB**, matching upstream `onnx-community/gemma-4-E2B-it-ONNX` (~3.1 GB).

## How to test the ONNX

Two ways, both already wired up in the repo:

### Node.js bench (fastest, runs in `onnxruntime-node` — real ORT, no browser quirks)

```
cd client
pnpm tsx scripts/bench-onnx.ts
```

This runs the 4 stock prompts (anxiety / breathing / Paris / haiku) against BOTH `onnx-community/gemma-4-E2B-it-ONNX` (downloaded from HF) and `models/runs/onnx-export-v2` (local). Outputs are tok/s + the generated text for visual quality check. Upstream baseline on Mac CPU was ~15 tok/s with coherent output.

If `onnx-export-v2` produces non-pad coherent text → you're done with the conversion, proceed to the push step.

### Browser compare page (slower, but tests the actual runtime path)

```
cd client
pnpm dev
# open http://localhost:3000/training/onnx-test/compare
```

The page loads upstream + our fine-tune side-by-side via transformers.js + onnxruntime-web. The symlink at [client/public/onnx-finetune-export](../client/public/onnx-finetune-export) is already pointing at `models/runs/onnx-export-v2` (set on Mac, persists in git as it's just a symlink — but on Windows you'll need to recreate it; symlinks don't always survive cross-platform git checkouts).

To recreate on Windows (PowerShell, admin):
```
New-Item -ItemType SymbolicLink -Path client\public\onnx-finetune-export -Target ..\..\models\runs\onnx-export-v2
```

Or just copy the dir:
```
cp -r models/runs/onnx-export-v2 client/public/onnx-finetune-export
```

**Known browser-side issue**: transformers.js v4 + WebGPU + locally-served external-data files has a `MountedFiles` bug. If you hit it, switch the device to CPU/WASM in [client/app/training/onnx-test/compare-client.tsx](../client/app/training/onnx-test/compare-client.tsx) just for verification.

## Push to HF (final step, only after verifying coherence)

User's earlier decision (recorded in memory): **overwrite** `Maelstrome/lora-wave-session-r32-merged` with the working PEFT merge, and create a new repo for the ONNX.

```
# Re-publish the working merge to the same HF repo name.
huggingface-cli upload Maelstrome/lora-wave-session-r32-merged models/runs/merge-peft .

# Create + push the ONNX artifact to a new repo.
huggingface-cli upload Maelstrome/lora-wave-session-r32-onnx models/runs/onnx-export-v2 .
```

Then flip the client constant — single line, [client/lib/gemma/local-runtime.ts:27](../client/lib/gemma/local-runtime.ts#L27):

```diff
- export const GEMMA_MODEL_ID = "onnx-community/gemma-4-E2B-it-ONNX";
+ export const GEMMA_MODEL_ID = "Maelstrome/lora-wave-session-r32-onnx";
```

`GEMMA_DTYPE = "q4f16"` on line 29 already matches.

## File map — what's new in this session

| Path | Purpose |
|---|---|
| [models/diagnose_merged_base.py](../models/diagnose_merged_base.py) | Smoke-test any merged checkpoint in plain PyTorch. Step 2 above. |
| [models/merge_lora_peft.py](../models/merge_lora_peft.py) | Mac/Windows-friendly PEFT-based LoRA merge (no unsloth). Step 1 above. |
| [models/cast_fp16_streaming.py](../models/cast_fp16_streaming.py) | Memory-safe fp32 → fp16 ONNX cast. Called as subprocess from `export_text_onnx.py`. |
| [models/export_text_onnx.py](../models/export_text_onnx.py) | Modified: accepts local source dir; embed_tokens exported before PyTorch freed; cast delegates to streaming caster. Step 3 above. |
| [models/quantize_gather.py](../models/quantize_gather.py) | Modified: skips Gather ops on tied weights (preserves lm_head); fixes `.tmp` suffix in external_data refs after atomic swap. Step 4 above. |
| [models/finish_export.py](../models/finish_export.py) | (Mostly redundant now — `export_text_onnx.py` handles end-to-end. Keep for partial-resume scenarios.) |

## If something goes wrong on Windows

- **`torch.onnx.export` OOM on GPU**: drop to `--device cpu` in step 3 (slower but ~50 GB max).
- **fp16 cast still OOM**: the streaming caster shouldn't, but if it does, check that `export_text_onnx.py`'s `_cast_fp32_to_fp16` is the subprocess version (not the old in-memory version).
- **`unsloth` install fails on Windows**: it's only marked for non-darwin, but you don't need it for this pipeline — PEFT does the merge. Comment out `unsloth` deps in [models/pyproject.toml](../models/pyproject.toml) if `uv sync` chokes.
- **`onnxruntime` GatherBlockQuantized kernel not found**: that's a browser-side issue (onnxruntime-web), not Node. The Node bench uses CPU kernels which support it.
- **Bench shows pad-only output**: re-run [step 2 (diagnose)](#pipeline-run-from-repo-root) on `models/runs/merge-peft/`. If THAT shows pad output, the re-merge itself is broken — different problem than the original. If diagnose passes but bench fails, the conversion broke the model — check that `num_kv_shared_layers: 0` patch is applied to `models/runs/onnx-export-v2/config.json`.

## Cross-reference: the original plan

The full planning doc is at [`/Users/bill.zhang/.claude/plans/we-are-downloading-the-adaptive-nygaard.md`](file:///Users/bill.zhang/.claude/plans/we-are-downloading-the-adaptive-nygaard.md) (not in repo). Rung 1 (the PyTorch sanity check) is what surfaced the broken-merge root cause. Rungs 2-4 (try HF Space, run transformers.js convert.py, ask upstream) became unnecessary once we re-merged via PEFT and the existing hand-rolled exporter worked correctly. Rung 5 (graph-signature fix to match upstream's `inputs_embeds` + KV-sharing) is still NOT done — our ONNX has 35 KV pairs and uses `input_ids` directly. transformers.js accepts this with `num_kv_shared_layers: 0`, but if you want to match upstream's graph 1:1 (smaller decoder, faster prefill), that's the open work item.
