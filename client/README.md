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

- The session uses five scripted meditation chunks from `lib/prompts/fallback-bank.ts`.
- The adaptive check-in chat calls temporary `gpt-5-mini` scaffolding through `/api/checkin`.
- The reflection screen calls temporary `gpt-5-mini` scaffolding through `/api/narrate/reflection`.
- The `/insights` regenerate button calls temporary `gpt-5-mini` scaffolding through `/api/insights`.
- The final target is in-browser Gemma 4 E2B-it + LoRAs via `@huggingface/transformers` + WebGPU, with no LLM network calls.

Copy `.env.local.example` to `.env.local` and set `OPENAI_API_KEY` for the temporary routes. Set `NEXT_PUBLIC_TRAINING_ENABLED=true` only when you want the developer training UI visible.

## Useful Commands

```bash
pnpm dev
pnpm build
pnpm lint
pnpm exec tsc --noEmit
```

See the root `README.md`, `AGENTS.md`, `PRD.md`, and `docs/models.md` for the product and model contracts.
