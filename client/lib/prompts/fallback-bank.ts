import type {
  AckPayload,
  ChunkLinesPayload,
  CitationKey,
  IntakeContext,
  BodyScanContext,
  ReflectionContext,
  ReflectionPayload,
  JSONNarrationPhase,
  PhasePayloadMap,
  TextNarrationPhase,
  PhaseInputMap,
} from "./schemas";
import { CHUNK_LINE_COUNT } from "./schemas";
import type {
  BodyScanLocation,
  MatType,
  MedicationStatus,
} from "@/types/models";
import type { ChunkNumber } from "@/types/session";
import {
  CHECK_IN_OPENERS,
  type CheckInOpeners,
} from "./check-in-openers";
import {
  OBSTACLE_LIBRARY,
  classifyObstacle,
  type ObstacleEntry,
} from "./obstacle-library";
import { fillScoreReflection } from "@/lib/session/score-tracking";
import { isAffirmative } from "@/lib/session/is-affirmative";

/**
 * Scripted narration bank. Used when the LLM route errors twice in a
 * row, fails Zod validation twice (JSON phases only), or when offline
 * (PRD.md > Risk Areas > WebGPU unavailable; AGENTS.md > Tech Stack >
 * "single scripted local narration bank"). Every (matType,
 * medicationStatus, phase) cell must resolve to a clinically-safe
 * string. Tone matches the live prompts: trauma-informed, never
 * toxic-positivity, never prescriptive.
 *
 * Two surfaces:
 *   - `fallbackJSONForPhase` — returns the typed JSON payload for
 *     med-ack and reflection.
 *   - `fallbackTextForPhase` — returns plain narration text for
 *     body-scan and the three wave phases. Encouragement on the wave
 *     phases is sampled separately from `encouragement-bank.ts`; it is
 *     not part of the streaming text fallback.
 */

type AckBank = {
  [M in MatType]: { [S in MedicationStatus]?: AckPayload } & {
    default: AckPayload;
  };
};

const ACK_BANK: AckBank = {
  buprenorphine: {
    on_time: {
      acknowledgment:
        "Your buprenorphine is working in the background right now. What you're feeling at this intensity would land harder without it. Let's ride what's left.",
      citationKey: "FDA:Suboxone",
    },
    late: {
      acknowledgment:
        "Levels are dipping but the long half-life means the medication is still with you. If today's dose is available, taking it now will help. Either way, we can surf this one.",
      citationKey: "FDA:Suboxone",
    },
    missed: {
      acknowledgment:
        "Part of what you feel is partial withdrawal layered onto craving — that's why it's sharper. If your medication is available, taking it now will help. None of this is failure.",
      citationKey: "FDA:Suboxone",
    },
    none: {
      acknowledgment:
        "Your medication regimen is part of how you got here. Let's stay with the wave for a few minutes and see where it moves.",
      citationKey: "SAMHSA:MAT-TIP63",
    },
    default: {
      acknowledgment:
        "Your medication is part of the picture here. We'll work with it. Let's surf this one.",
      citationKey: "SAMHSA:MAT-TIP63",
    },
  },
  naltrexone: {
    on_time: {
      acknowledgment:
        "The reward pathway is blocked right now. Your brain may be chasing something it physically cannot have. We can redirect that energy through this wave.",
      citationKey: "FDA:Naltrexone",
    },
    late: {
      acknowledgment:
        "The block is fading a little. If today's dose is available, taking it restores it. While we're here, let's stay with the wave.",
      citationKey: "FDA:Naltrexone",
    },
    missed: {
      acknowledgment:
        "Today's dose got missed and the block is fading. That's information, not a verdict. If the medication is available, taking it helps; either way, we ride this one.",
      citationKey: "FDA:Naltrexone",
    },
    default: {
      acknowledgment:
        "Naltrexone is part of how you got here. Let's stay with this wave for a few minutes.",
      citationKey: "FDA:Naltrexone",
    },
  },
  vivitrol: {
    on_time: {
      acknowledgment:
        "You're inside the active window of your last injection. Some weeks of the cycle feel sharper than others — that's the brain recalibrating, not a sign you're failing.",
      citationKey: "FDA:Vivitrol",
    },
    late: {
      acknowledgment:
        "Drug levels drop in the final week of the cycle and waves can feel sharper. When it's possible, scheduling the next injection restores the block. Right now, we surf.",
      citationKey: "FDA:Vivitrol",
    },
    missed: {
      acknowledgment:
        "The last injection is overdue and the block has likely faded. None of that is failure. Reaching out to your prescriber to schedule the next one is the next clinical step.",
      citationKey: "FDA:Vivitrol",
    },
    default: {
      acknowledgment:
        "Vivitrol is part of how you got here. Let's stay with this wave for a few minutes.",
      citationKey: "FDA:Vivitrol",
    },
  },
  methadone: {
    on_time: {
      acknowledgment:
        "Methadone peaks 2-4 hours after you dose and tapers slowly. If you dosed recently you're near peak; if it's been many hours you're closer to trough. Either way, we can ride this.",
      citationKey: "FDA:Methadone",
    },
    late: {
      acknowledgment:
        "You're in trough territory, which is when waves often spike. Getting to today's dose when you can will help. While we're here, stay with the wave.",
      citationKey: "FDA:Methadone",
    },
    missed: {
      acknowledgment:
        "Trough cravings without today's dose are physiologically expected — not a moral failing. Reaching out to your clinic about today's dose is the right next step. Stay here with me.",
      citationKey: "FDA:Methadone",
    },
    default: {
      acknowledgment:
        "Methadone is part of how you got here. Let's stay with this wave for a few minutes.",
      citationKey: "FDA:Methadone",
    },
  },
  none: {
    none: {
      acknowledgment:
        "You're working with your body's natural rhythms here, no medication adjusting the signal. Waves rise and waves fall. We're going to ride this one together.",
      citationKey: "MBRP",
    },
    default: {
      acknowledgment:
        "Waves rise and waves fall. We're going to ride this one together.",
      citationKey: "MBRP",
    },
  },
};

