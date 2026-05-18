# WAVE — Pitch Deck

> ~10-slide main deck + labeled Appendix. Voice/story canonical to `submission/human-demo-script.md` (Wenqing, therapist intern at Kaiser; Bill, engineering — first person). Technical depth verified against `submission/kaggle-writeup.md`. Narrative arc consistent with `submission/video-script.md`.
> Structure follows the Hackathon Playbook applicable subset (async submission, no live Q&A): main deck = problem + shocking number → one-line reframe → demo as the centerpiece → vision close. Lead with impact; tech is the enabler. Appendix exists for credibility (architecture, tradeoffs, edge/failure modes, cost/scale, roadmap).
> Rubric weighting: Impact & Vision 40 / Storytelling 30 / Technical depth 30 — story and impact front-loaded; technical claims stay concrete and verifiable. Ethos → Pathos → Logos across the arc; SUCCESs (Simple, Unexpected, Concrete, Credible, Emotional, Story).
> Brand: deep ink/teal background, glowing cyan crest (~`#5CE1D6`), light serif for emotional headlines, mono/uppercase for technical labels. On-slide text is sparse by design; prose lives in speaker notes.

---

## Slide 1 — WAVE

**On-slide:**
- WAVE
- An offline AI companion that helps you ride out a craving — in real time, the way a clinician would.
- Gemma 4 Good Hackathon · Health & Sciences
- [[USER: team member names]]

**Speaker notes:**
"I'm Wenqing. I'm a therapist intern at Kaiser. I see patients struggling with substance use every week, and they need more support than a weekly appointment can give. So Bill and I built WAVE — an offline AI companion that helps people ride out a drug or alcohol craving in real time, the way a trained clinician would." Hold a beat. Let the wave settle before the next slide. (Ethos: this is a clinician speaking, not a vendor.)

**Visual:** Full-bleed home-screen ocean canvas (`client/app/page.tsx`), wave faintly rising, WAVE wordmark lower third. No UI chrome. Same footage that opens and closes the video.

---

## Slide 2 — A craving doesn't schedule itself

**On-slide:**
- 1 in 6 Americans meet SUD criteria. Only ~1 in 5 who need treatment get it.
- The window to act when a craving hits: under 10 minutes.
- He's 43. Just lost his job. The craving is now.
- His next therapy session: 4 days away.

**Speaker notes:**
"Open on the number, because the number is the shock. One in six Americans meet the criteria for a substance use disorder — and only about one in five of those who need treatment ever receive it. Now make it one person. A forty-three-year-old man. Just lost his job. Drinking started as comfort, then became uncontrollable. A craving hits him right now. His next therapy session is four days away. The window to act is under ten minutes. Barriers and stigma sit in that gap. WAVE is built for exactly that ten minutes." (Pathos: loss framing — the cost of doing nothing, before any solution.)

**Visual:** Dark ocean, wave cresting high. Two stats burned in (`1 in 6` / `~1 in 5`) in near-white glow; `< 10 min` as a stark counter; the persona line as one quiet caption. No stock recovery imagery.

---

## Slide 3 — The reframe

**On-slide:**
- Recovery support shouldn't require a connection, an appointment, or a disclosure.
- WAVE puts a clinician-grade urge-surfing session in your pocket — offline, private, in the moment the craving crests.

**Speaker notes:**
"Here is the one idea this whole project turns on. Today, getting help in a craving means you need a connection, an open appointment, and the willingness to disclose to a system. WAVE removes all three. It puts a clinician-grade urge-surfing session in your pocket — fully offline, fully private, available the second the craving crests instead of four days later. Everything after this slide is just proof that this sentence is real." (This is the single-sentence vision reframe; deliver it slowly, it is the spine of the pitch.)

**Visual:** Near-empty slide. Just the two lines over the ocean, large serif. The wave holds at its peak — suspended — to mark the pivot from problem to solution.

---

## Slide 4 — What WAVE is

**On-slide:**
- A local AI companion that responds the way a skilled clinician would
- Grounded in Marlatt's Mindfulness-Based Relapse Prevention (MBRP)
- Therapeutic check-ins DURING the session — not before, not after
- Medication-aware: a 7/10 four hours post-Suboxone ≠ a 7/10 at hour 22

