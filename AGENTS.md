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

The checked-in web demo routes model-backed surfaces through `client/lib/gemma/*` and the local wllama (llama.cpp) runtime:

- Runtime: [client/lib/wllama/config.ts](client/lib/wllama/config.ts) is the single source of truth — the WAVE fine-tune ships as a merged Q4_K_M GGUF (`Maelstrome/lora-wave-session-r32`, 5 shards, ~3.2 GB) served via wllama (llama.cpp / WASM, WebGPU when available, browser-cached). All four model surfaces call it through [client/lib/gemma/wllama-generators.ts](client/lib/gemma/wllama-generators.ts). (ONNX + Transformers.js was attempted first and parked — see `docs/postmortems/onnx-export.md`.)
- Check-in chat: [client/lib/gemma/checkin.ts](client/lib/gemma/checkin.ts) calls the local fine-tune through wllama with `response_format: json_schema` — a single blocking generation returning `{ reply, endConversation }`. The `endConversation` field (NOT a native tool call) maps to the readiness signal; Kokoro TTS streams the reply audio sentence-by-sentence.
- Chunk narration: [client/lib/gemma/chunk.ts](client/lib/gemma/chunk.ts) calls local Gemma for each of the five meditation chunks and falls back to clinician-reviewed local copy after two invalid attempts.
- Reflection: [client/lib/gemma/session.ts](client/lib/gemma/session.ts) calls local Gemma for the final structured reflection while preserving validation + fallback semantics.
- Insights regeneration: [client/app/insights/page.tsx](client/app/insights/page.tsx) calls local Gemma directly and validates the returned insight cards.
- Voice test: [client/app/models/voice-test](client/app/models/voice-test) is a developer-only isolated test page for on-device conversational voice. It uses Whisper STT, the local Gemma voice-test boundary (wllama), Kokoro TTS, hands-free VAD, and explicit interruption detection. Details live in `client/docs/voice-test.md`.
- Fallback bank: `client/lib/prompts/fallback-bank.ts` holds local fallbacks for chunks, check-ins, and reflection.

The intake safety screen, fallback bank, and crisis-routing rules remain rule-based and never trust a model decision.

### Mobile (future, not in this repo yet)

- React Native + Expo, Gemma 4 E2B via LiteRT, SQLite with SQLCipher. See `PRD.md > Tech Stack (Production)`.

## Tech Stack

**Hackathon web demo (current checked-in implementation):**
- Next.js 16 (App Router), TypeScript strict, Tailwind CSS v4
- **Runtime:** one Gemma 4 E2B-it base + the multitask `lora-wave-session` LoRA, **merged and quantized into a single Q4_K_M GGUF** and run in the browser via wllama (llama.cpp / WASM, WebGPU when available). Meditation chunks are generated locally with schema validation and a clinician-reviewed fallback bank as the two-strike fallback. Per-model reference: `docs/models.md`. Training process: `docs/model-training.md`.
- **Current local runtime:** chunk narration, check-in, reflection, and insights all call the merged fine-tune through wllama (`client/lib/gemma/wllama-generators.ts`). Check-in uses `response_format: json_schema` (a single blocking `{ reply, endConversation }` generation — not native tool calls, not token-streamed); Kokoro streams the reply audio sentence-by-sentence. The LoRA is already merged into the served GGUF — there is no remaining "load the adapter" gap.
- **Synthetix** pipeline (developer-only, not shipped to users) produces each LoRA's training set in a small loop: (1) small human-written seed set → (2) Gemma expands it into `N` synthetic examples → (3) clinician spot-checks a sample in a small UI and leaves feedback on anything wrong → (4) regenerate with that feedback until a spot-check passes clean. Then an 80 / 20 stratified train / test split, **one** QLoRA run (Unsloth + TRL) on the train split, and a simple four-check eval harness on the test split (JSON validity, safety lexicon, surface invariants, latency). Source of truth: `client/synthetix/`.
- **Crisis triage runs on base Gemma with no LoRA** — the safety boundary that must never be fine-tuned. Routing to 988 / SAMHSA / local emergency is rule-based and never trusted to the model.
- Mock data / local UI state for the web demo's dashboard, history, and insights defaults
- CSS/Tailwind wave animation and an ambient audio bed during the session
- Developer-only `/models/voice-test` surface for validating the voice stack: Whisper STT, wllama Gemma streamed replies, Kokoro TTS with WebGPU default and WASM fallback, native Kokoro text/audio streaming, hands-free VAD, and interruption detection that suppresses self-triggering from TTS audio. This stack now also drives the production `/session` voice check-in.
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
- **Offline-first (everywhere)**: The final session path must make **zero LLM network requests** on both mobile and the web demo. Mobile runs Gemma 4 E2B via LiteRT; the web demo runs the merged Q4_K_M GGUF via wllama (llama.cpp / WASM, WebGPU when available). The one scripted narration bank in `client/lib/prompts/` is the two-strike fallback when model output fails Zod validation twice.
- **Privacy floor**: No account required to use the app. No third-party analytics in the session flow. Opt-in only for any data export to a clinician, and exports must be local files (PDF/JSON) the patient chooses to share.

