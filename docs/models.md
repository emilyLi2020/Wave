# WAVE - Models

> Per-model reference. This file describes what models WAVE trains, what ships
> in the browser demo, and which adapters are research artifacts for future
> runtimes. For the training process, see [`model-training.md`](./model-training.md).

---

## Quick Overview

The browser demo ships **one base model plus one multitask LoRA merged into a
single ONNX artifact**:

```
Gemma 4 E2B-it (INT4) + lora-wave-session -> merged ONNX demo model
```

This is a deliberate runtime choice. Current browser runtimes such as
Transformers.js + WebGPU do not provide mature production support for loading
one base model and hot-swapping LoRA adapters in memory. Loading one merged
model keeps the PWA demo simpler: one model download, one model in memory, and
no full-model reload between check-ins.

We still train future specialized LoRAs as demonstration artifacts:

```
lora-phase-narration
lora-check-in-1 ... lora-check-in-5
lora-reflection
```

Those specialized datasets are used twice:

1. Each specialized set can fine-tune its own proof-of-concept adapter for
   offline evaluation and demo storytelling.
2. The same rows are combined into the `lora-wave-session` dataset, which is
   the only LoRA merged into the browser demo model.

Crisis and intake safety routing remain rule-based and never use a LoRA.

Sources for Gemma 4 itself:
- [Gemma 4 - DeepMind](https://deepmind.google/models/gemma/gemma-4/)
- [ai.google.dev Gemma docs](https://ai.google.dev/gemma/docs)
- [Hugging Face: Welcome Gemma 4](https://huggingface.co/blog/gemma4)

---

## Base Model

### `google/gemma-4-E2B-it` (INT4)

| Field | Value |
|---|---|
| Parameters | 2.3 B effective / 5.1 B with embeddings |
| Context window | 128 k |
| Modalities | text + image + audio |
| Quantization | INT4 |
| Disk size | ~1.5 GB |
| Fine-tuned? | No global fine-tune |
| Runtime, web demo | `@huggingface/transformers` + WebGPU |
| Runtime, mobile | LiteRT, future port |

**Why this size.** E2B is the Gemma size designed for browser-class and
phone-class runtimes. WAVE's final session path needs zero LLM network calls,
local PHI-adjacent data handling, and acceptable latency during a craving
session.

---

## Shipped Demo LoRA

### `lora-wave-session`

| Field | Value |
|---|---|
| Base | `google/gemma-4-E2B-it` (INT4) |
| Runtime artifact | Merged ONNX model: base + LoRA |
| Where used | Browser demo session path |
| Training data | Combined ready rows from `lora-phase-narration`, `lora-check-in-1` through `lora-check-in-5`, and `lora-reflection` |
| Target sample count | 158 human-written seed rows total: 10 for phase narration (5 chunks × 2 intake bands), 20 each for the five check-ins, and 48 for reflection (16 medicationStatus × trigger cells × 3 matType variants; see `client/scripts/generate-lora-reflection-grid.ts`) |
| Browser behavior | One model is loaded once; no LoRA hot-swap at runtime |

**What it is fine-tuned for.** `lora-wave-session` is a multitask session LoRA.
The input includes a `surface` discriminator so the same adapter can produce:

- phase narration for chunks 1-5
- check-in turns after chunks 1-5
- the final reflection card

The shipped browser demo uses this merged model because separate browser LoRA
hot-swapping would otherwise require either unsupported adapter APIs or loading
multiple full merged ONNX models.

**Hard safety invariants.**

- Never produce crisis routing decisions. Intake and crisis routing are code.
- Never tell a patient to start, stop, increase, decrease, double, or skip a
  medication.
- Never use toxic-positivity phrasing such as "you got this", "stay strong", or
  "don't give up".
- Never shame missed doses, substance use, stalled cravings, or difficulty with
  a technique.
- Preserve the check-in protocol: score first when needed, one question or one
  technique per turn, validation before technique.

---

## Specialized Demonstration LoRAs

These adapters are trained and evaluated for demonstration and future runtime
integration, but they are not mounted in the browser demo because browser LoRA
hot-swapping is not mature enough yet.

Each specialized adapter collects **20 human-written seed examples** in the
developer training UI. The same examples are included in the combined
`lora-wave-session` fine-tune.

### `lora-phase-narration`

| Field | Value |
|---|---|
| Where used in future runtime | Meditation phase narration for chunks 1-5 |
| Seed target | 10 examples: one per cell of `chunkNumber` (1-5) × `startingIntensityBand` (`7-10` vs `1-6` intake craving) |
| Focus | Six-line meditation narration only. Scripts are **not** stratified by medication or trigger; those axes live in check-in seeds. Two variants per chunk match higher vs milder opening urge so pacing stays clinically honest without duplicating MAT logic here. |

### `lora-check-in-1`

| Field | Value |
|---|---|
| Where used in future runtime | Check-in after chunk 1 |
| Seed target | 20 examples |
| Focus | Baseline score, current body/emotional state, medication-aware validation |

### `lora-check-in-2`

| Field | Value |
|---|---|
| Where used in future runtime | Check-in after chunk 2 |
| Seed target | 20 examples |
| Focus | Body-scan obstacles and somatic noticing |

### `lora-check-in-3`

| Field | Value |
|---|---|
| Where used in future runtime | Check-in after chunk 3 |
| Seed target | 20 examples |
| Focus | Sound/visualization anchor obstacles and mind-wandering |

### `lora-check-in-4`

| Field | Value |
|---|---|
| Where used in future runtime | Check-in after chunk 4 |
| Seed target | 20 examples |
| Focus | Breathing obstacles, chest tightness, and breath-induced anxiety |

### `lora-check-in-5`

| Field | Value |
|---|---|
| Where used in future runtime | Closing check-in before reflection |
| Seed target | 20 examples |
| Focus | Closing score, full-arc reflection, carry-forward question |

### `lora-reflection`

| Field | Value |
|---|---|
| Where used in future runtime | Post-session reflection card |
| Seed target | 20 examples |
| Focus | Numeric drop, journal prompt, next-step chips, non-shaming use-day framing |

---

## Shared Input / Output Contracts

### Phase Narration Input

```ts
type PhaseNarrationInput = {
  surface: "phase_narration";
  chunkNumber: 1 | 2 | 3 | 4 | 5;
  /** Intake craving band only — meditation script pacing, not MAT/trigger. */
  startingIntensityBand: "7-10" | "1-6";
  priorSessionSummary?: string;
};
```

### Phase Narration Output

```ts
type PhaseNarrationOutput = {
  lines: [string, string, string, string, string, string];
};
```

### Check-In Input

```ts
type CheckInInput = {
  surface: "check_in";
  chunkNumber: 1 | 2 | 3 | 4 | 5;
  intakeIntensity: number;
  currentIntensity?: number;
  scoreTrend: "not_started" | "rising" | "flat" | "falling" | "mixed";
  medicationStatus: "on_time" | "late" | "missed" | "none";
  matType: "buprenorphine" | "naltrexone" | "methadone" | "vivitrol" | "none";
  trigger: "social" | "stress" | "physical" | "unknown_or_other";
  triggerOther?: string;
  usedSubstanceToday: boolean;
  priorChunkSummary: string;
  priorTranscript?: string;
};
```

### Check-In Output

```ts
type CheckInOutput = {
  reply: string;
  endConversation: {
    action: "continue" | "end";
    cravingScore?: number;
    obstacleCategory?:
      | "cannot_visualize"
      | "mind_wandering"
      | "urge_overwhelming"
      | "breath_tight"
      | "breath_anxiety"
      | "gave_in"
      | "guilt_failure"
      | "physical_discomfort"
      | "sleepiness";
  };
};
```

The runtime wrapper can map `action: "continue"` to the existing
`endConversation: null` contract and `action: "end"` to the existing parsed
end-conversation signal.

**Browser runtime note.** The merged training dataset stores check-in assistant
turns as strict JSON with `reply` and `endConversation`. The mounted frontend
keeps the patient-facing check-in chat streamed as plain prose through
`client/lib/gemma/checkin.ts` and maps readiness through the AI SDK
`endConversation` tool. Compatible dataset wording is mirrored in the frontend
prompts, but the JSON wrapper is intentionally not used for visible check-in
streaming.

### Reflection Input

```ts
type ReflectionInput = {
  surface: "reflection";
  intakeIntensity: number;
  endingIntensity: number;
  durationSeconds: number;
  medicationStatus: "on_time" | "late" | "missed" | "none";
  matType: "buprenorphine" | "naltrexone" | "methadone" | "vivitrol" | "none";
  trigger: "social" | "stress" | "physical" | "unknown_or_other";
  sessionsCount: number;
  usedSubstanceToday: boolean;
  scoreHistorySummary?: string;
};
```

### Reflection Output

```ts
type ReflectionOutput = {
  insight: string;
  journalPromptQuestion: string;
  nextSteps: {
    one: string;
    two: string;
    three: string;
    four: string;
  };
};
```

---

## Not Fine-Tuned

### Crisis triage surface

| Field | Value |
|---|---|
| Base | `google/gemma-4-E2B-it`, if copy generation is needed |
| LoRA | None |
| Routing owner | Rule-based code |

Routing is picked by code, not by the model:

- Suicidality -> 988 Suicide & Crisis Lifeline, pause session.
- "Used already" + lethal-dose markers -> local emergency, pause session.
- Otherwise -> SAMHSA National Helpline 1-800-662-HELP, continue session.

No future PR should add `lora-crisis`.

### Intake safety screen

| Field | Value |
|---|---|
| Model | None |
| LoRA | None |
| Routing owner | Rule-based code |

The intake safety screen runs before any model-backed surface. Both-yes on the
used-substance and physical-distress questions skips the session and shows the
static safety handoff. This must remain code, not a model decision.

---

## Adapter Manifest Direction

The web demo manifest points to one merged model artifact for
`lora-wave-session`. Future native/mobile runtimes can add separately loadable
adapter entries when their LoRA hot-swap APIs are production-ready.

```ts
type LoRAId =
  | "lora-phase-narration"
  | "lora-wave-session"
  | "lora-check-in-1"
  | "lora-check-in-2"
  | "lora-check-in-3"
  | "lora-check-in-4"
  | "lora-check-in-5"
  | "lora-reflection";
```

Specialized LoRAs must still satisfy the ship gates in
`docs/model-training.md` before being used by any runtime.

---

## Alignment With The Repo

- `client/app/training/` collects targets per specialized set (10 phase narration rows, 20 each for check-ins and reflection).
- `client/app/api/training/export/route.ts` exports each specialized JSONL file
  and the combined `lora-wave-session.jsonl` file.
- `client/lib/gemma/local-runtime.ts` remains the browser runtime boundary.
- `client/lib/prompts/schemas.ts` mirrors the mounted runtime contracts:
  phase narration returns six `lines`, check-ins stream prose plus a tool-based
  end signal, and reflection returns `insight`, `journalPromptQuestion`, and
  object-shaped `nextSteps` matching the training dataset.
- `PRD.md > Medication-Aware Prompt Logic` remains the clinical matrix for all
  seed examples.
- `AGENTS.md > Domain Constraints` remains the source of truth for tone,
  medication, crisis, and privacy rules.
