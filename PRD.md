# Product Requirements Document

## What Is This?

WAVE is an offline-capable, medication-aware urge surfing companion that helps people in SUD recovery ride out cravings in real time — and learns their personal high-risk windows so it can notify them **before** the next craving peaks. It ships as a **Next.js web application** (with an optional PWA layer for home-screen install, local notifications, and offline caching), not a native mobile app.

## Target User

Adults in recovery from Substance Use Disorder (opioid, alcohol, or stimulant), many of whom are on Medication-Assisted Treatment (Suboxone / buprenorphine, Naltrexone, Methadone, or Vivitrol). They typically have a counselor or prescriber they see weekly or monthly, but the window between craving onset and acting on it is often under 10 minutes — far shorter than any professional support can respond to. Existing urge-surfing apps treat every craving identically and ignore the patient's medication status entirely, which is clinically wrong: the same 7/10 craving means something very different at hour 4 versus hour 22 post-Suboxone dose. Our user is frustrated that no tool meets them where they actually are, neurobiologically, at the moment the wave builds.

WAVE meets them on the device they already have: any modern phone or laptop with a browser. No app store, no install required to start — "open a URL, start surfing."

## Core Flow

```
INPUT:   Patient opens WAVE (via proactive Web Push notification, an
         installed PWA icon, a bookmark, or a shared URL) and taps three
         answers: craving intensity (1-10), medication status (on-time /
         late / missed / N/A), trigger category (social / stress /
         physical / unknown).

PROCESS: Gemma 4 generates a medication-aware session: a 1-2 min
         medication acknowledgment tuned to what they took or missed, a
         body-scan that locates the craving physically, a 5-8 min wave
         animation with adaptive narration through rise / peak / fall
         phases, and a reflection that shows the patient their own
         longitudinal craving-vs-medication data. Gemma 4 runs either
         in-browser (WebGPU / WASM) or via a thin Route Handler that
         proxies an on-server Gemma 4 runtime (Ollama / llama.cpp) —
         never a third-party cloud LLM in the session path.

OUTPUT:  Patient rates ending intensity on the slider, sees a one-screen
         insight ("You surfed a 7 down to 2. On medication days you drop
         5.1 points on average; off-medication days 2.8."), picks a next
         action (call someone, walk, water, rest), and the session is
         logged locally (IndexedDB / localStorage) to refine future
         risk-window predictions.
```

## Core Features (MVP)

1. **Three-tap intake** — intensity, medication status, trigger — that fully conditions the rest of the session.
2. **Medication-aware acknowledgment** — Gemma 4 generates pharmacologically correct, trauma-informed copy based on which MAT the patient is on and whether they took today's dose.
3. **Urge surf wave session** — animated wave (Lottie / SVG) with adaptive rise / peak / fall narration and a live intensity slider the patient drags as the wave changes.
4. **Longitudinal pattern learning** — after ~7 sessions, an in-browser model surfaces high-risk time windows and a medication-vs-craving correlation the patient can see in their own data.
5. **Prophylactic notifications** — a Service Worker plus the Web Notifications / Web Push API fires a "the next 2 hours can be challenging" alert 15 minutes before a predicted risk window, plus missed-dose and medication-trough alerts. Degrades to an in-page reminder when Push is unavailable.
6. **Minimum-friction entry points** — installable PWA (Add to Home Screen), a URL a clinician can text to the patient, a copy-paste-to-lock-screen bookmark, and Web Share Target support so other apps can hand craving intensity into WAVE.

## Pages / Screens

