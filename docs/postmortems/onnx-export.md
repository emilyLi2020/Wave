# ONNX Export Postmortem: Gemma 4 E2B Fine-tune to Browser

> This is the technical narrative of trying to produce a text-only `q4f16` ONNX bundle from `Maelstrome/lora-wave-session-r32-merged` (our LoRA-merged Gemma 4 E2B) that could be served as `Maelstrome/lora-wave-session-r32-onnx` and consumed by the WAVE client's existing `@huggingface/transformers` runtime.
>
> Started: 2026-05-12. End state: a working ONNX export script at ~6.1 GB total — functional and architecturally correct — but ~2× larger than the upstream `onnx-community/gemma-4-E2B-it-ONNX` reference. The gap is structural, not a missed optimization.

---

## 1. Why hand-rolled in the first place

The natural path for HF → ONNX is `optimum-cli export onnx`. We hit a documented blocker on the very first try, captured in [`models/successful_runs/local_final/REPORT.md`](../../models/successful_runs/local_final/REPORT.md) lines 296–305:

> ONNX (NOT exported in this run): Optimum 2.1.0 doesn't support Gemma 4 (transforms pinned to 4.57.6, doesn't recognize `model_type=gemma4`).

Optimum's `TasksManager` has no `gemma4` entry. Calling `optimum-cli export onnx --model ... --task text-generation-with-past` errors out at architecture lookup before doing any work.

The realistic alternatives the report flagged:
1. Wait for Optimum to land Gemma 4 support — no visible work-in-progress
2. Use `transformers.js`'s `scripts/convert.py` — relies on Optimum internally, same blocker
3. Hand-roll `torch.onnx.export` against `Gemma4TextForCausalLM`, then quantize with `onnxruntime`

We chose option 3. Script: [`models/export_text_onnx.py`](../../models/export_text_onnx.py).

## 2. The iteration sequence

Each error here became a fix; together they trace the shape of the problem.

### 2.1 Config navigation — `'Gemma4Config' object has no attribute 'num_hidden_layers'`

`AutoModelForCausalLM.from_pretrained(merged_repo)` returns the full multimodal `Gemma4ForConditionalGeneration`. Its config is `Gemma4Config`, a wrapper with `text_config`, `vision_config`, `audio_config` sub-objects. The text-only attributes live under `config.text_config`, not directly on `config`.

**Fix**: `_extract_text_config` helper — try `text_model.config`, then `model.config.text_config`, then `model.config`, take the first with `num_hidden_layers`.

### 2.2 Text sub-tree extraction — `text_model=Gemma4TextModel` is the *base*, not the causal LM

`model.language_model` returns `Gemma4TextModel`, which has no `lm_head` and whose `forward()` returns `BaseModelOutputWithPast` (no `logits`). Our wrapper code assumed `outputs.logits` and broke.

**Fix**: Wrap *both* `text_model` and `model.lm_head` in our `MergedDecoderWrapper`. Compute `logits = self.lm_head(outputs.last_hidden_state)` manually inside `forward()`.

### 2.3 dynamic_axes vs dynamo — `treespec.unflatten(leaves): leaves has length 73 but spec holds 4 items`

`torch.onnx.export` in PyTorch 2.9+ defaults to `dynamo=True`. Dynamo's pytree flattening of our `*past_key_values: torch.Tensor` varargs sees 73 separate tensors (35 layers × 2 + 3 named args) but the spec only had 4 top-level items. `dynamic_axes` is also incompatible with dynamo.

**First attempted fix**: `dynamo=False` to force the legacy TorchScript tracer. That worked, but —

### 2.4 Legacy tracer hits `IndexError: tuple index out of range` deep in transformers' mask code

torch.jit tracing makes `tensor.shape[dim]` return a 0-d symbolic SymInt-like tensor when the dim is in `dynamic_axes`. Transformers 5.5's `masking_utils._preprocess_mask_arguments` assumes shape values are Python ints (`q_length.shape[0]`, `q_length[0].to(device)`). Crash.

**Second fix**: switch back to `dynamo=True` but restructure the wrapper to take `past_kv: tuple` as a single tree-flat input. Use `torch.export.Dim` for `dynamic_shapes` instead of the legacy `dynamic_axes` dict.

