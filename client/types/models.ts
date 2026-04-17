export type MatType =
  | "buprenorphine"
  | "naltrexone"
  | "methadone"
  | "vivitrol"
  | "none";

export type MedicationStatus = "on_time" | "late" | "missed" | "none";

export type TriggerCategory =
  | "social"
  | "stress"
  | "physical"
  | "unknown"
  | "other";

export type BodyScanLocation =
  | "chest"
  | "jaw"
  | "shoulders"
  | "legs"
  | "stomach"
  | "other";

export type SessionOutcome = "completed" | "left_early" | "used";

export type NotificationType =
  | "prophylactic"
  | "missed_dose"
  | "trough"
  | "reinforcement";

export type MedicationLogSource = "manual" | "photo";

export interface PatientProfile {
  id: string;
  firstName?: string;
  matType: MatType;
  usualDoseTime?: string;
  createdAt: string;
}

export interface Session {
  id: string;
  startedAt: string;
  endedAt?: string;
  intakeIntensity: number;
  endingIntensity?: number;
  medicationStatus: MedicationStatus;
  trigger: TriggerCategory;
  bodyScanLocation?: BodyScanLocation;
  outcome: SessionOutcome;
  journal?: string;
}

export interface IntensitySample {
  sessionId: string;
  timestamp: string;
  intensity: number;
}

export interface MedicationLog {
  id: string;
  timestamp: string;
  matType: MatType;
  doseAmount?: string;
  source: MedicationLogSource;
}

export interface NotificationEvent {
  id: string;
  firedAt: string;
  type: NotificationType;
  predictedWindowStart?: string;
  predictedWindowEnd?: string;
  openedWithin30Min: boolean;
}

export interface RiskWindow {
  weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  startHour: number;
  endHour: number;
  relativeRisk: number;
}

export interface RiskWindowModel {
  updatedAt: string;
  windows: RiskWindow[];
  medicationCorrelation: number;
}
