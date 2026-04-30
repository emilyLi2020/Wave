/**
 * Adapter Manager — runtime-agnostic contract named in AGENTS.md
 * (`client/lib/gemma/adapter-manager.ts`). Today it returns the
 * prompt-template id for a given session phase. When the in-browser
 * Gemma 4 + LoRA stack lands, it returns the LoRA id to hot-swap into
 * the base model. Call sites in `lib/gemma/session.ts` do not change.
 *
 * TODO:replace-with-gemma — switch the return value from a prompt-template
 * id to the final LoRA adapter ids. The legacy one-shot narration phases
 * below are slated for cleanup; the settled MVP LoRA stack is
 * `lora-check-in-1` through `lora-check-in-5` plus `lora-reflection`.
 */

import type { NarrationPhase } from "@/lib/prompts/schemas";

const ADAPTER_BY_PHASE: Record<NarrationPhase, string> = {
  "med-ack": "prompt-med-ack",
  "body-scan": "prompt-body-scan",
  "wave-rise": "prompt-wave-rise",
  "wave-peak": "prompt-wave-peak",
  "wave-fall": "prompt-wave-fall",
  reflection: "prompt-reflection",
};

export function pickAdapter(phase: NarrationPhase): string {
  return ADAPTER_BY_PHASE[phase];
}