## Check-in training dialogue rules (`lora-check-in-1`)

Strict guidance for training seeds (`client/data/training-seeds/lora-check-in-1.json`), `client/scripts/generate-lora-check-in-1-grid.ts`, and `/training` multi-turn examples—keep new examples aligned with the checked-in set.

1. **Opening**: Line 1 is always WAVE with the exact 1–10 craving prompt from `client/lib/training/check-in-dialogue.ts` (`CHECK_IN_CURRENT_URGE_SCALE_PROMPT`).
2. **Scores**: The patient states **current** intensity only, not baseline. Intake (baseline) is in structured input; the **first substantive WAVE reply after the number** compares baseline to current.
3. **Medication**: For **on-time** and **late**, affirm engagement first (e.g. *Thank you for keeping on track with your medication. That is very important, and you are doing the right thing.*), then give timing context without shame. For **missed**, thank them for honesty, normalize, and use prescriber/clinic language as in the seed file—do not use the same “keeping on track” line as if the dose were taken.
4. **Trigger**: Validate with surf framing, e.g. *Sometimes {trigger or triggerOther} alone can trigger the urge, and we are here to help you surf the wave.*
5. **Always end with a question**: Every WAVE line **must** end with a **`?`** so the patient always knows what to answer next (validated in `checkInOutputSchema` when `dialogueTurns` are present).
6. **Coping**: After obstacle validation, ask consent verbatim (`CHECK_IN_COPING_CONSENT_PROMPT` in `check-in-dialogue.ts`) **before** any coping instructions. On the **first** WAVE turn after the patient agrees, open with **`CHECK_IN_COPING_BRIDGE_OPENER`** (*Great, let's try this together.*), give the technique, and close that same turn with a short check-in question (see grid generator).
7. **Next chunk**: When the patient says they are ready, **stop**—no further WAVE line; the session advances. The transcript’s **last line is the patient**; `reply` in JSON still matches the **last WAVE** line (the readiness question).

**Clinician / LLM expansion** (Synthetix, dataset review): long-form instructions live in `client/data/training-seeds/clinician-llm-instructions.json` under **`lora-check-in-1`**, editable from `/training` → Check-in 1.

## Check-in training dialogue rules (`lora-check-in-2`)

Same sequencing discipline as check-in 1 (always end WAVE lines with `?`, consent + `CHECK_IN_COPING_BRIDGE_OPENER` before techniques, transcript ends on patient readiness with no extra WAVE line). **Differences (PRD § Chunk 2 / Check-in 2):**

1. **Turn 1 prompt**: Exactly **`CHECK_IN_CHUNK2_SCORE_PROMPT`** (same string as **`CHECK_IN_CHUNK234_SCORE_PROMPT`**) in `client/lib/training/check-in-dialogue.ts` — matches PRD / `CHECK_IN_OPENERS[2].turn1` (*How intense is the craving now, rate from 1 to 10?*). Not the same string as check-in 1.
2. **After the score (two WAVE turns before body work)**: (a) **First** WAVE turn: score reflection vs the **prior check-in score** (`fillScoreReflection` / `client/lib/session/score-tracking.ts`), then **`CHECK_IN_CHUNK2_LANDING_SECTION_PROMPT`** verbatim only. (b) **Second** WAVE turn (after the patient answers about the landing): if they were fine, open with **Great.**; if they named a struggle, validate briefly first. Then include **`CHECK_IN_BODY_URGE_LOCATION_OBSERVE_PROMPT`** verbatim in the same turn. Do **not** repeat check-in 1’s long medication + surf block on the first post-score turn. See `check-in-dialogue.ts`.
3. **Next patient turn**: Locating the urge, difficulty locating, or mixed experience; WAVE **validates** somatically, then may deepen or move to **consent → bridge → one technique** as in training seeds.
4. **Readiness**: Last WAVE line uses **`CHECK_IN_CHUNK2_READINESS_PROMPT`** (next phase is the **sound anchor**).

Canonical grid: `client/data/training-seeds/lora-check-in-2.json` via `client/scripts/generate-lora-check-in-2-grid.ts`.

**Clinician / LLM expansion**: long-form instructions live in `client/data/training-seeds/clinician-llm-instructions.json` under **`lora-check-in-2`**, editable from `/training` → Check-in 2.

## Check-in training dialogue rules (`lora-check-in-3`)

Same global discipline as check-in 2 (no check-in-1 med + surf paragraph on the first post-score turn; landing split into two WAVE turns; **Great.** or brief validation before the verbatim follow-up; consent + `CHECK_IN_COPING_BRIDGE_OPENER` before techniques; every WAVE line ends with `?`; transcript ends on patient readiness). **Chunk / PRD focus (after sound or visualization anchor, before 4-4-6 breathing):**

1. **Turn 1 prompt**: Exactly **`CHECK_IN_CHUNK3_SCORE_PROMPT`** (same string as **`CHECK_IN_CHUNK234_SCORE_PROMPT`**) in `client/lib/training/check-in-dialogue.ts` — matches PRD / `CHECK_IN_OPENERS[3].turn1` (*How intense is the craving now, rate from 1 to 10?*).
2. **First WAVE turn after the number**: Score reflection vs the **prior check-in score** (`fillScoreReflection` / `client/lib/session/score-tracking.ts`), then **`CHECK_IN_CHUNK3_LANDING_SECTION_PROMPT`** verbatim only (how the landing of the sound-anchor chunk felt; questions or concerns). Do **not** put the anchor-hold or body-observe question on this turn.
3. **Second WAVE turn (after the patient answers about the landing)**: **Great.** if they were fine; otherwise validate briefly. Then **`CHECK_IN_CHUNK3_ANCHOR_HOLD_PROMPT`** verbatim — PRD / `CHECK_IN_OPENERS[3].turn2` core question (*Could you hold onto the sound of water, or was it hard to stay with?*). Do **not** use the check-in-2 body-location observe block here.
4. **Branching (PRD § Adaptive path / Chunk 3 user flow)**: After the patient answers about the anchor, **validate before technique**. If the anchor did not land, do **not** push harder on visualization; use the obstacle-library stance (e.g. real-sound anchoring, thought labeling, normalizing urge intensification). At most **one** technique before readiness.
5. **Readiness**: Last WAVE line uses **`CHECK_IN_CHUNK3_READINESS_PROMPT`** (next part is **breathing**).

**Clinician / LLM expansion**: long-form instructions live in `client/data/training-seeds/clinician-llm-instructions.json` under **`lora-check-in-3`**, editable from `/training` when that surface is wired.

## Check-in training dialogue rules (`lora-check-in-4`)

Same global discipline as check-ins 2–3 (no check-in-1 med + surf paragraph on the first post-score turn; landing split into two WAVE turns; **Great.** or brief validation before the verbatim follow-up; consent + `CHECK_IN_COPING_BRIDGE_OPENER` before techniques; every WAVE line ends with `?`; transcript ends on patient readiness). **Chunk / PRD focus (after 4-4-6 breathing, before closing reflection):**

1. **Turn 1 prompt**: Exactly **`CHECK_IN_CHUNK4_SCORE_PROMPT`** (same string as **`CHECK_IN_CHUNK234_SCORE_PROMPT`**) in `client/lib/training/check-in-dialogue.ts` — matches PRD / `CHECK_IN_OPENERS[4].turn1` (*How intense is the craving now, rate from 1 to 10?*).
2. **First WAVE turn after the number**: Score reflection vs the **prior check-in score** (`fillScoreReflection` / `client/lib/session/score-tracking.ts`), then **`CHECK_IN_CHUNK4_LANDING_SECTION_PROMPT`** verbatim only (how the landing of the breathing exercise felt; questions or concerns). Do **not** put the PRD breathing follow-up or body-location observe on this turn.
3. **Second WAVE turn (after the patient answers about the landing)**: **Great.** if they were fine; otherwise validate briefly. Then **`CHECK_IN_CHUNK4_BREATHING_FOLLOW_UP_PROMPT`** verbatim — PRD / `CHECK_IN_OPENERS[4].turn2` core question (*How did the breathing feel — were you able to follow your own count, or did something get in the way?*). Do **not** use **`CHECK_IN_BODY_URGE_LOCATION_OBSERVE_PROMPT`** here (that block is check-in 2 only).
4. **Branching (PRD § Check-in 4 / obstacle library)**: After the patient answers about breathing, **validate before technique**. Branch on tight chest, intruding thoughts, and breath-induced anxiety. **Never** push deeper, longer, or more “disciplined” breaths when the patient reports **breath anxiety** or **chest tightness**; prefer smaller breaths, orientation, or outer focus. At most **one** technique before readiness (`lora-specs` invariant).
5. **Readiness**: Last WAVE line uses **`CHECK_IN_CHUNK4_READINESS_PROMPT`** (next part is the **closing reflection**).

**Clinician / LLM expansion**: long-form instructions live in `client/data/training-seeds/clinician-llm-instructions.json` under **`lora-check-in-4`**, editable from `/training` when that surface is wired.

## Learned User Preferences

- When editing prompt templates under `client/lib/prompts/`, preserve clinical content verbatim and only tighten structural/voice work; never alter pharmacology, citations, or safety copy without a fresh citation.
- Mock datasets that drive visualizations (e.g., the dashboard heatmap) should be dense enough that almost every cell shows data — leave at most 1-2 cells deliberately blank rather than rendering a sparse grid.
- Every LLM-touching feature must go through a `client/lib/gemma/*` boundary so runtime swaps stay localized.
- When explaining model training or eval results, start in plain English with whether a usable model exists, how it improved, and whether it can run in the frontend/local environment before going into MLE details.
- For remote/GPU work, avoid asking the user to run manual SSH/SCP or transfer commands when a safe tool-based path is available; ask only when tool access cannot do the transfer or command.
- Be cost-conscious with paid GPU training: once a usable adapter exists, do not launch another training run without explicit approval; prefer eval-only runs from saved artifacts when possible.

## Learned Workspace Facts

- `models/` is the repo's ad-hoc Python experiment area for Gemma smoke tests. It supports both `uv` (via `models/pyproject.toml` + `models/.python-version`, venv at `models/.venv/`) and conda (via `models/environment.yml`, env name `wave-models`) — both produce the same Python 3.11 environment. **`pyproject.toml` is the single source of truth for the dependency list; `environment.yml` is auto-generated by `models/sync_env.py` and carries an `# AUTO-GENERATED` header.** When changing deps, edit `pyproject.toml`, run `uv run python sync_env.py` (or `python sync_env.py` from a conda env), and commit `pyproject.toml`, `uv.lock`, and `environment.yml` together. Never hand-edit `environment.yml`.
- All fine-tune tooling lives in `models/finetune/` (trainers, eval, merge, synthetic data, smoke notebook). `models/finetune/train_wave_session_lora.py` is the active unified WAVE LoRA trainer. It consumes normalized input/output JSONL from `models/finetune/prepare_wave_session_dataset.py`, defaults to the Unsloth `unsloth/gemma-4-E2B-it` QLoRA path, applies the explicit `gemma-4` chat template, strips the leading `<bos>` from rendered SFT text, trains on assistant responses only, and writes token-length preflight reports that hard-fail truncation by default unless `--allow-truncation` is passed. It saves periodic checkpoints with resume support, defaults final eval to completion-only, and its generation eval can reload the saved adapter in inference mode with per-surface token caps, LoRA-only gates by default, optional base generation, and `generation-eval-progress.jsonl` progress logging. `models/finetune/train_phase_narration_lora.py` is the older phase-only trainer. See `models/finetune/README.md` for the full pipeline (dataset prep → train → eval → merge → diagnose) and gotchas table.
- Unified session LoRA data combines check-in 1–5, reflection, and phase narration sources under `models/datasets/human/`. The current combined training artifact is `models/datasets/lora-wave-session-expanded.jsonl`; the Studio-oriented export is `models/datasets/lora-wave-session-studio-sharegpt.jsonl` (ChatML / ShareGPT `messages` with strict JSON assistant content).
- The active web demo lives in `client/` (lowercase, renamed from `clients/` via `git mv`); any older `web/` or `clients/` paths in docs are stale.
- `client/lib/data/mock-sessions.ts` is the single source of truth for mock session data; the dashboard, history, and insights pages must consume `MOCK_SESSIONS` and its derived aggregators (`MOCK_SESSION_STATS`, `MOCK_RISK_GRID`, `MOCK_WEEK_SUMMARY`, `MOCK_RECENT_SESSIONS`, `STATIC_INSIGHTS`) from it instead of redefining local constants.
- Prompt templates in `client/lib/prompts/` use XML-style tagged sections (`<role>`, `<voice>`, `<never>`, `<output>` in system prompts; `<situation>` / `<clinical_source>` / `<citation_required>` in user turns) so the same prompts run portably on Gemma 4 E2B-it and any future runtime wrapper.
- The insights regenerate flow lives in `client/app/insights/page.tsx` and calls `generateGemmaInsights()` from the local runtime.
- The `sessions` array on insights/regen requests is capped at 200 in `client/lib/prompts/schemas.ts`; expanding the mock dataset past that cap requires bumping the schema first.
- The developer-only voice test stack is documented in `client/docs/voice-test.md`. Keep voice experiments isolated under `/models/voice-test` until they are intentionally promoted into `/session`; do not wire voice changes into the patient-facing flow as part of test-page work.
- `pnpm test:gemma:tools:live` is a Node smoke test that uses the filesystem cache at `client/.cache/transformers`; it does not benchmark browser WebGPU acceleration. Browser Gemma uses `GEMMA_CACHE_KEY = "wave-gemma4-cache"` with browser cache/IndexedDB and still reloads the model into memory after a full refresh.
- For Gemma 4 E2B training/eval, installing FlashAttention 2 may not speed this repo's path because Unsloth can still fall back to SDPA when Gemma 4's attention head dimension exceeds FA2 kernel limits; do not treat FA2 presence alone as proof the run is accelerated.
