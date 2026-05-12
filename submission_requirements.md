# Gemma 4 Good Hackathon Submission Requirements

This file is the working checklist for submitting **WAVE** to the Kaggle / Google DeepMind **Gemma 4 Good Hackathon**.

Official page: <https://www.kaggle.com/competitions/gemma-4-good-hackathon/overview>

Research cross-checks used for this checklist:

- Public mirrors agree the hackathon runs **April 2, 2026 through May 18, 2026 at 11:59 PM UTC**.
- Required package: **Kaggle Writeup**, **public video**, **public code repository or Kaggle Notebook**, **live demo or functional prototype files**, **technical analysis**, and **media gallery assets**.
- Judging emphasis: **Impact & Vision (40%)**, **Video Pitch & Storytelling (30%)**, and **Technical Depth & Execution (remaining 30%)**.
- Tracks include **Main Track**, **Impact Track**, and **Special Technology Track**. WAVE should position for **Health & Sciences** and **Unsloth**; it may also credibly mention the future **LiteRT / edge** path if the writeup is clear that the current demo is a browser PWA.
- Public sources reference a **3-minute YouTube video**. The current draft also assumes a **1,500-word writeup cap**; verify the exact cap in the Kaggle submission UI before final upload.

## 1. Submission Positioning

### Primary Submission Claim

WAVE is an offline-first, medication-aware urge surfing companion for Substance Use Disorder recovery. It uses Gemma 4 locally to personalize evidence-based craving support without sending PHI-adjacent session data to a cloud LLM.

### Best Track Fit

- **Impact Track:** Health & Sciences.
- **Special Technology Track:** Unsloth, because the project includes QLoRA fine-tuning work and a documented training / evaluation process.
- **Secondary technology story:** Edge / local AI. The product roadmap targets LiteRT on mobile, while the hackathon web demo uses a local browser runtime and a merged Gemma 4 E2B + LoRA artifact strategy.

### What Judges Need To Understand Quickly

- The problem is not "another chatbot." The problem is that craving support is most useful during a high-risk moment, when connectivity, privacy, stigma, and executive function are all constraints.
- The product flow is grounded in Marlatt's Mindfulness-Based Relapse Prevention urge surfing structure.
- Gemma 4 is used where local, private, adaptive language matters: check-ins, narration, reflection, insight generation, and model-backed personalization.
- Safety is not delegated to a fine-tuned model. Crisis routing and intake safety checks are rule-based.
- The model work is real: human-written seed rows, synthetic expansion where applicable, QLoRA with Unsloth, held-out evals, schema checks, safety lexicon checks, and a browser deployment plan.

## 2. Hard Deliverables

### Kaggle Writeup

The Kaggle Writeup is the central submission artifact. It should read like a concise product + technical case study, not a README dump.

Required content:

- **Title:** clear and memorable. Suggested: `WAVE: Offline Urge Surfing Support with Gemma 4`.
- **Subtitle:** one-sentence impact claim. Suggested: `A private, medication-aware recovery companion that runs local Gemma guidance during craving moments.`
- **Track selection:** Health & Sciences and Unsloth if Kaggle allows multiple / special-track selection.
- **Problem statement:** why SUD craving support needs privacy, immediacy, and offline access.
- **Solution overview:** intake, safety screen, urge surfing session, adaptive check-ins, reflection, dashboard / insight loop.
- **Gemma 4 usage:** explain exact Gemma 4 surfaces and why Gemma 4 is a fit.
- **Architecture:** Next.js web demo, local Gemma boundaries, prompt / schema validation, fallback bank, mock local state, training artifacts.
- **Training / adaptation:** Unsloth + TRL + QLoRA, `lora-wave-session`, specialized future LoRAs, dataset construction, eval harness.
- **Safety and clinical constraints:** rule-based crisis handoff, no medication advice, no raw medication photos, no third-party analytics in session flow, no shame-based language.
- **Demo instructions:** live URL, recommended browser, expected first load behavior, fallback behavior.
- **Repository link:** public GitHub URL.
- **Video link:** public YouTube URL.
- **Media gallery:** cover image plus screenshots / architecture image.

Recommended writeup structure:

1. **Opening / Human Need** - 120 to 180 words.
   - Start with the moment: a person in recovery has a craving, may be alone, and needs immediate support that does not expose sensitive data.
   - Avoid exaggerated medical claims. WAVE is support, not treatment replacement.
