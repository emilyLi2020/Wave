# WAVE

### An offline-first, medication-aware urge-surfing companion for substance use disorder recovery — running Gemma 4 entirely on your device.

**Track:** Health & Sciences (Impact)

---

## The Problem

1 in 6 Americans meet the criteria for a substance use disorder. Only about 1 in 5 who need treatment receive it — and even for them, recovery is not won in the therapist's office. It is won or lost in the ten minutes alone when a craving crests and there is no one to call.

**WAVE puts a medication-aware clinician in that ten-minute window — offline, on-device, in the moment a relapse is decided.**

That window — from urge cresting to acting on it — is often under ten minutes. A weekly therapist cannot be there. A sponsor may not pick up. And the apps that exist treat every craving the same: a generic breathing animation, no memory, no awareness of where the person actually is.

That last gap is clinically serious. Most people in recovery are on Medication-Assisted Treatment — Suboxone, Naltrexone, methadone, Vivitrol. A 7/10 craving four hours after a Suboxone dose is a different neurobiological event than the same 7/10 at hour twenty-two, when medication is troughing and part of what the person feels is early withdrawal, not just wanting. No mainstream urge-surfing tool knows the difference. WAVE does.

## The Solution

A person in recovery opens WAVE mid-craving, taps three times, and is guided through a 12–15 minute clinician-grade urge-surfing session that adapts to their craving and medication — no account, no network, no data leaving the device — closing with their craving measurably lower and a concrete next step.

The flow is deliberately small:

1. **Three taps.** Craving intensity (1–10), medication status (on time / late / missed / none), trigger (social / stress / physical / other). No typing.
2. **A rule-based safety screen.** Two yes/no questions ("used today?" then, only if yes, "feeling physically unwell?"). Both-yes skips the session and routes to the SAMHSA National Helpline plus a clinician prompt. Never touches a model.
3. **A 12–15 minute evidence-based session.** Five narrated chunks — settling, body scan, sound anchor, 4-4-6 breathing, closing reflection — from Marlatt's Mindfulness-Based Relapse Prevention (MBRP). Between every chunk, an adaptive Gemma check-in: a real multi-turn conversation, not a form. It asks the craving score, listens for what got in the way, validates before offering one technique, and never advances until the person is ready.
4. **A personal arc.** At close, the patient sees their craving drop in their own numbers, names a 10-minute next step, and the session is logged locally to sharpen future high-risk-window predictions.

The differentiator is medication-aware prompting. The intake medication status conditions every check-in. On a missed Suboxone dose, the model can name that part of what the person feels is partial withdrawal and gently ask if they can take their medication now. It never prescribes, recommends a dose change, or shames a missed one. The pharmacology copy is a clinician-reviewed matrix mapped to FDA labels and SAMHSA MAT guidance.

## How We Used Gemma 4

**The variant: `google/gemma-4-E2B-it`, INT4, ~1.5 GB.** E2B is the Gemma size built for browser- and phone-class runtimes. On-device is the product, not a constraint. Craving and medication logs are PHI-adjacent; a recovery tool that phones a cloud LLM with "I just used and I want to stop" is the wrong product. WAVE's session path makes **zero LLM network requests** — judges can open DevTools, toggle offline after the one-time model download, and complete a full session.

**Runtime: GGUF + wllama + WebGPU.** We serve a Q4_K_M GGUF split into five shards to clear the browser's 2 GB ArrayBuffer ceiling, loaded once via `@wllama/wllama` (`lib/wllama/`). One ~3.2 GB load is shared across chunk narration, voice check-ins, and the reflection card. Mobile (LiteRT on React Native) is the post-hackathon port; browser is the demo path.

**The fine-tune: an Unsloth QLoRA.** We trained `lora-wave-session` (r32) on Gemma 4 E2B-it with Unsloth + TRL, PEFT-merged, then converted to GGUF. It is a multitask adapter — a `surface` discriminator lets one adapter produce phase narration, check-in turns, and the reflection card. Training data is a clinician-seeded JSONL set, expanded through a gap-driven synthetic pipeline where the model proposes and **local validators plus a clinician spot-check gate every accepted row**. The merged base + adapter ships as the GGUF at `Maelstrome/lora-wave-session-r32`.

**The structured-output contract.** Clinical copy cannot be free-form. Chunks must be exactly six plain-text lines. The reflection must be a fixed object: `insight`, `journalPromptQuestion`, four concrete `nextSteps`. Check-ins return patient-facing prose plus an optional `endConversation` signal carrying the craving score and inferred obstacle. We enforce all three with llama.cpp `response_format: json_schema` (strict), re-validate with Zod as defense in depth, and fall back to a clinician-reviewed local bank after two invalid attempts. The patient is never blocked.

