# WAVE Client

Next.js 16 web demo for WAVE, an offline-first, medication-aware urge surfing companion.

## Getting Started

Install dependencies and run the development server:

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Current Runtime Shape

- The session generates five meditation chunks locally with Gemma and falls back to `lib/prompts/fallback-bank.ts` if model output fails validation twice.
- The adaptive check-in chat streams Gemma text through `ai` + `@browser-ai/transformers-js` and ends the conversation with a Zod-validated `endConversation` tool.
- Reflection and `/insights` regeneration still call Gemma 4 E2B-it locally through the direct `@huggingface/transformers` boundary.
- Model weights are cached by the browser after first load; WebGPU is used when available.
- The final target adds LoRA adapters on top of this local Gemma boundary, with no LLM network calls during inference.

Copy `.env.local.example` to `.env.local` and set `NEXT_PUBLIC_TRAINING_ENABLED=true` only when you want the developer training UI visible.

## Useful Commands

```bash
pnpm dev
pnpm build
pnpm lint
pnpm exec tsc --noEmit
pnpm test:gemma:tools:live
```

`pnpm test:gemma:tools:live` downloads the Gemma ONNX weights on first run and
caches them under `client/.cache/transformers/` for reuse. The cache folder is
gitignored.

## Performance — Gemma 4 E2B on the Web

Three models run in the browser alongside each other: Whisper (STT), Gemma 4 E2B (LLM), Kokoro (TTS). The web runtime is `@huggingface/transformers` v3 (transformers.js) on WebGPU. Optimizations are ranked by impact.

### High impact
- **Encoder stripping happens at export time, not runtime.** The client loads from `Maelstrome/lora-wave-session-r32-onnx`, a text-only q4f16 export of our fine-tuned Gemma 4 E2B. Produced by `models/export_text_onnx.py` from the merged-16bit safetensors. The repo contains only `decoder_model_merged_q4f16.onnx` + `embed_tokens_q4f16.onnx` — no vision or audio encoder weights to download (~270 MB saved vs the upstream multimodal ONNX repo).
- **Use the `q4f16` ONNX variant** with the WebGPU `shader-f16` feature enabled. INT4 weights + f16 math is the WebGPU sweet spot. Feature-detect `shader-f16` and fall back to `q4` only if unavailable.
- **Pre-warm at app load** with a dummy 1-token generate behind a loading splash. First call pays shader compile + weight upload (2–8s on iPhone Safari); after warmup TTFT drops to a few hundred ms. Never unload mid-session.
- **Stream tokens into Kokoro at the first sentence boundary** (`.`/`?`/`!`, or ~15 tokens, whichever first). Perceived latency is gated by TTS start, not full LLM completion.
- **Prefix-cache the system prompt.** Reuse the cached prefix across turns. Every 100 prompt tokens is ~200–500ms of mobile prefill.
- **Kokoro runs at fp16 + WebGPU by default** (~165 MB vs ~330 MB at fp32, no perceptible quality loss). See `KOKORO_RUNTIME_OPTIONS` in `lib/voice/types.ts` for q8/q4f16/q4 experimental options. q4 has audible artifacts on prosody — don't ship it as default for the meditation voice.
- **Defensive `<|think|>` filter** runs on every Gemma generation (`stripThinking` in `lib/gemma/local-runtime.ts`). The fine-tune's chat template defaults `enable_thinking=false`, but training data may have contained reasoning traces, so the client strips any stray `<|think|>...</|think|>` blocks before they reach the UI or TTS.

### Medium impact
- **Keep context tight (<512 tokens) to stay in Gemma 4's local sliding-window path.** The 128K context is irrelevant for voice turns and costs KV cache memory. Don't ship long histories.
- **INT8 KV cache** when the runtime exposes it.
- **Disable thinking mode** (`<|think|>`) — it burns tokens before producing user-facing output and kills TTFT.
- **Run each model on a different compute path** to avoid contention: Whisper on WASM-SIMD CPU (Web Worker), Gemma on WebGPU, Kokoro on WASM. Never put two models on WebGPU simultaneously — context switches tank throughput.
- **OffscreenCanvas + Web Worker** for Gemma so STT/TTS don't jank the main thread.
- **OPFS** (Origin Private File System) for the weight cache — faster than IndexedDB and avoids Safari quota prompts.
- **COOP/COEP headers** for `SharedArrayBuffer` so Whisper can use multi-threaded WASM.

### Runtime watch-list
- `litert-community/gemma-4-E2B-it-litert-lm` — once MediaPipe ships a `.task` wrapper, switching runtimes is typically 20–40% faster than transformers.js.

### Don't bother
- WebGL fallback for LLM — show an unsupported message instead.
- Q4_K_M / k-quants — WebGPU runtimes don't accelerate them; stick to plain INT4 group-quant.
- Manual PLE offload — no web runtime exposes Per-Layer Embedding offload in 2026.
- Speculative decoding — not shipping in any browser runtime yet.
- llama.cpp WASM as the primary runtime — CPU-only, ~2–4 tok/s.

See the root `README.md`, `AGENTS.md`, `PRD.md`, and `docs/models.md` for the product and model contracts.
