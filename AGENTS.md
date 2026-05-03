# AGENTS.md

## Project Overview

WAVE is an AI-powered urge surfing companion for people in Substance Use Disorder (SUD) recovery. It guides patients through evidence-based urge surfing sessions (Marlatt's Mindfulness-Based Relapse Prevention protocol), personalized in real time by the patient's **current medication status**, **craving intensity**, and **trigger**. Over time it learns each patient's personal high-risk windows and fires **prophylactic notifications 15 minutes before a predicted craving**, intervening during the anticipation phase when patients still have executive function.

The production vision is a **React Native mobile app** that runs **Gemma 4 entirely on-device** with all data stored locally (encrypted SQLite). The hackathon deliverable is a **Next.js web demo** in `client/` that showcases the session UX, medication-aware prompting, and pattern dashboard. Both surfaces read from the same PRD in `PRD.md`.

## Repo Layout

- `client/` — Next.js 16 (App Router) + TypeScript + Tailwind v4 web demo. This is the active hackathon surface and what `pnpm dev` / `npm run dev` runs. Includes `app/` routes, scripted session chunks, the multi-turn check-in UI, dashboard/history/insights pages, and developer-only training screens.
- `supabase/migrations/` — historical SQL migrations for an earlier demo storage path. The current checked-in web demo uses mock data / local UI state; production mobile replaces this with encrypted on-device SQLite.
- `.agents/skills/`, `.claude/skills/` — Cursor / Claude Code agent skills (`domain-to-spec`, `scaffold-frontend`, `scaffold-backend`, `v0-prompt-crafter`, `demo-prep`, etc.). Do not edit these during feature work.
- `frontend/`, `backend/`, `web/`, `clients/` — Legacy or stale paths. Do not use. The live app is in `client/`.
- `AGENTS.md` — This file. Shared instructions for every AI agent working in the repo.
- `PRD.md` — Product Requirements Document. The source of truth for what to build and the medication-aware prompt logic.
- `README.md` — Human-facing quickstart.

## Setup Commands

### Web demo (`client/`)

- Install: `cd client && pnpm install`
- Dev: `cd client && pnpm dev` (http://localhost:3000)
- Build: `cd client && pnpm build`
- Lint: `cd client && pnpm lint`
- Env: copy `client/.env.local.example` to `client/.env.local`. `NEXT_PUBLIC_TRAINING_ENABLED=true` exposes the developer-only training UI.

### Local Gemma runtime

The checked-in web demo now routes model-backed surfaces through `client/lib/gemma/*` and the local Transformers.js runtime:

- Runtime: [client/lib/gemma/local-runtime.ts](client/lib/gemma/local-runtime.ts) loads `onnx-community/gemma-4-E2B-it-ONNX` with `@huggingface/transformers` for JSON surfaces and `@browser-ai/transformers-js` + `ai` for streamed check-in tool calls, using `q4f16`, WebGPU when available, and browser cache persistence.
- Check-in chat: [client/lib/gemma/checkin.ts](client/lib/gemma/checkin.ts) calls local Gemma through AI SDK `streamText()`, streams patient-facing text into the chat bubble, and maps the Zod-validated `endConversation` tool to the existing readiness signal.
- Chunk narration: [client/lib/gemma/chunk.ts](client/lib/gemma/chunk.ts) calls local Gemma for each of the five meditation chunks and falls back to clinician-reviewed local copy after two invalid attempts.
- Reflection: [client/lib/gemma/session.ts](client/lib/gemma/session.ts) calls local Gemma for the final structured reflection while preserving validation + fallback semantics.
- Insights regeneration: [client/app/insights/page.tsx](client/app/insights/page.tsx) calls local Gemma directly and validates the returned insight cards.
- Fallback bank: `client/lib/prompts/fallback-bank.ts` holds local fallbacks for chunks, check-ins, and reflection.

The intake safety screen, fallback bank, and crisis-routing rules remain rule-based and never trust a model decision.

### Mobile (future, not in this repo yet)

- React Native + Expo, Gemma 4 E2B via LiteRT, SQLite with SQLCipher. See `PRD.md > Tech Stack (Production)`.

## Tech Stack

**Hackathon web demo (current checked-in implementation):**
- Next.js 16 (App Router), TypeScript strict, Tailwind CSS v4
- **Final runtime target:** one Gemma 4 E2B-it (INT4) base + small LoRA adapters running in the browser via `@huggingface/transformers` + WebGPU. The settled MVP model plan is one LoRA per check-in surface (`lora-check-in-1` through `lora-check-in-5`) plus `lora-reflection`; meditation chunks are generated locally by Gemma with schema validation and a clinician-reviewed local fallback bank. Per-model reference: `docs/models.md`. Training process: `docs/model-training.md`.
- **Current local runtime:** chunk narration, reflection, and insights regeneration call Gemma 4 E2B-it through `@huggingface/transformers` in the browser. Check-in chat uses AI SDK `streamText()` with `@browser-ai/transformers-js` so text streams as it is generated and the conversation ends through an app-validated `endConversation` tool. The remaining production gap is loading the LoRA adapters on top of the base model.
- **Synthetix** pipeline (developer-only, not shipped to users) produces each LoRA's training set in a small loop: (1) small human-written seed set → (2) Gemma expands it into `N` synthetic examples → (3) clinician spot-checks a sample in a small UI and leaves feedback on anything wrong → (4) regenerate with that feedback until a spot-check passes clean. Then an 80 / 20 stratified train / test split, **one** QLoRA run (Unsloth + TRL) on the train split, and a simple four-check eval harness on the test split (JSON validity, safety lexicon, surface invariants, latency). Source of truth: `client/synthetix/`.
- **Crisis triage runs on base Gemma with no LoRA** — the safety boundary that must never be fine-tuned. Routing to 988 / SAMHSA / local emergency is rule-based and never trusted to the model.
- Mock data / local UI state for the web demo's dashboard, history, and insights defaults
- CSS/Tailwind wave animation and an ambient audio bed during the session
- Scripted local fallback bank as the single fallback when local Gemma fails to load or output fails validation twice

**Production mobile (roadmap):**
- React Native (iOS + Android), Expo
- Gemma 4 E2B via LiteRT (on-device LLM), loading the **same LoRA stack** the web demo uses. Runtime LoRA selection stays rule-based; only the inference backend changes.
- Gemma 4 multimodal (on-device medication photo identification) with its own LoRA, trained by the same Synthetix pipeline.
- SQLite with SQLCipher (encrypted local DB)
- iOS/Android local notification schedulers
- Unsloth + TRL + QLoRA fine-tuning, one LoRA per clinical situation, trained on Synthetix-generated synthetic datasets (seeded by MBRP facilitator materials, MI transcripts, SAMHSA MAT guides, and FDA labels) with a mandatory clinician-review gate.

## Code Style

- TypeScript strict mode across `client/`. No `any` without a justification comment.
- Functional React components with hooks. No class components.
- Server components by default in the App Router; add `"use client"` only for interactivity (intake forms, wave animation, check-in chat).
- kebab-case for filenames, PascalCase for components, camelCase for functions and variables.
- Validate all user input with Zod at every API boundary.
- **Clinical behavior lives in data, not in components.** Both medication-aware **prompt templates** (stored under `client/lib/prompts/` so a clinician can review them without reading React) and the **LoRA adapters** that encode fine-tuned behavior are treated as first-class reviewable artifacts. Each LoRA has a typed stack-array spec under `client/synthetix/stacks/`, a rubric under `client/synthetix/rubric/`, and an entry in the adapter manifest (`client/lib/gemma/adapter-manifest.ts`) with its clinician approver, dataset hash, and eval scores.
- No single-letter variable names. No unexplained abbreviations.
- Every craving-rating, medication-status, and trigger field must be typed with a narrow union (not `string`).

## Testing Instructions

- Lint and type-check before committing: `cd client && pnpm lint && pnpm exec tsc --noEmit`.
- Add a manual test path to every PR that touches the session flow. Example format:
  1. Go to `/session`
  2. Tap 7/10, "took on time", "stress"
  3. Expect medication-acknowledgment text that references Suboxone working
  4. Drag slider to 2
  5. Expect post-session reflection citing the drop
- Do not add automated tests that download the Gemma 4 weights or hit any remote LLM in CI. Mock the `client/lib/gemma/*` boundaries (`streamCheckInTurn()`, `generateReflection()`, `generateChunk()`) and test prompt assembly + Zod validation against fixtures.

## Security Considerations

- **Never store or log raw medication photos.** In the production mobile app the photo must be processed in-memory by on-device vision and discarded. In the web demo, do not upload photos to Supabase — if a demo photo feature is added, process it client-side only.
- Never hardcode API keys. The session path must not require LLM provider keys. `.env.local` is in `.gitignore`.
- Craving logs, medication logs, and journal entries are **protected-health-information-adjacent**. Treat them as PHI-like even though the app is not a covered entity: no third-party analytics, no error-tracking payloads containing user text, no shipping logs off-device without explicit opt-in.
- If Supabase persistence is reintroduced, tables must enable Row Level Security and scope every row to the authenticated user. See `.claude/skills/supabase-postgres-best-practices/SKILL.md`.
- Ask the user before destructive database operations, large refactors of the session flow, or adding any new network request to the session experience. **The final session path must make zero LLM network calls on both mobile and the web demo.**

## PR Instructions

- Title format: `[feature|fix|chore|clinical] Short description`. Use `clinical` for changes to prompt templates, medication logic, or session copy.
- Run lint and typecheck before committing. Fix any errors you introduced.
- Keep diffs small and focused. Split prompt-copy changes from code changes where possible so clinicians can review prompt PRs without noise.
- Every PR that changes session prompts must link the MBRP / SAMHSA / FDA source that justifies the new copy, or cite the synthetic clinical dialogue in the training set.
- Every PR that ships or updates a LoRA adapter must satisfy the ship gates in `docs/model-training.md > Ship gates`: (a) bump the adapter's `version` + `sha256` in `client/lib/gemma/adapter-manifest.ts`, (b) point at the Synthetix run ID under `client/synthetix/runs/<lora-id>/<run-id>/` that produced its training data, (c) include the spot-check log from that run showing `pass: true` with zero flagged problems, (d) include the eval report from `eval.json` in that run showing `pass: true` on the held-out 20 % test split (JSON validity ≥ 98 %, safety lexicon 100 %, surface invariants 100 %, p95 latency under budget), and (e) name the clinician whose initials are on the clean spot-check. Never ship a LoRA for crisis triage — that surface is base-only on purpose; see `docs/models.md > Not fine-tuned — base model only`.
- Include a manual test path in the PR description (see Testing Instructions).

## Domain Constraints

- **MBRP fidelity**: Session structure must preserve Marlatt's Mindfulness-Based Relapse Prevention flow — intake, acknowledgment, body scan, wave (rise / peak / fall), reflection, next-step prompt. Do not collapse or reorder these phases without clinical review.
- **Trauma-informed, non-judgmental tone**: Never use toxic-positivity phrasing ("You've got this!", "Stay strong!") and never imply the patient has failed. If the patient missed a dose or used, the response must normalize and redirect, never shame.
- **Medication accuracy**: All pharmacology statements (half-lives, trough windows, receptor effects) must match FDA labels and SAMHSA MAT guidance. The canonical medication→prompt logic map lives in `PRD.md > Medication-Aware Prompt Logic`. Any change to medication copy requires a citation.
- **Not medical advice**: The app is a support tool, not a prescriber. Never tell a patient to start, stop, or change a medication. "Take your medication if available" is acceptable; "You should increase your dose" is not.
- **Crisis handoff**: Safety routing has **two** rule-based checkpoints, neither of which is ever delegated to a LoRA or LLM decision:
  1. **Intake safety screen, before any LoRA runs.** Immediately after the three-tap intake, the session presents two sequential yes/no questions: Q1 "Have you used any substances today?" and, only if Q1 is yes, Q2 "Are you feeling physically unwell, dizzy, or having trouble breathing right now?". Both-yes → skip the session entirely and render the safety handoff screen with SAMHSA National Helpline **1-800-662-HELP (1-800-662-4357)** and the line "If you have a therapist or social worker, reach out to them now." Q1=yes, Q2=no → continue the session but record `usedSubstanceToday: true` on the session row so the reflection phase can reference it. Q1=no → Q2 never shows. This screen exists because a keyword scan on the end-of-session journal text is too late for a patient who opens the app already in medical distress.
  2. **In-session crisis signals.** If a patient later indicates active suicidality, overdose risk, or that they have already used a potentially lethal amount, the app must surface the **988 Suicide & Crisis Lifeline** and **SAMHSA's National Helpline (1-800-662-HELP)** before continuing the session, routed through the base-model-only crisis triage surface documented in `docs/models.md > Not fine-tuned — base model only`.
- **Offline-first (everywhere)**: The final session path must make **zero LLM network requests** on both mobile and the web demo. Mobile runs Gemma 4 E2B via LiteRT; the web demo runs Gemma 4 E2B via transformers.js + WebGPU. The one scripted narration bank in `client/lib/prompts/` is the single fallback when WebGPU is unavailable or Gemma output fails Zod validation twice.
- **Privacy floor**: No account required to use the app. No third-party analytics in the session flow. Opt-in only for any data export to a clinician, and exports must be local files (PDF/JSON) the patient chooses to share.

## Learned User Preferences

- When editing prompt templates under `client/lib/prompts/`, preserve clinical content verbatim and only tighten structural/voice work; never alter pharmacology, citations, or safety copy without a fresh citation.
- Mock datasets that drive visualizations (e.g., the dashboard heatmap) should be dense enough that almost every cell shows data — leave at most 1-2 cells deliberately blank rather than rendering a sparse grid.
- Every LLM-touching feature must go through a `client/lib/gemma/*` boundary so runtime swaps stay localized.

## Learned Workspace Facts

- `models/` is the repo's ad-hoc Python experiment area for Gemma smoke tests. It supports both `uv` (via `models/pyproject.toml` + `models/.python-version`, venv at `models/.venv/`) and conda (via `models/environment.yml`, env name `wave-models`) — both produce the same Python 3.11 environment. **`pyproject.toml` is the single source of truth for the dependency list; `environment.yml` is auto-generated by `models/sync_env.py` and carries an `# AUTO-GENERATED` header.** When changing deps, edit `pyproject.toml`, run `uv run python sync_env.py` (or `python sync_env.py` from a conda env), and commit `pyproject.toml`, `uv.lock`, and `environment.yml` together. Never hand-edit `environment.yml`.
- The active web demo lives in `client/` (lowercase, renamed from `clients/` via `git mv`); any older `web/` or `clients/` paths in docs are stale.
- `client/lib/data/mock-sessions.ts` is the single source of truth for mock session data; the dashboard, history, and insights pages must consume `MOCK_SESSIONS` and its derived aggregators (`MOCK_SESSION_STATS`, `MOCK_RISK_GRID`, `MOCK_WEEK_SUMMARY`, `MOCK_RECENT_SESSIONS`, `STATIC_INSIGHTS`) from it instead of redefining local constants.
- Prompt templates in `client/lib/prompts/` use XML-style tagged sections (`<role>`, `<voice>`, `<never>`, `<output>` in system prompts; `<situation>` / `<clinical_source>` / `<citation_required>` in user turns) so the same prompts run portably on Gemma 4 E2B-it and any future runtime wrapper.
- The insights regenerate flow lives in `client/app/insights/page.tsx` and calls `generateGemmaInsights()` from the local runtime.
- The `sessions` array on insights/regen requests is capped at 200 in `client/lib/prompts/schemas.ts`; expanding the mock dataset past that cap requires bumping the schema first.