| Page | Purpose | Key Elements |
|------|---------|--------------|
| Landing (`/`) | Explain WAVE to a clinician or patient in 10 seconds; route to onboarding or an in-session demo | Hero, one-sentence value prop, "Start a session" CTA, privacy pledge, demo video link, "Install WAVE" prompt when PWA criteria met |
| Onboarding (`/onboarding`) | Capture the only three things we need: first name (optional), what MAT if any, usual dose time | 3-step form, Zod validation, written consent checkbox, stored locally in IndexedDB (via `localforage`) with a `localStorage` fallback |
| Session (`/session`) | The whole urge-surfing protocol — intake → medication ack → body scan → wave → reflection → next step | Intake 3-tap, medication-ack text block, body diagram with tappable regions, Lottie wave animation, live intensity slider, post-session insight card, next-step chips |
| Dashboard (`/dashboard`) | Show the patient their own data so medication adherence feels visible | Sessions count, average drop, medication-vs-no-medication drop delta, high-risk windows heatmap, current streak |
| History (`/history`) | Chronological list of sessions with expandable details and optional journal entries | Session list, filter by outcome / trigger / medication status, "Export for clinician" button (downloads a local PDF/JSON — nothing sent to a server) |
| Insights (`/insights`) | Plain-English patterns Gemma 4 has noticed, updated weekly | Trigger frequency, time-of-day risk, medication correlation, one-actionable suggestion per week |

## User Flow

1. **Pre-craving**: WAVE's Service Worker fires a Web Push (or local `showNotification`) 15 minutes before a predicted risk window. Patient sees it on the lock screen: "Your history shows the next 2 hours can be challenging. Open WAVE now — before the wave builds." Tapping it deep-links to `/session`.
2. **Intake**: Patient taps intensity (e.g. 7/10), medication status (e.g. "took Suboxone on time"), and trigger (e.g. "stress"). No typing. ~30 seconds.
3. **Acknowledgment**: Gemma 4 generates 2-3 sentences specific to "Suboxone + on-time + 7/10 + stress". Patient hears that their medication is already dampening this craving — what they feel at 7 would be a 9 without it.
4. **Body scan**: Patient taps the part of a body diagram where the craving sits (chest / jaw / legs / stomach). The narration acknowledges the specific location.
5. **Wave**: 5-8 minute animated wave. Narration adapts to phase — hardest language at "rising", most grounded at "peak", and celebration at "falling". Patient drags a live intensity slider that logs every 15 seconds to IndexedDB.
6. **Reflection**: Post-session screen: "You surfed a 7 down to 2. That's your 12th session. On medication days you drop 5.1 points on average." Optional one-line journal.
7. **Next step**: Patient picks a 10-minute action (call someone / walk / water / hands / rest). Session logs and closes.
8. **Over time**: Notifications get more precise as the pattern model sees more sessions. Dashboard and Insights show the patient their recovery in their own numbers.

## Data Model

All entities are stored **locally in the patient's browser** by default (IndexedDB via `localforage`, with a `localStorage` fallback for tiny tables). A patient can optionally enable an authenticated Supabase sync for cross-device continuity; in that mode, Row Level Security scopes every row to the signed-in user. No anonymous data ever leaves the browser.

- **Patient profile** — first name (optional), MAT type (`buprenorphine | naltrexone | methadone | vivitrol | none`), usual dose time, created at. No account, no email required unless the patient explicitly opts into cross-device sync.
- **Session** — id, started at, ended at, intake craving intensity (1-10), ending craving intensity (1-10), medication status at session (`on_time | late | missed | none`), trigger category (`social | stress | physical | unknown | other`), body-scan location (`chest | jaw | shoulders | legs | stomach | other`), outcome (`completed | left_early | used`), optional journal text.
- **Intensity sample** — session id, timestamp, intensity value. Written every 15 seconds during the wave phase so we can show the patient the actual shape of their craving later.
- **Medication log** — id, timestamp, MAT type, dose amount (if known), source (`manual | photo`). Photos are never stored — only the extracted structured fields.
- **Notification event** — id, fired at, type (`prophylactic | missed_dose | trough | reinforcement`), predicted risk window, whether the patient opened the app within 30 minutes.
- **Risk-window model** — derived, rebuilt in-browser after every session. Stores predicted high-risk time windows per weekday and a medication-craving correlation coefficient.

## Backend Needed?

**No dedicated backend service.** The app is a Next.js (App Router) project in `clients/`. All server work lives inside `clients/app/api/` as Route Handlers and is intentionally thin:

