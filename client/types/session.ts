/**
 * Five-chunk session data model.
 *
 * Source of truth for the runtime shape of the urge surfing session.
 * Mirrors PRD.md > Segment + Chunk Data Model. Every type here is
 * imported by both the player (chunk runtime) and the chat surface
 * (check-in runtime), so a single change here propagates to everything.
 *
 * Pause-duration invariant: every `pause` and `breath` segment's
 * `duration` field MUST equal the count spoken in the nearest preceding
 * `text` (for `pause`) or in the segment's own `instruction` (for
 * `breath`). The invariant is asserted by a unit test over CHUNKS in
 * client/lib/prompts/session-script.ts (PRD § Session Runtime
 * Requirements rule 1).
 */

import type {
  MatType,
  MedicationStatus,
  TriggerCategory,
} from "./models";

/** A unit of scripted narration delivered by the ChunkPlayer. */
export type Segment =
  | { type: "text"; content: string }
  | { type: "pause"; duration: number }
  | {
      type: "breath";
      phase: "inhale" | "hold" | "exhale";
      duration: number;
      instruction: string;
    };

/** A check-in turn lives in CheckIn.turns; one row per chat message. */
export interface CheckInTurn {
  /** 1-based, monotonically increasing within a single check-in. */
  index: number;
  role: "agent" | "patient";
  /** Plain text. Never markdown, never HTML. */
  content: string;
  /** Provenance for eval + logging. */
  via: "lora" | "fallback" | "patient";
  /** Agent turn only: time from the patient's prior message to first token. */
  atLatencyMs?: number;
  /**
   * Agent turn only: marks the explicit readiness ask. The state
   * machine refuses to advance from the check-in until the next
   * patient turn passes isAffirmative() AND the immediately preceding
   * agent turn had this flag set. Check-in 5 never sets this.
   */
  isReadinessAsk?: boolean;
}

/** The 9 canonical obstacle categories from the Obstacle Response Library. */
export type ObstacleCategory =
  | "cannot_visualize"
  | "mind_wandering"
  | "urge_overwhelming"
  | "breath_tight"
  | "breath_anxiety"
  | "gave_in"
  | "guilt_failure"
  | "physical_discomfort"
  | "sleepiness";

export type ChunkNumber = 1 | 2 | 3 | 4 | 5;

export interface CheckIn {
  chunkNumber: ChunkNumber;
  /** Captured at Turn 1, never null. */
  cravingScore: number;
  turns: CheckInTurn[];
  /** Inferred at Turn 3 from the patient's free text; null if no obstacle. */
  obstacleCategory: ObstacleCategory | null;
  /**
   * Turn 5 affirmative reply parsed as boolean. Null at Check-in 5
   * because Check-in 5 has no readiness prompt (PRD § Check-In
   * Conversation Protocol > Check-in 5 exception).
   */
  readyToContinue: boolean | null;
  startedAt: number;
  endedAt: number;
}

export interface Chunk {
  id: ChunkNumber;
  title: string;
  segments: Segment[];
}

/**
 * Trimmed intake context used by every check-in prompt and persisted
 * with the session. Mirrors the IntakeContext in
 * client/lib/prompts/schemas.ts but is duplicated here so the session
 * data model in this file is self-contained.
 */
export interface SessionUserProfile {
  matType: MatType;
  medicationStatus: MedicationStatus;
  trigger: TriggerCategory;
  triggerOther: string | null;
  usedSubstanceToday: boolean;
}

export interface SessionState {
  currentChunk: ChunkNumber;
  checkIns: CheckIn[];
  userProfile: SessionUserProfile;
}
