# Fine-tuned Gemma 4 ONNX in the browser: 7 export iterations, conclusion is "ship via a different runtime"

> Sibling to [`onnx-export.md`](./onnx-export.md) (the original Mac export postmortem, ending state: 7 GB artifact, transformers.js can't drive it) and [`mlc-finetune.md`](./mlc-finetune.md) (the MLC fork: works for first prompt, KV cache leaks between calls). This doc covers the Windows handoff that produced a 2.7 GB `inputs_embeds`-signature artifact + the subsequent multi-week effort to make it work under `@huggingface/transformers@4.2.0` + WebGPU.
>
> Resulting state on 2026-05-14: the fine-tune ONNX produces **coherent output under `onnxruntime-node` (CPU)** for every WAVE prompt at ~20 tok/s. It produces **zero tokens under `onnxruntime-web` (browser WebGPU)** for any WAVE-length prompt across every variant we built (v3, v4-fused, v5-pow2mul, v6-rmsnorm, v7-castfp32). The bug is **inside onnxruntime-web's WebGPU EP, not our export**, and our hand-rolled `torch.onnx.export` can't structurally match what upstream emits to avoid it. Recommended next path: GGUF + `llama.cpp` WASM (Unsloth's blessed browser route).

## TL;DR

| Path | Status |
|---|---|
| Train Gemma 4 LoRA (Unsloth) | ✅ adapter at `Maelstrome/lora-wave-session-r32` |
| Merge LoRA via PEFT (not Unsloth's `save_pretrained_merged`) | ✅ produces coherent fp16 base |
| Export to ONNX with transformers.js-compatible signature | ✅ artifact at `Maelstrome/lora-wave-session-r32-onnx` (2.7 GB, q4f16) |
| Drive via `transformers.js` v4 in Node (onnxruntime-node CPU) | ✅ ~20 tok/s, coherent on every WAVE prompt |
| Drive via `transformers.js` v4 in browser WebGPU (`onnxruntime-web`) | ❌ `len=0` on every WAVE-length prompt; fp16 overflow in Dawn's WebGPU EP |

Upstream `onnx-community/gemma-4-E2B-it-ONNX` works fine in the same browser pipeline because their decoder uses **fused contrib ops** (`SimplifiedLayerNormalization` with `stash_type=1`, `GroupQueryAttention`, `RotaryEmbedding`, `Gelu`) that handle fp16 overflow safely. Our hand-rolled `torch.onnx.export` emits the decomposed primitive equivalents (`Mul(x,x) + ReduceMean + Add(eps) + Pow(-0.5)` for RMSNorm, `Tanh + Pow(x,3)` for gelu, manual `Q@K^T + masked Softmax + V@_` for attention). On Node CPU these are correct. On WebGPU they overflow fp16 at long contexts and cascade to NaN, killing the first-token argmax onto a stop token.

We tried to patch the export six times. Each iteration killed a specific overflow site and CPU stayed coherent. **Every iteration still emitted `len=0` on browser WebGPU**, meaning the overflow we hadn't patched yet was always sufficient on its own to kill long-context generation. We stopped at v7.

## What works, what doesn't (the decisive bench)

`bench-onnx-wave-prompts.ts` (Node CPU, onnxruntime-node, q4f16):

| Variant | Phase narration | Check-in turn 1 | Reflection |
|---|---|---|---|
| v3 (decomposed, original) | 53.8s · 719 chars JSON | 46.2s · 85 chars chat | 21.2s · 471 chars JSON |
| v4 (gpt2-fused FastGelu) | 26.4s · 622 chars JSON | 24.7s · 85 chars chat | 9.4s · 439 chars JSON |
| v5 (Pow(x,2) → Mul(x,x)) | 23.4s · 622 chars JSON | 23.6s · 85 chars chat | 8.2s · 439 chars JSON |
| v6 (227 SimplifiedLayerNormalization) | 24.6s · 600 chars JSON | 26.2s · 85 chars chat | 8.8s · 463 chars JSON |
| v7 (Cast(fp32) wrapping remaining 15) | 24.8s · 600 chars JSON | 28.6s · 85 chars chat | 9.0s · 463 chars JSON |

Browser WebGPU compare page (`/models/onnx-test/compare`, `?local=1` for staged variants):

| Variant | Phase | Check-in | Reflection |
|---|---|---|---|
| All of v3 / v4 / v5 / v6 / v7 | `len=0` | `len=0` | `len=0` |

The upstream `onnx-community/gemma-4-E2B-it-ONNX` base model on the same browser page produces a coherent 497-char JSON for the same phase prompt. Confirmed by the user during this work.

## The full iteration sequence

### v3 — the original Windows-handoff export
- `torch.onnx.export(dynamo=True)` on a `MergedDecoderWrapper(text_model + lm_head)` that takes `inputs_embeds + per_layer_inputs + 15 KV pairs` (matching upstream's I/O signature; `num_kv_shared_layers=20`).
- fp16 cast via `cast_fp16_streaming.py` (streams initializers one at a time vs. `onnxconverter_common` which OOMs by inlining everything into a single protobuf).
- q4f16 quant via `MatMulNBitsQuantizer` (block_size=32). Decoder shrinks from 17 GB → 1.2 GB.
- PLE Gather tables packed to `com.microsoft.GatherBlockQuantized` via [`quantize_gather.py`](../../models/quantize_gather.py) — asymmetric uint4 + zp (symmetric int4 produces fluent gibberish; ORT's contrib op uses `(q - zp) * scale`).
- Total: 2.7 GB at `Maelstrome/lora-wave-session-r32-onnx`.
- Browser WebGPU: `len=0` for every WAVE prompt.

### v4 — gpt2-fused FastGelu
- `onnxruntime.transformers.optimizer.optimize_model(model_type="gpt2", opt_level=0)`.
- Fuses 70 `Tanh + Pow(x, 3) + Mul + Add` chains (decomposed `gelu_pytorch_tanh`) into 70 `FastGelu` contrib ops.
- The 70 `Tanh` instances were the most exotic op and the first suspect for WebGPU NaN.
- CPU: 2× faster (the contrib op has a single tuned kernel).
- Browser WebGPU: still `len=0`.

### v5 — `Pow(x, 2)` → `Mul(x, x)`
- WebGPU implements `Pow(y, x)` as `exp(x * ln(y))`. For y ≤ 0 (likely for raw activations going into RMSNorm's variance), `ln(y)` is NaN.
- `rewrite_pow_to_mul.py` walks every `Pow` whose exponent initializer is the constant `2.0` and replaces with `Mul(x, x)`. 242 rewrites.
- Left the 242 `Pow(x, -0.5)` instances alone (their input is `mean(x²) + eps`, guaranteed ≥ 0).
- CPU: identical output, slightly faster.
- Browser WebGPU: still `len=0`.

### v6 — fuse 227/242 RMSNorms into `SimplifiedLayerNormalization`
- The standard `SimplifiedLayerNormalization` op (opset 18, domain `""`) has `stash_type=1` meaning **fp32 internal accumulation** regardless of fp16 IO. This is what upstream uses and what avoids fp16 overflow when summing 1536 squared activations.
- [`fuse_rmsnorm.py`](../../models/fuse_rmsnorm.py) pattern-matches the 6-node decomposed chain (`Mul(x,x) → ReduceMean → Add(eps) → Pow(-0.5) → Mul(x, _) → Mul(_, weight)`) and replaces with one `SimplifiedLayerNormalization(x, weight, axis=-1, epsilon=eps, stash_type=1)`.
- 227 of 242 chains matched.
- Total nodes: 3007 → 1872 (was 3497 in v3).
- CPU: same output, marginally faster.
- Browser WebGPU: still `len=0`.

### v7 — Cast(fp32) wrapping the remaining 15 RMSNorms
- 15 chains didn't match v6's pattern because they're **post-projection V/K norms with no learned weight** (the chain ends with `Mul(x, rsqrt)` directly, no final `Mul(_, weight)`). Replacing with `SimplifiedLayerNormalization` would need a synthesized 1D ones weight whose shape varies per layer (head_dim 256 for sliding, 512 for full). Brittle.
- [`cast_rmsnorm_fp32.py`](../../models/cast_rmsnorm_fp32.py) inserts `Cast(fp32)` around the variance computation:
  - `Mul(x, x)` consumes a fresh fp32 cast of `x`
  - `Add(eps)` uses a fresh fp32 eps initializer
  - `Pow(_, -0.5)` uses a fresh fp32 exponent
  - A new `Cast(fp32→fp16)` feeds the existing downstream `Mul(x, rsqrt)`
  - Affected intermediate `value_info` entries dropped so the runtime re-infers fp32
- After v7, **all 242 variance chains accumulate `mean(x²)` in fp32 internally**.
- CPU: identical output (the value of `stash_type=1` is exactly the equivalent of these Casts; the math is provably the same).
- Browser WebGPU: still `len=0`.

## Why v7 still fails (the actual remaining surface)

Even with every RMSNorm running fp32-internal, the decoder still has fp16-decomposed:
- **35 manual attention paths**: `Q @ K^T` matmul → scale → mask-add (`+ (-inf for masked)`) → `Softmax` → `@ V`. Upstream collapses this into 12 `GroupQueryAttention` contrib ops + 23 raw layers. The fused op handles fp16 stability internally.
- **35 manual RoPE applications**: `Cos/Sin` constants + interleave + `Mul/Add`. Upstream uses `RotaryEmbedding` contrib op.
- **Attention mask construction**: explicit `-inf` (or `-1e9`) values cast through fp16 saturate to `-65504`. Combined with softmax-with-subtract-max, can lose entire rows of attention if every position is masked.

We didn't iterate to v8/v9/v10 patching these because:
1. Each iteration takes ~hours (re-quantize, re-stage, re-bench, re-browser-test) and was only ever incrementally productive.
2. The graph divergence from upstream is now ~600 nodes (v7: 1872 vs upstream: 1289) and shrinking incrementally. We can't fuse `GroupQueryAttention` or `RotaryEmbedding` ourselves — those require an export-side rewrite of `MergedDecoderWrapper` to construct the model out of `torch.nn` modules that ONNX export collapses into the contrib ops.
3. The right shape of fix is "use the export tool that emits these contrib ops in one pass" — but no such tool supports Gemma 4 fine-tunes today (see §"What we tried that doesn't work").
4. Unsloth's own answer to "do you have a recommended ONNX export for Gemma 4?" was **no, ship via GGUF**. Their PyTorch-side fix for the same fp16 overflow class is "RMSNorms upcast to fp32" — exactly what we did. They don't publish anything we're missing.

## What we built that's worth keeping

| File | Purpose |
|---|---|
| [`models/merge_lora_peft.py`](../../models/merge_lora_peft.py) | PEFT-based LoRA merge that produces coherent fp16 base (Unsloth's `save_pretrained_merged` is broken for our fine-tune; produces all-pad output). |
| [`models/diagnose_merged_base.py`](../../models/diagnose_merged_base.py) | 2-prompt smoke test on a merged checkpoint before downstream conversion. Catches the all-pad case early. |
| [`models/cast_fp16_streaming.py`](../../models/cast_fp16_streaming.py) | Memory-safe fp32 → fp16 cast for 17 GB ONNX models. `onnxconverter_common` OOMs at this size. |
| [`models/quantize_gather.py`](../../models/quantize_gather.py) | Asymmetric uint4 + zp packing for PLE Gather tables. Byte-identical to upstream's packing. |
| [`models/inspect_gbq.py`](../../models/inspect_gbq.py) | Byte-diff two `GatherBlockQuantized` initializers. Proved our embed_tokens matches upstream. |
| [`models/inspect_decoder.py`](../../models/inspect_decoder.py) | Op-count + IO-signature diff between two decoder ONNX files. Made the decomposed-vs-fused divergence visible. |
| [`models/try_fuse_decoder.py`](../../models/try_fuse_decoder.py) | Tries `optimize_model` with multiple `model_type` settings. `gpt2 + opt_level=0` is the only combo that produces useful fusion. |
| [`models/rewrite_pow_to_mul.py`](../../models/rewrite_pow_to_mul.py) | Walks every `Pow` node with constant exponent `2.0` and rewrites to `Mul(x, x)`. |
| [`models/fuse_rmsnorm.py`](../../models/fuse_rmsnorm.py) | Pattern-matches the 6-node RMSNorm decomposition and fuses to `SimplifiedLayerNormalization(stash_type=1)`. |
| [`models/cast_rmsnorm_fp32.py`](../../models/cast_rmsnorm_fp32.py) | Inserts `Cast(fp32)` around variance computation for the unweighted RMSNorm variants the fuser can't match. |
| [`models/restage_decoder.py`](../../models/restage_decoder.py) | Renames ORT's `.onnx.data` external-data sidecar to transformers.js's `.onnx_data` convention. |
| [`client/scripts/bench-onnx-wave-prompts.ts`](../../client/scripts/bench-onnx-wave-prompts.ts) | Runs the three production WAVE prompts through `transformers.js` in Node CPU. **This is what proved CPU-vs-WebGPU divergence cleanly.** Earlier bench scripts only used simple chat prompts and missed the bug. |
| [`client/scripts/serve-local-hf.ts`](../../client/scripts/serve-local-hf.ts) | Static-file server that mirrors HF Hub's URL pattern (`{repo}/resolve/main/...`). Lets the browser fetch a locally-staged variant for WebGPU testing without uploading 2.7 GB to HF each iteration. Supports range requests + CORS. |
| `client/app/models/onnx-test/compare/page.tsx` + `compare-client.tsx` | Side-by-side WebGPU runtime A/B with upstream. `?local=1` query param swaps `env.remoteHost` to the local server. Has a `?local-host=...` override and a smoke-test (user-only) button. |

## What we tried that doesn't work

Every one of these has been verified non-viable. Don't re-litigate.

- **`optimum-onnx`**: requires `transformers < 4.58.0`; Gemma 4 needs `≥ 5.5.0`. Hard incompatibility. Open optimum-onnx PR #121 ("transformers 5.2 support") has been pending since Feb 2026. See [`onnx-export.md`](./onnx-export.md#6-ecosystem-state-as-of-2026-05-13).
- **`transformers.js`'s `scripts/convert.py`**: doesn't recognize `model_type=gemma4`. Same root cause as optimum (it depends on optimum's `TasksManager`).
- **`onnxruntime.transformers.optimize_model` in `bert`/`phi`/`qwen3`/`gpt_neox` modes**: no fusions match. Only `gpt2` matches FastGelu. None match `SimplifiedLayerNormalization`/`RotaryEmbedding`/`GroupQueryAttention` for our decomposed shape.
- **MLC via `web-llm`**: compiles cleanly, all 3 Gemma 4 variants emit coherent output for the first prompt. **`chat.completions.create()` leaks KV-cache state between calls** ([`mlc-finetune.md`](./mlc-finetune.md#6-web-llm-batch-state-leakage--diagnosed-workaround-required) §6). Workaround = engine reload per task call (3-5 s × ~7 task switches per WAVE session). Rejected as the shipping path for that reason.
- **Matching upstream's `GatherBlockQuantized` packing byte-for-byte**: already identical. The embed tables on upstream and ours hash to the same first-16-bytes-hex for `data`, `scales`, and `zero_points` (PEFT/LoRA never touched embed tables, so they're upstream's bytes).
- **Re-quantize with fp32 ONNX (skip the int4 step)**: would balloon to ~10-18 GB. Impractical for browser delivery.

## What likely would work, but we didn't try

These are speculative; none of them are quick.

- **Rewrite `MergedDecoderWrapper` in `export_text_onnx.py`** to construct the forward path out of `torch.nn` modules whose ONNX export pattern matches what `onnxruntime.transformers.fusion_*` recognizes as `SimplifiedLayerNormalization` / `RotaryEmbedding` / `GroupQueryAttention`. We don't know exactly which PyTorch idioms map to which contrib ops — this would be reverse-engineering the optimizer's pattern matchers. Days of work, no guarantee.
- **Microsoft Olive**: targets ONNX deployment optimization for LLMs. Doesn't officially list Gemma 4. Same `transformers` version risk as optimum.
- **`onnxruntime-genai`**: has its own LLM export tools but [issue #2062](https://github.com/microsoft/onnxruntime-genai/issues/2062) flags Gemma 4 PLE + variable-head-dim + KV-cache-sharing as known blockers. No maintainer reply.
- **Wait for `onnxruntime-web` to ship a fix for [microsoft/onnxruntime#26732](https://github.com/microsoft/onnxruntime/issues/26732)** (the Gemma 3 q4f16 WebGPU overflow). Open since Dec 2025. No maintainer reply. No fix shipped.

## Recommended next path: GGUF + `llama.cpp` WASM

Per the Unsloth answer to our direct question:

> Unsloth has no ONNX/WebGPU export story for Gemma 4. Their published fix for the same fp16 overflow class is RMSNorm upcast to fp32 — exactly what our v6/v7 approach does in ONNX-land. **If browser shipping is non-negotiable and you want to stop maintaining a custom export pipeline, GGUF + llama.cpp WASM is the only "blessed" path.**

We already have a working GGUF artifact at [`Maelstrome/lora-wave-session-r32-gguf`](https://huggingface.co/Maelstrome/lora-wave-session-r32-gguf) (90+ HF downloads). The handoff to a GGUF browser runtime is unstarted.

Candidate runtimes:
- [`wllama`](https://github.com/ngxson/wllama) — `llama.cpp` compiled to WASM with SIMD. CPU-only but stable. Realistic ~5-10 tok/s on modern laptops.
- [`llama-cpp-wasm`](https://github.com/tangledgroup/llama-cpp-wasm) — similar.
- `ggml-webgpu` — experimental WebGPU backend in `llama.cpp`. Landed in early 2026; rough but the only viable WebGPU GGUF path.

This sidesteps the entire `onnxruntime-web` WebGPU EP. Different runtime, different op kernels, no fp16 overflow risk inherited from our work.

## Production runtime — what to ship today

The current [`client/lib/gemma/local-runtime.ts:27`](../../client/lib/gemma/local-runtime.ts#L27) points at `onnx-community/gemma-4-E2B-it-ONNX` (upstream base, no fine-tune). The user has verified that this works on the same compare page with the same WAVE prompts. **Keep it pointed there.** Ship the upstream base for the demo. The fine-tune lives as:
- The CPU-only ONNX artifact at `Maelstrome/lora-wave-session-r32-onnx` (correct, just not WebGPU-deployable).
- The GGUF at `Maelstrome/lora-wave-session-r32-gguf` (the path to revisit when the browser story gets re-investigated).

## Things to NOT re-litigate

1. The int4 PLE packing is correct. Don't re-quantize.
2. `use_cache=True` is correctly set in the export wrapper. The graph correctly threads shared-KV layers through `past_key_values` inputs. The 61-matmul delta vs upstream is from upstream's `GroupQueryAttention` fusion, not from us re-computing K/V.
3. Don't blame the fine-tune. CPU output is coherent and schema-compliant across all three WAVE tasks. The model is correct.
4. Don't blame the WAVE prompts. Their length triggers the bug, but they're not pathological — any long-context prompt does the same thing. Shortening them is a workaround, not a fix.
5. Don't ship MLC web-llm. [`mlc-finetune.md`](./mlc-finetune.md) §6 documents the state-leak bug and rejects this path.

## References

- Live test artifact directories: `models/runs/onnx-export-v3/`, `onnx-export-v4-fused/`, `onnx-export-v5-pow2mul/`, `onnx-export-v6-rmsnorm/`, `onnx-export-v7-castfp32/`.
- Upstream reference: `models/runs/upstream-embed-ref/` (downloaded for diffing).
- Browser comparison: [`/models/onnx-test/compare`](../../client/app/models/onnx-test/compare/page.tsx) with `?local=1` query param.
- Logs:
  - [`logs/bench-onnx-wave-prompts.log`](../../logs/bench-onnx-wave-prompts.log) — first CPU bench that revealed the divergence
  - [`logs/bench-onnx-v4-fused.log`](../../logs/bench-onnx-v4-fused.log), [`logs/bench-onnx-v5-pow2mul.log`](../../logs/bench-onnx-v5-pow2mul.log), [`logs/bench-onnx-v6-rmsnorm.log`](../../logs/bench-onnx-v6-rmsnorm.log), [`logs/bench-onnx-v7-castfp32.log`](../../logs/bench-onnx-v7-castfp32.log) — per-variant CPU runs
  - [`logs/gbq-diff.log`](../../logs/gbq-diff.log) — proves embed_tokens packing matches upstream
  - [`logs/decoder-diff.log`](../../logs/decoder-diff.log) — proves decoder structurally diverges from upstream
  - [`logs/fuse-attempt.log`](../../logs/fuse-attempt.log) — fusion attempts across model_type settings
- External issues:
  - [microsoft/onnxruntime#26732](https://github.com/microsoft/onnxruntime/issues/26732) — Gemma 3 q4f16 WebGPU overflow (open, no fix)
  - [huggingface/transformers.js#1469](https://github.com/huggingface/transformers.js/issues/1469) — Gemma 3 JSEP crash under WebGPU
  - [vllm-project/vllm#40290](https://github.com/vllm-project/vllm/issues/40290) — Gemma 4 fp16 overflow in vision tower (same family of bug)
  - [huggingface/transformers#45242](https://github.com/huggingface/transformers/issues/45242) — Gemma 4 `use_cache=False` corrupts attention (we verified we don't have this; included for completeness)
- Related Wave docs:
  - [`docs/postmortems/onnx-export.md`](./onnx-export.md) — the original Mac export postmortem (predates the Windows handoff and the WebGPU divergence finding)
  - [`docs/postmortems/mlc-finetune.md`](./mlc-finetune.md) — the parallel MLC investigation
  - [`docs/onnx-webgpu-divergence.md`](../onnx-webgpu-divergence.md) — pre-postmortem write-up of v3 → v4 finding; superseded by this doc
  - [`docs/onnx-windows-handoff.md`](../onnx-windows-handoff.md) — the original Windows handoff that became this postmortem
  - [`docs/transformers-js-gemma4-perf.md`](../transformers-js-gemma4-perf.md) — the orthogonal `num_logits_to_keep` patch (still applies; nothing in this postmortem changes it)
