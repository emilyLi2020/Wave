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

See the root `README.md`, `AGENTS.md`, `PRD.md`, and `docs/models.md` for the product and model contracts.
