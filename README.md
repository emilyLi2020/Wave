# WAVE

An offline-first, medication-aware urge surfing companion for SUD recovery.

- **Cursor / Claude Code skills** live under `.agents/skills/` and `.claude/skills/`.
- **WAVE web demo** lives under `client/` (Next.js 16 + TypeScript + Tailwind v4).
- **Specs** live at the repo root — see `AGENTS.md` (agent instructions, tech stack, code style, domain constraints) and `PRD.md` (user flow, pages, data model, medication-aware prompt logic).

## Run the web demo

```bash
cd client
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Navigate between **Home**, **Onboarding**, **Session**, **Dashboard**, **History**, **Insights**, and the developer-only **Training** screens from the top nav.

The active demo is in `client/`. The session flow currently uses scripted meditation chunks, a multi-turn check-in chat, and a reflection card. Until the in-browser Gemma + LoRA runtime lands, check-ins, reflection, and insight regeneration use temporary `gpt-5-mini` route handlers behind the `client/lib/gemma/*` boundaries; chunks are served from the local fallback bank.

## Docs

- **`AGENTS.md`** — shared instructions every AI coding tool (Cursor, Claude Code, Codex, Copilot, etc.) reads automatically.
- **`PRD.md`** — source of truth for what to build. Every scaffold, route, and prompt is derived from it.
- **`docs/models.md`** — per-model reference: the Gemma 4 base, every LoRA adapter, what each one is fine-tuned for, where it is used in the product, and its input/output contract.
- **`docs/model-training.md`** — how we produce every LoRA: data collection, Synthetix synthetic-data pipeline, clinician spot-check, train/test split, QLoRA training recipe, eval harness, and ship gates.
- **`client/.cursor/rules/frontend-guardrails.mdc`** — frontend guardrails scoped to `client/`.