- `POST /api/session/narrate` — accepts intake payload, returns medication-aware narration. Routes to whichever Gemma 4 runtime is configured (`NARRATION_PROVIDER=ollama | llamacpp | webllm | claude-fallback`). In the browser-first path (`webllm`), this handler is bypassed entirely and the model runs client-side.
- `POST /api/sync/sessions` — **opt-in only**. Pushes session rows into Supabase when the patient has explicitly enabled cross-device sync. Default is "never call this."
- `GET /api/sync/sessions` — opt-in pull for the same sync path.
- `POST /api/insights/recompute` — placeholder. In practice the risk-window model rebuilds in-browser and this route is unused unless a future cohort-level feature lands.

Do **not** run the `scaffold-backend` skill. There is no Python / FastAPI service.

## Tech Stack

**What runs today:**
- Next.js 16 (App Router), TypeScript strict, Tailwind CSS v4
- Gemma 4 via one of: `@mlc-ai/web-llm` (in-browser WebGPU), Ollama (localhost), or llama.cpp (server-side, WASM, or native) — selected via `NARRATION_PROVIDER`
- Anthropic Claude API **only as a scripted fallback** for presentation/demo safety; never the production path
- IndexedDB (via `localforage`) for session / medication / journal storage, with a `localStorage` fallback
- Lottie for the wave animation
- Service Worker + Web Push API for local notifications, with graceful degradation to in-page reminders on iOS browsers where Push is restricted

**Optional PWA layer (added when a feature requires it):**
- `next-pwa` or a hand-rolled Service Worker for offline caching and install-to-home-screen
- Web App Manifest with WAVE branding and shortcuts
- Web Share Target so other apps can hand craving intensity into WAVE

**Fine-tuning pipeline:**
- Unsloth + QLoRA on Gemma 4 E2B, trained on MBRP facilitator materials, MI transcripts, SAMHSA MAT guides, and synthetic clinical dialogues
- Exported to both GGUF (for Ollama / llama.cpp / llama.cpp-WASM) and `web-llm`-compatible weights (for in-browser)

## Domain Constraints

- **MBRP fidelity** — the session must follow Marlatt's Mindfulness-Based Relapse Prevention phases in order: intake → medication acknowledgment → body scan → wave (rise / peak / fall) → reflection → next-step prompt. Do not collapse phases.
- **Trauma-informed tone** — warm, grounded, never toxic-positivity. Never imply failure. Missed doses and relapses are normalized and redirected, never shamed.
- **Medication accuracy** — all pharmacology copy must match FDA labels and SAMHSA MAT guidance. See the Medication-Aware Prompt Logic section below for the canonical mapping.
- **Not medical advice** — WAVE never prescribes. "Take your medication if available" is acceptable; "increase your dose" is not.
- **Crisis handoff** — any signal of active suicidality, overdose risk, or lethal-dose use surfaces 988 (Suicide & Crisis Lifeline) and 1-800-662-HELP (SAMHSA National Helpline) before the session continues.
- **Privacy floor** — no account required, no third-party analytics in the session path, opt-in only for any export to a clinician, and exports must be local files the patient chooses to share. Cross-device sync is opt-in and off by default.
- **Offline-capable session path** — once the page has loaded and (if applicable) the in-browser model weights are cached, the session path must work with no network. The Service Worker precaches session assets and the scripted-fallback narration so a dropped Wi-Fi connection mid-session never breaks the flow.

## Medication-Aware Prompt Logic

This is the clinical core of WAVE and the source of truth for every prompt in `clients/lib/prompts/`. Any change requires a citation to MBRP, SAMHSA, or an FDA label.

