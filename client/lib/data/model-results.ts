// Held-out evaluation of the model WAVE actually serves.
//
// Source of truth for "what model ships": client/lib/wllama/config.ts →
// Maelstrome/lora-wave-session-r32 (the multitask `lora-wave-session`
// LoRA, served as the Q4_K_M GGUF via wllama for chunk narration,
// check-ins, and reflection).
//
// Numbers below are transcribed verbatim from the authoritative eval in
// wave-linux-eval-bundle.zip:
//   models/runs/lora-wave-session/competition-final-r16-a32-lr2p5e-4-s100-seq2048/
//     eval.json · run-config.json · README.md
// Eval generated 2026-05-10. It is a completion-likelihood eval on a
// frozen held-out split; the generation quality-gate pass (JSON/style/
// safety) was intentionally skipped in this run — those gates are
// enforced at runtime by the Zod + format + safety pipeline and the
// two-strike fallback bank, not re-measured here.

export const MODEL_RESULT = {
  loraId: "lora-wave-session",
  servedRepo: "Maelstrome/lora-wave-session-r32",
  servedArtifact: "gemma-4-e2b-it-peft.Q4_K_M GGUF (5 shards), via wllama",
  baseModel: "google/gemma-4-E2B-it (4-bit)",
  adapter: "WAVE multitask session LoRA",
  surfaces: "chunk narration · check-in · reflection",
  evalDate: "2026-05-10",
  evalMode:
    "Completion likelihood on a frozen held-out split. Base and LoRA scored on the same prompts.",
  claim:
    "The fine-tune cut held-out completion NLL by 32% and perplexity ~4.8×, beating base Gemma on every one of the 428 held-out prompts.",
  badges: [
    "Gemma 4 E2B-it",
    "Multitask LoRA",
    "4,277 examples",
    "428 held-out",
    "unsloth · 4-bit",
    "Served via wllama GGUF",
  ],
  dataset: {
    totalExamples: 4277,
    trainExamples: 3421,
    validationExamples: 428,
    heldOutExamples: 428,
    split: "80 / 10 / 10",
    seed: 7,
    source:
      "Combined check-in, phase-narration, and reflection rows (clinician 'ready' seeds + draft + synthetic-draft).",
  },
  training: {
    method: "PEFT LoRA via unsloth, TRL SFT, 4-bit base",
    epochs: "1 (capped at 100 optimizer steps)",
    optimizerSteps: 100,
    learningRate: "2.5e-4",
    loraRank: 16,
    loraAlpha: 32,
    loraDropout: 0,
    warmupSteps: 10,
    batchSize: "1 × grad-accum 8",
    maxSeqLength: 2048,
    quantization: "4-bit base (NF4)",
    target:
      "Language-model attention + MLP projections (25.3M trainable params).",
    // Hardware + wall time documented in the run's tuning-summary.json
    // telemetry (single attempt, the selected "primary" config — no
    // hyperparameter search). NB: this is the run-specific record; an
    // earlier unrelated batch-size experiment used a B200.
    gpu: "NVIDIA GeForce RTX 5080",
    wallTime: "6 min 20 s (380.4 s) for 100 steps",
    peakGpuMemory: "11.0 GB allocated · 18.5 GB reserved",
  },
  adapterCheck: {
    label: "Adapter changed",
    value: "lora_B nonzero",
    detail:
      "B_total_norm 127.94 across 490 adapter tensors (245 A / 245 B), 0 zero tensors.",
  },
} as const;

export const SCORE_CARDS = [
  {
    label: "Completion NLL",
    base: "4.9327",
    lora: "3.3555",
    delta: "-1.5772",
    interpretation:
      "Lower is better — the closest LLM analog to a training loss. The reference WAVE completion became far more likely under the fine-tune.",
  },
  {
    label: "Perplexity",
    base: "138.76",
    lora: "28.66",
    delta: "-110.10",
    interpretation:
      "Lower is better. Perplexity dropped roughly 4.8×, from base Gemma to the WAVE fine-tune.",
  },
  {
    label: "NLL improvement",
    base: "—",
    lora: "31.98%",
    delta: "+31.98%",
    interpretation:
      "Mean reduction in completion negative log-likelihood versus base Gemma on the held-out split.",
  },
  {
    label: "Held-out win rate",
    base: "—",
    lora: "428 / 428",
    delta: "100%",
    interpretation:
      "The fine-tune had lower NLL than base on every single held-out prompt — no losses, no ties.",
  },
] as const;

// Paired per-prompt comparison (eval.json → comparison.pairedNllStats).
export const PAIRED_STATS = [
  {
    label: "Paired prompts",
    value: "428",
    description: "Same frozen held-out prompts scored under base and LoRA.",
  },
  {
    label: "Wins / losses / ties",
    value: "428 / 0 / 0",
    description: "Per-prompt: the fine-tune never lost to base.",
  },
  {
    label: "Mean NLL delta",
    value: "1.583",
    description: "Median 1.599. Bootstrap 95% CI [1.573, 1.591].",
  },
  {
    label: "Sign-test p-value",
    value: "≈ 2.9e-129",
    description: "The 428/428 win rate is not chance — the effect is decisive.",
  },
] as const;

// Held-out test split composition by WAVE surface (run-config.json →
// counts.test.bySurface). All three runtime surfaces are represented.
export const DATASET_SURFACES = [
  { label: "Phase narration", value: 147 },
  { label: "Check-in", value: 144 },
  { label: "Reflection", value: 137 },
] as const;

export const CAVEATS = [
  "Completion-likelihood eval only. The generation quality gates (JSON validity, schema, patient-facing style, safety, medication directives) were intentionally skipped in this run — they are enforced at runtime by the Zod + format + safety pipeline and the two-strike fallback bank, not re-measured here.",
  "Statistically the paired signal is decisive (428/428 wins, sign-test p ≈ 2.9e-129), but the training data is still synthetic-draft-heavy (only 58 clinician-'ready' rows of 4,277) and should be more fully clinician-reviewed before clinical claims.",
  "Numbers above are from the unquantized PEFT adapter on the frozen prompts. The app serves its Q4_K_M GGUF quantization (Maelstrome/lora-wave-session-r32) via wllama, so on-device quality is approximate, not identical.",
  "The HF repo is named '-r32' for historical reasons; the trained adapter is rank 16 / alpha 32.",
  "This is a contest proof-of-concept, not a production clinical validation.",
] as const;
