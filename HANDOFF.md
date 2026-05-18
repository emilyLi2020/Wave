# Handoff

> **Current state** (2026-05-14 PM): the **wllama + GGUF path is the shipping path**. The ONNX iteration documented below (v3→v7) was abandoned after v7 still failed on browser WebGPU — same `onnxruntime-web` fp16 bug class, not fixable from our side. wllama bypasses it entirely by running llama.cpp's own WebGPU kernels.
>
> Read [`client/docs/wllama.md`](client/docs/wllama.md) for the current architecture. The rest of this file is preserved as the historical record of what was tried in the ONNX iteration.

## Current shipping path (2026-05-14 PM)

| Where | What |
|---|---|
| HF | [`Maelstrome/lora-wave-session-r32/gguf/`](https://huggingface.co/Maelstrome/lora-wave-session-r32/tree/main/gguf) — Q4_K_M GGUF, 5 shards, ~3.2 GB. Lives next to the adapter at the repo root. |
| Browser surface | [`client/app/models/wllama-test/`](client/app/models/wllama-test/) — Smoke / Phase / Check-in / Reflection buttons, defaults to HF, `?local=1` for the local mirror. Verified working on WebGPU. |
| Client lib | [`client/lib/wllama/`](client/lib/wllama/) — `loadWaveWllama()` wrapper used by the test page and (eventually) the production runtime. |
| Python pipeline | [`models/gguf/README.md`](models/gguf/README.md) — PEFT merge → f16 → Q4_K_M → split → upload. |
| Design doc | [`client/docs/wllama.md`](client/docs/wllama.md) — end-to-end architecture, why-wllama-over-ONNX, browser support matrix, production-wiring plan. |

To delete (HF web UI, your action): `lora-wave-session-r32-{merged,gguf,onnx,onnx-fused}` — all obsolete.

Production wiring: **done.** Chunk narration, check-in, reflection, and insights all run through `@/lib/wllama` via [`client/lib/gemma/wllama-generators.ts`](client/lib/gemma/wllama-generators.ts) (the `client/lib/gemma/{chunk,checkin,session}.ts` boundaries import it). The legacy `local-runtime.ts` (transformers.js + ONNX) is retained only for the dev `pnpm test:gemma:tools:live` smoke. See `client/docs/wllama.md`.

---

# Overnight autonomous run — handoff (historical; ONNX iteration)

**Date**: 2026-05-14 03:00–03:30
**Branch**: `main` (uncommitted changes; nothing committed/pushed)

## The short version

Yesterday's diagnosis was wrong. Our int4 packing is byte-for-byte identical to upstream's. The real problem is that our decoder uses **decomposed primitive ops** (specifically `Tanh + Pow(x, 3)`-based `gelu_pytorch_tanh`) where upstream uses **fused `FastGelu` contrib ops**. The decomposed `Pow(x, 3)` NaN-cascades on WebGPU for long-context activations → first-token argmax lands on a stop token → `len=0`.

**Fix**: re-run `onnxruntime.transformers.optimize_model(model_type="gpt2", opt_level=0)` on the v3 decoder. This fuses the 70 `Tanh` ops into 70 `FastGelu` contrib ops. CPU bench is still coherent and **2× faster** (Phase 26s vs 54s, Reflection 9.4s vs 21s).

The v4-fused export is staged locally at [`models/runs/onnx-export-v4-fused/`](models/runs/onnx-export-v4-fused/) (2.7 GB). Pending your verification in the browser.

## Fastest path: verify under WebGPU WITHOUT uploading

I added a local-HF mirror so you can test v4 in WebGPU before publishing:

```powershell
# Terminal 1 — start the static-file server that mirrors HF's URL layout
cd client
pnpm exec tsx scripts/serve-local-hf.ts
# Listens on http://localhost:8765/Maelstrome/lora-wave-session-r32-onnx-fused/resolve/main/...
# Reads from models/runs/onnx-export-v4-fused/ — no copy, no upload.

# Terminal 2 — start dev server
cd client
pnpm dev

# Browser — append ?local=1 to the compare URL
# http://localhost:3000/models/onnx-test/compare?local=1
# Hard-reload (Ctrl+Shift+R) to clear transformers.js IndexedDB cache.
# Click "Load" on the fine-tune column (right). It'll fetch from your localhost
# server instead of huggingface.co — confirmed working under WebGPU because
# env.remoteHost goes through the absolute-URL fetch path (not the MountedFiles
# bug path that hits env.allowLocalModels=true).
# Click "Run all 3 tasks on this model".
# Expected: coherent output. If still len=0, see "If v4 also fails" below.
```

## Once verified, publish + flip GEMMA_MODEL_ID

```powershell
# Upload v4 to a new HF repo (autonomous run couldn't do this for safety)
hf upload Maelstrome/lora-wave-session-r32-onnx-fused models/runs/onnx-export-v4-fused . --create-repo

# Edit client/lib/gemma/local-runtime.ts:27
# From:  export const GEMMA_MODEL_ID = "onnx-community/gemma-4-E2B-it-ONNX";
# To:    export const GEMMA_MODEL_ID = "Maelstrome/lora-wave-session-r32-onnx-fused";

# Verify CPU bench too (already done overnight; rerun if you want)
cd client
MODEL_ID=onnx-export-v4-fused pnpm exec tsx scripts/bench-onnx-wave-prompts.ts
# Expected: phase ~26s coherent JSON · check-in ~25s natural chat · reflection ~9s JSON
```

## If v4 also fails with `len=0`

Next suspect is RMSNorm's `Pow(x, 2)` (484 `Pow` + 242 `ReduceMean` ops remain after fusion). Same WebGPU `Pow=exp(y*ln(x))` issue, less severe because `Pow(x, 2)` is more likely special-cased to `x*x`, but not guaranteed. Fix is a graph rewrite: walk every `Pow` node whose second input is the constant `2`, replace with `Mul(x, x)`. Maybe 50 lines of Python.

If that also fails, the failure is genuinely an `onnxruntime-web` WebGPU kernel bug for our decomposed-RMSNorm shape and we should file upstream. At that point we're better off shipping via MLC (PR #3485) for the fine-tune path and keeping upstream on ONNX.

## What I changed (uncommitted)

| File | Change |
|---|---|
| `models/onnx/export.py` | `_optimize_graph` switched from `bert` → `gpt2` mode, `opt_level=1`→`0`, now wired into `run_track_b` after q4f16 quantization. Future re-exports will produce v4-fused-shaped decoders automatically. |
| `models/runs/onnx-export-v4-fused/` | New: full v4 export (decoder fused, embed_tokens copied from v3 unchanged). Ready to push to HF. |
| `models/onnx/inspect_gbq.py` | New: byte-diffs GBQ initializers between two ONNX files. Used to prove embed_tokens matches upstream. |
| `models/onnx/inspect_decoder.py` | New: dumps node counts + I/O signature of a decoder ONNX. Used to find the fused-vs-decomposed divergence. |
| `models/onnx/try_fuse_decoder.py` | New: tries `optimize_model` with different `model_type` settings. `gpt2` mode wins. |
| `models/onnx/try_fuse_decoder_v2.py` | New: tried higher `opt_level` settings; conclusion is `opt_level=0` works best. Keep for reference. |
| `models/onnx/restage_decoder.py` | New: re-saves a fused decoder with transformers.js-compatible `.onnx_data` (underscore) filename. |
| `client/docs/onnx-webgpu-divergence.md` | Rewrote with the corrected diagnosis. Old version blamed packing; new version explains decomposed-ops + FastGelu fusion. |
| `client/app/models/onnx-test/compare-client.tsx` | `FINETUNE_LOCAL_ID` switched to `Maelstrome/lora-wave-session-r32-onnx-fused`. Slot subtitle says "(v4 fused)". Also still has the smoke-test button from earlier. |
| `client/scripts/bench-onnx-wave-prompts.ts` | `MODEL_ID` now reads `process.env.MODEL_ID` so you can A/B v3 and v4 without editing. |
| `client/scripts/serve-local-hf.ts` | New: static-file server that mirrors HF's URL layout (`{model}/resolve/main/...`) for the v4 export. Lets you test under WebGPU without uploading. Range requests + CORS supported. |
| `client/app/models/onnx-test/compare-client.tsx` (more) | Added `?local=1` query-param mode: when set, the fine-tune slot's `env.remoteHost` is swapped to `localhost:8765` (configurable via `?local-host=...`). Upstream stays on HF. Banner appears when active. |

## Safe-to-delete intermediates

```powershell
# 8.5 GB of fusion-trial intermediates (autonomous run was blocked from deleting; you can):
Remove-Item -Recurse -Force models/runs/onnx-fuse-trials

# 2.9 GB of upstream reference download (only used for diffing; can re-pull anytime):
Remove-Item -Recurse -Force models/runs/upstream-embed-ref
```

## Issue #6 status

[Comment posted](https://github.com/emilyLi2020/Wave/issues/6#issuecomment-4449767660) with corrected diagnosis. The graph-signature blocker that opened this issue is closed; the remaining unchecked box ("flip `GEMMA_MODEL_ID`") is gated on browser verification of v4.

## What was tried and didn't work (so we don't re-litigate)

- **Match upstream's int4 GBQ packing byte-for-byte**: no need — already identical.
- **`model_type="bert"` fusion**: no fusions match Gemma 4.
- **`opt_level=1` or `opt_level=2`**: adds Cast wrapper nodes for fp16-on-CPU compute without producing fusions. Keep `opt_level=0`.
- **`optimum-onnx` for a clean re-export**: incompatible — requires `transformers<4.58.0` and Gemma 4 needs ≥5.5.0. Same blocker called out in the [export postmortem](docs/postmortems/onnx-export.md#6-ecosystem-state-as-of-2026-05-13).
- **Shape inference**: fails with an AssertionError on our graph (probably due to KV-sharing dynamic dims); doesn't matter, the FastGelu pattern matches without it.

## Files touched in earlier turns of this session (already documented elsewhere)

- `client/app/models/onnx-test/compare-client.tsx`: chat-template alternation fix, channel-marker stripping fallback, smoke-test button.
- `models/runs/onnx-export-v3/generation_config.json`: added (also pushed to v3 HF repo).
- `models/onnx/export.py`: added `generation_config.json` to `RUNTIME_CONFIG_FILES`.
- `client/scripts/bench-onnx-wave-prompts.ts`: created to run WAVE prompts in Node CPU (this is what proved the model is fine and isolated the bug to the browser).
- `client/docs/onnx-webgpu-divergence.md`: created (now rewritten with v4 finding).

Sleep well. The interesting part is "did `FastGelu` alone fix WebGPU, or do we also need to handle RMSNorm" — you'll know within 5 minutes of running steps 1–3 above.
