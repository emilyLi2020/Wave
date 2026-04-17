# Gemma 4 Integration Plan for WAVE

> **Status:** plan / design doc. No code in this PR — this file is the shared contract
> that the web demo (`clients/`) and the production React Native mobile app will both
> implement against. Every prompt, schema, and model choice below is derived from
> `PRD.md` and `AGENTS.md` at the repo root.
>
> **Sources:**
> [Gemma 4 (DeepMind)](https://deepmind.google/models/gemma/gemma-4/) ·
> [ai.google.dev Gemma docs](https://ai.google.dev/gemma/docs) ·
> [Hugging Face Gemma 4 post](https://huggingface.co/blog/gemma4)

---

## 1. Why Gemma 4 for WAVE

WAVE has three hard constraints from `AGENTS.md > Domain Constraints` and
`PRD.md > Domain Constraints` that push us to Gemma 4 specifically:

1. **Offline-first on mobile.** The session path must make **zero network requests**
   in production. That rules out any hosted LLM and requires a model that runs
   fully on-device on mid-range phones.
2. **PHI-adjacent data never leaves the device.** Craving logs, medication logs,
   journal text, and photos are treated as PHI-like. A cloud LLM is a non-starter
   for the mobile product.
3. **Tight latency during the wave phase.** Adaptive narration must refresh
   every ~20–30 s across rise / peak / fall without breaking the animation. A
   phone-class model with a small KV footprint is required.

Gemma 4 is a fit because:

- **E2B / E4B are designed for phones and IoT.** Per-Layer Embeddings (PLE) and a
  shared KV cache give them meaningful quality at ~2.3 B / 4.5 B effective
  parameters and 128 k context ([HF blog](https://huggingface.co/blog/gemma4)).
- **Multimodal out of the box.** E2B and E4B accept image, text, **and** audio.
  E2B/E4B are the only sizes we can realistically deploy on-device for the
  medication-photo and (future) voice-intake features.
- **Open license (Apache 2.0).** We can fine-tune on clinical dialogues and ship
  weights inside the app without a commercial license negotiation.
- **First-class runtimes already exist:** LiteRT / MediaPipe (Android/iOS),
  `transformers.js` + WebGPU (web demo), `llama.cpp` GGUF (dev loop, server
  fallback), ONNX Runtime (Android NNAPI / Core ML delegate).

The **web demo in `clients/`** currently uses Claude via Next.js Route Handlers
(`PRD.md > Backend Routes`). The plan below keeps that path but adds a
Gemma-4-powered in-browser fallback so the demo honors the offline-first
pledge even when Wi-Fi drops.

---

## 2. Model-size decisions per surface

Gemma 4 ships four sizes ([Gemma 4 model card](https://ai.google.dev/gemma/docs/core/model_card_4)):

| Model | Effective params | Context | Modalities | Where it runs |
|---|---|---|---|---|
| **E2B-it** | 2.3 B (5.1 B w/ embeddings) | 128 k | text + image + audio | phones (LiteRT, MLX), browser (WebGPU via transformers.js), Raspberry Pi |
| **E4B-it** | 4.5 B (8 B w/ embeddings) | 128 k | text + image + audio | flagship phones, laptops, WebGPU |
| **26B-A4B-it** | 4 B active / 26 B MoE | 256 k | text + image (no audio) | consumer GPU / workstation |
| **31B-it** | 31 B dense | 256 k | text + image (no audio) | workstation / server |

WAVE's model selection per runtime:

| Runtime | Primary model | Why |
|---|---|---|
| **Production mobile (iOS/Android, LiteRT)** | **Gemma 4 E2B-it, INT4** | Fits in ~1.4 GB RAM after INT4 quant; runs at usable TPS on iPhone 14+ / Pixel 8+. E4B is a future toggle for flagship devices only. |
| **Web demo offline fallback (browser)** | **Gemma 4 E2B-it via transformers.js + WebGPU** | Lets the demo honor the zero-network pledge on a laptop with a modern browser. Large download is cached; acceptable for a demo surface. |
| **Web demo online default (server)** | **Gemma 4 E4B-it on a small GPU** *(optional — Claude stays as the stand-in until migration)* | Highest-quality open model we can self-host cheaply; keeps parity with on-device behavior. |
| **Offline batch jobs (insights recompute, fine-tuning evals)** | **Gemma 4 26B-A4B-it** | MoE gives frontier-ish quality at 4 B active params, cheap to run on a single 24 GB GPU; only used off the critical path. |
| **Gold-standard eval / synthetic data generation** | **Gemma 4 31B-it + Claude Opus** (two-model agreement) | Not shipped. Used to score fine-tune checkpoints against MBRP / SAMHSA rubrics. |

**Rule of thumb for the session path:** every prompt that runs during the wave
phase must target **E2B-it INT4** as the worst-case runtime and still pass its
eval. If a surface needs E4B or larger, it moves **off the critical path** (run
it during reflection, insights recompute, or background). The session itself
must stay E2B-feasible.

---

## 3. Surface-by-surface breakdown

Each surface below maps to one phase of the flow in `PRD.md > Core Flow` or one
derived feature. For every surface we specify:

- **Inputs** — what the app passes to the model (fields, not free-text)
- **Output contract** — JSON schema the model must return
- **Model + runtime** — which Gemma 4 variant handles it
- **Latency budget** — measured end-to-end on an iPhone 14 / mid Pixel
- **Safety rails** — validators and fallbacks that run regardless of model output
- **Fine-tuning status** — base prompt, LoRA, or full FT

All schemas are expressed as TypeScript + Zod and must be validated by the
client before the output is rendered. JSON-only decoding is enforced by either
(a) constrained grammar decoding in `llama.cpp` / LiteRT, or (b) a retry with
`"JSON only, no prose"` + Zod re-validation, or (c) `response_format` style
structured output in the transformers pipeline. Gemma 4 emits clean JSON for
bounding boxes without grammar help ([HF blog](https://huggingface.co/blog/gemma4)),
so structured output is within reach; we still validate defensively.

### 3.1 Medication-aware acknowledgment (session phase 2)

> "Your medication is actively working right now. What you're feeling at a 7 would
> be a 9 or 10 without it." — `PRD.md > Medication-Aware Prompt Logic`

**Inputs**

```ts
type AckInput = {
  intensity: number;          // 1..10
  medicationStatus: "on_time" | "late" | "missed" | "none";
  matType: "buprenorphine" | "naltrexone" | "methadone" | "vivitrol" | "none";
  trigger: "social" | "stress" | "physical" | "unknown" | "other";
  hoursSinceDose?: number;    // optional, 0..48
  lastSessionDropDelta?: number; // optional, 0..10, for continuity framing
  localeTimeOfDay: "morning" | "midday" | "evening" | "late_night";
};
```

**Output contract**

```ts
type AckOutput = {
  acknowledgment: string;          // <= 280 chars, 2–3 sentences
  pharmacologyClaim: {
    medication: AckInput["matType"];
    claim: string;                 // short factual statement
    citation: "FDA_LABEL" | "SAMHSA_TIP63" | "MBRP_FACILITATOR" | "NONE";
  };
  crisisSignalDetected: boolean;   // forces Crisis Triage surface (§3.7) if true
  nextPhase: "body_scan";          // constant, kept for forward-compat
};
```

**Model + runtime**

- Primary: **Gemma 4 E2B-it, INT4, LiteRT** on-device (mobile) /
  transformers.js + WebGPU (browser fallback) / Claude (current web default).
- Decoding: greedy + temperature 0.3, max 180 tokens, JSON mode via grammar.

**Latency budget**

- Target: **< 1.2 s** first-token on iPhone 14 / Pixel 8, **< 2.5 s** full JSON.
- Session UI shows a subtle breath-in / breath-out loader while streaming.

**Safety rails**

- Zod-validate the JSON. On parse failure → fall back to the scripted
  medication-specific copy in `clients/lib/prompts/medication-ack.ts`.
- **Pharmacology allow-list.** Reject outputs whose `pharmacologyClaim.claim`
  contains any of `{increase, decrease, stop, start, double, skip}` +
  `{dose, medication}`. Regression test file: `eval/ack_allowlist.test.ts`.
- `crisisSignalDetected` must be `true` if the intake freeform journal (when
  present) mentions suicidality, overdose, or "used already". If the model
  misses this, a keyword pre-filter forces it to `true`.

**Fine-tuning**

- **LoRA fine-tune on E2B-it.** Adapters ~30–80 MB, shipped inside the app
  bundle. Training data (see §5) is MBRP facilitator transcripts,
  SAMHSA TIP 63 excerpts, FDA MAT labels, and ~1.5 k synthetic dialogues
  generated by 31B-it + Claude and reviewed by a clinician.

---

### 3.2 Body-scan narration (session phase 3)

**Inputs**

```ts
type BodyScanInput = AckInput & {
  bodyLocation: "chest" | "jaw" | "shoulders" | "legs" | "stomach" | "other";
};
```

**Output contract**

```ts
type BodyScanOutput = {
  narration: string;       // <= 320 chars, second-person, grounded
  breathCount: 3 | 4 | 5;  // how many breaths to pace the animation
  sensationLabel: "tight" | "warm" | "cold" | "fluttery" | "heavy" | "absent";
};
```

**Model + runtime:** E2B-it INT4, same path as §3.1.
**Latency:** < 1.5 s full JSON. Runs in parallel with the animation warm-up.
**Safety rails:** Narration must not name the substance (no "alcohol", "heroin",
"pills"). Lexical filter. Fallback to one of 18 scripted body-scan lines in
`clients/lib/prompts/body-scan.ts`.
**Fine-tuning:** same LoRA as §3.1.

---

### 3.3 Adaptive wave narration (session phase 4 — hot path)

This is the **tightest surface** — the wave animation plays for 5–8 minutes and
we want fresh narration at three beats (rise → peak → fall) plus micro-nudges
if the patient's live slider spikes.

**Inputs** (streamed; one call per phase transition)

```ts
type WaveInput = AckInput & {
  phase: "rise" | "peak" | "fall";
  currentIntensity: number;         // 1..10, most recent slider value
  intensityTrendLast60s: "up" | "flat" | "down";
  elapsedSeconds: number;           // 0..480
};
```

**Output contract**

```ts
type WaveOutput = {
  narration: string;                // <= 220 chars
  pacingHint: "slower" | "hold" | "faster";  // drives animation speed
  encouragement: "grounding" | "normalizing" | "celebrating";
};
```

**Model + runtime:** **E2B-it INT4** exclusively. No fallback to larger model
during the wave — latency is the whole point. Decoding: temperature 0.4,
max 120 tokens, streaming.
**Latency:** **< 800 ms first token, < 1.8 s full JSON.** If the budget is
exceeded on a given device, switch to the scripted narration bank for the rest
of the session and log a `model_latency_exceeded` event locally.
**Safety rails:**

- No toxic-positivity lexical set (`"you got this"`, `"stay strong"`,
  `"don't give up"`) — rejected and fallback used.
- `phase === "peak"` narration must be grounding, not celebrating.
- Slider-driven micro-nudges are **not** LLM-generated — they are rule-based
  from `intensityTrendLast60s` and a scripted line bank. LLM only runs on phase
  transitions (max 3 calls per session).

**Fine-tuning:** same LoRA as §3.1 with an MBRP wave-specific subset.

---

### 3.4 Post-session reflection + journal prompt (phase 5)

**Inputs**

```ts
type ReflectionInput = {
  intakeIntensity: number;
  endingIntensity: number;
  durationSeconds: number;
  medicationStatus: AckInput["medicationStatus"];
  matType: AckInput["matType"];
  historicalAverageDropOnMed?: number;
  historicalAverageDropOffMed?: number;
  sessionsCount: number;
  optionalJournalText?: string;     // <= 500 chars
};
```

**Output contract**

```ts
type ReflectionOutput = {
  insightOneLine: string;              // shown big on the reflection screen
  longitudinalComparisonLine?: string; // "On medication days you drop 5.1 points..."
  journalPromptQuestion: string;       // optional one-line prompt for the diary
  suggestedNextStep: "call" | "walk" | "water" | "hands" | "rest";
  crisisSignalDetected: boolean;
};
```

**Model + runtime:** E2B-it INT4 on-device. No cloud call here — patient data
must stay local.
**Latency:** < 2 s. This runs after the wave ends, so we have breathing room.
**Safety rails:**

- `insightOneLine` must include the numeric drop (enforced by a post-check that
  the string contains the ending intensity).
- If `optionalJournalText` trips the crisis lexical filter, return
  `crisisSignalDetected=true` and route to §3.7 before rendering.

**Fine-tuning:** LoRA shared with §3.1.

---

### 3.5 Insights / pattern explanations (weekly, background)

**Inputs**

```ts
type InsightsInput = {
  sessionHistory: Array<{
    startedAt: string;
    intakeIntensity: number;
    endingIntensity: number;
    medicationStatus: AckInput["medicationStatus"];
    trigger: AckInput["trigger"];
    bodyLocation?: BodyScanInput["bodyLocation"];
  }>;
  riskWindowModel: {
    windows: Array<{ weekday: 0|1|2|3|4|5|6; startHour: number; endHour: number; relativeRisk: number }>;
    medicationCorrelation: number;
  };
  lastInsightShownAt?: string;
};
```

**Output contract**

```ts
type InsightsOutput = {
  patterns: Array<{
    kind: "time_of_day" | "trigger_frequency" | "medication_correlation" | "body_location";
    plainEnglish: string;    // one sentence, no jargon
    confidence: "low" | "medium" | "high";
  }>;
  actionableSuggestion: {
    text: string;            // "Keep hands busy on Friday evenings after 9pm"
    targetWindow?: { weekday: number; startHour: number; endHour: number };
  };
  crisisSignalDetected: false;   // always false for this surface
};
```

**Model + runtime:** **Gemma 4 26B-A4B-it** in the cloud / on the developer's
workstation during CI for eval runs; **Gemma 4 E4B-it** on-device for the
production weekly recompute (flagship phones) with an **E2B fallback** for
older phones that produces a shorter, 2-pattern output.
**Latency:** < 8 s. Runs weekly in the background; not in the session path.
**Safety rails:** `patterns[].plainEnglish` must not include any substance name.
`actionableSuggestion.text` must not contain any verb in the pharmacology
allow-list (§3.1) except `"take"`.
**Fine-tuning:** optional; base-model + good system prompt is sufficient for
MVP. Revisit after 50 real patient-weeks of data.

---

### 3.6 Prophylactic notification copy (background)

**Inputs**

```ts
type NotificationInput = {
  predictedWindow: { weekday: number; startHour: number; endHour: number; relativeRisk: number };
  minutesUntilWindow: 15;            // fixed per PRD
  recentDropDelta?: number;
  ignoredWindowCount: number;        // down-weights tone if patient has ignored
};
```

**Output contract**

```ts
type NotificationOutput = {
  title: string;         // <= 40 chars
  body: string;          // <= 120 chars
  cta: "Open WAVE" | "Log medication" | "Snooze";
};
```

**Model + runtime:** E2B-it INT4, run when the scheduler wakes. Could also be
pre-computed at session end into a small bank and picked by rule.
**Latency:** < 1 s.
**Safety rails:** never mention a substance; never shame. If
`ignoredWindowCount >= 3`, the title is forced to `"Here when you want us"` and
the model only controls `body`.
**Fine-tuning:** LoRA shared with §3.1.

---

### 3.7 Crisis triage (cross-cutting)

Any surface whose output has `crisisSignalDetected=true`, or whose input passes
a lexical pre-filter for suicidality / overdose / "already used a lethal
amount", is routed here **before** the session continues.

**Inputs**

```ts
type CrisisInput = {
  triggeringSurface: "ack" | "body_scan" | "wave" | "reflection" | "journal";
  rawPatientTextIfAny?: string;   // <= 500 chars
};
```

**Output contract**

```ts
type CrisisOutput = {
  routeTo: "988" | "samhsa_helpline" | "local_emergency" | "none";
  copy: string;                   // <= 200 chars, calm, non-judgmental
  continueSession: boolean;       // false = hand off and pause session
};
```

**Model + runtime:** **E2B-it INT4, temperature 0.0, JSON-only**. This surface
is also backed by a **hard-coded fallback** that is always correct and is
shown immediately while the model's refinement streams. The model is only
allowed to tune copy — `routeTo` and `continueSession` are chosen by a rule,
not the LLM. The rule:

- Any suicidality mention → `routeTo="988"`, `continueSession=false`.
- "Used already" + lethal-dose markers → `routeTo="local_emergency"`,
  `continueSession=false`.
- Otherwise → `routeTo="samhsa_helpline"`, `continueSession=true`.

**Safety rails:** `copy` is post-validated to include the hotline number that
matches `routeTo`. Mismatch → discard model output, use the canned copy.
**Fine-tuning:** no fine-tune. This surface stays on base E2B + rules, per
`AGENTS.md > Crisis handoff`.

---

### 3.8 Medication photo → structured log (multimodal, future)

`PRD.md > Out of Scope` marks photo recognition as post-MVP, but Gemma 4 E2B's
**on-device vision** makes this the first post-MVP feature worth planning.

**Inputs**

```ts
type PhotoInput = {
  imageBytes: Uint8Array;           // processed in-memory; never stored
  knownMatType?: AckInput["matType"];  // from onboarding, if available
};
```

**Output contract**

```ts
type PhotoOutput = {
  matType: AckInput["matType"];
  doseAmount?: string;              // "8 mg/2 mg", "50 mg"
  confidence: "low" | "medium" | "high";
  warning?: "unreadable" | "unknown_medication" | "partial_label";
};
```

**Model + runtime:** **Gemma 4 E2B-it (multimodal), LiteRT** on-device. The raw
image is passed directly to the model; nothing is uploaded. Per
`AGENTS.md > Security Considerations`, the photo is processed in-memory and
discarded — only the structured fields are persisted to the local medication
log.
**Latency:** < 3 s for a still frame.
**Safety rails:**

- If `confidence !== "high"` → require manual confirmation before writing to
  the medication log.
- If the detected `matType` disagrees with `knownMatType` → ask the user to
  confirm; never auto-overwrite the profile.

**Fine-tuning:** **QLoRA vision fine-tune on E2B** on a small dataset of MAT
medication photos (Suboxone film, Naltrexone tablets, Vivitrol auto-injector,
methadone cup labels) in varied lighting. Target ~500 labeled images.

---

### 3.9 Voice intake (multimodal audio, future)

**Inputs:** 3–10 s audio clip answering "What's going on right now?"
**Output contract:** same shape as `AckInput` (intensity, medicationStatus,
trigger inferred from tone + words), plus a `transcript` field.
**Model + runtime:** **Gemma 4 E2B-it (audio)** via LiteRT. Audio is processed
in-memory and discarded — only the structured fields persist.
**Latency:** < 2 s.
**Safety rails:** if the transcript contains substance names, do not store the
transcript, only the structured fields.
**Fine-tuning:** none required for MVP — the HF post shows E2B/E4B handling
speech transcription well out of the box.

---

## 4. Summary matrix

| Surface | Model | Runtime | JSON mode | p95 latency | Fine-tune | Critical path? |
|---|---|---|---|---|---|---|
| §3.1 Medication ack | E2B-it INT4 | LiteRT / WebGPU | yes, grammar | 2.5 s | LoRA | ✅ |
| §3.2 Body scan | E2B-it INT4 | LiteRT / WebGPU | yes, grammar | 1.5 s | LoRA (shared) | ✅ |
| §3.3 Wave narration | E2B-it INT4 | LiteRT / WebGPU | yes, grammar | 1.8 s | LoRA (shared) | ✅✅ |
| §3.4 Reflection | E2B-it INT4 | LiteRT / WebGPU | yes, grammar | 2.0 s | LoRA (shared) | ✅ |
| §3.5 Insights | E4B-it (phone) / 26B-A4B (dev) | LiteRT / Ollama | yes, grammar | 8 s | none (MVP) | ❌ |
| §3.6 Notifications | E2B-it INT4 | LiteRT | yes | 1.0 s | LoRA (shared) | ❌ |
| §3.7 Crisis triage | E2B-it INT4 | LiteRT | yes, greedy T=0 | 1.5 s | **none** | ✅ |
| §3.8 Med photo | E2B-it multimodal | LiteRT | yes | 3.0 s | QLoRA vision | ❌ (post-MVP) |
| §3.9 Voice intake | E2B-it audio | LiteRT | yes | 2.0 s | none | ❌ (post-MVP) |

---

## 5. Fine-tuning plan

### What to fine-tune

One **shared LoRA adapter on Gemma 4 E2B-it** covering surfaces §3.1, §3.2,
§3.3, §3.4, §3.6. Single adapter keeps the shipped weights small (~30–80 MB
on top of the ~1.4 GB INT4 base). A separate **QLoRA vision adapter** for
§3.8 lands after MVP.

- Crisis triage (§3.7) stays on the **base E2B** — we never want a fine-tune
  to drift the 988 / SAMHSA hand-off away from the rule-based guarantee.
- Insights (§3.5) stays on base E4B / 26B-A4B for now.

### Data sources

1. **MBRP facilitator materials** — Marlatt & Bowen's MBRP facilitator guide
   transcripts (licensed). Segmented per phase (intake / ack / body scan /
   wave / reflection).
2. **SAMHSA TIP 63** — plain-text paragraphs mapped to `matType` + `status`
   cells of `PRD.md > Medication-Aware Prompt Logic`.
3. **FDA labels** — Suboxone, Vivitrol, generic buprenorphine, naltrexone,
   methadone. Parsed into single-sentence pharmacology claims tagged
   `FDA_LABEL`.
4. **Motivational Interviewing transcripts** — public MI corpora to anchor
   trauma-informed tone.
5. **Synthetic clinical dialogues** — ~2.5 k examples generated by
   **Gemma 4 31B-it + Claude Opus** in agreement, then **clinician-reviewed**
   in batches of 200. Every synthetic example is tied to one row of the
   medication-aware prompt matrix.

### Training recipe

- Framework: **Unsloth + TRL + QLoRA** on Gemma 4 E2B-it-base.
- Adapter rank 16–32, alpha 32, dropout 0.05.
- One epoch first; inspect; then up to three epochs with early stopping on
  eval pass rate (§6).
- Target hardware: single A100 80 GB or 2× L4. Training fits in a few hours.

### Why LoRA (not full FT, not just prompt engineering)

- **Prompt engineering alone** works for short demos but regresses on
  long-tail medication cases (Vivitrol week 2, missed-dose + stress + 9/10).
  LoRA fixes the tail without hurting latency (merged at load time).
- **Full fine-tune** would force us to re-ship the whole model on every copy
  update and is overkill — the base already handles tone well per the HF
  blog's "so good out of the box" note.
- **LoRA** gives clinicians a reviewable artifact: a ~50 MB adapter that maps
  1:1 to a dataset + eval, and can be swapped without touching app code.

---

## 6. Evaluation harness

Every PR that changes prompts, adapters, or model versions must pass the
harness below. Runs locally and in CI.

**1. Medication matrix coverage.** 7 (medication status × MAT type) × 5
(trigger) × 3 (intensity bucket) = 105 fixtures. For each, the ack, body
scan, wave, and reflection outputs are scored by **Gemma 4 31B-it + Claude
Opus** against a rubric:

- Pharmacology claim is in the allow-list for that `matType`.
- No shaming / toxic-positivity lexicon.
- No substance named.
- Tone grade ≥ 4 / 5 on a trauma-informed rubric.

**2. Safety red-team.** 60 adversarial inputs (active suicidality, overdose,
"already used", medication-change requests, minors). Every one must route
through §3.7 correctly and never emit a pharmacology claim outside the
allow-list.

**3. Latency regression.** 50 real-device traces on iPhone 14, Pixel 8, and
a 2020-era Android baseline. Fails if any p95 exceeds the budget in the §4
matrix by more than 10 %.

**4. JSON validity.** Every fixture must parse under the Zod schema 99 %+
of the time on the first try, 100 % after one retry.

**5. Offline pledge.** A test harness spins the web demo with the network
disabled and confirms the session completes end-to-end.

Eval code lives under `clients/eval/` once we start implementing.

---

## 7. Runtime integration — how we wire Gemma 4 into each surface

### 7.1 Production mobile (React Native + LiteRT)

- Package the INT4 E2B base + LoRA adapter inside the app bundle (or first-run
  download). Verify checksum on boot.
- Use **LiteRT** (Google's renamed TF Lite) with the Gemma 4 Task API. Expose
  a thin TS wrapper `generateJSON<T>(schema, prompt)` that streams tokens,
  enforces the JSON grammar, and Zod-validates.
- Session-path calls run on the GPU/NPU delegate; background calls (notifications,
  insights) run on CPU to keep the GPU free for the Lottie animation.
- All inputs are constructed from typed unions in `clients/types/models.ts` —
  no raw strings cross the model boundary.

### 7.2 Web demo online (current Claude path)

- Keep the Claude Route Handler at `clients/app/api/session/narrate/route.ts`
  as the default during the hackathon.
- Mirror the same `generateJSON<T>` signature and the same Zod schemas on the
  server side so the swap to Gemma 4 is a one-line change later.
- **Migration milestone:** once the LoRA adapter is trained, add
  `clients/app/api/session/narrate-gemma/route.ts` that calls a self-hosted
  E4B-it endpoint (llama.cpp server or vLLM) behind a feature flag. Run the
  harness (§6) against both until parity.

### 7.3 Web demo offline fallback (browser)

- Add `clients/lib/gemma-browser.ts` using **`@huggingface/transformers.js` +
  WebGPU** loading the E2B-it ONNX build. First visit downloads ~1.5 GB
  compressed; subsequent visits load from IndexedDB cache.
- If the fetch to the Route Handler fails (or a `?offline=1` flag is set in
  the URL, for the judge-facing demo), the client falls through to the
  browser Gemma pipeline instead of the scripted bank. Scripted bank is the
  third fallback.
- Service Worker pre-caches the prompt templates and the ONNX shards.

### 7.4 Dev loop

- `llama.cpp` with the Gemma 4 E2B-it GGUF provides a local OpenAI-compatible
  server for iteration without touching a phone. This matches the instructions
  in the [HF post](https://huggingface.co/blog/gemma4) (`llama-server -hf
  ggml-org/gemma-4-E2B-it-GGUF`).
- Cursor / Claude Code agents working in `clients/` point at
  `http://localhost:8080` via an env var; production builds never read it.

---

## 8. Open questions / risks

1. **Grammar-constrained decoding on LiteRT.** Gemma 4 emits clean JSON in the
   HF examples, but on-device grammar support in LiteRT is less mature than in
   `llama.cpp`. If unavailable, we fall back to a retry-on-invalid loop with a
   cap of 2 retries. Must benchmark.
2. **INT4 quality drop for nuanced tone.** The HF blog notes Gemma 4 is
   "ideal for quantization" but we should run §6.1 against FP16 vs INT4 and
   quantify the delta before shipping INT4 only.
3. **Clinician review throughput on synthetic data.** 2.5 k examples is a lot
   for a single clinician reviewer. Batch in groups of 200 and gate the
   training run on reviewed batches only.
4. **Gemma 4 license boundaries.** Apache 2.0 is clean, but Google's
   prohibited-use policy still applies. WAVE is a support tool, not medical
   advice (`AGENTS.md > Domain Constraints`); keep the disclaimer copy in
   onboarding aligned with the policy.
5. **Model version pinning.** Pin to a specific Gemma 4 checkpoint hash
   in the bundle manifest. Any upgrade re-runs the full harness.

---

## 9. Milestones (technical scope, not calendar)

- **M0 — scaffolding (in this repo today).** Next.js web demo in `clients/`
  with Claude. No Gemma yet. ✅ current state.
- **M1 — schema + scripted fallback.** Freeze the Zod schemas in this doc
  into `clients/lib/prompts/schemas.ts`. Build the scripted-fallback banks
  for every surface. Wire the session to use schemas + fallbacks with Claude
  in the middle. Unblocks the harness.
- **M2 — base Gemma 4 E2B in the browser.** Ship the transformers.js +
  WebGPU path behind a feature flag. Run harness §6.1 and §6.4 against it.
- **M3 — LoRA adapter trained and merged.** Training run on the §5 dataset.
  Ship the adapter to the web demo behind the same flag. Run full harness.
- **M4 — React Native + LiteRT port.** Port `clients/lib/prompts/*` and the
  schemas unchanged; swap the runtime to LiteRT. First on-device session.
- **M5 — multimodal (photo, then voice).** Add §3.8 and §3.9 behind settings
  toggles. Train the vision QLoRA.

Each milestone is independently shippable and each gates on the §6 harness
passing.
