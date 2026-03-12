import type { JsonValue } from "./json-schema";

export const STEP_STATUSES = [
  "success",
  "failed",
  "retrying",
  "skipped",
  "paused",
  "cancelled"
] as const;

export const RUN_STATUSES = [
  "completed",
  "failed",
  "paused",
  "cancelled",
  "timed_out"
] as const;

export type StepStatus = (typeof STEP_STATUSES)[number];
export type RunStatus = (typeof RUN_STATUSES)[number];

export interface RunWorkflowRef {
  name: string;
  version: string;
  file?: string;
  description?: string;
}

export interface RunCounters {
  completedSteps: number;
  failedSteps: number;
  retries: number;
  loopIterations: number;
  checkpoints: number;
}

export interface RunArtifactPaths {
  meta: string;
  input: string;
  state: string;
  output: string;
  trace: string;
  checkpointsDir: string;
}

export interface RunRecord {
  schemaVersion: string;
  runId: string;
  workflow: RunWorkflowRef;
  status: RunStatus;
  startedAt: string;
  completedAt?: string;
  currentStepId?: string;
  policies?: {
    maxRunSteps?: number;
    maxRunDurationMs?: number;
    allowTools?: string[];
    allowExternalSideEffects?: boolean;
  };
  counters?: RunCounters;
  input?: JsonValue;
  output?: JsonValue;
  artifactPaths?: Partial<RunArtifactPaths>;
}