| Medication | Status | Example acknowledgment framing |
|---|---|---|
| Buprenorphine / Suboxone | On-time dose | "Your medication is actively working right now. What you're feeling at a 7 would be a 9 or 10 without it. Let's work with what's left." |
| Buprenorphine / Suboxone | Missed dose | "Part of what you're feeling is partial withdrawal — not just craving. That's why it's more intense. Can you take your medication right now?" |
| Buprenorphine / Suboxone | 16-22h post-dose | "Your medication levels may be dropping. This is a normal trough. If a wave is building, we can surf ahead of it." |
| Naltrexone (oral) | Taken | "The reward pathway is blocked. Your brain is chasing something it physically cannot have tonight. Let's redirect that energy." |
| Vivitrol (injection) | First 2 weeks | "Week 2 on Vivitrol is often the hardest — your brain is recalibrating. This intensity is temporary and expected, not a sign you're failing." |
| Methadone (oral) | Any | "Your methadone peaks about 2-4 hours after you take it. When did you dose today? Let's locate you in that curve." |
| None / not on MAT | — | "Let's work with your body's natural rhythms." (standard MBRP protocol, no pharmacology claims) |

## Success Criteria

- [ ] Patient can complete a full session end-to-end in under 20 minutes from a cold open.
- [ ] Three-tap intake: no typing required to start a session.
- [ ] Every session's medication acknowledgment is different when the medication status changes, and pharmacologically correct in each case.
- [ ] Dashboard shows the patient their medication-vs-no-medication drop delta as soon as they have at least one of each.
- [ ] A Service Worker is registered and at least one prophylactic notification fires locally for a simulated risk window.
- [ ] App is deployed to a public Vercel URL and loads with JavaScript disabled far enough to show the value prop and privacy pledge.
- [ ] Judges can open DevTools Network tab during the session phase and see zero new requests after the initial page load and (when `NARRATION_PROVIDER=webllm`) zero requests at all during the session.
- [ ] Lighthouse PWA audit passes (installable, offline-capable, Service Worker registered) when the PWA layer is enabled.

## What This Is NOT

- Not a native mobile app. No React Native, no Expo, no App Store / Play Store build in scope. The roadmap is "better PWA," not "ship to stores."
- Not a substitute for a counselor, sponsor, prescriber, or crisis line.
- Not a diagnostic tool. It does not diagnose SUD, withdrawal, or overdose.
- Not a medication reminder app in the narrow sense — medication awareness is in service of the urge-surfing session, not a standalone adherence tracker.
- Not a social or peer-support product. No feed, no friends, no sharing.
- Not cloud-backed by default. Cross-device sync exists only as an opt-in feature; the default path keeps all data in the browser.

## Out of Scope (Save for Later)

- Native iOS / Android React Native builds.
- Apple Watch / Wear OS complications (no Web API equivalent).
- Siri / Google Assistant shortcuts (the closest equivalent — Web Share Target and URL shortcuts — is in scope instead).
- Multimodal medication photo recognition via a native on-device vision model. (An in-browser Gemma 4 multimodal path is a stretch goal once weights and WebGPU support are stable.)
- Clinician-facing portal for cohort-level insights.
- Multi-language support (English only at MVP).
- Integration with EHR systems (Epic, Cerner) via FHIR.
- Payments / premium features — the app is free.

## Risk Areas

1. **Clinical copy regression** — a well-meaning code change to prompt assembly accidentally strips a medication-specific clause, and a patient on Naltrexone hears generic Suboxone copy. Mitigation: prompt templates live in `clients/lib/prompts/` as typed, testable data; every prompt PR has a clinical citation.
2. **Notification fatigue** — too many prophylactic alerts turn into noise the patient mutes. Mitigation: cap at one prophylactic + one medication alert per day by default, and let the pattern model down-weight windows the patient ignores repeatedly.
3. **Offline-capable promise breaks under demo pressure** — a session accidentally hard-requires a network call and dies when the conference Wi-Fi drops. Mitigation: scripted local-fallback narration path covering all four medication statuses, precached by the Service Worker, exercised in every PR's manual test with DevTools set to "Offline."
4. **Browser capability gaps** — iOS Safari historically lags on Web Push and some Service Worker features. Mitigation: feature-detect and fall back to in-page reminders; never let a missing API break the session.
5. **In-browser model size and cold-start** — Gemma 4 E2B weights are large to download and WebGPU cold-start is slow on first visit. Mitigation: show the scripted-fallback session first, download weights in the background with clear progress UI, and promote the user to the on-device path on a later visit.
