/**
 * The five scripted chunks of the urge surfing session.
 *
 * NO LONGER THE RUNTIME SOURCE OF TRUTH.
 *
 * As of the LLM-driven-chunks rewrite, the runtime narration is
 * generated per-chunk by `generateChunk()` (client/lib/gemma/chunk.ts)
 * with the patient's full prior session history as context. This file
 * remains as a clinician-reviewed reference + a sample input for the
 * Synthetix LoRA training scaffolding under `client/synthetix/`.
 *
 * Fallback for the live path lives in `client/lib/prompts/fallback-bank.ts`
 * under `fallbackChunk(chunkNumber)`. Keep the two in rough alignment so
 * a generation outage degrades to clinically equivalent copy.
 *
 * @deprecated for runtime use. Importing `CHUNKS` or `chunkById` from
 * a session-machine surface is a bug — the machine now consumes the
 * `Chunk` returned by `generateChunk()`. Synthetix scaffolding may
 * still import these as training references.
 *
 * Total runtime targets 12-15 minutes across all 5 chunks
 * (PRD.md > Session Structure):
 *
 *   Chunk 1  Intro + settling + urge awareness   ~2   min
 *   Chunk 2  Body scan                            ~2-3 min
 *   Chunk 3  Sound / visualization anchor         ~2-3 min
 *   Chunk 4  Breathing (4-4-6)                    ~3-4 min
 *   Chunk 5  Closing reflection                   ~1-2 min
 *
 * Pause-duration invariant
 *
 * Every `pause` and `breath` segment's `duration` field MUST match the
 * count spoken in the nearest preceding text (or the segment's own
 * `instruction`). This is a ship-blocker (PRD § Session Runtime
 * Requirements rule 1) and is asserted by the unit test in
 * client/lib/prompts/__tests__/session-script-invariants.test.ts.
 *
 * Clinical sources
 *
 * The chunk copy is paraphrased from MBRP urge surfing facilitator
 * guidance (Bowen / Chawla / Marlatt) and the public-domain TherapistAid
 * "CALM Urge Surfing" script. No medication-specific copy lives here —
 * the medication-aware prompting only shows up at the check-ins, where
 * Gemma can weave in the right validation clause from the
 * Medication-Aware Prompt Logic table at runtime. This file is
 * intentionally medication-agnostic so the same scripted bed plays for
 * every patient.
 *
 * Do NOT regenerate this file at runtime. It is clinician-reviewed copy
 * (PRD.md > Session Structure > Clinical rationale).
 */

import type { Chunk } from "@/types/session";

const CHUNK_1: Chunk = {
  id: 1,
  title: "Settle in",
  segments: [
    {
      type: "text",
      content:
        "Welcome. You're here, and that already matters. Let's start slow.",
    },
    { type: "pause", duration: 4 },
    {
      type: "text",
      content:
        "Find a comfortable position. Sit back, lie down, whatever feels easiest on your body right now. You don't need to do anything perfectly.",
    },
    { type: "pause", duration: 6 },
    {
      type: "text",
      content:
        "Soften your gaze, or close your eyes if that feels okay. You don't have to fight anything. Not the craving. Not the restlessness. Not the thoughts pulling at you.",
    },
    { type: "pause", duration: 8 },
    {
      type: "text",
      content:
        "We're going to think of this urge as a wave. Waves rise. Waves crest. Waves fall. None of them last forever, even when they feel like they will.",
    },
    { type: "pause", duration: 8 },
    {
      type: "text",
      content:
        "Take 20 seconds and just notice what's already here in your body. No fixing. No labeling. Just notice.",
    },
    { type: "pause", duration: 20 },
    {
      type: "text",
      content:
        "Now take 10 more seconds with whatever you noticed. Let it be there. Stay with it.",
    },
    { type: "pause", duration: 10 },
  ],
};

const CHUNK_2: Chunk = {
  id: 2,
  title: "Body scan",
  segments: [
    {
      type: "text",
      content:
        "Now we're going to find where the urge actually lives in your body. Cravings are not just a thought — they show up as sensation somewhere physical.",
    },
    { type: "pause", duration: 6 },
    {
      type: "text",
      content:
        "Start at the top of your head. Slowly move your attention down — face, jaw, throat, chest, stomach, hands, legs. Take 30 seconds.",
    },
    { type: "pause", duration: 30 },
    {
      type: "text",
      content:
        "When you find a place where the urge lives — tightness, heat, pressure, a pulling, a buzz — pause there. Take another 30 seconds with that spot.",
    },
    { type: "pause", duration: 30 },
    {
      type: "text",
      content:
        "Get curious about it. Where exactly are its edges? Is it sharp or fuzzy? Warm or cool? Steady or pulsing? Just observe, like you're describing weather. 30 seconds.",
    },
    { type: "pause", duration: 30 },
    {
      type: "text",
      content:
        "Notice if there are multiple places at once. If there are, find the one that feels most intense. Stay there for 30 seconds.",
    },
    { type: "pause", duration: 30 },
    {
      type: "text",
      content:
        "You're not trying to make the sensation leave. You're just keeping it company. Take 20 more seconds.",
    },
    { type: "pause", duration: 20 },
  ],
};

