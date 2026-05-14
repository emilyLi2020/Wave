# MLC Build Postmortem: Gemma 4 E2B Fine-tune → WebGPU WASM

> Companion to [`onnx-export.md`](./onnx-export.md). After the ONNX path landed us at ~7 GB total (4× upstream's 1.5 GB decoder due to PLE tables), we switched to MLC-LLM's compile pipeline against [PR #3485](https://github.com/mlc-ai/mlc-llm/pull/3485) (Gemma 4 E2B text-only support) + [relax PR #346](https://github.com/mlc-ai/relax/pull/346) (TVM-side companion).
>
> End state: **2.5 GB total bundle, q4f16_1 quantized with PLE tables packed**. Comparable to upstream and architecturally tuned for WebGPU.

---

## 1. Why MLC after we already had ONNX

The ONNX path produced a functional fine-tune export but couldn't compress the Per-Layer Embedding (PLE) Gather tables — `MatMulNBitsQuantizer` only touches MatMul ops, leaving ~4.7 GB of fp16 PLE storage untouched.

MLC PR #3485 includes `Gemma4SplitScaledEmbedding` — a Gemma-4-aware quantization path that does pack PLE tables to 4-bit. That's what gets us from 7 GB → 2.5 GB.

PR #3485 also adds:
- WebGPU-aware kernel selection (`max_num_threads: 128` instead of default 256)
- KV cache sharing (`num_kv_shared_layers: 20`) — only 15 unique cache pairs across 35 layers
- Variable head_dim handling (256 for sliding layers, 512 for 7 full-attention layers)
- The matching relax PR #346 supplies the TVM-side `max_shared_memory_per_block = 32768` constant required for WebGPU compile

---

## 2. The build environment we needed

| Tool | Why | Install |
|---|---|---|
| LLVM | TVM uses it for IR codegen even when targeting WebGPU | `brew install llvm` |
| CMake | Build system for TVM, mlc-llm, tokenizers | already present via brew |
| Ninja | Faster than make for the C++ build | already present via brew |
| Emscripten (`emcc`) | Compiles `mlc_wasm_runtime.bc` for the WebGPU linker | `brew install emscripten` |
| Apple Clang | C++ compiler | Xcode CLT |
| Python 3.11 | mlc-llm requires it (won't work with 3.13) | via uv in `models/.venv` |

For Python: `models/.venv` got `apache-tvm-ffi`, `mlc-ai-nightly-cpu`, `mlc-llm-nightly-cpu` installed early on as breadcrumbs, then **all replaced** by the source builds. The published wheels have an ABI mismatch on macOS — `mlc_llm/libmlc_llm_module.dylib` links against `@rpath/libtvm.dylib` (unified) but `mlc-ai-nightly-cpu` ships split `libtvm_compiler.dylib` + `libtvm_runtime.dylib`. Source build sidesteps this entirely.

`pytest` is a transitive runtime import in `tvm_ffi.testing` (annoyingly, not an optional dep). Without it, `import tvm` fails.

---

## 3. The clone + checkout

```bash
mkdir -p /tmp/mlc-workspace && cd /tmp/mlc-workspace

# mlc-llm with PR #3485 fetched as a branch
git clone --depth 1 https://github.com/mlc-ai/mlc-llm.git mlc-llm-base
cd mlc-llm-base
git fetch origin pull/3485/head:pr-3485
git checkout pr-3485

# mlc-ai/relax (TVM) with submodules + PR #346 fetched
cd /tmp/mlc-workspace
git clone --depth 1 --recursive https://github.com/mlc-ai/relax.git relax-base
cd relax-base
git fetch origin pull/346/head:pr-346
git checkout pr-346
git submodule update --init --recursive
```

The relax clone is ~2 GB with submodules (TVM has many: dlpack, dmlc-core, picojson, tvm-ffi, rang, libbacktrace, etc.).

---

## 4. Building TVM/relax from source

```bash
cd /tmp/mlc-workspace/relax-base
mkdir build && cd build

# Use brew's LLVM, enable Metal codegen (Mac), skip CUDA
cmake .. -G Ninja \
  -DUSE_METAL=ON \
  -DUSE_LLVM=$(brew --prefix llvm)/bin/llvm-config \
  -DCMAKE_PREFIX_PATH=$(brew --prefix llvm)

ninja
```

The `-DUSE_LLVM=<llvm-config>` form is more reliable than `LLVM_DIR` — it lets TVM probe LLVM's actual capabilities rather than just finding the cmake config file.

Build time on Apple Silicon (M4): ~30–60 min depending on parallelism.

After the build, the libtvm.dylib + libtvm_runtime.dylib + libtvm_ffi.dylib land in `/tmp/mlc-workspace/relax-base/build/`.

---

## 5. The mlc-llm install — and the symlink trick

mlc-llm's `pyproject.toml` uses `scikit-build-core` to compile its C++ extension during pip install. The C++ build expects TVM at `3rdparty/tvm` (a git submodule pinned to a specific mlc-ai/relax commit).

The naive flow `git submodule update --init --recursive` would clone mlc-ai/relax fresh into `3rdparty/tvm` — but that version doesn't have PR #346's changes. We need mlc-llm to build against our **PR #346-patched** relax.

**Solution: symlink `3rdparty/tvm` to our built `relax-base`.**

```bash
cd /tmp/mlc-workspace/mlc-llm-base

# Replace the empty submodule dir with a symlink to the PR #346 source
rm -rf 3rdparty/tvm
ln -s /tmp/mlc-workspace/relax-base 3rdparty/tvm
```

mlc-llm has other submodules besides tvm (tokenizers-cpp, xgrammar, stb) that need to be fetched too. Naive `git submodule update --init --recursive` fails because git refuses to even **enumerate** submodules when one path is a symlink:

```
error: expected submodule path '3rdparty/tvm' not to be a symbolic link
```

**Solution: swap symlink → empty dir, run submodule init, swap back.**

```bash
TVM_TARGET=$(readlink 3rdparty/tvm)
rm 3rdparty/tvm
mkdir 3rdparty/tvm                               # empty placeholder

git submodule status \
  | awk '{print $2}' \
  | grep -v '^3rdparty/tvm$' \
  | xargs -I{} git submodule update --init --recursive {}

rmdir 3rdparty/tvm
ln -s "$TVM_TARGET" 3rdparty/tvm                 # restore
```

Submodules pulled in addition to tvm:
- `3rdparty/tokenizers-cpp` (with its own nested `msgpack` + `sentencepiece`)
- `3rdparty/stb` (header-only image library — needed by `cpp/json_ffi/image_utils.cc`)
- `3rdparty/xgrammar` (constrained-generation library — needed by `cpp/serve/request_state.h`)

The `--recursive` flag matters: tokenizers-cpp's `msgpack` and `sentencepiece` sub-submodules also need initializing or the cmake configure fails with `does not contain a CMakeLists.txt file`.

Then editable install:

```bash
export TVM_LIBRARY_PATH=/tmp/mlc-workspace/relax-base/build
export PYTHONPATH=/tmp/mlc-workspace/relax-base/python:$PYTHONPATH

VIRTUAL_ENV=/path/to/wave/models/.venv \
  uv pip install --project /path/to/wave/models -e .
```

Compile time for mlc-llm bindings: ~5–10 min on Apple Silicon. The 176-target build links sentencepiece, tokenizers, xgrammar, mlc-llm's C++ engine, and the (re-)built TVM runtime objects.

---

## 6. Build script wrapping all of the above

Captured in [`models/runs/bench/build_mlc.sh`](../../models/runs/bench/build_mlc.sh) (gitignored — lives under `models/runs/`). Idempotent: re-running picks up incremental cmake state and skips already-fetched submodules.

---

## 7. The convert + compile flow

```bash
# Use the locally-cached HF snapshot path, not the repo ID
SNAPSHOT=~/.cache/huggingface/hub/models--Maelstrome--lora-wave-session-r32-merged/snapshots/<sha>

# Step 1: convert weights (~1 min on Metal)
python -m mlc_llm convert_weight "$SNAPSHOT" \
  --quantization q4f16_1 \
  --model-type gemma4 \
  -o models/runs/mlc-export

# Step 2: generate chat config (~5 sec)
python -m mlc_llm gen_config "$SNAPSHOT" \
  --quantization q4f16_1 \
  --model-type gemma4 \
  --conv-template gemma_instruction \
  -o models/runs/mlc-export

# Step 3: compile for WebGPU (~30 sec TVM compile + WASM link)
python -m mlc_llm compile \
  models/runs/mlc-export/mlc-chat-config.json \
  --device webgpu \
  -o models/runs/mlc-export/wave-r32-q4f16_1-webgpu.wasm
```

Key env vars throughout:
```bash
export VIRTUAL_ENV=/path/to/wave/models/.venv
export TVM_LIBRARY_PATH=/tmp/mlc-workspace/relax-base/build
export PYTHONPATH=/tmp/mlc-workspace/relax-base/python:$PYTHONPATH
export MLC_LLM_SOURCE_DIR=/tmp/mlc-workspace/mlc-llm-base
export TVM_SOURCE_DIR=/tmp/mlc-workspace/relax-base
```

---

## 8. The convert/compile gotchas

### 8.1 `convert_weight` needs a local path, not an HF repo ID

```
argument config: invalid detect_config value: 'Maelstrome/lora-wave-session-r32-merged'
```

mlc-llm's auto-config probe walks the filesystem looking for `config.json`. It doesn't talk to the HF Hub. Pass the cached snapshot directory directly.

### 8.2 `compile --device webgpu` needs `mlc_wasm_runtime.bc`

The final link step embeds a precompiled WASM runtime bitcode that's not in the source tree:

```
RuntimeError: Cannot find library: mlc_wasm_runtime.bc
Make sure you have run `./web/prep_emcc_deps.sh` and `export MLC_LLM_SOURCE_DIR=/path/to/mlc-llm`
```

`prep_emcc_deps.sh` requires `emcc` (emscripten) and `npm`. It then does:

```bash
cd web && make                                    # builds mlc_wasm_runtime.bc
cd $TVM_SOURCE_DIR/web && TVM_HOME=$TVM_SOURCE_DIR make    # builds TVM web runtime
```

### 8.3 `prep_emcc_deps.sh` also trips on the tvm symlink

The script starts with `git submodule update --init --recursive`, hitting the same git error from §5. Workaround: run the two `make` commands directly, skip the script's submodule init:

```bash
cd /tmp/mlc-workspace/mlc-llm-base/web
TVM_SOURCE_DIR=/tmp/mlc-workspace/relax-base make

cd /tmp/mlc-workspace/relax-base/web
TVM_HOME=/tmp/mlc-workspace/relax-base make
```

The first make produces `web/dist/wasm/mlc_wasm_runtime.bc` (the file the final link needs). On a fresh emscripten install it also generates ~5 cached sysroot libraries (libc, libdlmalloc, libcompiler_rt, libc++, libsockets, libc++abi). One-time cost.

### 8.4 The metal compile path doesn't need WASM

If you only want native Mac validation, `--device metal` produces a `.dylib` without needing emscripten at all. Useful for fast iteration before paying the WASM compile cost.

---

## 9. What the final output contains

```
models/runs/mlc-export/
├── mlc-chat-config.json                  4.5 KB — model config + chat template (gemma_instruction)
├── ndarray-cache.json                    ~300 KB — quantization metadata + shard manifest
├── tokenizer.json                        32 MB — HF tokenizer
├── tokenizer_config.json                 24 KB — tokenizer settings
├── wave-r32-q4f16_1-webgpu.wasm          9.4 MB — compiled WebGPU shader library (kernels)
└── params_shard_{0..45}.bin              2.45 GB total — quantized weight shards
```

Key numbers from the compile:
- **Total parameters: 5,123,178,979** (matches model card — 5.1 B)
- **Parameter size after quantization: 2.45 GB**
- **Bits per parameter: 4.114** (essentially 4-bit with metadata overhead)
- **Runtime memory: 3.66 GB** without KV cache (2.51 GB params + 1.14 GB temp buffers)

Compare to ONNX bundle: 7 GB. **Net win: 4.5 GB smaller while preserving the fine-tune.**

---

## 10. Browser-side wiring

Done in [`client/app/training/mlc-test/`](../../client/app/training/mlc-test/) (page + client component) using `@mlc-ai/web-llm@^0.2.83`:

```ts
const MLC_APP_CONFIG: AppConfig = {
  model_list: [{
    model: new URL("/mlc-export/", window.location.origin).toString(),
    model_id: "wave-r32-q4f16_1",
    model_lib: new URL("/mlc-export/wave-r32-q4f16_1-webgpu.wasm", window.location.origin).toString(),
    overrides: { context_window_size: 4096 },
  }],
};

const engine = await CreateMLCEngine("wave-r32-q4f16_1", { appConfig: MLC_APP_CONFIG, initProgressCallback });
const stream = await engine.chat.completions.create({
  messages: [{ role: "user", content: prompt }],
  temperature: 0,
  max_tokens: 80,
  stream: true,
});
```

The `mlc-export` directory is symlinked into `client/public/` so Next.js serves the artifacts at `http://localhost:3000/mlc-export/`.

First-load behavior in browser:
- Downloads all 46 weight shards (~2.5 GB) into IndexedDB
- Compiles WebGPU shaders from the WASM kernel library
- Loads weights into GPU memory
- Total cold-load: ~30 s – 2 min depending on disk speed

Second-load: IndexedDB cache hit, just GPU memory load (~5–10 s).

---

## 11. iPhone deployment notes

For an iPhone 17 Pro Safari demo:
1. Upload `mlc-export/` to a public HF repo (`Maelstrome/lora-wave-session-r32-mlc`)
2. Update the test page's `MLC_APP_CONFIG.model_list[0].model` URL to the HF repo URL
3. Visit on iPhone — Safari 18+ supports WebGPU natively

Runtime memory budget on iPhone 17 Pro:
- iOS Safari per-tab WebGPU cap: historically ~1.5–2 GB, ~3 GB on 12 GB devices
- Our model needs **3.66 GB without KV cache** → tight; may OOM
- Fallback: re-export with `q3f16_1` quantization (smaller) if q4f16_1 doesn't fit
- Or trim `context_window_size` further (we already overrode to 4096; could go to 2048)

The `prefill_chunk_size: 8192` is the largest single matmul during inference. WebGPU buffer sizes for that operation can exceed Safari's per-buffer limit (`max_storage_buffer_binding_size`, typically 128 MB). PR #3485's `Gemma4SplitScaledEmbedding` already handles the PLE table case; matmul buffers are separate concerns.

---

## 12. Lessons worth remembering

- **MLC ≠ HF Optimum ergonomics.** The HF ecosystem (Optimum, transformers.js) hides toolchain complexity; MLC exposes it. Source builds, env vars, submodule dances, multiple PR branches — all required, none documented in one place.
- **The relax PR was the gate, not the mlc-llm PR.** PR #3485 is mostly Python code (~1500 lines) — easy to apply as an overlay. The TVM/C++ changes in relax PR #346 are what required the source build.
- **Git submodule + symlink is genuinely incompatible.** No amount of `--force` or `git config` works. The swap-to-empty-dir dance is the only path.
- **Published `mlc-llm-nightly-cpu` wheel is broken on macOS** for our use case (links against unified `libtvm.dylib` that doesn't exist in the current `mlc-ai-nightly-cpu` split). Source build is mandatory until they sync the wheels.
- **`prep_emcc_deps.sh` ≠ optional.** WebGPU target needs the WASM runtime bitcode. Metal target doesn't. If you only want Mac validation, skip emscripten entirely.
- **The PR #3485 author's "clean-room WebGPU validation" claim held up.** The build succeeded with no patches; convert/compile produced viable artifacts; the disputed-review comments are about output quality, not whether anything works at all.
- **`context_window_size` defaults to 131072** (Gemma 4's max). Override via `overrides` in `mlc-chat-config.json` or at convert time — full context inflates the KV cache buffer requirements significantly.

---

## File references

- This document: [`docs/postmortems/mlc-build.md`](./mlc-build.md)
- Companion ONNX postmortem: [`docs/postmortems/onnx-export.md`](./onnx-export.md)
- Build helper script: [`models/runs/bench/build_mlc.sh`](../../models/runs/bench/build_mlc.sh) (gitignored)
- Test page: [`client/app/training/mlc-test/page.tsx`](../../client/app/training/mlc-test/page.tsx)
- Test client: [`client/app/training/mlc-test/mlc-test-client.tsx`](../../client/app/training/mlc-test/mlc-test-client.tsx)
- Workspace (not in repo): `/tmp/mlc-workspace/`
- Compiled export (gitignored): `models/runs/mlc-export/`
- mlc-llm PR: <https://github.com/mlc-ai/mlc-llm/pull/3485>
- relax PR: <https://github.com/mlc-ai/relax/pull/346>
- Tracking issue (onnxruntime-genai Gemma 4 request): <https://github.com/microsoft/onnxruntime-genai/issues/2062>