### 2.5 `DynamicCache.from_legacy_cache` removed in transformers 5.5

Standard cookbook is to wrap legacy `Tuple[Tuple[Tensor, Tensor], ...]` past_key_values into a `DynamicCache` before passing to the base model. The classmethod was removed at some version bump.

**Fix**: Construct `DynamicCache()` and populate via `cache.update(k, v, layer_idx)` per layer.

### 2.6 Cache iteration — `ValueError: too many values to unpack (expected 2)`

In dynamo's symbolic trace, iterating `out_kv` (the model's output cache) yields tuples with >2 elements for some `DynamicCache` versions. The legacy `for k, v in cache` pattern broke.

**Fix**: Defensive iteration in priority order: `cache.key_cache[i]` + `cache.value_cache[i]` direct indexing first, then `to_legacy_cache()`, then fall through.

### 2.7 Per-layer head_dim — `Expected 256 in dimension 3 but got 512 for tensor number 1`

Gemma 4 has **two** head dimensions:
- `head_dim: 256` for the 28 sliding-attention layers
- `global_head_dim: 512` for the 7 full-attention layers (every 5th)

Our example past_key_values used `head_dim=256` universally. The first full-attention layer's `cat([past_kv_256, new_kv_512], dim=2)` failed.

**Fix**: Build `per_layer_head_dim[]` from `text_config.layer_types` and `text_config.global_head_dim`. Construct example past tensors with the right dim per layer.

### 2.8 `ModuleNotFoundError: onnxruntime.quantization.matmul_4bits_quantizer`

The 4-bit MatMul quantizer was renamed `matmul_4bits_quantizer` → `matmul_nbits_quantizer` (with class `MatMulNBitsQuantizer` handling N-bit including 4) somewhere in onnxruntime 1.20+.

**Fix**: Defensive multi-path import; try the new module name first.

### 2.9 External-data naming — `missing required output file: decoder_model_merged_q4f16.onnx_data`

`onnxruntime.quantization.MatMulNBitsQuantizer.save_model_to_file` writes external data as `<model>.onnx.data` (dot before `data`). transformers.js's loader looks for `<model>.onnx_data` (underscore). Different conventions; same data; incompatible filenames.

**Fix**: Use `onnx.save_model(..., location=<basename>.onnx_data, ...)` directly to control the external-data filename. Validation in `validate_output` checks for the transformers.js-compatible names.

### 2.10 Track A (transformers.js convert.py subprocess) never worked

The script's Track A path clones `huggingface/transformers.js` and shells out to `scripts/convert.py`. That script doesn't exist at that path in current transformers.js layout. The catch block falls through to Track B (our hand-rolled torch.onnx.export). Track A is effectively dead code we keep around for when transformers.js eventually reorganizes its scripts back.

## 3. The pipeline that finally works

After all 10 iterations:

```
HF merged-16bit repo
        ↓ snapshot_download (cached)
local snapshot (10.2 GB safetensors, multimodal config)
        ↓ AutoModelForCausalLM.from_pretrained
in-memory Gemma4ForConditionalGeneration
        ↓ _extract_text_causal_lm + _extract_text_config
text_model (Gemma4TextModel) + lm_head + text_config
        ↓ MergedDecoderWrapper + torch.onnx.export(dynamo=True, dynamic_shapes=Dim)
decoder_model_merged.onnx (~18 GB fp32 with external data)
        ↓ _cast_fp32_to_fp16 (onnxconverter-common)
decoder_model_merged_fp16.onnx (~9 GB fp16)
        ↓ _quantize_q4f16 (MatMulNBitsQuantizer, block_size=32)
decoder_model_merged_q4f16.onnx + .onnx_data (~6.1 GB)

(parallel pipeline for embed_tokens, smaller graph, same passes)
```

End state on disk:
- `decoder_model_merged_q4f16.onnx_data`: 6.10 GB
- `embed_tokens_q4f16.onnx_data`: 0.75 GB
- Plus configs + tokenizer (~32 MB)
- **Total bundle: ~7 GB**

## 4. The size gap — why we're 2× upstream

Upstream `onnx-community/gemma-4-E2B-it-ONNX`:
- decoder data: 1.52 GB
- embed_tokens data: 1.59 GB (theirs is bigger! they kept fp32; ours is fp16)
- Total: ~3.1 GB