2. **What WAVE Does** - 180 to 250 words.
   - Describe the session flow: intake, safety check, body scan, wave visualization, breathing, reflection, next step.
   - Mention medication-aware context in general terms, without making prescriptive claims.
3. **Why Gemma 4** - 180 to 250 words.
   - Local intelligence, edge suitability, structured outputs, adaptable tone, privacy.
   - Name `Gemma 4 E2B-it` for the browser / edge story.
4. **Technical Architecture** - 250 to 350 words.
   - `client/` Next.js app.
   - `client/lib/gemma/*` runtime boundaries.
   - Zod validation and fallback bank.
   - Mock session data for dashboard / insights.
   - Future mobile path with LiteRT and encrypted SQLite.
5. **Model Training and Evaluation** - 220 to 320 words.
   - `lora-wave-session` merged artifact strategy.
   - Human seed data, synthetic expansion, QLoRA via Unsloth, held-out evals.
   - Safety invariants and no-LoRA crisis routing.
6. **Impact and Future** - 150 to 250 words.
   - Clinical review, privacy, opt-in exports, mobile deployment, local notifications before predicted craving windows.

Writeup quality bar:

- Every technical claim must be backed by code, docs, screenshots, or model artifacts in the repo.
- Do not claim clinical efficacy. Say "supports," "guides," "companion," or "prototype," not "treats" or "prevents relapse."
- Do not imply the demo stores real patient records. Say the current demo uses local UI state / mock data.
- If claiming local model execution, specify exactly which surfaces are local, fallback, or still demo-bound.
- Keep medication language conservative and aligned with the PRD. Do not include dosing advice.

## 3. Public Video

The video is not optional. Public sources describe a **3-minute YouTube video** showing the "wow" factor and the human story behind the app.

Hard requirements:

- Host on **YouTube**.
- Make it publicly viewable without login.
- Keep it at or under **3 minutes**.
- Add the YouTube link to the Kaggle Writeup / media gallery.
- Show only capabilities that exist in the code or clearly label future roadmap as future.

### Recommended 3-Minute Script

#### 0:00-0:20 - Human Hook

Goal: make the stakes understandable before mentioning model details.

Key beats:

- "Cravings often arrive when someone is alone, ashamed, offline, or not ready to call a clinician."
- "WAVE gives a private, immediate, non-judgmental urge surfing session in that moment."
- Show the session screen, not slides.

Avoid:

- Fear-based language.
- Claims that the app replaces sponsors, clinicians, emergency care, or MAT.

#### 0:20-0:55 - Product Walkthrough Setup

Show:

- Home / session entry.
- Three-tap intake: craving intensity, medication status, trigger.
- Rule-based safety questions.

Narration points:

- The intake is intentionally short because high-craving moments are cognitively hard.
- Safety routing runs before any fine-tuned model surface.
- The app is designed around privacy and offline-first support.

#### 0:55-1:35 - "Wow" Demo Moment

Show:

- A session with high craving, medication context, and stress trigger.
- Adaptive check-in after a chunk.
- Personalized, trauma-informed response that acknowledges the user's context without shame.
- Craving score dropping and the reflection card summarizing the arc.

Narration points:

- Gemma 4 personalizes the language within strict clinical and safety boundaries.
- The experience follows urge surfing: notice the urge, ride the wave, return to the body, reflect.

#### 1:35-2:20 - Technical Engine

Show one clean architecture graphic:

```text
Next.js PWA
  -> rule-based safety gates
  -> typed session state
  -> client/lib/gemma boundaries
  -> Gemma 4 E2B-it + lora-wave-session
  -> Zod validation
  -> clinician-reviewed fallback bank
```

Mention:

- `Gemma 4 E2B-it` is chosen for edge / browser-class deployment.
- `lora-wave-session` is a multitask LoRA trained from WAVE session surfaces.
- Unsloth + TRL + QLoRA are used for adaptation.
- Outputs are schema-validated.
- Crisis / overdose / suicidality routing remains code, not a LoRA decision.

#### 2:20-2:45 - Impact

Show:

- Dashboard / history / insights.
- Pattern idea: identifying high-risk windows and nudging before cravings.

Narration points:

- WAVE is built for low-friction support between appointments.
- The future mobile version runs fully on-device with encrypted local storage and local notifications.

#### 2:45-3:00 - Close

Suggested closing:

> WAVE uses Gemma 4 where local intelligence matters most: private, adaptive support in the exact moment a craving crests. It is not a replacement for care. It is a bridge back to the next safe minute.

### Video Production Checklist

- Record the demo in a clean browser profile with no developer overlays.
- Use readable zoom and large cursor.
- Keep transitions simple.
- Use real app screens for at least 70% of the video.
- Include one architecture visual and one model / eval visual.
- Add subtitles or burned-in key captions.
- Use clear voiceover audio; audio quality matters more than cinematic effects.
- Do a final playback on a phone and laptop before uploading.

## 4. Public Repository Requirements

The repository must be public before submission.

Must be obvious from the repo:

- How to run the app:
  - `cd client`
  - `pnpm install`
  - `pnpm dev`
- Where the web demo lives: `client/`.
- Where the model documentation lives: `docs/models.md`.
- Where training documentation lives: `docs/model-training.md`.
- Where the PRD and clinical constraints live: `PRD.md` and `AGENTS.md`.
- Where Gemma runtime boundaries live: `client/lib/gemma/`.
- Where prompt fallbacks live: `client/lib/prompts/`.
- Where training / Synthetix surfaces live: `client/synthetix/` and `client/data/training-seeds/` if included.

Before submission:

- Remove or ignore accidental local logs, private auth files, and oversized scratch artifacts unless intentionally documented.
- Confirm `.env.local` is not committed.
- Confirm no raw patient data or real PHI appears anywhere in examples, logs, screenshots, or training rows.
- Confirm generated model artifacts that are too large for GitHub are either hosted appropriately or clearly described with reproduction steps.
- Confirm `README.md` tells judges exactly how to run the demo and where to inspect model work.

## 5. Live Demo Requirements

The demo must be functional enough for a judge to test without private credentials.

Minimum acceptance path:

1. Open the deployed app or run locally from `client/`.
2. Start a session.
3. Select a craving intensity, medication status, and trigger.
4. Answer the intake safety screen.
5. Complete at least one urge surfing chunk.
6. Use a check-in chat.
7. Finish the session.
8. See a reflection card.
9. Open dashboard / history / insights.

Demo must not require:

- A paid API key.
- A private account.
- Access to hidden local files.
- Network LLM calls for the main session path.

Document clearly:

- Recommended browser.
- Expected model load time.
- Whether WebGPU is required or optional.
- What happens if Gemma fails to load.
- What is mocked in the demo.
- What is real model behavior.

## 6. Technical Depth Checklist

Judges should see that WAVE is not just a UI mock.

### Gemma 4 Integration

- Name the model variant: `Gemma 4 E2B-it`.
- Explain why E2B fits the edge / privacy story.
- Explain which app surfaces use model-backed generation.
- Explain what is validated with Zod.
- Explain fallback behavior after invalid outputs or runtime failure.

### Fine-Tuning / Domain Adaptation

Include:

- `lora-wave-session` as the hackathon demo LoRA.
- Specialized future adapters:
  - `lora-phase-narration`
  - `lora-check-in-1` through `lora-check-in-5`
  - `lora-reflection`
- Dataset composition: phase narration, check-ins, reflection.
- Training stack: Unsloth + TRL + QLoRA.
- Split: 80 / 20 train / held-out eval where applicable.
- Safety gates: JSON validity, safety lexicon, surface invariants, latency.
- Clinician-review concept: human seed rows and spot-check flow.

### Architecture

Include:

- Next.js 16 App Router, TypeScript, Tailwind v4.
- Browser demo under `client/`.
- Local runtime boundary under `client/lib/gemma/*`.
- Prompt templates under `client/lib/prompts/`.
- Mock session analytics under `client/lib/data/mock-sessions.ts`.
- Future mobile path: React Native / Expo, LiteRT, encrypted SQLite, local notifications.

### Safety

Explicitly state:

- Intake safety screen is rule-based.
- In-session crisis signals route to emergency / crisis resources through a base-only safety path.
- Crisis routing is never fine-tuned.
- The app does not prescribe medication changes.
- The demo does not upload raw medication photos.
- No real patient data is used in training examples or screenshots.

## 7. Impact & Vision Checklist

WAVE should be framed as a high-impact healthcare support prototype, while staying medically careful.

Strong impact claims:

- "Helps make evidence-informed craving support available in the moment."
- "Protects privacy by keeping sensitive session context local."
- "Reduces friction for people who may not be ready to call someone."
- "Supports continuity between appointments."
- "Future local notifications could intervene before predicted craving windows."

Avoid:

- "Prevents relapse."
- "Treats addiction."
- "Replaces therapy."
- "Guarantees safety."
- "Gives medication guidance."

Evidence / credibility points to mention:

- MBRP-inspired urge surfing flow.
- Medication-aware but non-prescriptive prompts.
- Safety handoff rules.
- Clinical reviewable prompt templates.
- Schema validation for model outputs.
- Held-out evals and safety invariants.

## 8. Media Gallery Assets

Required / recommended assets:

- Cover image.
- Screenshot: session intake.
- Screenshot: check-in chat.
- Screenshot: reflection card.
- Screenshot: dashboard / insight page.
- Architecture diagram.
- Model training / evaluation diagram.
- Optional: 30-second GIF or short clip if Kaggle media gallery supports it.

Cover image requirements:

- Include the name **WAVE**.
- Communicate "private craving support" visually.
- Avoid medical cliches, pills as decoration, or sensational recovery imagery.
- Use high contrast and readable text at thumbnail size.

Suggested cover text:

```text
WAVE
Offline urge surfing support with Gemma 4
Private. Medication-aware. Built for the craving moment.
```

## 9. Final Pre-Submission Checklist

### Kaggle

- Kaggle account is verified.
- Team members are finalized and within the max team size.
- Correct competition track(s) selected.
- Writeup is under the UI word limit.
- YouTube video link is public.
- Repo link is public.
- Live demo link works in an incognito window.
- Media gallery has cover image and screenshots.
- All links are tested after publishing.

### Repo

- `README.md` has quickstart and demo path.
- `docs/models.md` describes model usage.
- `docs/model-training.md` describes training / eval.
- No secrets, tokens, `.env.local`, auth URLs, private logs, or PHI-like data are committed.
- Large model artifacts are handled intentionally.
- App can run from a clean checkout.

### Demo

- Session flow works start to finish.
- Safety handoff path works.
- Reflection path works.
- Dashboard / insights pages render.
- Local fallback path is documented.
- First load behavior is acceptable or clearly explained.

### Video

- Under 3 minutes.
- YouTube public / unlisted but accessible without login.
- Shows real product behavior.
- Includes the human story.
- Includes one concise architecture view.
- Names Gemma 4 and Unsloth clearly.
- Avoids unsupported medical claims.

### Writeup

- Starts with impact.
- Clearly explains why Gemma 4 is essential.
- Names model variant and adaptation strategy.
- Links docs and repo.
- Explains safety boundaries.
- Explains what is prototype vs roadmap.
- Ends with a concrete future path.

## 10. Suggested Writeup Copy Blocks

### One-Sentence Summary

WAVE is an offline-first, medication-aware urge surfing companion that uses Gemma 4 to provide private, adaptive craving support during the exact moments when people in recovery need low-friction help.

### Technical Summary

The hackathon demo is a Next.js PWA backed by local Gemma runtime boundaries in `client/lib/gemma/*`. The session flow uses typed intake state, rule-based safety gates, Gemma-backed check-ins and reflections, Zod output validation, and clinician-reviewed fallbacks. The model adaptation path trains a multitask `lora-wave-session` adapter with Unsloth + TRL + QLoRA from WAVE-specific phase narration, check-in, and reflection examples.

### Safety Summary

WAVE does not ask a fine-tuned model to make crisis decisions. Intake and crisis handoff are rule-based, medication copy is non-prescriptive, and model outputs are constrained by schemas, safety lexicons, and fallback behavior. The current demo uses mock / local state and does not require users to upload PHI.

### Roadmap Summary

The production target is a React Native app with Gemma 4 E2B running on-device through LiteRT, encrypted SQLite storage, and local notifications that can nudge users before historically high-risk craving windows. The web demo proves the core interaction model and the local adaptation strategy.

## 11. Open Verification Items

These should be checked directly in the Kaggle UI before final submission:

- Exact writeup word limit.
- Whether multiple tracks can be selected or only one primary track.
- Whether the YouTube video can be unlisted or must be fully public.
- Exact media gallery file type / size requirements.
- Whether model weights must be uploaded for the Unsloth special track or whether repo-hosted artifacts and documented reproduction are sufficient.
- Whether the live demo can be a deployed URL only or must include downloadable files.