**Speaker notes:**
"WAVE is a local AI companion that responds the way a skilled clinician would. It listens, adapts, and guides you through the craving in real time using urge surfing, grounded in Marlatt's Mindfulness-Based Relapse Prevention framework — every phrase shaped by real clinical scripts and SAMHSA guidelines. Two things make it different from any mindfulness app on the market. First, the check-ins happen during the session, between guided chunks — not a form before or after. Second, it is medication-aware: most people in recovery are on Medication-Assisted Treatment, and a seven out of ten four hours after a Suboxone dose is a different neurobiological event than the same seven at hour twenty-two, when medication is troughing. No mainstream urge-surfing tool knows that difference. WAVE was built to close it." (Credible + Concrete: the medication insight is the proof this came from a clinician.)

**Visual:** Screenshot of the session chunk player (`client/app/session/_components/chunk-player.tsx`) with the medication-aware banner visible ("Your Suboxone is in your system right now…"), wave behind, single italic narration line.

---

## Slide 5 — The session, end to end (demo)

**On-slide:**
- 1. Three taps — intensity · medication · trigger (no typing)
- 2. Rule-based safety screen — before any model runs
- 3. 12–15 min session: 5 narrated MBRP chunks + adaptive Gemma check-ins
- 4. Personal arc: the craving drops in your own numbers — `7 → 2`

**Speaker notes:**
"This is the heart of the pitch — walk it slowly, this is what they remember. The flow is deliberately tiny, because thinking clearly is hard mid-craving. Three taps: how strong, what medication and whether today's dose is in, what set it off. Then a rule-based safety screen — two yes/no questions that route to the SAMHSA helpline if needed, never touching a model. Then the twelve-to-fifteen-minute session: five narrated MBRP chunks, and between every chunk a real adaptive Gemma check-in — multi-turn conversation, not a form. It validates before offering one technique, and never advances until the person says they're ready. At close, the patient watches their craving fall in their own numbers and names a ten-minute next step." (This is the demo centerpiece — ~60–70% of attention lives here.)

**Visual:** Three-up screenshot strip — intake (`intake-form.tsx`) → voice check-in (`voice-check-in.tsx`, chat bubbles + mic meter) → reflection ScoreArc (`score-arc.tsx`) showing `7 → 2`. For the video: a 15-second recorded walkthrough using the Demo-mode toggle (no live WebGPU-on-stage risk). See Appendix A for the full architecture this runs on.

---

## Slide 6 — It doesn't wait for you

**On-slide:**
- Lock-screen notification 15 min BEFORE a predicted risk window
- "The next 2 hours can be challenging. Open WAVE now — before the wave builds."
- Intervenes at the moment of highest clinical leverage
- Proactive prevention, not just reactive rescue

**Speaker notes:**
"WAVE doesn't wait for you to open it. Based on your history, the local scheduler fires a notification fifteen minutes before a predicted risk window — the moment of highest clinical leverage, while the person still has executive function and a real choice. That is the shift from reactive rescue to proactive prevention, and it happens entirely on the device, with no history ever leaving the phone." (Unexpected: a recovery tool that reaches out first.)

**Visual:** Mock lock-screen notification card (the pre-craving message) centered over the ocean. Single line of supporting text. Restrained.

---

## Slide 7 — It knows its lane

**On-slide:**
- Strict rule-based safety screen catches acute crisis → 988 / SAMHSA
- No medication advice. Ever. No dose changes. No shame for a missed one.
- Crisis routing is code — never delegated to a fine-tuned model
- The safety boundary is a deliberate engineering decision

**Speaker notes:**
"A tool in this space has to know its limits. If a session surfaces signs of acute crisis, a strict rule-based screen catches it immediately and routes to 988 and SAMHSA — that path is plain code, never delegated to a model, so it cannot hallucinate its way around a crisis. WAVE does not offer medication advice: it never prescribes, never recommends a dose change, never shames a missed one. Drawing the safety boundary in code, on purpose, is the single most important engineering decision in the project." (Ethos again — restraint earns trust; this is what makes a clinician comfortable recommending it.)

**Visual:** A small "Crisis signal → 988 / SAMHSA (rule-based · no model)" flow chip, with a clear visual wall between "model" and "code" regions. Minimal.

---