So we win on `embed_tokens` (768 MB vs 1.59 GB) and lose ~4× on the decoder.

The decoder gap is **Per-Layer Embeddings (PLE)**. From the model config:

```json
"hidden_size_per_layer_input": 256,
"vocab_size_per_layer_input": 262144,
"num_hidden_layers": 35
```

PLE storage requirement: `35 layers × 262144 vocab × 256 hidden = 2.35 B params`.

Breakdown of our 6.1 GB:

| Component | Params | Format | Size |
|---|---|---|---|
| Transformer body (attention + FFN matmuls) | ~2.6 B | q4 (4-bit + scale/zp metadata) | ~1.5 GB |
| **PLE tables** (per-layer Gather ops) | **~2.35 B** | **fp16** (NOT quantized — they're Gather, not MatMul) | **~4.7 GB** |
| LayerNorm, RoPE, biases | ~0.05 B | fp16 | ~100 MB |
| **Total** | | | **~6.3 GB** |

`MatMulNBitsQuantizer` only quantizes `MatMul` nodes. PLE tables are `Gather` ops; they stay at whatever dtype the fp16 cast leaves them in. Upstream's ~1.5 GB decoder almost certainly applies 4-bit quantization to those Gather initializers — saving ~3.5 GB of PLE storage that we leave on the floor.

This is what makes Gemma 4 E2B's "effective vs total" parameter split (2.3 B vs 5.1 B) misleading on disk. Half the file is PLE; touching it is essential for matching upstream size.

## 5. What we tried to close the gap

After Phase 1 (fp16 cast) cut us from 12.18 GB → 6.10 GB, we tested three graph optimizers between the fp16 cast and the quantization step:

| Tool | Result | Reason |
|---|---|---|
| `onnxsim.simplify` | Skipped (catch block) | Round-trips through a single in-memory protobuf message; hits the 2 GB single-message limit on models with external data |
| `onnxoptimizer.optimize` | Skipped (catch block) | Same protobuf limit |
| `onnxruntime.transformers.optimize_model` in `bert` mode | Ran cleanly via file-path API; **added ~200 MB** | Gemma 4's PLE + interleaved sliding/full attention doesn't match BERT fusion patterns. ORT added Cast/wrapper nodes for fp16 CPU compute without finding any real fusion opportunities |

Reverted the optimize step. Function kept defined for future experiments. Final pipeline is just fp16 cast → q4 quantize.

## 6. Ecosystem state (as of 2026-05-13)

We checked every public project that could plausibly fix this for us:

| Project | Gemma 4 support? | Evidence |
|---|---|---|
| `huggingface/optimum` | **No** | No Gemma 4 PRs. Latest Gemma work: Gemma 2 ONNX (PR #2290, closed Sep 2025). |
| `huggingface/optimum-onnx` | **No** | No Gemma 4 PRs. Latest: Gemma 3 / gemma3-text (PRs #70, #87 from Oct 2025). PR #121 "transformers 5.2 support" still open since Feb 2026 — Gemma 4 needs 5.5+. |
| `huggingface/transformers.js` | **No** | No Gemma 4 PRs. Latest: Gemma 3 VLM (#1601, Mar 2026); Gemma 3n (#1348, Jun 2025). |
| `microsoft/onnxruntime-genai` | **No** | Open feature request [issue #2062](https://github.com/microsoft/onnxruntime-genai/issues/2062) (Apr 3, 2026) detailing exactly the PLE / variable-head-dim / KV-cache-sharing blockers. No maintainer reply, no PRs. |
| `mlc-ai/mlc-llm` | **Draft** | [PR #3485](https://github.com/mlc-ai/mlc-llm/pull/3485) — text-only E2B, WebGPU-targeted, depends on companion `mlc-ai/relax` PR #346. ~1500 lines of Python. Unit tests pass; author claims clean-room WebGPU validation. 3 disputed review comments still open. |

The `onnx-community/gemma-4-E2B-it-ONNX` repo exists and works — so someone has a recipe — but it lives outside any public PR. Likely a one-off internal script not yet productized.

The genai issue #2062 is particularly informative: the author attempted to produce a 1.6 GB INT4 ONNX export but hit `ShapeInferenceError: Incompatible dimensions for matrix multiplication at /model/layers.4/attn/o_proj/MatMul_Q4`. They confirm upstream's layout is "incompatible" with onnxruntime-genai's expected I/O contract — meaning upstream produced a transformers.js-shaped artifact that doesn't conform to standard genai loaders.

## 7. What this means for the WAVE client

Three options for serving Gemma 4 in the browser today:

1. **Ship upstream `onnx-community/gemma-4-E2B-it-ONNX` base model** — 3.1 GB total, no fine-tune. This is what `GEMMA_MODEL_ID` in `client/lib/gemma/local-runtime.ts` was reverted to during the work.
2. **Ship our 7 GB fine-tuned ONNX** — has the LoRA's tuning baked in, 2× the cold-load size of upstream. Demo-viable on fast wifi, painful on cellular.
3. **Compile via MLC PR #3485 to WebGPU** — would give us fine-tune + ~2 GB + competitive iPhone tok/sec all three, but requires building TVM/relax from source. Path in progress as of this writing.

## 8. Recommended path forward (post-hackathon)

If we want the fine-tune in the browser at upstream-size cost:

**Option A — Custom Gather quantizer (~150 lines, ~3 hours)**
Walk the ONNX graph after the fp16 cast. For every `Gather` op whose input initializer is large (> 100 MB), pack the initializer to int4 with per-block scales (block_size=32 to match MatMul). Emit a custom `Gather` op variant that the runtime knows how to dequantize at lookup time. Stays in transformers.js-compatible layout.

Risk: requires either a custom op (not portable) or modifying the model's Python forward to do int4-aware embedding lookup (not portable either). The reason upstream might have abandoned this path: there's no standardized 4-bit Gather in ONNX.

**Option B — MLC PR #3485 (the path we're currently building)**
Run `mlc_llm convert_weight` on the merged repo, `mlc_llm compile --device webgpu`, register the resulting `.wasm` + weights with `@mlc-ai/web-llm` on the client. ~2 GB output, iPhone 17 Pro WebGPU-tuned, fine-tune intact.

Risk: draft PR with 3 disputed review comments on numerical correctness; web-llm side needs separate wiring.

**Option C — Wait for HF ecosystem**
File a feature request linking the genai #2062 issue and the existence of `onnx-community/gemma-4-E2B-it-ONNX`. Won't help any specific demo timeline.

## 9. What we learned that's worth remembering

- **Per-Layer Embeddings change the storage math**. For any model with PLE, MatMul-only quantization leaves the biggest weight blob untouched. Always check the model's effective-vs-total parameter ratio before assuming MatMul quantization is sufficient.
- **`onnxsim` and `onnxoptimizer` have a 2 GB ceiling** for models with external data. Their in-memory round-trip through a single protobuf message can't handle LLM-scale graphs. Use `onnxruntime.transformers.optimize_model`'s file-path API instead — but its fusions are model-architecture-specific.
- **Transformers internal mask APIs change shape between minor versions**. `q_length` going from int to scalar tensor between transformers 5.4 and 5.5 was invisible until torch.jit tracing collided with it. If hand-rolling exports, pin transformers tightly.
- **dynamo's pytree handling treats varargs differently than the legacy tracer.** Restructuring `*past_key_values` into `past_kv: tuple` for dynamo is a one-line semantic change with a 100× difference in error message clarity.
- **The biggest source of inertia in ONNX-ecosystem support for new HF models is `transformers` version compatibility**, not the runtime. Optimum's "transformers 5.2 support" PR has been open three months; until it lands, Gemma 4 support won't land in optimum-onnx.

## File references

- Export script: [`models/export_text_onnx.py`](../../models/export_text_onnx.py)
- Pyproject deps: [`models/pyproject.toml`](../../models/pyproject.toml)
- Overnight automation log: [`models/runs/AUTOMATION_LOG.md`](../../models/runs/AUTOMATION_LOG.md) (gitignored, local only)
- Bench script: [`models/runs/bench/bench.ts`](../../models/runs/bench/bench.ts) (gitignored, local only)
- Original LoRA REPORT.md noting the Optimum blocker: [`models/successful_runs/local_final/REPORT.md`](../../models/successful_runs/local_final/REPORT.md)
