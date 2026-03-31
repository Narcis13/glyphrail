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

export const CURSOR_FRAME_KINDS = [
  "root",
  "if",
  "for_each",
  "while"
] as const;

export type CursorFrameKind = (typeof CURSOR_FRAME_KINDS)[number];

export interface RootCursorFrame {
  kind: "root";
  nextIndex: number;
}

export interface IfCursorFrame {
  kind: "if";
  stepId: string;
  branch: "then" | "else";
  nextIndex: number;
}

export interface ForEachCursorFrame {
  kind: "for_each";
  stepId: string;
  as: string;
  items: JsonValue[];
  itemIndex: number;
  nextIndex: number;
}

export interface WhileCursorFrame {
  kind: "while";
  stepId: string;
  iteration: number;
  nextIndex: number;
}

export type ExecutionCursorFrame =
  | RootCursorFrame
  | IfCursorFrame
  | ForEachCursorFrame
  | WhileCursorFrame;

export interface ExecutionCursor {
  frames: ExecutionCursorFrame[];
}

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
  cursor?: ExecutionCursor;
  elapsedMs?: number;
  visitedSteps?: number;
  policies?: {
    maxRunSteps?: number;
    maxRunDurationMs?: number;
    allowTools?: string[];
    allowExternalSideEffects?: boolean;
  };
  counters?: RunCounters;
  retryCounters?: Record<string, number>;
  input?: JsonValue;
  output?: JsonValue;
  artifactPaths?: Partial<RunArtifactPaths>;
  document?: { sourceFile: string; format: "markdown" | "html" };
}