## Slide 8 — Why Gemma 4 E2B, on-device

**On-slide:**
- `google/gemma-4-E2B-it`, INT4 (Q4_K_M GGUF), ~1.5 GB — built for browser/phone
- Zero LLM network requests during a session — verifiable in DevTools
- On-device = a precondition for trust, not a privacy bullet point
- Structured output + clinician-grade tone + edge latency at the moment of need

**Speaker notes:**
"For users with no data, no WiFi, and no margin for error, connectivity cannot be a prerequisite for care. Gemma 4 E2B-it runs entirely in the browser and on the edge — the most sensitive interactions, disclosing triggers and medication and logging a craving, never leave the phone. For populations carrying the dual stigma of financial instability and substance use, that is not a privacy feature; it is a precondition for trust. Beyond privacy, Gemma 4 gives us exactly what the clinical architecture demands: structured output for strict schema adherence, an adaptable tone that mirrors an unhurried clinician rather than a wellness bot, and edge latency so WAVE responds in the moment the craving is cresting. Judges can open DevTools, toggle offline after the one-time download, and complete a full session. The deeper engineering — adapter, decoding contract, the honest postmortem — is in Appendix A and B." (Logos: the model choice is argued, not asserted.)

**Visual:** Clean one-line architecture caption over the ocean: `Gemma 4 E2B + LoRA → WebGPU → in the browser. No cloud.` Optionally a DevTools "offline" toggle screenshot to prove zero network.

---

## Slide 9 — Reach: built for who's left behind

**On-slide:**
- People experiencing homelessness · rural communities without broadband
- Undocumented individuals who can't risk cloud surveillance
- Low-income workers without consistent data plans
- Runs on a model that fits a phone → marginal cost per person ≈ $0

**Speaker notes:**
"Because every piece runs on-device on a model that fits a phone, WAVE works with no data and no WiFi, ever — and the marginal cost per additional person is effectively zero. That makes it reachable for exactly the people internet-dependent telehealth leaves behind: people experiencing homelessness, rural communities without broadband, undocumented individuals who cannot risk cloud surveillance, low-income workers who can't afford a consistent data plan. WAVE stands on four things: clinically rooted in real patient observation, completely offline, absolutely private, and proactive rather than only reactive. It is deployable to the population that needs it most and can least afford a subscription." (Impact: connect the engineering win directly back to the person from Slide 2.)

**Visual:** Four-quadrant reach graphic (the four populations) with the `marginal cost ≈ $0` line as the anchor. Restrained, no clip-art people.

---

## Slide 10 — Vision

**On-slide:**
- WAVE is a bridge — to the next safe minute. Not a replacement for care.
- Imagine recovery support that's always there, costs nothing per person, and never leaves the phone.
- Repo: github.com/emilyLi2020/Wave
- Demo: [[USER: LIVE DEMO URL UNRESOLVED — waves.vercel.app is NOT our app (foreign squat) and must NOT be used; waves-art3m1s.vercel.app returns 401. Deploy client/ to a team-controlled Vercel domain with NO auth, verify anon 200 in incognito, then put THAT url here]]
- [[USER: YouTube video URL]] · Model: huggingface.co/Maelstrome/lora-wave-session-r32

**Speaker notes:**
"Imagine a world where recovery support is always there — in the worst ten minutes, with no connection, no appointment, no disclosure, and no cost per person. WAVE isn't a replacement for clinical care. It's a bridge — to the next safe minute. Everything you saw runs today, in a browser, on the person's own device. Thank you." (Vision close: end on the what-could-be, not the tech.)

**Visual:** Return to the opening home-screen ocean, wave settling flat, WAVE wordmark. End card with the links/handles. Same bookend as the video close.

---

# APPENDIX

> Not part of the ~10-slide main deck. These exist for judges verifying Technical Depth & Execution (30 pts). Concrete, honest, no grandiosity.

---

## Appendix A — Architecture

**On-slide:**
- The whole session pipeline, and exactly where the model is vs. where code is

**Speaker notes:**
"This is the system end to end. The only LLM in the loop is the merged-LoRA Gemma 4 E2B running in-browser via wllama + WebGPU. Everything safety-bearing — intake, the crisis screen, crisis routing — is deterministic code, deliberately. There is no server in the session path."

