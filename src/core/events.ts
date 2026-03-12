import type { WorkflowStepKind } from "./ast";
import type { JsonObject, JsonValue } from "./json-schema";
import type { RunStatus, StepStatus } from "./run-record";

export const TRACE_EVENT_TYPES = [
  "run.started",
  "run.completed",
  "run.failed",
  "run.paused",
  "step.started",
  "step.completed",
  "step.failed",
  "step.skipped",
  "tool.called",
  "tool.completed",
  "tool.failed",
  "agent.called",
  "agent.completed",
  "agent.failed",
  "checkpoint.saved"
] as const;

export type TraceEventType = (typeof TRACE_EVENT_TYPES)[number];

export interface TraceEvent {
  schemaVersion: string;
  ts: string;
  runId: string;
  event: TraceEventType;
  stepId?: string;
  kind?: WorkflowStepKind;
  status?: StepStatus | RunStatus;
  durationMs?: number;
  input?: JsonValue;
  output?: JsonValue;
  stateDiff?: JsonValue;
  meta?: JsonObject;
}