const CHUNK_3: Chunk = {
  id: 3,
  title: "Sound anchor",
  segments: [
    {
      type: "text",
      content:
        "Now we're going to give your attention something steady to rest on. Some people picture the ocean. If picturing is hard, sound works just as well — sometimes better.",
    },
    { type: "pause", duration: 6 },
    {
      type: "text",
      content:
        "First, listen to whatever's actually around you for 20 seconds. A hum. Air moving. A distant voice. Don't judge any of it. Just hear it.",
    },
    { type: "pause", duration: 20 },
    {
      type: "text",
      content:
        "Now layer in the sound of water — waves pulling in, pushing out. It doesn't have to be vivid. Just a sense of rhythm that doesn't need anything from you. 30 seconds.",
    },
    { type: "pause", duration: 30 },
    {
      type: "text",
      content:
        "Each time the wave pulls back, that's the urge loosening its grip a little. Each time it comes in, that's okay too. You're still here. Still riding. 30 seconds.",
    },
    { type: "pause", duration: 30 },
    {
      type: "text",
      content:
        "If thoughts come pulling — planning, worrying, remembering — just notice them, then come back to the sound. The mind wandering is not a failure. The coming back is the practice. Stay for 45 seconds.",
    },
    { type: "pause", duration: 45 },
    {
      type: "text",
      content:
        "The wave doesn't need you to do anything. Just listen. 20 more seconds.",
    },
    { type: "pause", duration: 20 },
  ],
};

const CHUNK_4: Chunk = {
  id: 4,
  title: "Breath",
  segments: [
    {
      type: "text",
      content:
        "We're going to use the breath as a surfboard now. The pattern is breathe in for 4, hold for 4, breathe out for 6. We'll go through three rounds together, then you'll do a few on your own.",
    },
    { type: "pause", duration: 6 },
    {
      type: "text",
      content: "Round one. Follow the wave on the screen.",
    },
    { type: "pause", duration: 3 },
    {
      type: "breath",
      phase: "inhale",
      duration: 4,
      instruction: "Breathe in. Count to 4 in your mind.",
    },
    {
      type: "breath",
      phase: "hold",
      duration: 4,
      instruction: "Hold. Count to 4.",
    },
    {
      type: "breath",
      phase: "exhale",
      duration: 6,
      instruction: "Breathe out, slow. Count to 6.",
    },
    {
      type: "text",
      content: "Round two.",
    },
    { type: "pause", duration: 2 },
    {
      type: "breath",
      phase: "inhale",
      duration: 4,
      instruction: "Breathe in. Count to 4.",
    },
    {
      type: "breath",
      phase: "hold",
      duration: 4,
      instruction: "Hold. Count to 4.",
    },
    {
      type: "breath",
      phase: "exhale",
      duration: 6,
      instruction: "Breathe out. Count to 6.",
    },
    {
      type: "text",
      content: "Round three.",
    },
    { type: "pause", duration: 2 },
    {
      type: "breath",
      phase: "inhale",
      duration: 4,
      instruction: "Breathe in. Count to 4.",
    },
    {
      type: "breath",
      phase: "hold",
      duration: 4,
      instruction: "Hold. Count to 4.",
    },
    {
      type: "breath",
      phase: "exhale",
      duration: 6,
      instruction: "Breathe out. Count to 6.",
    },
    {
      type: "text",
      content:
        "Now keep the same pattern on your own. Breathe with the wave. 4 in, 4 hold, 6 out. 90 seconds.",
    },
    { type: "pause", duration: 90 },
    {
      type: "text",
      content:
        "Let the count go. Just breathe slow, with the wave, for one more minute.",
    },
    { type: "pause", duration: 60 },
  ],
};

const CHUNK_5: Chunk = {
  id: 5,
  title: "Close",
  segments: [
    {
      type: "text",
      content:
        "We're going to bring this to a close. Take 30 seconds and notice what's different — in your body, in your thoughts, in the urge itself — from when we started.",
    },
    { type: "pause", duration: 30 },
    {
      type: "text",
      content:
        "Whatever you observed counts. If the wave fell, that's something you did. If it held, that's something you survived. If it rose, you're still here, and that's also the practice.",
    },
    { type: "pause", duration: 8 },
    {
      type: "text",
      content:
        "Take 15 more seconds with that. Then we'll do a final check-in.",
    },
    { type: "pause", duration: 15 },
  ],
};

export const CHUNKS: readonly [Chunk, Chunk, Chunk, Chunk, Chunk] = [
  CHUNK_1,
  CHUNK_2,
  CHUNK_3,
  CHUNK_4,
  CHUNK_5,
];

export function chunkById(id: 1 | 2 | 3 | 4 | 5): Chunk {
  return CHUNKS[id - 1];
}