**Visual:** ASCII flow:

```
                        ┌──────────────────────────────────────────┐
   User (mid-craving)   │            ALL ON-DEVICE / NO CLOUD        │
        │               │                                            │
        ▼               │                                            │
 ┌───────────────┐      │   [CODE]                                    │
 │ 3-tap intake  │──────┼──▶ rule-based SAFETY SCREEN ───┐            │
 │ intensity /   │      │     (2 yes/no, no model)       │ crisis?    │
 │ medication /  │      │                                ▼            │
 │ trigger       │      │                       ┌──────────────────┐  │
 └───────────────┘      │                       │  988 / SAMHSA    │  │
                         │                       │  routing [CODE]  │  │
                         │                       └──────────────────┘  │
                         │           no-crisis path                    │
                         │               │                             │
                         │               ▼                             │
                         │   ┌─────────────────────────────────────┐   │
                         │   │  SESSION SHELL  (12–15 min)          │   │
                         │   │  Chunk 1 ─ Check-in 1 ─ Chunk 2 ─ …  │   │
                         │   │  Chunk 5 ─ Check-in 5                │   │
                         │   │  narration + check-ins = [MODEL]:    │   │
                         │   │  Gemma 4 E2B + merged LoRA           │   │
                         │   │  (Q4_K_M GGUF · wllama · WebGPU)     │   │
                         │   └─────────────────────────────────────┘   │
                         │               │                             │
                         │               ▼                             │
                         │   ┌─────────────────────────────────────┐   │
                         │   │ Reflection card  (craving 7 → 2)     │   │
                         │   │ → local encrypted log [CODE]         │   │
                         │   │ → on-device risk-window scheduler    │   │
                         │   │   → pre-craving lock-screen notify   │   │
                         │   └─────────────────────────────────────┘   │
                         └──────────────────────────────────────────┘
```

`[MODEL]` = the only place an LLM runs. Everything `[CODE]` is deterministic by design.

---

## Appendix B — Technical depth & the honest postmortem

**On-slide:**
- One adapter: `lora-wave-session-r32` — Unsloth QLoRA (r32), PEFT-merged, multitask
- Ships as GGUF Q4_K_M via `@wllama/wllama` + WebGPU (one ~3.2 GB one-time load)
- Output contract: strict `json_schema` (check-ins) + `json_object`/Zod (chunks, reflection) + clinician-reviewed fallback bank
- Postmortem: native tool-call fine-tune collapsed across v1–v6 → switched to constrained decoding

**Speaker notes:**
"One adapter produces phase narration, check-in turns, and the reflection card, selected by a surface discriminator, trained on a clinician-seeded dataset with local validators and a clinician spot-check gating every accepted row. Clinical copy can't be free-form, so we constrain decoding: strict json_schema for check-ins, json_object plus Zod for chunks and reflection, with a clinician-reviewed local bank if two attempts fail — the patient is never blocked. And the honest part: our first plan was to fine-tune Gemma to emit native tool-call tokens. Across six runs, v1 through v6, it collapsed to one canned response — the dataset was ~94% non-tool turns and cross-entropy crushed the control token by roughly five orders of magnitude. The lesson that survived: constrained decoding beats fine-tuning a rare control token into a dominant distribution. The full postmortem is in the repo — it's the most honest engineering artifact we have."

**Visual:** Two-column: left = adapter + decoding contract stack; right = the v1–v6 collapse curve sketch (control-token probability flatlining). Label clearly "v1–v6" (never cite a v7).

---

## Appendix C — Tradeoffs & why

**On-slide:**
- On-device vs. cloud → chose on-device: trust precondition for this population; cost ≈ $0
- Fine-tune for tool-calls vs. constrained decoding → chose constrained decoding (postmortem-driven)
- Free-form generation vs. schema + fallback bank → chose schema + bank: patient never blocked
- Bigger model vs. Gemma 4 E2B → chose E2B: fits a phone/browser; edge latency at the moment of need

**Speaker notes:**
"Each of these was a real fork. On-device cost us cloud-scale model size but bought the only thing that matters here — trust and zero marginal cost for an underserved population. Constrained decoding cost us 'native' elegance but bought reliability we could verify, and the postmortem proves we earned that opinion. The schema-plus-bank fallback costs occasional non-model copy but guarantees the patient is never left staring at a blank screen mid-craving. E2B over a larger model costs raw capability but is the only thing that runs in the browser at the latency a cresting craving demands. Every tradeoff was decided in the direction of the person in Slide 2."

