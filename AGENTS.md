# AGENTS.md

## Project Overview

WAVE is an AI-powered urge surfing companion for people in Substance Use Disorder (SUD) recovery. It guides patients through evidence-based urge surfing sessions (Marlatt's Mindfulness-Based Relapse Prevention protocol), personalized in real time by the patient's **current medication status**, **craving intensity**, and **trigger**. Over time it learns each patient's personal high-risk windows and fires **prophylactic notifications 15 minutes before a predicted craving**, intervening during the anticipation phase when patients still have executive function.

The product is a **Next.js web application** that runs in any modern browser. An optional **PWA layer** (installable, Service Worker, Web Push) is added on top for home-screen install, local notifications, and offline-capable sessions. There is **no native mobile (React Native / Expo) build in scope** — the roadmap is "better PWA," not "ship to the App Store." All specs live in `PRD.md` and this file.

## Repo Layout

- `client/` — Next.js 16 (App Router) + TypeScript + Tailwind v4 web app. This is the one and only product surface. `pnpm dev` runs here. Includes `app/` routes, Route Handlers under `app/api/`, typed domain models under `types/`, and (soon) prompt templates under `lib/prompts/`.
- `.agents/skills/`, `.claude/skills/` — Cursor / Claude Code agent skills (`domain-to-spec`, `scaffold-frontend`, `scaffold-backend`, `v0-prompt-crafter`, `demo-prep`, etc.). Do not edit these during feature work.
- `AGENTS.md` — This file. Shared instructions for every AI agent working in the repo.
- `PRD.md` — Product Requirements Document. The source of truth for what to build, the medication-aware prompt logic, and the tech stack.
- `README.md` — Human-facing quickstart.

There is intentionally no `web/`, `frontend/`, `backend/`, `mobile/`, or `supabase/` folder at the repo root. If you see references to those in older code or docs, they are stale — the app lives in `client/`.

## Setup Commands

### Web app (`client/`)

- Install: `cd client && pnpm install`
- Dev: `cd client && pnpm dev` (http://localhost:3000)
- Build: `cd client && pnpm build`
- Lint: `cd client && pnpm lint`
- Typecheck: `cd client && pnpm exec tsc --noEmit`
- Env: copy `client/.env.example` to `client/.env.local`. Required keys depend on which narration provider is selected — see `PRD.md > Tech Stack`. At minimum, set `NARRATION_PROVIDER` (`webllm | ollama | llamacpp | claude-fallback`). Only set `ANTHROPIC_API_KEY` if you are explicitly testing the scripted-fallback path, and only set `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SECRET_KEY` if you are working on the opt-in cross-device sync feature.

### PWA layer (optional, added when a feature needs it)

- Service Worker and Web App Manifest live under `client/app/` and `client/public/`.
- Web Push requires HTTPS (Vercel deploys satisfy this; locally use `next dev --experimental-https` or `ngrok`).
- Feature-detect everything. iOS Safari restricts Web Push to installed PWAs; always have an in-page fallback.

## Tech Stack

**What runs today:**
- Next.js 16 (App Router), TypeScript strict, Tailwind CSS v4
- Gemma 4 narration served by one of `NARRATION_PROVIDER`: `webllm` (in-browser via `@mlc-ai/web-llm`, WebGPU), `ollama` (localhost Ollama), `llamacpp` (server-side or WASM), or `claude-fallback` (Anthropic Claude — demo safety net only, never production)
- IndexedDB via `localforage` for session / medication / journal storage, with `localStorage` fallback
- Lottie for the wave animation
- Service Worker + Web Notifications / Web Push for prophylactic alerts (feature-detected; in-page reminder when unavailable)
- Supabase Postgres **opt-in only** for cross-device sync; off by default, RLS required

**Fine-tuning:**
- Unsloth + QLoRA on Gemma 4 E2B, trained on MBRP facilitator materials, MI transcripts, SAMHSA MAT guides, and synthetic clinical dialogues
- Exported to GGUF (for Ollama / llama.cpp / WASM) and `web-llm`-compatible weights (for in-browser)

**Out of scope:**
- React Native, Expo, iOS / Android native builds
- SQLCipher / on-device SQLite (browsers don't need it; IndexedDB is the primitive)
- Dedicated Python / FastAPI backend (`PRD.md > Backend Needed?` is `No`)

## Code Style

- TypeScript strict mode across `client/`. No `any` without a justification comment.
- Functional React components with hooks. No class components.
- Server components by default in the App Router; add `"use client"` only for interactivity (intake forms, wave animation, intensity slider, body-scan tap targets, PWA install prompt, notification permission flow).
- kebab-case for filenames, PascalCase for components, camelCase for functions and variables.
- Validate all user input with Zod at every API boundary (client submit + Route Handler re-validation).
- **Clinical copy lives in data, not in components.** Medication-aware prompts (`PRD.md > Medication-Aware Prompt Logic`) must be stored as structured prompt templates in `client/lib/prompts/` so a clinician can review them without reading React code.
- No single-letter variable names. No unexplained abbreviations.
- Every craving-rating, medication-status, and trigger field must be typed with a narrow union (from `client/types/models.ts`), not `string`.
- Feature-detect every browser capability before using it: `"serviceWorker" in navigator`, `"PushManager" in window`, `"gpu" in navigator`, etc. Never let a missing API break the session path.

## Testing Instructions

- Lint and type-check before committing: `cd client && pnpm lint && pnpm exec tsc --noEmit`.
- Add a manual test path to every PR that touches the session flow. Example format:
  1. Go to `/session`
  2. Tap 7/10, "took on time", "stress"
  3. Expect medication-acknowledgment text that references Suboxone working
  4. Drag slider to 2
  5. Expect post-session reflection citing the drop
- For PWA / Service Worker / notification work, include an **offline test** path:
  1. Load the app once (so the Service Worker caches assets)
  2. Open DevTools → Network → "Offline"
  3. Reload, start a session, verify the scripted fallback narration plays
  4. Confirm zero network requests are made during the session
- Do not add automated tests that hit the Anthropic API or any cloud LLM in CI. Mock the Route Handler response.

## Security Considerations

- **Never store or log raw medication photos.** Process them client-side in-memory via a WebGPU / WASM vision model (or `<canvas>` OCR) and discard. Do not upload them to any endpoint.
- Never hardcode API keys. Any key (e.g. `ANTHROPIC_API_KEY` for the fallback, `SUPABASE_SECRET_KEY` for opt-in sync) lives only in `client/.env.local`. `.env.local` is in `.gitignore`.
- Craving logs, medication logs, and journal entries are **protected-health-information-adjacent**. Treat them as PHI-like even though the app is not a covered entity: no third-party analytics, no error-tracking payloads containing user text, no shipping logs off-device without explicit opt-in.
- If and when cross-device sync lands, Supabase tables must enable Row Level Security and scope every row to the authenticated user. Default state of sync is **disabled**.
- Ask the user before destructive database operations, large refactors of the session flow, or adding any new network request to the session experience. **The session path must stay zero-network after initial page load; keep the session network surface minimal.**

## PR Instructions

- Title format: `[feature|fix|chore|clinical] Short description`. Use `clinical` for changes to prompt templates, medication logic, or session copy.
- Run lint and typecheck before committing. Fix any errors you introduced.
- Keep diffs small and focused. Split prompt-copy changes from code changes where possible so clinicians can review prompt PRs without noise.
- Every PR that changes session prompts must link the MBRP / SAMHSA / FDA source that justifies the new copy, or cite the synthetic clinical dialogue in the training set.
- Include a manual test path in the PR description (see Testing Instructions).
- For any change that touches the Service Worker, Web Push, or the narration provider switch, include the **offline test path** above.

## Domain Constraints

- **MBRP fidelity**: Session structure must preserve Marlatt's Mindfulness-Based Relapse Prevention flow — intake, acknowledgment, body scan, wave (rise / peak / fall), reflection, next-step prompt. Do not collapse or reorder these phases without clinical review.
- **Trauma-informed, non-judgmental tone**: Never use toxic-positivity phrasing ("You've got this!", "Stay strong!") and never imply the patient has failed. If the patient missed a dose or used, the response must normalize and redirect, never shame.
- **Medication accuracy**: All pharmacology statements (half-lives, trough windows, receptor effects) must match FDA labels and SAMHSA MAT guidance. The canonical medication→prompt logic map lives in `PRD.md > Medication-Aware Prompt Logic`. Any change to medication copy requires a citation.
- **Not medical advice**: The app is a support tool, not a prescriber. Never tell a patient to start, stop, or change a medication. "Take your medication if available" is acceptable; "You should increase your dose" is not.
- **Crisis handoff**: If a patient indicates active suicidality, overdose risk, or that they have already used a potentially lethal amount, the app must surface the 988 Suicide & Crisis Lifeline and SAMHSA's National Helpline (1-800-662-HELP) before continuing the session.
- **Offline-capable session path**: Once the page and (if using `webllm`) the model weights are cached, the session must work with no network. Always have a scripted local fallback.
- **Privacy floor**: No account required to use the app. No third-party analytics in the session flow. Opt-in only for any data export to a clinician (local file download), and opt-in only for cross-device Supabase sync.
