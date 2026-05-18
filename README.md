# WAVE

### An offline-first, medication-aware urge-surfing companion for substance use disorder recovery — running **Gemma 4 entirely in your browser**.

> **Gemma 4 Good Hackathon — Health & Sciences (Impact Track)**

[![Gemma 4 E2B](https://img.shields.io/badge/Gemma%204-E2B--it%20(QLoRA%2FGGUF)-1a73e8?style=flat-square&logo=google)](https://huggingface.co/Maelstrome/lora-wave-session-r32)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=nextdotjs)](https://nextjs.org)
[![wllama + WebGPU](https://img.shields.io/badge/Runtime-wllama%20%2B%20WebGPU-ff6f00?style=flat-square)](https://github.com/ngxson/wllama)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?style=flat-square&logo=typescript)](https://www.typescriptlang.org)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue?style=flat-square)](LICENSE)

**1 in 6 Americans meet the criteria for a substance use disorder, and a relapse is decided in the ten minutes alone when a craving crests — not in the therapist's office.** WAVE puts a medication-aware clinician in that ten-minute window: a guided urge-surfing session that runs Gemma 4 E2B fully on-device, with no account, no network, and no data leaving the browser.

> **▶ Live demo:** _<ADD DEPLOYED URL — deployment pending. Do **not** use `waves.vercel.app`; that hostname is an unrelated third‑party app, not this project.>_
> Runs entirely in your browser (no server, no account). First load downloads the model (~3.2 GB, cached after); toggle DevTools offline afterward and a full session still completes.
>
> **▶ Video pitch:** _<ADD YOUTUBE URL — pitch video pending.>_

---

## How Gemma 4 Is Used

WAVE is built **with and on Gemma 4** — every word a patient reads or hears mid-session is generated on their own device by a fine-tuned Gemma 4.

- **Base model:** `google/gemma-4-E2B-it` (Google) — the Gemma size designed for browser- and phone-class runtimes. On-device is not a constraint we tolerated; it is the only ethically defensible architecture for real-time PHI-adjacent recovery support.
- **Fine-tune:** an Unsloth **QLoRA (r32)**, `lora-wave-session`, trained on a clinician-seeded clinical dataset (MBRP facilitator material, MI transcripts, SAMHSA MAT guidance, FDA labels — clinician spot-checked), PEFT-merged, then quantized to **Q4_K_M GGUF**. One multitask adapter produces phase narration, check-in turns, and the reflection card via a `surface` discriminator.
- **Runtime:** **fully in-browser via `@wllama/wllama` on WebGPU — zero LLM network requests.** The Q4_K_M GGUF is sharded to clear the browser's 2 GB ArrayBuffer ceiling and loaded once across all session surfaces.
- **Where:** five narrated meditation chunks, adaptive multi-turn voice check-ins, and the closing reflection card — all with strict `response_format: json_schema` decoding, Zod re-validation, and clinician-reviewed scripted fallbacks when validation fails.
- Per-model detail and I/O contracts: see [`docs/models.md`](docs/models.md).

> Crisis routing (988 / SAMHSA) and the intake safety screen are **rule-based code and are never delegated to the model** — the safety boundary is deliberate.

## Architecture

Browser-only. No server inference, no LLM network calls.

```
3-tap intake ─► rule-based safety screen (no model)
  (craving 1-10,           │  used today? + unwell? → both-yes
   med status, trigger)     │  routes to SAMHSA, skips session
                            ▼
Session shell ── continuous ambient audio + wave animation
        │
        ├─ Chunk 1..5  ── Gemma 4 (GGUF / wllama / WebGPU)
        │                   └─► 6-line schema ─► Zod ─► fallback bank
        │
        └─ Check-in 1..5 ── Gemma 4 multi-turn, medication-aware
                              └─► json_schema {reply, endConversation}
                                        │
                                        ▼
                          score / obstacle / readiness gate (code)
        │
        ▼
Reflection card (structured JSON) ─► local session log ─► risk-window model

Voice check-in loop (hands-free):
   mic ─► Silero VAD ─► Whisper STT ─► Gemma 4 (wllama) ─► Kokoro TTS ─► speaker
                              ▲                                          │
                              └──────────── barge-in interrupt ──────────┘
```

Everything model-touching sits behind `client/lib/gemma/*`, so the wllama engine can be swapped for LiteRT by changing one import.

## Run the web demo

```bash
cd client
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Navigate between **Home**, **Onboarding**, **Session**, **Dashboard**, **History**, **Insights**, and the developer-only **Training** screens from the top nav.

- **WAVE web demo** lives under `client/` (Next.js 16 + TypeScript + Tailwind v4) — the active demo path.
- **WAVE mobile demo** lives under `mobile/` (Expo / React Native iOS) — the post-hackathon port; patches `react-native-litert-lm@0.3.6` with a rebuilt LiteRT-LM iOS XCFramework hosted on Hugging Face.
- **Cursor / Claude Code skills** live under `.agents/skills/` and `.claude/skills/`.
- **Specs** live at the repo root — `AGENTS.md` (agent instructions, tech stack, domain constraints) and `PRD.md` (user flow, pages, data model, medication-aware prompt logic).

## Browser / Hardware Requirements

- Requires **WebGPU**: Chrome/Edge 113+ or Safari 17+.
- **~3.2 GB** model download on first load (cached afterward).
- ~4 GB free VRAM / unified memory recommended.
- iOS Safari works but is slower. If a page looks stuck on first visit, it is downloading the model — give it time.

## Docs

- **`AGENTS.md`** — shared instructions every AI coding tool (Cursor, Claude Code, Codex, Copilot) reads automatically.
- **`PRD.md`** — source of truth for what to build. Every scaffold, route, and prompt is derived from it.
- **`docs/models.md`** — per-model reference: the Gemma 4 base, every LoRA adapter, what each is fine-tuned for, where it is used, and its input/output contract.
- **`docs/model-training.md`** — how we produce every LoRA: data collection, synthetic-data pipeline, clinician spot-check, train/test split, QLoRA recipe, eval harness, ship gates.
- **`docs/postmortems/tool-call-finetune.md`** — the v1–v6 native-tool-call mode-collapse postmortem and the constrained-decoding mitigation that shipped.
- **`client/docs/voice-test.md`** — developer-only voice stack reference for `/models/voice-test`: Whisper STT, wllama Gemma streaming, Kokoro TTS, hands-free VAD, interruption detection.
- **`client/.cursor/rules/frontend-guardrails.mdc`** — frontend guardrails scoped to `client/`.

## License & Model Attribution

WAVE project code (everything outside the model weights) is licensed under the
**Apache License, Version 2.0** — see [`LICENSE`](LICENSE).

This product is built with and includes a derivative of **Gemma**. Base model:
**Gemma 4 E2B** (Google), used under the [Gemma Terms of Use](https://ai.google.dev/gemma/terms)
and subject to the [Gemma Prohibited Use Policy](https://ai.google.dev/gemma/prohibited_use_policy).
"Gemma" is a trademark of Google LLC. The fine-tuned adapter and merged GGUF in
`Maelstrome/lora-wave-session-r32` are a Gemma derivative and remain subject to
the Gemma Terms of Use. Full attribution: see [`NOTICE`](NOTICE).
