# Browser fine-tune via wllama + GGUF

**Status**: shipping path for the WAVE fine-tune in the browser. Verified end-to-end on WebGPU with all three production prompts (phase / check_in / reflection). Replaces the seven-iteration ONNX export attempt documented in [`docs/onnx-webgpu-divergence.md`](onnx-webgpu-divergence.md) and [`models/onnx/README.md`](../models/onnx/README.md).

## TL;DR

The browser loads `gemma-4-e2b-it-peft.Q4_K_M.gguf` (split into 5 shards, ~3.2 GB total) directly from the consolidated HF repo at [`Maelstrome/lora-wave-session-r32/gguf/`](https://huggingface.co/Maelstrome/lora-wave-session-r32/tree/main/gguf). The [wllama](https://github.com/ngxson/wllama) library wraps llama.cpp's WASM/WebGPU build; we point it at the first shard and it auto-discovers the rest. WebGPU is enabled automatically on capable browsers; WASM SIMD is the fallback.

This path was chosen after seven iterations on a hand-rolled ONNX export all produced coherent CPU output but `len=0` on browser WebGPU — a bug class inside `onnxruntime-web`'s WebGPU fp16 kernels for Gemma's decomposed-primitive graph. wllama bypasses that entire class of bug because it ships llama.cpp's own kernels, where Gemma 4 has been first-class since launch.

## File map

| Location | Purpose |
|---|---|
| **Python side** (build the GGUF) | |
| [`models/finetune/merge_lora_peft.py`](../models/finetune/merge_lora_peft.py) | PEFT-merge the LoRA into a coherent base. Required because `unsloth.save_pretrained_merged` produces an all-`<pad>` corruption. |
| [`models/finetune/diagnose_merged_base.py`](../models/finetune/diagnose_merged_base.py) | 2-prompt smoke test for the merge. Stop here if it fails. |
| [`models/gguf/README.md`](../models/gguf/README.md) | End-to-end conversion pipeline (PEFT merge → f16 GGUF → Q4_K_M → split → upload). |
| [`models/gguf/bench_wave_prompts.py`](../models/gguf/bench_wave_prompts.py) | Drives `llama-cli` with the three production WAVE prompts to verify coherence locally. |
| **Client side** (load and run in browser) | |
| [`client/lib/wllama/config.ts`](../client/lib/wllama/config.ts) | Single source of truth: HF repo + filename, default `n_ctx`, WASM path. |
| [`client/lib/wllama/client.ts`](../client/lib/wllama/client.ts) | `loadWaveWllama()` + `describeWaveWllamaSource()`. Lazy-imports wllama, branches on local-mirror vs. HF. |
| [`client/lib/wllama/index.ts`](../client/lib/wllama/index.ts) | Public surface. Import from `@/lib/wllama`. |
| [`client/lib/wllama/README.md`](../client/lib/wllama/README.md) | Per-module usage doc. |
| [`client/public/wllama/wllama.wasm`](../client/public/wllama/) | The 7.1 MB WASM binary served at `/wllama/wllama.wasm`. Copied from `node_modules` after `pnpm install`. |
| [`client/app/models/wllama-test/`](../client/app/models/wllama-test/) | Browser test surface. Loads the GGUF, exposes Smoke / Phase / Check-in / Reflection buttons. |
| [`client/scripts/serve-local-hf.ts`](../client/scripts/serve-local-hf.ts) | Static-file server. Now exposes `/gguf/` (in addition to HF-style and MediaPipe mounts) reading from `models/runs/merge-peft-gguf/split/`. Used by `?local=1` mode. |
| [`client/scripts/dump-wave-prompts.ts`](../client/scripts/dump-wave-prompts.ts) | Renders the three WAVE prompts and writes them as JSON for `bench_wave_prompts.py` to consume. |
| **HF artifacts** | |
| [`Maelstrome/lora-wave-session-r32`](https://huggingface.co/Maelstrome/lora-wave-session-r32) | Single consolidated repo. Adapter at root; GGUFs under `gguf/`. |
| [`Maelstrome/lora-wave-session-r32/gguf/README.md`](https://huggingface.co/Maelstrome/lora-wave-session-r32/blob/main/gguf/README.md) | GGUF-subdir-specific doc: file layout, wllama/Ollama/llama.cpp usage. |

## Architecture

```
PyTorch merged base (bf16, 10 GB)
        │
        │  llama.cpp convert_hf_to_gguf.py
        ▼
f16 GGUF (~8.7 GB)
        │
        │  llama.cpp llama-quantize Q4_K_M
        ▼
Q4_K_M GGUF (3.2 GB)
        │
        │  llama.cpp llama-gguf-split --split-max-size 512M
        ▼
5 shards (43M + 1.93G + 510M + 509M + 438M)
        │
        │  hf upload Maelstrome/lora-wave-session-r32 .../split gguf
        ▼
Maelstrome/lora-wave-session-r32/gguf/ on HF
        │
        │  client/lib/wllama/client.ts: loadWaveWllama()
        ▼
Browser: wllama instance, WebGPU-backed, n_ctx=8192
        │
        │  wllama.createChatCompletion({ messages, max_tokens, ... })
        ▼
JSON / chat output → WAVE app surfaces
```

## Why wllama over `onnxruntime-web`

The hand-rolled ONNX export pipeline produced a model that:

- **CPU (Node, `onnxruntime-node`)**: coherent, schema-compliant output on all three WAVE prompts.
- **Browser WebGPU (`onnxruntime-web`)**: `len=0` — the model emits a stop token on the first decode step.

Seven iterations (v3 → v7) of post-export rewriters tried to remove the divergence between our decoder graph and upstream's:

| Iteration | Fix | Result |
|---|---|---|
| v3 | Original export | `len=0` |
| v4 | ORT `optimize_model(model_type="gpt2")` fused 70 `Tanh` chains → 70 `FastGelu` | `len=0` |
| v5 | Rewrote 242 `Pow(x, 2.0)` → `Mul(x, x)` (avoids WebGPU's `exp(y·ln(x))` `Pow` kernel) | `len=0` |
| v6 | Pattern-fused 227 RMSNorm 6-tuples → `SimplifiedLayerNormalization(stash_type=1)` | `len=0` |
| v7 | Wrapped remaining 15 variance chains with `Cast(fp32)` pairs | `len=0` |

After v7, the remaining divergence vs upstream (`onnx-community/gemma-4-E2B-it-ONNX`, which works on WebGPU) was the attention and rotary embedding — both decomposed in our export, both fused contrib ops upstream. Closing those requires rewriting the PyTorch wrapper to emit `scaled_dot_product_attention` calls the ORT optimizer's GQA/RoPE pattern matcher recognizes. Days of work with no guarantee, and even if it worked we'd still be on a runtime (`onnxruntime-web`) with documented Gemma fp16 issues ([microsoft/onnxruntime#26732](https://github.com/microsoft/onnxruntime/issues/26732), still open).

wllama doesn't use `onnxruntime-web` at all. It compiles llama.cpp's WebGPU kernels via Emscripten and ships its own runtime. llama.cpp's Gemma 4 path has been first-class since launch ([blog post](https://huggingface.co/blog/gemma4)), supports the full chat template, and runs the same Q4_K_M GGUF that's used by Ollama, LM Studio, and `llama-cli` — so the browser path inherits whatever correctness those non-browser paths have.

## Runtime performance — measured

Captured on Windows 11 / Chrome / NVIDIA Blackwell discrete GPU via [`/models/onnx-test/benchmark`](../client/app/models/onnx-test/benchmark-client.tsx) (3 runs per scenario, temperature 0, greedy decode). Both runtimes confirmed on WebGPU — `navigator.gpu.requestAdapter` returns a real adapter for both, and ORT logs the same adapter-init warning that wllama does. So this is an apples-to-apples WebGPU comparison, not a "ONNX on CPU vs wllama on GPU" comparison.

| Scenario | Metric | ONNX base (q4f16) | wllama fine-tune (Q4_K_M) | wllama advantage |
|---|---|---|---|---|
| Phase narration | Decode | 6.8 tok/s | 38.5 tok/s | **5.7×** |
| Phase narration | TTFT | 203 ms | 276 ms | ONNX +73 ms |
| Phase narration | Total (~65 tok) | 9.45 s | 2.02 s | **4.7×** |
| Check-in (multi-turn) | Decode | 6.6 tok/s | 40.3 tok/s | **6.1×** |
| Check-in | TTFT | 295 ms | 276 ms | wllama +19 ms |
| Check-in | Total per turn (~85 tok) | 14.67 s | 2.21 s | **6.6×** |
| Reflection | Decode | 6.5 tok/s | 36.8 tok/s | **5.7×** |
| Reflection | TTFT | 237 ms | 299 ms | ONNX +62 ms |
| Reflection | Total (200 tok cap) | 30.71 s | 4.55 s | **6.7×** |

**Decode is the bottleneck for ONNX.** Prefill (TTFT) is roughly tied — within ~70ms either way. But ONNX decode is pinned at ~6.6 tok/s across every scenario, regardless of context length, which is the giveaway that the limit is per-token dispatch overhead, not prefill or model size.

**GPU utilization tells the story:** at 6.6 tok/s, ORT pegs the GPU at ~10% utilization while CPU works hard. wllama at 38 tok/s saturates the GPU. Same hardware, same Gemma 4 E2B at q4 quantization — totally different dispatch pattern.

Why: onnxruntime-web uses **JSEP** (JavaScript Execution Provider) to deliver WebGPU. JSEP dispatches each ONNX op from WASM to WebGPU individually with a sync barrier between them. Gemma 4 decode is hundreds of small ops per token (RMSNorm, MatMulNBits, RoPE, attention, gates), so the GPU spends most of its time idle waiting for the next op from the WASM module. llama.cpp's WebGPU backend (in wllama) fuses these into bigger compute shaders that do more work per dispatch and keep the GPU fed continuously.

This is a structural ORT-web limitation, not something we can fix from the application side without rewriting the runtime. Even if the fp16 correctness bug ([`docs/onnx-webgpu-divergence.md`](onnx-webgpu-divergence.md)) were resolved, this 6× throughput gap would remain.

## How `?local=1` works

The test page defaults to HF, so it works without any local infrastructure. For fast iteration on the GGUF itself:

```powershell
cd client
pnpm exec tsx scripts/serve-local-hf.ts
# Listens on http://localhost:8765 with three mounts:
#   /Maelstrome/lora-wave-session-r32-onnx-fused/resolve/main/*  (HF-style ONNX, unused now)
#   /mediapipe/*                                                 (MediaPipe assets)
#   /gguf/*                                                      (split GGUFs)
```

Then open `http://localhost:3000/models/wllama-test?local=1`. The page calls `loadWaveWllama({ useLocalMirror: true, ... })` which routes to `loadModelFromUrl(http://localhost:8765/gguf/...-00001-of-00005.gguf)`. wllama follows shard 2..5 from the same base URL automatically.

Override the host with `?local-host=http://localhost:9999` if you're running the mirror on a non-default port.

## Browser support matrix

| Browser | WebGPU available? | Expected behavior |
|---|---|---|
| Chrome 113+ (Windows/macOS/Linux) | Yes | Full WebGPU offload, all layers on GPU. ~10–30 tok/s on a discrete GPU. |
| Chrome 113+ (Android, ChromeOS) | Sometimes | Variable; falls back to WASM SIMD if WebGPU init fails. |
| Edge 113+ | Yes | Same as Chrome. |
| Firefox Nightly with `dom.webgpu.enabled` | Experimental | Untested. |
| Safari 26+ (iOS/macOS) | Partial | WebGPU enabled by default in 26; not tested on this model. |
| Older browsers | No | WASM SIMD fallback. ~1–3 tok/s. |

wllama V3.1+ defaults to WebGPU with all layers offloaded. Pass `n_gpu_layers: 0` to `loadWaveWllama({ ... })` (currently not exposed in the wrapper — add to `LoadWaveWllamaOptions` if you need it) to force the WASM path for testing.

## Production wiring (next step, not yet done)

To replace transformers.js+ONNX in the production runtime:

1. Edit [`client/lib/gemma/local-runtime.ts`](../client/lib/gemma/local-runtime.ts). The current implementation uses `transformers.js` `pipeline()` to load `onnx-community/gemma-4-E2B-it-ONNX`. Replace with `loadWaveWllama()` from `@/lib/wllama`.
2. Adapt the `generateGemmaChunk` / `generateGemmaCheckIn` / `generateGemmaReflection` functions in [`client/lib/gemma/*.ts`](../client/lib/gemma/) to call `wllama.createChatCompletion()` instead of the transformers.js pipeline. The message shape (`[{ role, content }]`) is identical, so this is mostly s/`pipe(messages, ...)`/`wllama.createChatCompletion({ messages, ... })`/.
3. Remove the transformers.js patch ([`client/patches/@huggingface__transformers@4.2.0.patch`](../client/patches/)) and the `@huggingface/transformers` dependency once nothing references them.
4. Remove the `onnx-test/compare` page (and the ONNX `assertModelsEnabled` gate if it's now redundant).

A separate followup: extend the wllama wrapper to expose `createChatCompletion` with a streaming flag, so the production check-in surface can stream tokens to the UI as they arrive rather than waiting for the full completion. wllama supports this via its `Wllama.createChatCompletion({ stream: true })` API; we just don't expose it in `loadWaveWllama` yet.

## Operational notes

- **CacheStorage**: wllama caches shards in the browser's `caches` API by default. First load downloads ~3.2 GB; subsequent loads hit the cache (zero network). Inspect via DevTools → Application → Cache Storage → `wllama_cache`.
- **2 GB ArrayBuffer ceiling**: each shard must fit in a single `ArrayBuffer`, which has a 2 GB hard limit in V8. Our split is `--split-max-size 512M` but one tensor is too big to split below 1.93 GB; that shard is the largest. If a future quantization (e.g., Q4_K_S or Q3_K) produces shards >2 GB, re-quantize finer.
- **Re-publishing**: if the GGUF changes, the simplest path is `hf upload Maelstrome/lora-wave-session-r32 models/runs/merge-peft-gguf/split gguf --delete "*"` to wipe and re-upload the subdir cleanly. Then bump the filename in `client/lib/wllama/config.ts` if the shard names changed (or keep it stable if you re-split into the same `-N-of-M` pattern).
- **Tokenizer drift**: the chat template and special tokens are baked into the GGUF metadata at conversion time. If you change the chat template in the source repo without re-converting the GGUF, the browser will use the old template until you re-upload. There's no "tokenizer-only" patch path for GGUF.

## Repo hygiene

The pre-consolidation sibling repos are deprecated:

- `Maelstrome/lora-wave-session-r32-merged` — corrupt unsloth-merged base, never useful, delete via HF web UI.
- `Maelstrome/lora-wave-session-r32-gguf` — May-11 GGUF built via unsloth's path; superseded by the in-repo `gguf/`. Delete.
- `Maelstrome/lora-wave-session-r32-onnx` — v3 ONNX (broken on WebGPU). Delete.
- `Maelstrome/lora-wave-session-r32-onnx-fused` — v4-fused ONNX, never worked end-to-end. Delete.

`Maelstrome/lora-wave-session-r32-report` (the eval write-up repo) and `Maelstrome/lora-wave-session-dataset` stay — they're referenced by the consolidated README and are not redundant.
