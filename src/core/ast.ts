import type { JsonSchema, JsonValue } from "./json-schema";

export const WORKFLOW_STEP_KINDS = [
  "assign",
  "tool",
  "agent",
  "if",
  "for_each",
  "while",
  "parallel",
  "return",
  "fail",
  "noop"
] as const;

export type WorkflowStepKind = (typeof WORKFLOW_STEP_KINDS)[number];

export interface WorkflowDefaults {
  model?: string;
  timeoutMs?: number;
  maxStepRetries?: number;
  outputMode?: "structured" | "text" | "json";
}

export interface WorkflowPolicies {
  allowTools?: string[];
  maxRunSteps?: number;
  maxRunDurationMs?: number;
  maxAgentToolCalls?: number;
}

export interface BaseStep {
  id: string;
  kind: WorkflowStepKind;
  name?: string;
  description?: string;
  when?: string;
  timeoutMs?: number;
}

export interface AssignStep extends BaseStep {
  kind: "assign";
  set: Record<string, JsonValue | string | Record<string, unknown> | unknown[]>;
}

export interface StepWriteDirectives {
  save?: string;
  append?: string;
  merge?: string;
}

export interface ToolStep extends BaseStep, StepWriteDirectives {
  kind: "tool";
  tool: string;
  input?: Record<string, JsonValue | string | Record<string, unknown> | unknown[]>;
}

export interface AgentStep extends BaseStep, StepWriteDirectives {
  kind: "agent";
  mode?: "structured" | "tool-use";
  provider?: string;
  model?: string;
  objective: string;
  instructions?: string;
  input?: Record<string, JsonValue | string | Record<string, unknown> | unknown[]>;
  outputSchema?: JsonSchema;
}

export interface IfStep extends BaseStep {
  kind: "if";
  condition: string;
  then: WorkflowStep[];
  else?: WorkflowStep[];
}

export interface ForEachStep extends BaseStep {
  kind: "for_each";
  items: string;
  as: string;
  steps: WorkflowStep[];
}

export interface WhileStep extends BaseStep {
  kind: "while";
  condition: string;
  maxIterations: number;
  steps: WorkflowStep[];
}

export interface ParallelBranch {
  id?: string;
  steps: WorkflowStep[];
}

export interface ParallelStep extends BaseStep {
  kind: "parallel";
  branches: ParallelBranch[];
}

export interface ReturnStep extends BaseStep {
  kind: "return";
  output?: JsonValue | string | Record<string, unknown>;
}

export interface FailStep extends BaseStep {
  kind: "fail";
  message?: string;
  error?: string;
}

export interface NoopStep extends BaseStep {
  kind: "noop";
}

export type WorkflowStep =
  | AssignStep
  | ToolStep
  | AgentStep
  | IfStep
  | ForEachStep
  | WhileStep
  | ParallelStep
  | ReturnStep
  | FailStep
  | NoopStep;

export interface WorkflowDocument {
  version: string;
  name: string;
  description?: string;
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
  defaults?: WorkflowDefaults;
  policies?: WorkflowPolicies;
  state?: Record<string, JsonValue>;
  steps: WorkflowStep[];
  output?: JsonValue | Record<string, unknown>;
}
