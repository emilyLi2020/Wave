# AGENTS.md

## Project Overview

WAVE is an AI-powered urge surfing companion for people in Substance Use Disorder (SUD) recovery. It guides patients through evidence-based urge surfing sessions (Marlatt's Mindfulness-Based Relapse Prevention protocol), personalized in real time by the patient's **current medication status**, **craving intensity**, and **trigger**. Over time it learns each patient's personal high-risk windows and fires **prophylactic notifications 15 minutes before a predicted craving**, intervening during the anticipation phase when patients still have executive function.

The production vision is a **React Native mobile app** that runs **Gemma 4 entirely on-device** with all data stored locally (encrypted SQLite). The hackathon deliverable is a **Next.js web demo** in `web/` that showcases the session UX, medication-aware prompting, and pattern dashboard. Both surfaces read from the same PRD in `PRD.md`.

## Repo Layout

- `web/` — Next.js 15 (App Router) + TypeScript + Tailwind v4 web demo. This is the active hackathon surface and what `pnpm dev` / `npm run dev` runs. Includes `src/app` routes and Supabase client wiring. **All LLM inference runs in the browser via Gemma 4 E2B-it on WebGPU — no server-side LLM call exists in this repo.**
- `supabase/migrations/` — SQL migrations for the demo's Supabase project (session logs, medication logs, journal entries). Production mobile app replaces this with encrypted on-device SQLite.
- `.agents/skills/`, `.claude/skills/` — Cursor / Claude Code agent skills (`domain-to-spec`, `scaffold-frontend`, `scaffold-backend`, `v0-prompt-crafter`, `demo-prep`, etc.). Do not edit these during feature work.
- `frontend/`, `backend/` — Empty legacy folders. Do not use. The live app is in `web/`.
- `AGENTS.md` — This file. Shared instructions for every AI agent working in the repo.
- `PRD.md` — Product Requirements Document. The source of truth for what to build and the medication-aware prompt logic.
- `README.md` — Human-facing quickstart.

## Setup Commands

### Web demo (`web/`)

- Install: `cd web && npm install`
- Dev: `cd web && npm run dev` (http://localhost:3000)
- Build: `cd web && npm run build`
- Lint: `cd web && npm run lint`
- Env: copy `web/.env.example` to `web/.env.local` and set `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY`. **No LLM API key is required** — inference runs in-browser on Gemma 4 E2B via WebGPU.
- Database: run `supabase/migrations/001_wave_tables.sql` once in the Supabase SQL editor (or via the Supabase CLI).

### Mobile (future, not in this repo yet)

- React Native + Expo, Gemma 4 E2B via LiteRT, SQLite with SQLCipher. See `PRD.md > Tech Stack (Production)`.

## Tech Stack

**Hackathon web demo (Gemma end-to-end — what runs today):**
- Next.js 15 (App Router), TypeScript strict, Tailwind CSS v4
- **One Gemma 4 E2B-it (INT4) base + a stack of small LoRA adapters — one LoRA per clinical situation.** The base and the adapters run in the browser via `@huggingface/transformers` (transformers.js) + WebGPU. An Adapter Manager hot-swaps LoRAs per session phase. No server-side LLM, no cloud LLM, no API key. See `docs/gemma-4-integration.md`.
- **Synthetix** pipeline (developer-only, not shipped to users) produces each LoRA's training set in a small loop: (1) small human-written seed set → (2) Gemma expands it into `N` synthetic examples → (3) clinician spot-checks a sample in a small UI and leaves feedback on anything wrong → (4) regenerate with that feedback until a spot-check passes clean. Then an 80 / 20 stratified train / test split, **one** QLoRA run (Unsloth + TRL) on the train split, and a simple four-check eval harness on the test split (JSON validity, safety lexicon, surface invariants, latency). Source of truth: `clients/synthetix/`.
- **Crisis triage runs on base Gemma with no LoRA** — the safety boundary that must never be fine-tuned. Routing to 988 / SAMHSA / local emergency is rule-based and never trusted to the model.
- Supabase Postgres (stand-in for encrypted on-device SQLite) for session/medication/journal logs
- Lottie for the wave animation
- Scripted local narration bank as the single fallback when WebGPU is unavailable or a model call fails Zod validation twice

**Production mobile (roadmap):**
- React Native (iOS + Android), Expo
- Gemma 4 E2B via LiteRT (on-device LLM), loading the **same LoRA stack** the web demo uses. The Adapter Manager contract (`clients/lib/gemma/adapter-manager.ts`) is runtime-agnostic; only the inference backend changes.
- Gemma 4 multimodal (on-device medication photo identification) with its own LoRA, trained by the same Synthetix pipeline.
- SQLite with SQLCipher (encrypted local DB)
- iOS/Android local notification schedulers
- Unsloth + TRL + QLoRA fine-tuning, one LoRA per clinical situation, trained on Synthetix-generated synthetic datasets (seeded by MBRP facilitator materials, MI transcripts, SAMHSA MAT guides, and FDA labels) with a mandatory clinician-review gate.

## Code Style

- TypeScript strict mode across `web/`. No `any` without a justification comment.
- Functional React components with hooks. No class components.
- Server components by default in the App Router; add `"use client"` only for interactivity (intake forms, wave animation, intensity slider, body-scan tap targets).
- kebab-case for filenames, PascalCase for components, camelCase for functions and variables.
- Validate all user input with Zod at every API boundary.
- **Clinical behavior lives in data, not in components.** Both medication-aware **prompt templates** (stored under `clients/lib/prompts/` so a clinician can review them without reading React) and the **LoRA adapters** that encode fine-tuned behavior are treated as first-class reviewable artifacts. Each LoRA has a typed stack-array spec under `clients/synthetix/stacks/`, a rubric under `clients/synthetix/rubric/`, and an entry in the adapter manifest (`clients/lib/gemma/adapter-manifest.ts`) with its clinician approver, dataset hash, and eval scores.
- No single-letter variable names. No unexplained abbreviations.
- Every craving-rating, medication-status, and trigger field must be typed with a narrow union (not `string`).

## Testing Instructions

- Lint and type-check before committing: `cd web && npm run lint && npx tsc --noEmit`.
- Add a manual test path to every PR that touches the session flow. Example format:
  1. Go to `/session`
  2. Tap 7/10, "took on time", "stress"
  3. Expect medication-acknowledgment text that references Suboxone working
  4. Drag slider to 2
  5. Expect post-session reflection citing the drop
- Do not add automated tests that download the Gemma 4 weights or hit any remote LLM in CI. Mock `generateJSON<T>()` in `clients/lib/gemma/session.ts` and test the prompt-assembly + Zod-validation paths against fixtures.

## Security Considerations

- **Never store or log raw medication photos.** In the production mobile app the photo must be processed in-memory by on-device vision and discarded. In the web demo, do not upload photos to Supabase — if a demo photo feature is added, process it client-side only.
- Never hardcode API keys. `SUPABASE_SECRET_KEY` lives only in `web/.env.local`. `.env.local` is in `.gitignore`. There is no LLM API key anywhere in the repo — Gemma 4 runs in the browser.
- Craving logs, medication logs, and journal entries are **protected-health-information-adjacent**. Treat them as PHI-like even though the app is not a covered entity: no third-party analytics, no error-tracking payloads containing user text, no shipping logs off-device without explicit opt-in.
- The web demo's Supabase tables must enable Row Level Security and scope every row to the authenticated user. See `.claude/skills/supabase-postgres-best-practices/SKILL.md`.
- Ask the user before destructive database operations, large refactors of the session flow, or adding any new network request to the session experience. **The session path must make zero LLM network calls on both mobile and the web demo.** The only network traffic allowed in the session flow is the one-time Gemma 4 weight download (cached in IndexedDB) and opt-in Supabase writes after the session ends.

## PR Instructions

- Title format: `[feature|fix|chore|clinical] Short description`. Use `clinical` for changes to prompt templates, medication logic, or session copy.
- Run lint and typecheck before committing. Fix any errors you introduced.
- Keep diffs small and focused. Split prompt-copy changes from code changes where possible so clinicians can review prompt PRs without noise.
- Every PR that changes session prompts must link the MBRP / SAMHSA / FDA source that justifies the new copy, or cite the synthetic clinical dialogue in the training set.
- Every PR that ships or updates a LoRA adapter must (a) bump the adapter's `version` + `sha256` in `clients/lib/gemma/adapter-manifest.ts`, (b) point at the Synthetix run ID under `clients/synthetix/runs/<lora-id>/<run-id>/` that produced its training data, (c) include the spot-check log from that run showing `pass: true` with zero flagged problems, (d) include the eval report from `eval.json` in that run showing `pass: true` on the held-out 20 % test split (JSON validity ≥ 98 %, safety lexicon 100 %, surface invariants 100 %, p95 latency under budget — see `docs/gemma-4-integration.md > §6.7`), and (e) name the clinician whose initials are on the clean spot-check. Never ship a LoRA for crisis triage — that surface is base-only on purpose.
- Include a manual test path in the PR description (see Testing Instructions).

## Domain Constraints

- **MBRP fidelity**: Session structure must preserve Marlatt's Mindfulness-Based Relapse Prevention flow — intake, acknowledgment, body scan, wave (rise / peak / fall), reflection, next-step prompt. Do not collapse or reorder these phases without clinical review.
- **Trauma-informed, non-judgmental tone**: Never use toxic-positivity phrasing ("You've got this!", "Stay strong!") and never imply the patient has failed. If the patient missed a dose or used, the response must normalize and redirect, never shame.
- **Medication accuracy**: All pharmacology statements (half-lives, trough windows, receptor effects) must match FDA labels and SAMHSA MAT guidance. The canonical medication→prompt logic map lives in `PRD.md > Medication-Aware Prompt Logic`. Any change to medication copy requires a citation.
- **Not medical advice**: The app is a support tool, not a prescriber. Never tell a patient to start, stop, or change a medication. "Take your medication if available" is acceptable; "You should increase your dose" is not.
- **Crisis handoff**: If a patient indicates active suicidality, overdose risk, or that they have already used a potentially lethal amount, the app must surface the 988 Suicide & Crisis Lifeline and SAMHSA's National Helpline (1-800-662-HELP) before continuing the session.
- **Offline-first (everywhere)**: The session path must make **zero LLM network requests** on both mobile and the web demo. Mobile runs Gemma 4 E2B via LiteRT; the web demo runs Gemma 4 E2B via transformers.js + WebGPU. The one scripted narration bank in `clients/lib/prompts/` is the single fallback when WebGPU is unavailable or a model output fails Zod validation twice.
- **Privacy floor**: No account required to use the app. No third-party analytics in the session flow. Opt-in only for any data export to a clinician, and exports must be local files (PDF/JSON) the patient chooses to share.
