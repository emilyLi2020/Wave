# ONNX fine-tune: Node CPU works, browser WebGPU emits zero tokens

**Date filed**: 2026-05-14
**Updated**: 2026-05-14 — corrected diagnosis (decomposed ops, not int4 packing) and shipped fix path (v4-fused).
**Status**: fix candidate produced (v4-fused), pending browser verification + HF upload
**Models**:
- v3 (broken on WebGPU): [Maelstrome/lora-wave-session-r32-onnx](https://huggingface.co/Maelstrome/lora-wave-session-r32-onnx)
- v4-fused (candidate fix): `Maelstrome/lora-wave-session-r32-onnx-fused` (needs `hf upload` from local)
- upstream (works on WebGPU): [onnx-community/gemma-4-E2B-it-ONNX](https://huggingface.co/onnx-community/gemma-4-E2B-it-ONNX)
- **Runtime**: `@huggingface/transformers@4.2.0` + the [num_logits_to_keep patch](./transformers-js-gemma4-perf.md)

## TL;DR

The v3 fine-tuned ONNX export is **correct end-to-end** when driven through `onnxruntime-node` (Node CPU). It produces coherent, schema-compliant output for all three production WAVE prompts.

The **identical model, runtime, prompts, and chat template** in the browser on `onnxruntime-web` + WebGPU emits **zero tokens** — the model stops on its first decode step because the first-token argmax lands on one of the stop tokens (`[1, 106, 50]`).

The root cause is **not** the int4 packing (our embed_tokens GBQ initializers are byte-for-byte identical to upstream's). The root cause is that **our decoder uses decomposed primitive ops** where upstream uses **fused contrib ops** (`SimplifiedLayerNormalization`, `Gelu`, `RotaryEmbedding`, `GroupQueryAttention`). On WebGPU the decomposed `gelu_pytorch_tanh` (`Tanh + Pow(x, 3) + Mul + Add`) likely NaN-cascades on long prompts.

**v4-fused fix**: re-run `onnxruntime.transformers.optimize_model(model_type="gpt2")` on our v3 decoder. It eliminates all 70 `Tanh` ops and folds them into 70 `FastGelu` contrib ops. CPU bench is **2× faster** and still produces coherent output for all three WAVE prompts. Pending browser verification once uploaded to HF.

## Diagnostic timeline

1. Bench-style simple prompts work in both CPU and WebGPU. False confidence: only ever bench'd `"Capital of France?"`-style prompts, never the production WAVE prompts.
2. Production WAVE prompts on WebGPU: zero tokens.
3. Pushed missing [`generation_config.json`](https://huggingface.co/Maelstrome/lora-wave-session-r32-onnx/blob/main/generation_config.json) (`eos_token_id: [1, 106, 50]`). Symptom shifted from "long incoherent output stripped to empty by `<|channel>` markers" to "stops at len=0".
4. **Same exact prompts in Node CPU**: fully coherent. Isolates the bug to the browser/WebGPU runtime.
5. **A/B'd upstream on the same WebGPU + same WAVE prompts**: upstream works. So the bug is in our specific model file, not the runtime.
6. **Byte-diffed our embed_tokens vs upstream's**: byte-for-byte identical. PEFT/LoRA never touched embed tables. **Int4 packing is NOT the divergence.**
7. **Structurally diffed our decoder vs upstream's**: massively different.
8. **Ran ORT fusion**: at `opt_level=0` with `model_type="gpt2"`, all 70 `Tanh` ops disappeared and were replaced by 70 `FastGelu` contrib ops. CPU bench is still coherent and 2× faster.

## The actual divergence: decomposed primitives vs fused contrib ops

| Op | Ours v3 (decomposed) | Upstream (fused) | Ours v4 (after gpt2-fusion) |
|---|---|---|---|
| Total nodes | 3497 | 1289 | 3007 |
| `MatMulNBits` | 277 | 242 | 277 |
| `SimplifiedLayerNormalization` | 0 | 242 | 0 |
| `Gelu` / `FastGelu` | 0 | 70 | **70 (FastGelu)** |
| `RotaryEmbedding` | 0 | 50 | 0 |
| `GroupQueryAttention` | 0 | 12 | 0 |
| `Pow` | 554 | 0 | 484 |
| `ReduceMean` | 242 | 0 | 242 |
| `Tanh` | 70 | 0 | **0** |

Why this matters on WebGPU:
- Upstream's contrib ops have hand-tuned WebGPU kernels in `onnxruntime-web`.
- Our decomposed `gelu_pytorch_tanh` does `0.5x * (1 + tanh(sqrt(2/π) * (x + 0.044715 * x³)))`. The `Pow(x, 3)` on WebGPU is commonly implemented as `exp(3 * ln(x))` which produces NaN for `x ≤ 0`. Activations in long-context attention output can be negative → NaN cascade → first-token logits all NaN → argmax falls on token 0 or the first stop ID.
- This perfectly explains why short prompts work (small activations stay positive / in safe range) and long prompts fail.

v4-fused replaces the decomposed `gelu_pytorch_tanh` math with a single `FastGelu` ORT contrib op that has a real WebGPU kernel. The remaining 484 `Pow` (mostly `Pow(x, 2)` inside RMSNorm decompositions) should be safe — `Pow(x, 2)` is typically special-cased to `x*x` in WebGPU shaders and is well-defined for all real x.

## Repro / verify

```bash
# CPU baseline (works on v3 AND v4)
cd client
pnpm exec tsx scripts/bench-onnx-wave-prompts.ts                          # v3 (default)
MODEL_ID=onnx-export-v4-fused pnpm exec tsx scripts/bench-onnx-wave-prompts.ts  # v4

# v4 results: phase 26.4s · check-in 24.7s · reflection 9.4s
# v3 results: phase 53.8s · check-in 46.2s · reflection 21.2s
# (both coherent; v4 is ~2× faster on CPU due to fused FastGelu)
```

Browser verification (pending HF upload):
1. Run from repo root: `hf upload Maelstrome/lora-wave-session-r32-onnx-fused models/runs/onnx-export-v4-fused . --create-repo`
2. Open `/models/onnx-test/compare`, hard-reload to drop transformers.js IndexedDB cache.
3. Click "Load" on the fine-tune column (it now points at the `-fused` repo).
4. Click "Run all 3 tasks on this model".
5. Expected: coherent output across all three tasks. If `len=0` still, see "If v4-fused also fails".

## How v4-fused was produced

[`models/try_fuse_decoder.py`](../models/try_fuse_decoder.py) → [`models/restage_decoder.py`](../models/restage_decoder.py):

```python
from onnxruntime.transformers.optimizer import optimize_model
m = optimize_model(
    "models/runs/onnx-export-v3/onnx/decoder_model_merged_q4f16.onnx",
    model_type="gpt2",
    num_heads=8,
    hidden_size=1536,
    opt_level=0,         # disable ORT graph opts; we just want fusion patterns
)
# then save with transformers.js-compatible external data location (.onnx_data, not .onnx.data)
```

The `model_type="gpt2"` selects `Gpt2OnnxModel` which includes the `FastGelu` fusion pattern. `opt_level=0` skips ORT's own graph optimizations (which previously added wrapper Cast nodes without producing fusions). The fusion's shape-inference assertion failure is suppressed but doesn't prevent the `FastGelu` pattern from applying since it doesn't need full shape info.

Embed_tokens.onnx is **unchanged** between v3 and v4 — only the decoder was re-fused.

## If v4-fused also fails on WebGPU

If the FastGelu fusion isn't enough and v4-fused still produces `len=0` on WebGPU, the remaining suspect is **RMSNorm decomposition** (242 `ReduceMean` + 554 `Pow(x, 2)` ops). Path forward:

1. Manually rewrite `Pow(x, 2)` → `Mul(x, x)` in the ONNX graph (avoids the `exp/ln` WebGPU path entirely). Quick to script.
2. Or attempt RMSNorm → `SimplifiedLayerNormalization` fusion manually (no ORT model_type produces it for our graph; would need to write a custom pattern matcher).
3. If neither works, the failure is genuinely a `onnxruntime-web` WebGPU kernel bug for our specific decomposed shape; file upstream.

## File references

- Test script (Node CPU): [`client/scripts/bench-onnx-wave-prompts.ts`](../client/scripts/bench-onnx-wave-prompts.ts)
- Decoder diff inspector: [`models/inspect_decoder.py`](../models/inspect_decoder.py)
- GBQ packing diff: [`models/inspect_gbq.py`](../models/inspect_gbq.py)
- Fusion attempt script: [`models/try_fuse_decoder.py`](../models/try_fuse_decoder.py)
- v4 staging script: [`models/restage_decoder.py`](../models/restage_decoder.py)
- Browser surface: [`client/app/models/onnx-test/compare-client.tsx`](../client/app/models/onnx-test/compare-client.tsx)
- v3 export pipeline (decomposed): [`models/export_text_onnx.py`](../models/export_text_onnx.py)
- Logs: [`logs/bench-onnx-v4-fused.log`](../logs/bench-onnx-v4-fused.log), [`logs/gbq-diff.log`](../logs/gbq-diff.log), [`logs/decoder-diff.log`](../logs/decoder-diff.log), [`logs/fuse-attempt.log`](../logs/fuse-attempt.log)
- Related docs: [`docs/postmortems/onnx-export.md`](postmortems/onnx-export.md), [`docs/transformers-js-gemma4-perf.md`](transformers-js-gemma4-perf.md)
