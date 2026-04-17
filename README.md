# WAVE

An offline-capable, medication-aware urge surfing companion for SUD recovery — shipped as a **Next.js web app** (with an optional PWA layer), not a native mobile app.

- **Cursor / Claude Code skills** live under `.agents/skills/` and `.claude/skills/`.
- **WAVE web app** lives under `clients/` (Next.js 16 + TypeScript + Tailwind v4).
- **Specs** live at the repo root — see `AGENTS.md` (agent instructions, tech stack, code style, domain constraints) and `PRD.md` (user flow, pages, data model, medication-aware prompt logic).

## Run the web app

```bash
cd clients
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Navigate between **Home**, **Onboarding**, **Session**, **Dashboard**, **History**, and **Insights** from the top nav.

The scaffold is intentionally a stub — each page renders its PRD-defined layout with placeholder content. Flesh out features one at a time using the `feature-builder` skill. The medication-aware prompt assembler (`PRD.md > Medication-Aware Prompt Logic`) is the clinical core and the recommended first feature.

## Narration providers

Gemma 4 narration is swappable via `NARRATION_PROVIDER` in `clients/.env.local`:

- `webllm` — in-browser Gemma 4 via WebGPU (`@mlc-ai/web-llm`). Zero network in the session path.
- `ollama` — local Ollama at `http://localhost:11434`. Good for dev and for a laptop-hosted demo.
- `llamacpp` — llama.cpp (server binary, WASM build, or embedded).
- `claude-fallback` — Anthropic Claude. **Demo safety net only**, never production.

The Route Handler at `clients/app/api/session/narrate` switches between them. `webllm` bypasses it entirely.

## PWA (optional, added when needed)

The app is a standard Next.js web app first. A PWA layer (Service Worker, Web App Manifest, Web Push) is added only when a feature requires it — e.g. prophylactic notifications, offline sessions, install-to-home-screen. There is no React Native / Expo / native mobile build in scope.

## Docs

- **`AGENTS.md`** — shared instructions every AI coding tool (Cursor, Claude Code, Codex, Copilot, etc.) reads automatically.
- **`PRD.md`** — source of truth for what to build. Every scaffold, route, and prompt is derived from it.
- **`clients/.cursor/rules/frontend-guardrails.mdc`** — frontend guardrails scoped to `clients/`.
