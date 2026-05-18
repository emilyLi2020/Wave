# WAVE

An offline-first, medication-aware urge surfing companion for SUD recovery.

- **Cursor / Claude Code skills** live under `.agents/skills/` and `.claude/skills/`.
- **WAVE web demo** lives under `client/` (Next.js 16 + TypeScript + Tailwind v4).
- **WAVE mobile demo** lives under `mobile/` (Expo / React Native iOS). It patches `react-native-litert-lm@0.3.6` at install time with a rebuilt LiteRT-LM iOS XCFramework hosted on Hugging Face.
- **Specs** live at the repo root — see `AGENTS.md` (agent instructions, tech stack, code style, domain constraints) and `PRD.md` (user flow, pages, data model, medication-aware prompt logic).

## Run the web demo

```bash
cd client
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Navigate between **Home**, **Onboarding**, **Session**, **Dashboard**, **History**, **Insights**, and the developer-only **Training** screens from the top nav.

The active demo is in `client/`. The session flow runs Gemma 4 E2B on-device via `@wllama/wllama` (Q4_K_M GGUF, WebGPU) for meditation chunks, voice check-ins (Whisper STT → wllama → Kokoro TTS), and the reflection card, all behind the `client/lib/gemma/*` boundaries with scripted local fallbacks when validation fails. The reflection and phase-narration contracts mirror the combined `lora-wave-session` dataset; check-ins use strict `response_format: json_schema` with an `endConversation` signal to preserve the dataset's clinical wording and readiness semantics.

## Docs

- **`AGENTS.md`** — shared instructions every AI coding tool (Cursor, Claude Code, Codex, Copilot, etc.) reads automatically.
- **`PRD.md`** — source of truth for what to build. Every scaffold, route, and prompt is derived from it.
- **`docs/models.md`** — per-model reference: the Gemma 4 base, every LoRA adapter, what each one is fine-tuned for, where it is used in the product, and its input/output contract.
- **`docs/model-training.md`** — how we produce every LoRA: data collection, Synthetix synthetic-data pipeline, clinician spot-check, train/test split, QLoRA training recipe, eval harness, and ship gates.
- **`docs/skills.md`** — project agent skills, including the impartial issue/plan observer workflow.
- **`client/docs/voice-test.md`** — developer-only voice stack reference for `/models/voice-test`: Whisper STT, wllama Gemma streaming, Kokoro TTS, hands-free VAD, and interruption detection.
- **`client/.cursor/rules/frontend-guardrails.mdc`** — frontend guardrails scoped to `client/`.