**Visual:** Four decision rows, each as `chose X over Y → because Z`. Mono/uppercase labels.

---

## Appendix D — Edge & failure modes

**On-slide:**
- Acute crisis → rule-based screen → 988 / SAMHSA (deterministic, model never in this path)
- Model returns invalid/unsafe structure → 2 retries → clinician-reviewed fallback bank
- WebGPU unavailable / download incomplete → graceful message; session not faked
- Medication advice / dose questions → hard-refused by design; out of lane
- No network at all → expected, fully supported (the default operating condition)

**Speaker notes:**
"The safety story is mostly a story about failure modes. Acute crisis never depends on a model — it's a deterministic screen straight to 988 and SAMHSA. Bad model output is caught by validators, retried twice, then served from a clinician-reviewed bank, so a malformed generation can't strand the patient. If WebGPU isn't available, we say so honestly rather than fake a session. Anything touching medication dosing is hard-refused — it's out of lane on purpose. And 'no network' isn't a failure mode at all; it's the default condition WAVE is designed for."

**Visual:** Failure-mode table: condition → deterministic handling. Emphasize the model is absent from every safety-critical row.

---

## Appendix E — Cost & scalability

**On-slide:**
- One-time ~3.2 GB model download, then runs offline indefinitely
- Marginal cost per additional user ≈ $0 (no inference servers, no API spend)
- Scales by distribution, not by infrastructure — no capacity ceiling
- No PII egress → no data-handling cost or breach surface

**Speaker notes:**
"The economics are the impact argument. After a one-time roughly three-gigabyte download, WAVE runs offline forever. There are no inference servers and no per-call API spend, so the marginal cost of the next user is effectively zero. It scales by distribution rather than by infrastructure — there is no capacity ceiling to fund. And because no personal data ever leaves the device, there is no data-handling cost and no breach surface. This is what makes a free, population-scale deployment actually plausible."

**Visual:** Single comparison: typical telehealth (per-user inference + infra + data cost, rising line) vs. WAVE (flat near-zero line after one-time download).

---

## Appendix F — Roadmap beyond the hackathon

**On-slide:**
- React Native build for native mobile distribution
- Prophylactic pre-craving notifications tuned from on-device history
- On-device medication photo recognition (no image ever leaves the phone)
- On-device pattern learning from encrypted session history

**Speaker notes:**
"Beyond the hackathon, the mobile roadmap turns WAVE into a continuous support system. A React Native build for real distribution. Pre-craving notifications tuned from each person's own on-device history. On-device medication photo recognition so even the camera input never leaves the phone. And on-device pattern learning from encrypted session history, so WAVE gets better for each person without anything ever touching the cloud. Each item keeps the same non-negotiable: it stays on the device."

**Visual:** Four-item timeline, all four anchored to a single "stays on-device" baseline.

---

## Open questions for the human

- [[USER: team member names]] — needed on Slide 1 (writeup/video carry the same gap).
- [[USER: YouTube video URL]] — Slide 10 links block (still open per AgentHub post #16).
- [[USER: LIVE DEMO URL]] — Slide 10 still a placeholder per FEEDBACK post #20: waves.vercel.app must NOT be used. Deploy `client/` to a team-controlled Vercel domain with no auth, verify anonymous 200 in incognito, then thread that exact URL here.
- Confirm `huggingface.co/Maelstrome/lora-wave-session-r32` is PUBLIC before this deck is shown to judges (a broken model link is a Technical Depth credibility hit).
- Slide 5 / demo-format decision: recommend a 15-second recorded walkthrough (Demo-mode toggle; no WebGPU-fails-on-stage risk) over a live run.
- Optional: a single defensible eval metric (if `eval.json` yields one) would strengthen Appendix B — currently no quantitative eval claim is made, by design, to avoid fabricated metrics.
- Per AgentHub post #22: the frontend-fine-tuned / backend-base model split is intentionally NOT in this deck (repo-docs only; stating it would contradict the on-device/no-server core claim).