## Architecture

```
3-tap intake ─► rule-based safety screen (no model)
      │
      ▼
Session shell ── continuous ambient audio, wave animation
      │
      ├─ Chunk 1..5  ── Gemma (GGUF/wllama) ─► 6-line schema ─► Zod ─► fallback bank
      │
      └─ Check-in 1..5 ── Gemma multi-turn ─► json_schema {reply, endConversation}
                                              │
                                              ▼
                          score / obstacle / readiness gate (code)
      │
      ▼
Reflection card (structured JSON) ─► local session log ─► risk-window model
```

Everything model-touching sits behind `client/lib/gemma/*`, so wllama can be swapped for LiteRT by changing one import. Crisis routing (988 / SAMHSA) and the intake safety screen are rule-based, never delegated to the model — the safety boundary is code on purpose.

## Challenges & What We Learned

**The native function-calling mode collapse.** Our first plan was to fine-tune Gemma 4 to emit native tool-call tokens for the check-in `endConversation` signal. Six training runs (v1–v6) failed the same way: the LoRA collapsed to one canned response. The forensic postmortem is the most honest engineering artifact in the repo (`docs/postmortems/tool-call-finetune.md`):

- v1: the trainer rebuilt the assistant message from the JSON payload, silently dropping our rewritten tool-call content.
- v2: Unsloth's `gemma-4` chat template silently strips the `tools=` argument, so training prompts never contained the tool spec while inference did — a train/inference mismatch invisible until we byte-diffed the rendered templates.
- v3–v6: even with rendering fixed, the dataset was ~94% non-tool-emitting turns. Cross-entropy drove the tool-call token's probability down ~five orders of magnitude — functional destruction, not suppression — matching the published "LoRA latches onto a high-signal shortcut and overrides pretraining" literature.

**The mitigation that shipped.** We stopped fighting the token distribution and changed the contract. Check-ins ship through strict `json_schema`-constrained decoding — `{reply, endConversation}` — which llama.cpp enforces at the grammar level regardless of the LoRA's logits. The adapter is trained for clinical wording and readiness/score semantics; the JSON wrapper guarantees structure. The lesson that survives: **render-check before every long training run** (every failure was detectable in 30 seconds), and **constrained decoding beats fine-tuning a rare control token into a dominant distribution.**

## Why These Technical Choices Were Right

- **On-device** is not a constraint we tolerated; it is the only ethically defensible architecture for real-time PHI-adjacent recovery support. It works in the exact moment it is needed — offline, on the lock screen, no server latency — and reaches people telehealth apps cannot: rural areas without broadband, people experiencing homelessness, those who cannot afford a data plan.
- **GGUF + wllama over ONNX.** The ONNX/WebGPU path showed fp16 divergence and is parked; the GGUF Q4_K_M path is stable, quantizes cleanly, and runs an artifact a clinician can inspect.
- **JSON-schema-constrained decoding over native tool calls.** Earned the hard way (below). It decouples clinical correctness (the LoRA) from structural correctness (the grammar) so neither can break the other.
- **Clinical behavior as reviewable data.** Prompts, the medication matrix, and the obstacle library are typed data a clinician can audit without reading React — every change requires an MBRP / SAMHSA / FDA citation.

## Impact & Vision

We shipped a complete working session — three-tap intake, rule-based crisis routing, a five-chunk MBRP arc, five adaptive Gemma check-ins, a structured reflection — running entirely on a phone-class model with zero LLM network calls. It meets people in the ten minutes that decide a relapse, knows their medication, remembers their patterns, and never sends their worst moment to a server.

**What's next:**

1. The React Native / LiteRT build, so WAVE lives on the lock screen where the craving happens.
2. Prophylactic notifications firing 15 minutes *before* a predicted high-risk window — intervening during anticipation, while executive function holds.
3. On-device medication photo recognition, making intake one tap.
4. A clinician dashboard fed only by patient-exported, locally-encrypted summaries.

Because every piece runs on a model that fits a phone, the marginal cost per person is zero — deployable to the population that needs it and can least afford a subscription.

## Links

- **Repository:** [[USER: insert public GitHub repo URL]]
- **Live demo:** [[USER: insert deployed Vercel demo URL]]
- **Video pitch:** [[USER: insert YouTube/video URL]]
- **Fine-tuned model:** https://huggingface.co/Maelstrome/lora-wave-session-r32
- **Team:** [[USER: insert team member names]]