function bankAck(input: IntakeContext): AckPayload {
  const grid = ACK_BANK[input.matType];
  return grid[input.medicationStatus] ?? grid.default;
}

const BODY_SCAN_BANK: Record<BodyScanLocation, string> = {
  chest:
    "Bring your attention to your chest. Notice the tightness, or the held breath, without trying to change it. It's just sensation. We're going to stay with it for a moment.",
  jaw: "Bring your attention to your jaw. Notice the clench, or the grind, without trying to undo it. Let it be there. We're going to stay with it for a moment.",
  shoulders:
    "Bring your attention to your shoulders and upper back. Notice the weight you're carrying there, without trying to set it down. Just notice. Stay with me.",
  legs: "Bring your attention to your legs. Notice the restlessness, the want-to-leave, without acting on it. It's just sensation moving through you. Stay here.",
  stomach:
    "Bring your attention to your stomach. Notice the flutter, the hollow, the pull, without trying to fix it. It's just sensation. We're going to stay with it.",
  other:
    "Bring your attention to where the craving sits in your body. Notice the sensation without trying to change it. It's just a wave moving through you. Stay here with me.",
};

function bankBodyScan(input: BodyScanContext): string {
  return BODY_SCAN_BANK[input.bodyLocation];
}

const WAVE_BANK: Record<"rise" | "peak" | "fall", string> = {
  rise: "The wave is building. This is the hardest part. Stay with the sensation instead of pushing it away. It's going to crest, and then it's going to come down.",
  peak: "You're at the top. Peaks don't last. Breathe slow. Notice that you are still here, still choosing, still riding.",
  fall: "The wave is coming down. Notice the drop in your body. You stayed. That's what surfing this looks like.",
};

function bankWave(phase: "rise" | "peak" | "fall"): string {
  return WAVE_BANK[phase];
}

const NEXT_STEPS_DEFAULT = [
  "Drink a glass of water",
  "Walk one block outside",
  "Text a safe person",
  "Lie down for 10 min",
];

function bankReflection(input: ReflectionContext): ReflectionPayload {
  const drop = input.intakeIntensity - input.endingIntensity;
  let insight: string;
  if (drop > 0) {
    insight = `You surfed a ${input.intakeIntensity} down to a ${input.endingIntensity}. That's a drop of ${drop}. You stayed in the session and you let the wave pass.`;
  } else if (drop === 0) {
    insight = `Your intensity stayed at ${input.intakeIntensity}. You didn't act on the urge — you rode it. Holding level when a wave is high is its own kind of win.`;
  } else {
    insight = `Your intensity rose from ${input.intakeIntensity} to ${input.endingIntensity}. You stayed in the session anyway. That matters more than the number.`;
  }

  if (input.usedSubstanceToday) {
    insight +=
      " You chose to come into a session today even after using. That is a meaningful step, not a contradiction.";
  }

  return { insight, nextSteps: NEXT_STEPS_DEFAULT };
}

/**
 * Fallback for the JSON phases (med-ack and reflection). Used by
 * generateJSON() after two failed model attempts.
 */
