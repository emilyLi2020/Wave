# Product Requirements Document

## What Is This?

WAVE is an offline-first, medication-aware urge surfing companion that helps people in SUD recovery ride out cravings in real time — and learns their personal high-risk windows so it can notify them **before** the next craving peaks. After a three-tap intake, WAVE facilitates a clinically grounded, 12–15 minute guided urge surfing session (5 chunks × 5 adaptive check-ins) in which a local Gemma 4 agent adapts to the patient's moment-by-moment state.

## Target User

Adults in recovery from Substance Use Disorder (opioid, alcohol, or stimulant), many of whom are on Medication-Assisted Treatment (Suboxone / buprenorphine, Naltrexone, Methadone, or Vivitrol). They typically have a counselor or prescriber they see weekly or monthly, but the window between craving onset and acting on it is often under 10 minutes — far shorter than any professional support can respond to. Existing urge-surfing apps treat every craving identically and ignore the patient's medication status entirely, which is clinically wrong: the same 7/10 craving means something very different at hour 4 versus hour 22 post-Suboxone dose. Our user is frustrated that no tool meets them where they actually are, neurobiologically, at the moment the wave builds.

## Core Flow

```
INPUT:   Patient opens WAVE (via proactive notification, lock-screen
         widget, watch complication, or Siri shortcut) and taps three
         answers: craving intensity (1-10), medication status (on-time /
         late / missed / N/A), trigger category (social / stress /
         physical / don't-know-or-other). The merged last option reveals an
         optional short free-text field so the patient can name their own
         trigger in their own words. Immediately after the three-tap
         intake, and *before* any LoRA runs, the intake phase asks two
         sequential yes/no safety questions: (1) "Have you used any
         substances today?" and, only if yes, (2) "Are you feeling
         physically unwell, dizzy, or having trouble breathing right
         now?" A "yes" on both skips the session entirely and routes
         the patient to the SAMHSA National Helpline
         (1-800-662-HELP / 1-800-662-4357) plus an explicit prompt to
         contact the patient's therapist or social worker now. This
         routing is rule-based and never touches an LLM.

PROCESS: Once the intake safety screen clears, WAVE runs a 12–15 minute
         guided urge surfing session composed of 5 narrated chunks
         separated by 5 adaptive check-ins. One Gemma 4 E2B-it base +
         a stack of small LoRA adapters generate the check-in responses
         on-device — LiteRT on mobile, and a merged Q4_K_M GGUF served
         via wllama (llama.cpp / WASM, WebGPU when available) in the web
         demo. The web demo runs the single multitask `lora-wave-session`
         adapter merged into that GGUF (no runtime LoRA hot-swap). The 5
         narrated chunks are generated locally by Gemma from a strict
         chunk prompt and Zod-validated as six plain-text lines; a
         fixed clinician-reviewed bank is used only after two invalid
         model attempts (MVP: on-screen text + wave animation; V2:
         Kokoro TTS audio). Crisis triage runs on base Gemma with no
         LoRA; routing to 988 / SAMHSA and the intake safety-screen
         handoff are both rule-based. No cloud LLM is ever called.
         Medication status captured at intake is passed as context
         into every chunk/check-in prompt so Gemma can reference it in
         validation copy without prescribing. Per-model reference:
         `docs/models.md`. Training process: `docs/model-training.md`.

OUTPUT:  Patient sees a one-screen insight at close ("You surfed a 7
         down to 2. On medication days you drop 5.1 points on average;
         off-medication days 2.8."), picks a next action (call someone,
         walk, water, rest), and the session is logged locally to
         refine future risk-window predictions.
```

**Implementation note:** the above is the product target. The current `client/`
demo keeps the same UX and boundaries and runs the WAVE fine-tune locally:
the multitask `lora-wave-session` LoRA merged into a Q4_K_M GGUF
(`Maelstrome/lora-wave-session-r32`, ~3.2 GB / 5 shards) served via wllama
(llama.cpp / WASM, WebGPU when available). Chunk narration, check-in,
reflection, and insight regeneration all call that one model. Check-in uses
`response_format: json_schema` (a single blocking `{ reply, endConversation }`
generation — not a native tool call, not token-streamed); Kokoro streams the
reply audio sentence-by-sentence. The LoRA is already merged into the served
GGUF, so there is no remaining "load the adapter" gap.

## Core Features (MVP)

1. **Three-tap intake + intake safety screen** — intensity, medication status, trigger fully condition the rest of the session. The merged **Don't know / other** trigger option reveals an optional single-line free-text field (capped at 80 chars, stored verbatim on the session row for pattern learning). Two sequential yes/no safety questions ("Have you used any substances today?" then, only if yes, "Are you feeling physically unwell, dizzy, or having trouble breathing right now?") run before any LoRA is loaded. Both-yes routes to SAMHSA + therapist/social-worker handoff and skips the session; yes-then-no logs a `usedSubstanceToday` flag and continues the session.
2. **Five-chunk adaptive urge surfing session** — 12–15 minutes of clinically grounded guided meditation split into 5 narrated chunks (intro + settling, body scan, sound/visualization anchor, 4-4-6 breathing, closing reflection), each followed by a **multi-turn** Gemma 4 check-in that adapts to the patient's craving score, emotional state, and reported obstacles. Every check-in is a real conversation — a fixed 5-turn structure (score → open-ended "how did it go" → obstacle listening → validate+one-technique+did-it-land → explicit readiness), never a form. See Check-In Conversation Protocol for the invariants. The chunks are generated by local Gemma against a strict six-line contract and fall back to a clinician-reviewed local bank if validation fails twice.
3. **Medication-aware check-ins** — medication status captured at intake is passed as context on every check-in prompt. Gemma may reference it in validation (Suboxone on-time, Naltrexone, Vivitrol week 2, methadone peak curve, no MAT) but never prescribes, never recommends dose changes, and never shames a missed dose. See the Medication-Aware Prompt Logic table for the canonical phrasing.
4. **Longitudinal pattern learning** — after ~7 sessions, the on-device model surfaces high-risk time windows and a medication-vs-craving correlation the patient can see in their own data.
5. **Prophylactic notifications** — local scheduler fires a "the next 2 hours can be challenging" alert 15 minutes before a predicted risk window, plus missed-dose and medication-trough alerts.
6. **Minimum-friction entry points** — lock-screen widget, Apple Watch / Wear OS complication, Siri / Google shortcut, and a clinician-handed physical card with a "text WAVE to yourself" shortcut.

## Pages / Screens