export function fallbackJSONForPhase<P extends JSONNarrationPhase>(
  phase: P,
  input: PhaseInputMap[P],
): PhasePayloadMap[P] {
  switch (phase) {
    case "med-ack":
      return bankAck(input as IntakeContext) as PhasePayloadMap[P];
    case "reflection":
      return bankReflection(input as ReflectionContext) as PhasePayloadMap[P];
    default: {
      const _exhaustive: never = phase;
      throw new Error(`Unknown JSON narration phase: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Fallback for the streaming text phases (body-scan and the three wave
 * sub-phases). Used by generateText() after two failed model attempts.
 * Encouragement on wave phases is sampled separately from
 * `encouragement-bank.ts` and is not part of the returned text.
 */
export function fallbackTextForPhase<P extends TextNarrationPhase>(
  phase: P,
  input: PhaseInputMap[P],
): string {
  switch (phase) {
    case "body-scan":
      return bankBodyScan(input as BodyScanContext);
    case "wave-rise":
      return bankWave("rise");
    case "wave-peak":
      return bankWave("peak");
    case "wave-fall":
      return bankWave("fall");
    default: {
      const _exhaustive: never = phase;
      throw new Error(`Unknown text narration phase: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Re-exported for tests and dashboards that want to display the citation
 * key associated with a fallback ack.
 */
export type { CitationKey };

/**
 * Scripted next-agent-turn for the multi-turn check-in chat. Used by
 * `streamCheckInTurn()` after two failed model attempts (PRD § Session
 * Runtime Requirements rule 7).
 *
 * The fallback walks the same Turn 1 → Turn 5 sequence the live LLM
 * would produce, drawn entirely from `check-in-openers.ts` and
 * `obstacle-library.ts` so a copy edit in either source file
 * propagates to both the live path and this fallback.
 *
 * The shape mirrors what the live `/api/checkin` route returns: a
 * single plain-text agent reply, no markdown.
 */
export interface FallbackCheckInTurn {
  text: string;
  /**
   * The Turn-5-equivalent. The check-in chat surface uses this to mark
   * the next agent turn as a readiness ask, which is what the state
   * machine watches for at the readiness gate.
   */
  isReadinessAsk: boolean;
}

interface ChatTurn {
  role: "agent" | "patient";
  content: string;
}

export function fallbackCheckInTurn(
  chunkNumber: ChunkNumber,
  history: readonly ChatTurn[],
  scoreHistory: readonly number[],
): FallbackCheckInTurn {
  const openers: CheckInOpeners = CHECK_IN_OPENERS[chunkNumber];

  const patientTurnsBeforeNow = history.filter(
    (turn) => turn.role === "patient",
  ).length;
  const lastPatient = [...history].reverse().find((t) => t.role === "patient");
  const lastAgent = [...history].reverse().find((t) => t.role === "agent");

  // Map the patient's nth message to the agent turn we owe them.
  // Patient messages: [score, free-text-1, free-text-2 (post-validate),
  //                    free-text-3 (post-technique), readiness-reply].
  // The first message (score) is sent right after Turn 1, so when
  // `patientTurnsBeforeNow === 1` the next agent turn is Turn 2.

  switch (patientTurnsBeforeNow) {
    case 0: {
      // No patient message yet — we should not be here, but ship Turn 1.
      return { text: openers.turn1, isReadinessAsk: false };
    }
    case 1: {
      // Score arrived. Fill Turn 2's [score reflection] slot.
      const filled = fillScoreReflection(
        openers.turn2,
        scoreHistory,
        chunkNumber,
      );
      return { text: filled, isReadinessAsk: false };
    }
    case 2: {
      // Free text after Turn 2. Validate, then offer one small practice
      // and ask the patient to try it before readiness.
      const obstacle = lastPatient
        ? classifyObstacle(lastPatient.content)
        : null;
      if (obstacle) {
        const entry: ObstacleEntry = OBSTACLE_LIBRARY[obstacle];
        const technique = entry.technique
          ? ` ${entry.technique} ${entry.didItLand}`
          : " You're still here. Want to keep going?";
        return { text: `${entry.validate}${technique}`, isReadinessAsk: false };
      }
      return {
        text:
          chunkNumber === 5
            ? "What you're noticing right now matters. You stayed with the practice all the way through — that takes something. What do you want to carry with you into the rest of today?"
            : "That sensation gives us something real to work with. Try bringing your attention to the edges of it — where it starts, where it stops, whether it feels tight, warm, hollow, or pulsing. Can you try that for one breath and tell me what you notice?",
        isReadinessAsk: false,
      };
    }
    case 3: {
      // After the patient tried the brief practice, move to readiness
      // (or the closing carry-forward question at C5).
      if (lastPatient && classifyObstacle(lastPatient.content) === "physical_discomfort") {
        return {
          text:
            "A pounding heartbeat can be your nervous system trying to protect you. Place one hand on your chest if that feels okay, press gently enough to feel contact, and say quietly, 'It's okay, this is a body alarm, and it can pass.' What changes when you stay with that for one breath?",
          isReadinessAsk: false,
        };
      }
      return {
        text: openers.turn5,
        isReadinessAsk: chunkNumber !== 5,
      };
    }
    case 4: {
      // Patient responded to "did it land". Move to readiness ask.
      return {
        text: openers.turn5,
        isReadinessAsk: chunkNumber !== 5,
      };
    }
    default: {
      // Patient has been talking past the readiness ask. If the last
      // patient reply parses as affirmative, keep the readiness flag
      // off; otherwise re-issue the readiness ask softly.
      const ready = lastPatient ? isAffirmative(lastPatient.content) : false;
      const lastAgentWasReadiness = lastAgent?.content === openers.turn5;
      if (ready && lastAgentWasReadiness) {
        return {
          text: "Okay. Let's keep going.",
          isReadinessAsk: false,
        };
      }
      return {
        text: openers.turn5,
        isReadinessAsk: chunkNumber !== 5,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// fallbackChunk — clinician-reviewed scripted chunk lines.
//
// Returned by `generateChunk()` after two failed model attempts. Each
// chunk has exactly CHUNK_LINE_COUNT lines so the response shape
// matches the live LLM contract (`{ lines: string[] }` of fixed
// length). The lines are paraphrased from MBRP urge-surfing
// facilitator guidance and the public-domain TherapistAid CALM
// Urge Surfing script — same source pool as `session-script.ts`.
// ---------------------------------------------------------------------------

const SCRIPTED_CHUNK_LINES: Record<ChunkNumber, readonly string[]> = {
  1: [
    "Welcome. You're here, and that already matters. Let's start slow.",
    "Find a comfortable position. Sit back, lie down, whatever feels easiest on your body right now.",
    "Soften your gaze, or close your eyes if that feels okay. You don't have to fight anything.",
    "We're going to ride this urge like a wave. Waves rise. They crest. They fall. None of them last forever.",
    "Take a moment to notice what's already here in your body — no fixing, no judging, just noticing.",
    "Stay with what's present. The next few minutes are yours.",
  ],
  2: [
    "We're going to do a slow body scan. No fixing — just noticing.",
    "Start at the top of your head. Move attention down through your face, your jaw, the back of your throat.",
    "Notice your shoulders, your chest, your stomach. Where does this urge live in you right now?",
    "Land on the spot that feels strongest. Let your attention rest there for a moment.",
    "Get curious about the edges of the sensation. Is it sharp or dull? Hot or cool? Steady or pulsing?",
    "You don't have to make it leave. Watching it without flinching is the practice.",
  ],
  3: [
    "Let's anchor on sound. If pictures don't come easily, sound works just as well.",
    "Notice whatever sound is actually around you right now — the room, the air, your own breath.",
    "Now imagine the sound of waves. Pulling in. Pushing out. A rhythm that doesn't need anything from you.",
    "If your mind wanders, that's not failing. The coming back is the practice.",
    "Let the sound carry the urge for a few breaths. You don't have to do anything with it.",
    "Stay with the rhythm. There's nothing to chase here.",
  ],
  4: [
    "We're going to breathe with the wave. The pattern is 4 in, 4 hold, 6 out.",
    "Breathe in for 4. Count in your head: one, two, three, four.",
    "Hold for 4. Soft hold, no strain.",
    "Breathe out for 6. Slow. Longer than the in-breath.",
    "Stay with this pattern on your own for a few rounds. The breath is your surfboard.",
    "When you're ready, let the count go. Just breathe slow, with the wave.",
  ],
  5: [
    "We're going to bring this to a close. Take a moment to notice what's different now.",
    "Look at your body, your thoughts, the urge itself. Compare what's here to where you started.",
    "Whatever you observed counts. A fall is something you did. Holding is something you survived.",
    "If the wave rose, you stayed in the session anyway. That's still the practice.",
    "There's no version of this you did wrong. Showing up is the whole skill.",
    "One more brief conversation, and we're done.",
  ],
};

if (process.env.NODE_ENV !== "production") {
  for (const [chunkNumber, lines] of Object.entries(SCRIPTED_CHUNK_LINES)) {
    if (lines.length !== CHUNK_LINE_COUNT) {
      throw new Error(
        `fallbackChunk: chunk ${chunkNumber} has ${lines.length} lines but expected ${CHUNK_LINE_COUNT}.`,
      );
    }
  }
}

export function fallbackChunk(chunkNumber: ChunkNumber): ChunkLinesPayload {
  return { lines: [...SCRIPTED_CHUNK_LINES[chunkNumber]] };
}