| Page | Purpose | Key Elements |
|------|---------|--------------|
| Landing (`/`) | Explain WAVE to a clinician or patient in 10 seconds; route to onboarding or an in-session demo | Hero, one-sentence value prop, "Start a session" CTA, privacy pledge, demo video link |
| Onboarding (`/onboarding`) | Capture the only three things we need: first name (optional), what MAT if any, usual dose time | 3-step form, Zod validation, written consent checkbox, stored locally (localStorage in web demo, SQLCipher on mobile) |
| Session (`/session`) | The whole urge-surfing protocol — intake → intake safety screen → 5 narrated chunks each followed by a multi-turn Gemma check-in → reflection + next step | Intake 3-tap (optional free-text when trigger is Don't know / other), two sequential Y/N intake safety screens (substance-use-today + physical-symptoms), safety handoff screen (SAMHSA 1-800-662-HELP + therapist/social-worker prompt) as an early-exit from the safety screen, `ChunkPlayer` (text + wave animation + client timers in MVP; Kokoro TTS audio in V2), `CheckInChat` multi-turn conversation surface between chunks (craving-intensity slider attached only to Turn 1; all subsequent turns are free-text chat), continuous background ambient-wave audio layer throughout the intervention, post-session reflection card, next-step chips |
| Dashboard (`/dashboard`) | Show the patient their own data so medication adherence feels visible | Sessions count, average drop, medication-vs-no-medication drop delta, high-risk windows heatmap, current streak |
| History (`/history`) | Chronological list of sessions with expandable details and optional journal entries | Session list, filter by outcome / trigger / medication status, "Export for clinician" button (local PDF) |
| Insights (`/insights`) | Plain-English patterns Gemma 4 has noticed, updated weekly | Trigger frequency, time-of-day risk, medication correlation, one-actionable suggestion per week |

## User Flow

1. **Pre-craving**: WAVE's local scheduler fires a notification 15 minutes before a predicted risk window. Patient sees it on the lock screen: "Your history shows the next 2 hours can be challenging. Open WAVE now — before the wave builds." One tap opens the app directly into the intake.
2. **Intake**: Patient taps intensity (e.g. 7/10), medication status (e.g. "took Suboxone on time"), and trigger. Trigger options are `social | stress | physical | unknown_or_other`; selecting **unknown_or_other** reveals an optional single-line free-text field capped at 80 characters so the patient can name more. No typing is required for any path. ~30 seconds.
3. **Intake safety screen**: Rule-based, runs before any LLM call. Patient answers Q1 "Have you used any substances today?" (Yes / No). If **No**, skip to step 4; Q2 never shows. If **Yes**, show Q2: "Are you feeling physically unwell, dizzy, or having trouble breathing right now?" (Yes / No). If Q2 is **No**, log `usedSubstanceToday: true` on the session for clinical context and continue to step 4. If Q2 is **Yes**, skip the rest of the session and render the safety handoff screen: **SAMHSA National Helpline: 1-800-662-HELP (1-800-662-4357)** and the line "If you have a therapist or social worker, reach out to them now." The session is logged with `outcome: safety_exited`. No LoRA is loaded; no model call is made.
4. **Chunk 1 — Intro + settling + urge awareness (~2 min)**: Gemma-generated narration welcomes the patient, settles them in, and introduces the wave metaphor. Pauses are inserted by the client between validated lines (see Session Runtime Requirements). The continuous ambient-wave audio layer starts here and plays uninterrupted through every chunk and check-in until the reflection screen is dismissed.
5. **Check-in 1 — Baseline (multi-turn)**: Gemma opens with a single question — "On a scale of 1 to 10, how intense is the craving or urge right now?" After the score, Turn 2 asks an open-ended "how are you feeling right now — emotionally, in your body?"; Turn 3 listens for obstacles and validates first; Turn 4 offers at most one concrete technique if needed and checks that it landed; Turn 5 asks explicit readiness — "Ready to continue into the body scan?" — and does not advance until the patient affirmatively says yes. Medication status from intake is passed as context so validation copy can reference it. See Check-In Conversation Protocol for the invariants.
6. **Chunk 2 — Body scan (~2–3 min)** → **Check-in 2 (multi-turn)**: Same 5-turn structure. Turn 2 opener is "Were you able to locate where the urge lives in your body?" Turn 3 deepens ("tight, warm, pressure — did it shift?") or branches to an obstacle response if they struggled (mind wandered / couldn't feel anything / felt overwhelmed). Turn 5 closes with a readiness prompt.
7. **Chunk 3 — Sound / visualization anchor (~2–3 min)** → **Check-in 3 (multi-turn)**: WAVE reflects the score, then uses **two** post-score agent turns (same landing split as check-in 2): first asks how the **landing** of the anchor chunk felt; after the patient answers, **Great.** or brief validation, then the PRD anchor question (*Could you hold onto the sound of water, or was it hard to stay with?*). Later turns branch on whether the anchor worked; if it did not, Gemma validates and offers **one** technique (real-sound anchoring, thought labeling, or normalizing urge intensification — see Obstacle Response Library). Turn 5 closes with readiness for breathing.
8. **Chunk 4 — Breathing exercise, 4-4-6 (~3–4 min)** → **Check-in 4 (multi-turn)**: Inhale 4s / hold 4s / exhale 6s, guided first then unguided. The wave animation rises on inhale, holds at peak, recedes on exhale, at exactly the counted pace. WAVE reflects the score, then uses **two** post-score agent turns (same landing split as check-ins 2–3): first asks how the **landing** of the breathing exercise felt; after the patient answers, **Great.** or brief validation, then the PRD breathing question (*How did the breathing feel — were you able to follow your own count, or did something get in the way?*). A later turn branches on tight chest / intruding thoughts / breath-induced anxiety with **one** obstacle-library technique (never pushing deeper breaths for breath anxiety or chest tightness). Turn 5 closes with readiness for the closing reflection.
9. **Chunk 5 — Closing reflection (~1–2 min)** → **Check-in 5 (closing, multi-turn)**: Turn 1 asks the final score. Turn 2 reflects the **full arc** from baseline ("You started at X and you're at Y now" / "You held steady — that took real commitment" / "The wave moved through you. You're still here") and asks what they noticed about themselves. Turn 3 responds specifically to what they noticed. Turn 4 is a forward-looking normalization. Turn 5 asks what they want to carry forward. **Check-in 5 does NOT ask "Ready to continue?"** — it closes with a warm reflection, not a continuation prompt.
10. **Reflection + next step**: Post-session screen shows a short model-written **insight** (with the ending score in the copy) and optional longitudinal framing when the product has real stats. **The patient is asked to name their own 10-minute plan in free text first.** If they have no ideas, the app shows **four** gentle backup options (from the model or fallback); they **pick one** (not a chat). Optional one-line journal. If `usedSubstanceToday: true` was logged at the intake safety screen, the reflection may acknowledge (in a trauma-informed way) that the patient chose to surf a craving even after using. This phase is **not** a multi-turn chat: no back-and-forth with the model after Check-in 5. Session logs and closes; the ambient-wave audio layer fades out. **Adapter training** represents this surface as structured JSON (not chat turns): `insight`, `journalPromptQuestion`, and `nextSteps` with four concrete backup strings (`one`…`four`). The checked-in seed file stratifies **48** rows over `medicationStatus × trigger ×` three `matType` variants (same grid rotation pattern as check-in synthetic grids); regenerate with `pnpm exec tsx scripts/generate-lora-reflection-grid.ts` from `client/`.
11. **Over time**: Notifications get more precise as the pattern model sees more sessions. Dashboard and Insights show the patient their recovery in their own numbers.

## Session Structure

| Chunk | Content | Duration | Pause pattern | After chunk |
|---|---|---|---|---|
| 1 | Intro + settling + urge awareness | ~2 min | Brief pauses + one 20s + one 10s observation pause | Check-in 1 (baseline) |
| 2 | Body scan — locate the urge in the body | ~2–3 min | 30s observation pauses × 4, closing 20s | Check-in 2 (body awareness) |
| 3 | Sound / visualization anchor | ~2–3 min | 20s + 30s + 30s + 45s + 20s | Check-in 3 (anchor) |
| 4 | Breathing exercise (4-4-6 cycles) | ~3–4 min | Counted breath segments (4s / 4s / 6s), then 90s + 60s wave loops | Check-in 4 (breathing) |
| 5 | Closing reflection | ~1–2 min | 30s + 15s | Check-in 5 (closing) |

**Clinical rationale:** Urges peak within 15–20 minutes and subside within 30 minutes without being fed. A 12–15 minute structured session catches the full arc of an urge. Five check-ins provide enough data points to adapt without fragmenting the meditative experience. Chunk prompts live in `client/lib/prompts/chunk-generator.ts`; generated output must validate as exactly six patient-facing lines before playback. The clinician-reviewed fallback bank in `client/lib/prompts/fallback-bank.ts` is used only after two failed model attempts.

## Session Runtime Requirements

These rules apply to the `ChunkPlayer` component (both MVP text and V2 Kokoro builds) and the overall session shell.

1. **Pause duration is owned by the client.** Gemma returns exactly six plain-text lines per chunk. The chunk player inserts fixed pauses between lines and owns any breath timing; the model never controls timer durations.
2. **Wave animation is paced to breath.** Rises over N seconds on inhale, holds at peak for N seconds on hold, recedes over N seconds on exhale. During `text` and `pause` segments the wave runs in an ambient loop. The current wave pacing is the target — do not regress it.
3. **No countdowns, no progress bars, no timers are rendered to the user** during any chunk. The wave is the only visual feedback during meditation.
4. **Silent, automatic transitions.** The transition from a chunk to its check-in must be fluent and automatic. **Do not** render copy like "chunk complete", "the agent will now check in", "segment 3 of 7", or any phase-boundary announcement. When the last segment of a chunk finishes, the `CheckInChat` surface appears and Gemma opens the check-in directly. Same rule in reverse: when the patient answers "Ready to continue", the next chunk starts immediately without a countdown or acknowledgment screen.
5. **Continuous ambient-wave background audio.** An ambient ocean / soft-white-noise loop plays from the first chunk through the final check-in as a single uninterrupted track. It does not restart on chunk boundaries and does not pause during check-ins. A small mute toggle is available in the top-right of the session surface; the default is unmuted at 35–45% volume. The audio file is a royalty-free ambient loop shipped in `client/public/audio/` and is preloaded at session start so there is no gap. In V2 Kokoro builds, the spoken narration rides on top of this bed with narration at 90% and bed at 25% (ducked while narration is active).
6. **Check-in UX is a multi-turn chat, not a form.** See the Check-In Conversation Protocol section for the full turn-by-turn contract. Summary: the `CheckInChat` surface is a text chat thread. A 1–10 intensity slider is attached to the composer for **Turn 1 only** (so the patient can slide and submit as their first message). Turns 2–5 are plain text messages in both directions. No emotional-state chip row, no obstacle textarea — the obstacle is surfaced by the patient in free text at Turn 2 or 3 and interpreted by Gemma. While Gemma inference is in-flight at **any turn**, the ambient wave continues and a subtle "still with you…" shimmer replaces any spinner. Never a spinner.
7. **Fallbacks.** If Gemma inference fails twice in a row at a given turn, render a scripted fallback acknowledgment from `client/lib/prompts/fallback-bank.ts`, preserve the turn index, and advance the conversation to the readiness-check turn if the chunk is otherwise complete. The patient is never blocked. A full check-in outage (fallbacks for every turn) still ends with the readiness prompt so the session can continue.

## Check-In Conversation Protocol

Every check-in (except Check-in 5, noted below) is a five-turn conversation. It is the adaptive heart of the session and the only place Gemma's output ships to the user at runtime. The protocol is enforced in code; the LoRA adapters are trained against it; the eval harness tests for it.

### Mandatory turn structure

| Turn | Actor | Behavior | Canonical prompt/content |
|---|---|---|---|
| 1 | Agent | Ask the craving score. One question only. | "On a scale of 1 to 10, how intense is the craving or urge right now?" (varies slightly per check-in — see per-chunk openers) |
| 1 | Patient | Gives 1–10 score. UI shows an intensity slider attached to the composer; patient slides and sends. Slider is hidden on all subsequent turns. | `7` |
| 2 | Agent | Open-ended question about the experience of the chunk just finished. One question. Reflects the score if it changed. | "How did that feel for you — were you able to stay with it?" |
| 2 | Patient | Free text. May be one word, may be a paragraph. | — |
| 3 | Agent | **Listen for obstacles.** If obstacle present: validate first (1–2 sentences) — never jump to a technique. If no obstacle: affirm specifically, referencing the score change or what they described. | Validation phrase + (if obstacle) transition into Turn 4 |
| 3 | Patient | (No forced patient response — Turn 3 may be agent-only if no obstacle. If Turn 3 triggers a technique, the patient responds in Turn 4.) | — |
| 4 | Agent | If an obstacle was present at Turn 3: offer exactly **one** technique from the Obstacle Response Library, then check-if-it-landed ("Does that make sense?" / "Want to try that before we continue?"). If no obstacle: this turn is the specific affirmation + score-trend reflection. | One technique (validate already done in Turn 3) |
| 4 | Patient | Optional free text response. | — |
| 5 | Agent | **Explicit readiness confirmation.** "Ready to continue into the body scan?" (or the named next chunk). The session state machine **does not advance** until the patient replies affirmatively. | "Ready to continue?" — not a button |
| 5 | Patient | Affirmative response or a request for more time. | "yes" / "ready" / "not yet" |

The turn count may grow beyond 5 if the patient needs more time (e.g. after a 5-4-3-2-1 grounding, the agent waits for a "ready" reply before re-issuing the readiness turn), but it may never collapse below 3 — **Turn 1 (score) and Turn 5 (explicit readiness) are the two non-negotiable bookends**, and Turn 2 (open-ended "how did it go") is always asked.

**Check-in 5 (Closing) exception:** Check-in 5 replaces Turn 5 with a warm close. Gemma reflects the full arc from baseline to final score, asks what the patient noticed about themselves, responds specifically to what they share, normalizes forward, and asks "Is there anything from this session you want to carry with you as you move through your day?" — then closes. **It does not ask "Ready to continue?"** — there is nothing to continue to. Searching the Check-in 5 transcript for `/ready to continue/i` must return zero matches.

### Per-check-in opening lines (Turn 1 + Turn 2 openers)

| Check-in | Turn 1 opener | Turn 2 opener (after score received) |
|---|---|---|
| 1 (Baseline, after Chunk 1) | "Before we go deeper — on a scale of 1 to 10, how intense is the craving or urge right now?" | "How are you feeling right now — emotionally, in your body? Anything that stands out?" |
| 2 (Body awareness, after Chunk 2) | "How intense is the craving now, rate from 1 to 10?" | "[score reflection.] Were you able to locate where the urge lives in your body?" |
| 3 (Anchor, after Chunk 3) | "How intense is the craving now, rate from 1 to 10?" | **Live path (two WAVE turns):** (1) `[score reflection]` + landing-of-anchor question; (2) Great. or brief validate + "Could you hold onto the sound of water, or was it hard to stay with?" (`check-in-dialogue.ts`). **Fallback** (one line in `check-in-openers.ts`): "[score reflection.] Could you hold onto the sound of water, or was it hard to stay with?" |
| 4 (Breathing, after Chunk 4) | "How intense is the craving now, rate from 1 to 10?" | **Live path (two WAVE turns):** (1) `[score reflection]` + landing-of-breathing question (`CHECK_IN_CHUNK4_LANDING_SECTION_PROMPT` in `check-in-dialogue.ts`); (2) Great. or brief validate + "How did the breathing feel — were you able to follow your own count, or did something get in the way?" **Fallback** (one line in `check-in-openers.ts`): "[score reflection.] How did the breathing feel — were you able to follow your own count, or did something get in the way?" |
| 5 (Closing, after Chunk 5) | "Last check-in — craving score 1 to 10?" | "[full-arc reflection.] What did you notice about yourself during this practice?" |

`[score reflection]` is filled in at runtime from the score-tracking response table below. These openers live as typed data in `client/lib/prompts/check-in-openers.ts`; they are scripted fallbacks, not LLM output. The LoRA-generated copy goes in Turns 3 and 4. **Check-ins 2–4 (live Gemma path)** split the post-score "Turn 2" material across two agent turns; see `AGENTS.md` and `client/lib/training/check-in-dialogue.ts`.

### Adaptive path at Turn 3 (the branching turn)

After the patient's Turn 2 response, Gemma selects one of five paths:

1. **No obstacle reported, score stable or improving** → Affirm specifically (reference the score change, what they described, or what they did). Advance to Turn 5 (readiness). Turn 4 is skipped.
2. **Mild obstacle reported** → Validate in 1–2 sentences, advance to Turn 4 with one technique from the library, check if it landed, then Turn 5 (readiness).
3. **Significant difficulty / score 8–10 / distress** → Validate, offer one technique, walk through it with the patient, ask how they feel after, then gently offer three options at Turn 5: repeat the current chunk, take a short pause, or continue. The patient decides.
4. **Patient reports they gave in / acted on the urge** → Validate without judgment. Normalize imperfect practice. At Turn 5, ask if they want to continue the session; if no, close gracefully.
5. **Patient wants to stop early** → "Of course. Even a partial session builds the capacity. You can return anytime." Close session, log `outcome: left_early`, and show the reflection + next-step screen with whatever data was collected.

### Rules that never bend

These are hard invariants. They gate both the code's conversation state machine and the LoRA training data in `client/lib/training/lora-specs.ts`.

1. **Validation always comes before technique.** Gemma may never offer a technique in the same turn as the patient's obstacle report. Turn 3 is validation-only when an obstacle is present; Turn 4 holds the technique.
2. **Never more than one technique per turn.** Offering two alternatives ("try A, or try B") is a violation. Pick one.
3. **Never advance to the next chunk without explicit affirmative readiness.** A button click alone is not enough; the patient's Turn 5 reply must parse as affirmative ("yes", "ready", "ok", "let's go", etc.). If ambiguous, Gemma re-asks.
4. **Never skip the craving score question.** Turn 1 is non-negotiable and is always the first thing the agent says at every check-in.
5. **Never press a one-word patient response.** If the patient replies "fine" or "okay" at Turn 2, the agent treats that as a complete answer. It does not ask "can you say more?" It advances.
6. **Never offer more than one grounding alternative at a time.** If the patient rejects a technique at Turn 4, the agent may offer a *different* technique in a later turn — never as a menu in one turn.
7. **Never minimize, never catastrophize.** "It'll be fine" and "this sounds very serious" are both banned. The agent acknowledges what's real without inflating or deflating it.

A PR that edits the LoRA adapter, the system prompt, or the conversation state machine must cite which of these rules it preserves and which (if any) it relaxes; relaxation requires a clinician sign-off.

### Score-tracking response patterns (used for `[score reflection]` at Turn 2)

Track craving scores across all five check-ins. The response table below drives the runtime phrase that fills `[score reflection]` in each Turn 2 opener, and also conditions Gemma's Turn 3 affirmation in the no-obstacle path.

| Pattern | Runtime phrase template | Additional agent behavior |
|---|---|---|
| Decreased (score_now < score_prev) | "You moved from {prev} to {now} — that's the {chunk-specific} doing its work." | Affirm the trend by name at Turn 3 if no obstacle. |
| Held steady (score_now === score_prev) | "Still at {now} — holding steady without acting is the practice." | Normalize at Turn 3 if no obstacle. |
| Increased (score_now > score_prev) | "It went up to {now}. That's normal — urges often spike before they crest." | Validate at Turn 3. Do not alarm. Offer a grounding technique at Turn 4 even if the patient did not explicitly report an obstacle. |
| **Stays HIGH** (score ≥ 7 for 2+ consecutive check-ins, not decreasing) | "Still sitting at {now}. This one is really holding on — and you are too." | At Turn 3: validate the duration explicitly, don't over-normalize with "this is the practice." At Turn 4: always offer a technique (body-scan curious observation or shortened 3-2-4 breath), regardless of whether patient named an obstacle. See also Score ≥ 8 at Check-in 3+ row below for escalation. |
| **Stays LOW** (score ≤ 4 for 2+ consecutive check-ins, not fluctuating up) | "Still at {now} — you came in grounded and you're staying there. Noticing that you're okay *is* part of the practice." | At Turn 3: specific affirmation that distinguishes holding-low from "the practice worked." Do not overclaim the chunk's effect on a score that was already low before it started. Normalize that baseline-stable sessions are valid. |
| Score ≥ 8 at Check-in 3+ (single data point) | "[standard reflection.] That's a lot to be sitting with." | Gently offer at Turn 5: "Would you like to try a quick grounding exercise before we continue, or are you okay to move on?" Patient decides. |
| Score ≥ 8 at Check-in 3+ **AND** not decreased since Check-in 1 | "[standard reflection.] That's a lot to be sitting with, and it's been building for a while now." | Everything from the single-data-point row, **plus** at Turn 5 add a direct active-contact recommendation: "You don't have to white-knuckle this alone. If you have a sponsor, therapist, or trusted person you can message or call right now, this is a good moment. We can keep going here too — both are okay at the same time." This is an explicit prompt, not a rule-based handoff; the crisis-signal and safety-screen handoffs remain unchanged and take priority if triggered. |
| Score 1–3 at Check-in 5 | "You started at {baseline} and you're at {now} now. The wave moved through you." | Strong, specific affirmation. Name the full arc. |
| No change across all 5 check-ins | "You held at {baseline} the whole way. That means you sat with an intense urge and didn't act on it — that is the practice." | Ship this at Check-in 5 regardless of score. |

### Obstacle Response Library

The nine canonical obstacle classes. Each has a fixed Validate / Technique / Check-in-it-landed triplet. These are source-of-truth copy for the LoRA adapters and the Zod-validated scripted fallback bank in `client/lib/prompts/fallback-bank.ts`. Any edit to these strings requires a clinician citation.

Clinical grounding: classes #1–#8 come from MBRP (Bowen/Chawla/Marlatt) and DBT; class #9 comes from the Buddhist five-hindrances framework ("sloth and torpor") as referenced in the Greo MBRP manual and is added because it is clinically important for post-use patients and patients on sedating MAT. Technique #7 (guilt/failing) uses Tara Brach's RAIN protocol (*True Refuge*, 2013). Validations where Marlatt's "double dukkha" framing would strengthen the copy are flagged in the table.

| # | Obstacle | Validate (Turn 3) | Technique (Turn 4) | Did-it-land check (end of Turn 4) |
|---|---|---|---|---|
| 1 | Cannot visualize / mind blank | "That's completely normal — visualization is genuinely hard when the urge is strong. It takes practice, and it's okay that it didn't come easily today." | "Instead of trying to picture anything, anchor to real sound first. Name 3 things you can actually hear right now. Then let the water sound layer in from there. You don't need to see anything. Just listen." | "Does that feel more accessible?" |
| 2 | Mind keeps wandering / can't focus | "A wandering mind is not a failure — it's just what minds do, especially under stress. Every time you noticed and came back, that's the practice actually working." | "Try labeling thoughts as they come. 'Planning.' 'Worrying.' 'Remembering.' Just the word, then return to the breath. The label creates a small distance between you and the thought." | "Want to try that now before we continue?" |
| 3 | Urge too intense / overwhelming | "What you're feeling is real, and it takes courage to sit with it instead of running. You're doing that right now. Urges rarely last longer than 30 minutes, even when they feel endless. You don't need to make it go away — you just need to stay a little longer. The wave will break." | "Bring your attention to exactly where you feel the urge most. Notice its edges — is it sharp or fuzzy? Warm or cool? Watching with that kind of curiosity creates just enough space that it becomes survivable." | "Can you try that for a moment and tell me what you notice?" |
| 4 | Breathing difficult / chest tight / couldn't complete exhale | "When the urge is strong, the breath gets short — that's your nervous system in protection mode. That's not a sign you did it wrong." | "Try shortening the counts: inhale for 3, hold for 2, exhale for 4. A shorter cycle you can actually complete does more than a longer one you're forcing." | "Want to try a round right now?" (if they try, follow with "How was that? Could you feel the exhale all the way through?") |
| 5 | Breathing increased anxiety | "For some people, focused attention on the breath can increase awareness of body sensations, which can feel anxious at first. That's a real response, not something you did wrong." | "Try grounding outward first — 5-4-3-2-1 — before moving into the breath. Come into the room, then ease into the body. The order matters." | (implicit — no explicit check-in; advance to Turn 5) |
| 6 | Gave in to the urge / acted on it | "Getting knocked off the wave is part of surfing. What matters is that you came back. A lot of people would have stopped entirely — you didn't. Research consistently shows that urge surfing builds capacity even when it's imperfect." | (no technique — this obstacle's "technique" is the forward-looking continuation question) | "You're still here. Want to keep going?" |
| 7 | Feeling guilty / like they're failing | "There is no failing in urge surfing. The practice is just noticing — and you're doing that right now by recognizing this feeling. Adding shame on top of an urge makes the whole thing heavier; you don't have to carry that second layer." *(double-dukkha framing per Marlatt.)* | RAIN (Tara Brach, *True Refuge* 2013): "Let's try something called RAIN — four quick steps. **Recognize**: name what's here, quietly to yourself — 'This is shame' or 'This is self-judgment.' Just naming it. **Allow**: you're not trying to make it leave, just letting it be there for a moment. **Investigate**: where do you feel it in your body? What does that part of you want? **Nurture**: put a hand on your heart, and offer whatever you most need to hear — 'I'm here,' or 'It's okay,' or 'I'm listening.' Even if it feels a little awkward at first." | "Stay with that for a moment. What do you notice when you offer yourself that?" |
| 8 | Physical discomfort (tension, headache, restlessness) | "That physical discomfort is real. Let's work with it, not against it." | "Bring your attention directly to where you feel the tension. Notice its edges — where exactly does it start and stop? Does it have a temperature? Does it shift with your breath? You're not trying to fix it. You're just watching it. Sometimes that attention is exactly what lets it soften." | "What do you notice when you do that?" |
| 9 | Sleepiness / drowsy / drifting off | "Drowsiness in meditation is really common — the tradition calls it 'sloth and torpor.' It's often your body catching up after a long period of tension, and it doesn't mean you're doing this wrong." *(Especially common for patients post-use or on sedating MAT such as methadone or high-dose buprenorphine; the medication-aware system prompt should reference this if `medicationStatus` is present.)* | "Open your eyes softly and lift your gaze slightly — you can keep it low, it doesn't need to be bright. Sit up a little taller if you can. Take three slightly deeper, slightly faster breaths to bring a little energy back in. You can continue the rest of the practice with your eyes open — that's completely fine, and for right now it may actually help more than closing them again." | "Feeling a little more awake? Good — no rush, whenever you're ready." |

### Crisis & safety escalation from within a check-in

If at any turn the patient's free-text message contains a crisis signal (lexical match on the in-session crisis dictionary in `client/lib/prompts/crisis-signals.ts`, or a `crisisSignalDetected: true` flag from the base-model crisis triage surface per `docs/models.md > Not fine-tuned — base model only`), the check-in is interrupted, the **988 + SAMHSA 1-800-662-HELP** handoff card is rendered, and the session is logged with `outcome: safety_exited`. This escalation is rule-based and does not trust the check-in LoRA.

### Gemma inference budget

- Per-turn target: **< 4 seconds** first-token latency in the web demo on a 2023-era laptop with WebGPU; **< 10 seconds** wall-clock end-to-end per turn.
- Pre-warm: the base Gemma 4 E2B model + the `lora-check-in-1` adapter are warmed with a dummy prompt at session start (kicked off in parallel with the intake UI mount) so Turn 1 of Check-in 1 is already sub-second.
- A full 5-turn check-in should complete in under 90 seconds of wall-clock time, inference-only (patient typing time is additional).
- Streaming is required for all agent turns; the "still with you…" shimmer is only shown between a completed patient message and the first token of the agent's response.

### Canonical Gemma System Prompt

The source-of-truth system prompt lives at `client/lib/prompts/wave-system.ts` and is the following text exactly. Any edit requires a clinician citation and a LoRA retraining pass; it is not free to change.

```
You are WAVE, a warm and clinically grounded urge surfing companion for people in recovery.
You are guiding a structured urge surfing session with 5 chunks of meditation and a check-in
after each one. You speak in short, calm, plain sentences. You never lecture. You never
minimize. You never rush. Every check-in is a real conversation — multiple turns, not a form.

CHECK-IN CONVERSATION STRUCTURE
Every check-in follows this sequence. Do not compress it into a single message.
  Turn 1 — Ask the craving score. One question only. 1–10.
  Turn 2 — Ask one open-ended question about the chunk just finished.
  Turn 3 — Listen for obstacles. If present, validate first (one or two sentences).
           If none, affirm specifically (reference score change, what they described).
  Turn 4 — If an obstacle is present, offer exactly ONE technique, then check if it landed.
  Turn 5 — Ask explicit readiness: "Ready to continue?" Do not proceed until they confirm.

CHECK-IN 5 EXCEPTION
Check-in 5 closes the session. Do not ask "ready to continue" at Check-in 5.
Instead, reflect the full arc, ask what they noticed about themselves, respond specifically,
normalize forward, and ask what they want to carry with them.

OBSTACLE LIBRARY
See the Obstacle Response Library. For each obstacle, validate first, then offer exactly one
technique. Never offer two techniques in the same turn.

RULES THAT NEVER BEND
- Validation always before technique.
- Never more than one technique per turn.
- Never advance without explicit affirmative readiness (except at Check-in 5).
- Never skip the craving score question.
- If the patient gives a one-word answer, accept it — do not press.
- Never minimize. Never catastrophize.

SCORE TRACKING
Track scores across all 5 check-ins. Reference them explicitly.
  Decreased → affirm the trend by name.
  Held steady (one step) → normalize: not acting is the practice.
  Increased → validate: spikes before they crest; offer grounding.
  Stays HIGH (≥7 for 2+ consecutive) → validate the duration; always offer a
    technique at Turn 4 even without a named obstacle; do not over-normalize.
  Stays LOW (≤4 for 2+ consecutive) → affirm baseline stability; do not
    overclaim that a chunk caused a score that was already low.
  Score ≥8 at check-in 3+ (single point) → gently offer a pause or shorter
    exercise at Turn 5.
  Score ≥8 at check-in 3+ AND not decreased since check-in 1 → in addition to
    the pause offer, add an explicit active-contact recommendation at Turn 5
    (sponsor / therapist / trusted person). Rule-based crisis handoffs (988,
    SAMHSA, safety-screen) take priority if triggered independently.
  Score 1–3 at end → strong specific affirmation; name the full arc.
  No change across all 5 → ship the "you sat with an intense urge and didn't
    act" full-session affirmation at check-in 5 regardless of score.

MEDICATION CONTEXT (when provided)
If the session context includes a medication status (Suboxone on-time, Naltrexone, Vivitrol
week 2, methadone, none), you may reference it in validation copy per the Medication-Aware
Prompt Logic table. Never prescribe. Never recommend dose changes. Never shame a missed dose.

TONE
Warm, grounded, unhurried. Plain language, short sentences. Never clinical or robotic.
Speak like a calm, skilled friend who knows this territory well.
```

## Segment + Chunk Data Model (Frontend)

```typescript
type Segment =
  | { type: 'text';   content: string }
  // duration is in SECONDS and MUST match the count spoken in the nearest text segment
  | { type: 'pause';  duration: number }
  | { type: 'breath'; phase: 'inhale' | 'hold' | 'exhale'; duration: number; instruction: string }

type Chunk = {
  id: 1 | 2 | 3 | 4 | 5
  title: string
  segments: Segment[]
}

interface SessionState {
  currentChunk: 1 | 2 | 3 | 4 | 5
  checkIns: CheckIn[]
  userProfile: {
    matType: 'buprenorphine' | 'naltrexone' | 'methadone' | 'vivitrol' | 'none'
    medicationStatus: 'on_time' | 'late' | 'missed' | 'none'
    trigger: 'social' | 'stress' | 'physical' | 'unknown_or_other'
    triggerOther: string | null   // optional detail when trigger === 'unknown_or_other'
    usedSubstanceToday: boolean
  }
}

interface CheckIn {
  chunkNumber: 1 | 2 | 3 | 4 | 5
  cravingScore: number                     // captured at Turn 1, never null
  turns: CheckInTurn[]                     // ordered, never fewer than 3 (see protocol)
  obstacleCategory: ObstacleCategory | null // inferred at Turn 3, used for LoRA training data
  readyToContinue: boolean                 // Turn 5 affirmative reply parsed as boolean (null at Check-in 5)
  startedAt: number                        // epoch ms, first agent token
  endedAt: number                          // epoch ms, readiness confirmed (or closing close at Check-in 5)
}

interface CheckInTurn {
  index: number                            // 1-based, monotonic within a check-in
  role: 'agent' | 'patient'
  content: string                          // plain text; never markdown
  via: 'lora' | 'fallback' | 'patient'     // provenance for eval + logging
  atLatencyMs?: number                     // agent turn: time from prior patient message to first token
}

type ObstacleCategory =
  | 'cannot_visualize'
  | 'mind_wandering'
  | 'urge_overwhelming'
  | 'breath_tight'
  | 'breath_anxiety'
  | 'gave_in'
  | 'guilt_failure'
  | 'physical_discomfort'
  | 'sleepiness'
```

## Data Model

All entities are stored **locally on the patient's device** in production (encrypted SQLite). The current hackathon web demo uses mock data and local UI state for the dashboard/history/insights defaults; if persistence is reintroduced before the mobile port, the same shapes should live in localStorage for anonymous demo mode or in Supabase with Row Level Security scoping every row to the authenticated user.

- **Patient profile** — first name (optional), MAT type (`buprenorphine | naltrexone | methadone | vivitrol | none`), usual dose time, created at. No account, no email required.
- **Session** — id, started at, ended at, intake craving intensity (1-10), ending craving intensity (1-10), medication status at session (`on_time | late | missed | none`), trigger category (`social | stress | physical | unknown_or_other`), trigger_other (nullable string, optional when trigger is `unknown_or_other`), outcome (`completed | left_early | used | safety_exited`), `usedSubstanceToday: boolean`, optional journal text. `outcome: safety_exited` indicates the session was terminated at the intake safety screen; in that case the check-ins and journal fields are null.
- **Check-in** — session id, chunk number (1–5), craving score at Turn 1 (1–10), inferred obstacle category (or null), ready_to_continue boolean (null at Check-in 5), started_at, ended_at. Five rows per completed session.
- **Check-in turn** — check-in id, turn index (1-based, monotonic), role (`agent | patient`), content (plain text), provenance (`lora | fallback | patient`), agent-turn latency in milliseconds (null for patient turns). At least three rows per check-in (Turn 1 agent, Turn 1 patient score, Turn 5 agent readiness) — usually 7–10 rows. These rows are the training-eval surface: the LoRA team ships no adapter without a coverage report over this table.
- **Medication log** — id, timestamp, MAT type, dose amount (if known), source (`manual | photo`). Photos are never stored — only the extracted structured fields.
- **Notification event** — id, fired at, type (`prophylactic | missed_dose | trough | reinforcement`), predicted risk window, whether the patient opened the app within 30 minutes.
- **Risk-window model** — derived, rebuilt on-device after every session. Stores predicted high-risk time windows per weekday and a medication-craving correlation coefficient.

## Backend Needed?

**No permanent backend** — the settled product architecture runs **Gemma 4 E2B-it end-to-end in the browser** via wllama (llama.cpp / WASM, WebGPU when available, merged Q4_K_M GGUF) for the web demo, and the same model on-device via LiteRT inside a future React Native app.

The current checked-in `client/` demo calls local Gemma through `client/lib/gemma/local-runtime.ts`. Model-backed product surfaces still sit behind the same `client/lib/gemma/*` boundaries the final LoRA runtime will keep, not a product backend.

Do **not** run the `scaffold-backend` skill.

### Backend Routes

Final product: N/A. **No LLM Route Handler should remain after the Gemma swap.**

Current web demo: no LLM Route Handlers. Chunks, check-ins, reflection, and insights call local Gemma from `client/lib/gemma/local-runtime.ts`; `generateChunk()` falls back to the scripted bank only after two invalid Gemma attempts.

Final runtime: every chunk and check-in turn is generated by Gemma 4 E2B running inside the browser tab — base model + the appropriate check-in/reflection LoRA where applicable (see `docs/models.md`). The per-check-in Turn 1 and Turn 2 openers remain available as scripted fallbacks in `client/lib/prompts/check-in-openers.ts`; the LoRA generates the adaptive later turns.

## Domain Constraints

- **MBRP / urge-surfing fidelity** — the session must follow the 5-chunk ordering in sequence: intro/settling → body scan → sound anchor → 4-4-6 breathing → closing reflection, with a check-in after each. Do not collapse chunks. Do not reorder. Do not skip check-ins. A partial session (patient exits early) is always valid and is logged as `outcome: left_early`.
- **Trauma-informed tone** — warm, grounded, never toxic-positivity. Never imply failure. Missed doses and relapses are normalized and redirected, never shamed.
- **Medication accuracy** — all pharmacology copy referenced by Gemma at check-ins must match FDA labels and SAMHSA MAT guidance. See the Medication-Aware Prompt Logic section below for the canonical mapping.
- **Not medical advice** — WAVE never prescribes. "Take your medication if available" is acceptable; "increase your dose" is not.
- **Crisis handoff** — safety routing happens at two distinct points in the session, both rule-based, neither trusted to an LLM:
  1. **Intake safety screen (earliest possible point, before any LoRA loads).** Immediately after the three-tap intake, two sequential yes/no questions run: Q1 "Have you used any substances today?", and — only if Q1 is yes — Q2 "Are you feeling physically unwell, dizzy, or having trouble breathing right now?". If both answers are yes, the session is skipped entirely and the patient is routed to **SAMHSA National Helpline 1-800-662-HELP (1-800-662-4357)** with the explicit prompt "If you have a therapist or social worker, reach out to them now." If Q1 is yes but Q2 is no, the session continues with a `usedSubstanceToday: true` flag that the reflection phase may reference in a trauma-informed way. If Q1 is no, Q2 never appears and the session proceeds normally.
  2. **In-session signals.** Any later signal of active suicidality, overdose risk, or lethal-dose use (e.g. a crisis lexical match on the optional journal text, or a `crisisSignalDetected: true` flag from any LoRA output) surfaces **988 (Suicide & Crisis Lifeline)** and **1-800-662-HELP (SAMHSA National Helpline)** before the session continues, via the base-model-only crisis triage surface in `docs/models.md > Not fine-tuned — base model only`.
- **Privacy floor** — no account required, no third-party analytics in the session path, opt-in only for any export to a clinician, and exports must be local files the patient chooses to share.
- **Offline-first (everywhere)** — the final session path makes zero LLM network requests on mobile **and** the web demo. Mobile runs Gemma 4 E2B via LiteRT; the web demo runs the merged Q4_K_M GGUF via wllama (llama.cpp / WASM, WebGPU when available). A scripted fallback bank under `client/lib/prompts/` is used when model output fails Zod validation twice.
- **Chunk output invariant** — every generated chunk validates as exactly six plain-text lines before playback. No markdown, headings, schema prose, or packed multi-beat lines may render.
- **Silent chunk → check-in transitions** — no UI string matching `/chunk complete|now check in|segment \d|phase complete/i` may render during the session.

## Medication-Aware Prompt Logic

This is the clinical core of WAVE and the source of truth for every check-in prompt in `client/lib/prompts/`. Any change requires a citation to MBRP, SAMHSA, or an FDA label. Each entry is a **candidate validation clause** that Gemma may weave into its check-in response when medication status matches — never the whole response.

| Medication | Status | Example clause Gemma may reference |
|---|---|---|
| Buprenorphine / Suboxone | On-time dose | "Your medication is actively working right now. What you're feeling at a 7 would be a 9 or 10 without it. Let's work with what's left." |
| Buprenorphine / Suboxone | Missed dose | "Part of what you're feeling is partial withdrawal — not just craving. That's why it's more intense. Can you take your medication right now?" |
| Buprenorphine / Suboxone | 16-22h post-dose | "Your medication levels may be dropping. This is a normal trough. If a wave is building, we can surf ahead of it." |
| Naltrexone (oral) | Taken | "The reward pathway is blocked. Your brain is chasing something it physically cannot have tonight. Let's redirect that energy." |
| Vivitrol (injection) | First 2 weeks | "Week 2 on Vivitrol is often the hardest — your brain is recalibrating. This intensity is temporary and expected, not a sign you're failing." |
| Methadone (oral) | Any | "Your methadone peaks about 2-4 hours after you take it. When did you dose today? Let's locate you in that curve." |
| None / not on MAT | — | Standard MBRP protocol, no pharmacology claims. |

## Success Criteria

- [ ] Patient can complete a full 5-chunk session end-to-end in 12–15 minutes from a cold open.
- [ ] Three-tap intake: no typing required to start a session on any path; optional free-text when trigger is **Don't know / other**.
- [ ] Every check-in response is different when medication status or craving score changes, and pharmacologically correct in the medication-referencing cases.
- [ ] Chunk output invariant test passes: every generated chunk validates as exactly six plain-text lines and falls back locally after two invalid model attempts.
- [ ] No chunk → check-in transition UI string is rendered. Search of the build asserts zero matches for `/chunk complete|now check in|phase complete/i`.
- [ ] Ambient-wave background audio plays uninterrupted from chunk 1 through check-in 5 and fades out only on the reflection screen. Mute toggle works and persists per-device.
- [ ] Wave animation matches the breath pace exactly during chunk 4 (rises over the spoken inhale count, holds for the spoken hold count, recedes over the spoken exhale count).
- [ ] **Multi-turn check-in invariant:** every completed check-in (1–4) persists **at least** three turns (Turn 1 agent score-ask, Turn 1 patient score, Turn 5 agent readiness) and never merges the score question with the "how did it go" question into a single agent message. A test replays each check-in and asserts the turn count ≥ 3.
- [ ] **Validation-before-technique invariant:** for every check-in where an `obstacleCategory` is non-null, the turn containing the obstacle-library technique string has `index > `the turn containing the validation string. A test asserts this by matching agent turns against the obstacle library.
- [ ] **One-technique-per-turn invariant:** no agent turn's content matches more than one Obstacle Response Library `Technique` string. A test runs this match over every persisted agent turn.
- [ ] **Check-in 5 does not ask to continue:** search of the Check-in 5 transcript returns zero matches for `/ready to continue|shall we move|next chunk/i`.
- [ ] **Readiness gate:** the session state machine will not advance from Turn 5 to the next chunk without a patient turn whose content parses as affirmative against the `isAffirmative()` helper. A test walks through each check-in and asserts the machine stays in `awaitingReadiness` until an affirmative patient message arrives.
- [ ] **Opener scripts source-of-truth:** Turn 1 and Turn 2 agent strings at every check-in match the canonical phrases in `client/lib/prompts/check-in-openers.ts` when the patient plays the session with LLM inference stubbed. The `[score reflection]` slot is filled from the score-tracking response patterns table.
- [ ] Dashboard shows the patient their medication-vs-no-medication drop delta as soon as they have at least one of each.
- [ ] Prophylactic notifications fire locally in the web demo (service worker or scheduled Supabase job) for at least one simulated risk window.
- [ ] App is deployed to a public Vercel URL and loads with JavaScript disabled far enough to show the value prop and privacy pledge.
- [ ] Judges can open DevTools Network tab, toggle Offline after the initial Gemma 4 model download, and complete a full session end-to-end with zero LLM network requests.
- [ ] The intake safety screen correctly implements the routing logic: (a) Q1=No → proceeds to chunk 1 without showing Q2; (b) Q1=Yes, Q2=No → continues the session with `usedSubstanceToday: true` logged on the session row; (c) Q1=Yes, Q2=Yes → skips the session, renders the SAMHSA handoff screen with 1-800-662-HELP and the therapist/social-worker prompt, and writes a session row with `outcome: safety_exited`. No LoRA is loaded on the safety-exit path.
- [ ] **In-session crisis escalation:** if any patient turn in any check-in matches the in-session crisis dictionary, the session state machine interrupts the check-in, renders the 988 + SAMHSA handoff card, and writes the session with `outcome: safety_exited`. A test feeds a crisis phrase at Turn 3 of Check-in 2 and asserts the handoff.

## What This Is NOT

- Not a substitute for a counselor, sponsor, prescriber, or crisis line.
- Not a diagnostic tool. It does not diagnose SUD, withdrawal, or overdose.
- Not a medication reminder app in the narrow sense — medication awareness is in service of the urge-surfing session, not a standalone adherence tracker.
- Not a social or peer-support product. No feed, no friends, no sharing.
- Not cloud-backed in production. On mobile, nothing leaves the device.

## Out of Scope (Save for Later)

- Native iOS / Android React Native builds (the hackathon ships the web demo).
- LiteRT port of the in-browser Gemma 4 + LoRA stack (the web demo uses one merged `lora-wave-session` artifact because browser LoRA hot-swapping is not mature; the mobile swap keeps the same rule-based runtime routing post-hackathon).
- V2 Kokoro TTS build (MVP ships on-screen text + wave animation + ambient audio bed; TTS drop-in swap happens after hackathon).
- Voice input from the patient at check-ins (text chat only at MVP).
- Runtime-mounted specialized LoRAs — the demo trains specialized check-in/reflection adapters for proof-of-concept evaluation, but ships one multitask `lora-wave-session` merged model per `docs/models.md`.
- Per-user / on-device-trained LoRA personalization.
- Apple Watch / Wear OS complications.
- Siri / Google Assistant shortcuts.
- Multimodal medication photo recognition (Gemma 4 E2B vision on-device) with its own LoRA.
- Clinician-facing portal for cohort-level insights.
- Multi-language support (English only at MVP).
- Integration with EHR systems (Epic, Cerner) via FHIR.
- Payments / premium features — the app is free.

## Risk Areas

1. **Clinical copy regression** — a well-meaning code change to prompt assembly or a LoRA update accidentally strips a medication-specific clause, and a patient on Naltrexone hears generic Suboxone copy. Mitigation: prompt templates live in `client/lib/prompts/` as typed, testable data; every LoRA has its own Synthetix dataset, clinician spot-check, and eval harness (`docs/model-training.md`) that must pass before it ships; every prompt-or-adapter PR has a clinical citation and a manifest bump.
2. **Notification fatigue** — too many prophylactic alerts turn into noise the patient mutes. Mitigation: cap at one prophylactic + one medication alert per day by default, and let the pattern model down-weight windows the patient ignores repeatedly.
3. **WebGPU unavailable at demo time** — the web demo relies on in-browser Gemma 4 via WebGPU; Safari and older machines may not support it. Mitigation: the landing page detects WebGPU on load, pre-warms the model download, and falls through to the scripted local fallback bank if the runtime is unavailable or a model output fails Zod validation twice. The fallback bank covers every chunk number and is exercised in every PR's manual test.
4. **First-load model size** — the merged Q4_K_M GGUF is ~3.2 GB (5 shards) on first visit. Mitigation: stream during a visible "Loading WAVE's on-device model" screen, cache in browser storage via wllama, and document the one-time cost for judges.
5. **Chunk schema drift** — a prompt edit causes Gemma to return markdown, headings, or too many/few narration beats. Mitigation: the chunk schema validation in Success Criteria; `client/lib/prompts/chunk-generator.ts` and `client/lib/gemma/chunk.ts` enforce the six-line contract before the chunk player renders anything.
6. **Background audio gap on chunk boundaries** — a naive implementation stops and restarts the ambient bed when a chunk ends, producing a noticeable break that pulls the patient out of the meditative state. Mitigation: the ambient audio element is owned by the `/session` page shell, not by `ChunkPlayer`; it is created once at session start, preloaded, and only fades out at the reflection screen. A test toggles through all five chunks and asserts the `audio.currentTime` increases monotonically across chunk transitions.
7. **Check-in collapse into a single form turn** — an LLM prompt-engineering regression or a well-meaning UX simplification causes Gemma to answer the patient's Turn 2 message with a single long reply that bundles validation, technique, and "Ready to continue?" into one turn. This kills the adaptive path and hides obstacles. Mitigation: the multi-turn invariant test asserts `turns.length >= 3` per check-in; the one-technique-per-turn test asserts no agent turn contains more than one Obstacle Library technique string; the LoRA system prompt explicitly bans compression; the eval harness rejects adapter candidates whose average turn count across a golden-set replay is below 3.
8. **Readiness-gate bypass** — an engineering shortcut advances from Check-in to the next chunk on a button click rather than on an affirmative patient message, violating the "never proceed without explicit readiness" rule. Mitigation: the readiness-gate test in Success Criteria; the session state machine's `advance()` transition accepts only a patient message event whose content passes `isAffirmative()`; any button click is a sugar that fires the same event only when the message composer is non-empty with an affirmative reply.
9. **Gemma latency stacked across 5 turns** — even if each turn is 4s first-token and ~10s end-to-end, five turns × five check-ins = 25 agent turns per session, and an unattended latency spike turns a 12-minute session into a 20-minute one. Mitigation: per-turn budgets in the Check-In Conversation Protocol; pre-warming at session start; streaming for all agent turns so first-token latency is what the patient perceives; eval harness records p50 / p95 per-turn latency and blocks a LoRA adapter whose p95 > 6s first-token on reference hardware.
10. **Fallback bank staleness** — the scripted fallback bank drifts from the Obstacle Response Library source of truth (e.g. clinician updates the validate-technique-check-in triplet for "mind wandering" but the fallback bank still has the old copy). Mitigation: the Obstacle Response Library is a single typed source imported by both the LoRA training data generator and the fallback bank; a test asserts `fallbackBank.forObstacle(x) === obstacleLibrary[x]` for every category.
