import type { Tool } from "../tools/contracts";
import { loadDeclaredTools } from "../tools/registry";
import { createRunId } from "../util/id";
import { nowIso } from "../util/time";
import { resolveProjectPath, type ResolvedProjectConfig } from "../config";
import { normalizeStatePath } from "../dsl/normalization";
import { EXIT_CODES, GlyphrailFailure, annotateFailure, createFailure, exitCodeForErrorCode } from "./errors";
import type { TraceEvent } from "./events";
import type {
  AssignStep,
  FailStep,
  ForEachStep,
  IfStep,
  NoopStep,
  ReturnStep,
  ToolStep,
  WhileStep,
  WorkflowDocument,
  WorkflowStep
} from "./ast";
import type { JsonObject, JsonValue } from "./json-schema";
import type { RunCounters, RunRecord, RunStatus } from "./run-record";
import {
  appendTraceEvent,
  getRunPaths,
  initializeRunArtifacts,
  saveCheckpoint,
  toArtifactPaths,
  writeRunMeta,
  writeRunOutput,
  writeRunState,
  type RunCheckpoint,
  type RunPaths
} from "./run-store";
import {
  appendStateValue,
  cloneJsonValue,
  createRuntimeNamespaces,
  evaluateRuntimeValue,
  getStateSnapshot,
  mergeStateValue,
  setStateValue,
  type RuntimeNamespaces,
  type StateMutationResult,
  type StepExecutionContext
} from "./runtime-state";
import { assertJsonSchema } from "./schema-validator";
import { SCHEMA_VERSION } from "../version";

export interface ExecuteWorkflowOptions {
  project: ResolvedProjectConfig;
  relativeWorkflowFile: string;
  workflow: WorkflowDocument;
  input: JsonValue;
  maxRunSteps?: number;
  maxRunDurationMs?: number;
  checkpointEveryStep?: boolean;
}

export interface ExecuteWorkflowResult {
  runId: string;
  status: RunStatus;
  output: JsonValue;
  state: JsonObject;
  record: RunRecord;
  artifacts: RunPaths;
  traceEventCount: number;
}

interface EffectivePolicies {
  maxRunSteps: number;
  maxRunDurationMs: number;
  allowTools?: string[];
  allowExternalSideEffects: boolean;
}

interface ExecutionState {
  project: ResolvedProjectConfig;
  workflow: WorkflowDocument;
  relativeWorkflowFile: string;
  runId: string;
  startedAt: string;
  startedAtMs: number;
  runtime: RuntimeNamespaces;
  tools: Map<string, Tool>;
  policies: EffectivePolicies;
  counters: RunCounters;
  paths: RunPaths;
  checkpointEveryStep: boolean;
  currentStepId?: string;
  visitedSteps: number;
  traceEventCount: number;
}

interface StepExecutionResult {
  stateDiff?: JsonObject;
  output?: JsonValue;
  returnOutput?: JsonValue;
  meta?: JsonObject;
}

interface ExecutionSignal {
  type: "continue" | "return";
  result?: StepExecutionResult;
}

export async function executeWorkflow(options: ExecuteWorkflowOptions): Promise<ExecuteWorkflowResult> {
  const runId = createRunId();
  const startedAt = nowIso();
  const runtime = createRuntimeNamespaces(options.workflow, options.input, {
    runId,
    workflowFile: options.relativeWorkflowFile,
    startedAt
  });
  const tools = await loadToolsMap(options.project, options.workflow);
  const policies = buildEffectivePolicies(options);
  const paths = getRunPaths(options.project, runId);
  const counters: RunCounters = {
    completedSteps: 0,
    failedSteps: 0,
    retries: 0,
    loopIterations: 0,
    checkpoints: 0
  };
  const state: ExecutionState = {
    project: options.project,
    workflow: options.workflow,
    relativeWorkflowFile: options.relativeWorkflowFile,
    runId,
    startedAt,
    startedAtMs: Date.now(),
    runtime,
    tools,
    policies,
    counters,
    paths,
    checkpointEveryStep: options.checkpointEveryStep ?? options.project.config.defaultCheckpointEveryStep,
    visitedSteps: 0,
    traceEventCount: 0
  };

  await initializeRunArtifacts(paths, options.input, runtime.state);
  await emitTrace(state, {
    event: "run.started",
    status: "completed",
    input: options.input,
    meta: {
      workflow: options.workflow.name,
      file: options.relativeWorkflowFile
    }
  });

  try {
    const executionSignal = await executeStepList(options.workflow.steps, state, {});
    const output = materializeRunOutput(state, executionSignal?.result?.returnOutput);

    if (options.workflow.outputSchema) {
      assertJsonSchema(output, options.workflow.outputSchema, {
        errorCode: "OUTPUT_VALIDATION_ERROR",
        subject: "Workflow output"
      });
    }

    const completedAt = nowIso();
    const record = buildRunRecord(state, "completed", completedAt, output);

    await writeRunState(paths, getStateSnapshot(state.runtime.state));
    await writeRunOutput(paths, output);
    await writeRunMeta(paths, record);
    await emitTrace(state, {
      event: "run.completed",
      status: "completed",
      output,
      meta: {
        completedAt
      }
    });

    return {
      runId,
      status: "completed",
      output,
      state: getStateSnapshot(state.runtime.state),
      record,
      artifacts: paths,
      traceEventCount: state.traceEventCount
    };
  } catch (error) {
    const failure = annotateFailure(error, {
      runId,
      stepId: state.currentStepId
    });
    const completedAt = nowIso();
    const status: RunStatus = failure.glyphrailError.code === "TIMEOUT" ? "timed_out" : "failed";
    const record = buildRunRecord(state, status, completedAt);

    await writeRunState(paths, getStateSnapshot(state.runtime.state));
    await writeRunMeta(paths, record);
    await emitTrace(state, {
      event: "run.failed",
      status,
      meta: {
        completedAt,
        error: {
          code: failure.glyphrailError.code,
          message: failure.glyphrailError.message,
          stepId: failure.glyphrailError.stepId ?? state.currentStepId ?? null
        }
      }
    });

    throw failure;
  }
}

async function executeStepList(
  steps: WorkflowStep[],
  state: ExecutionState,
  stepContext: StepExecutionContext
): Promise<ExecutionSignal | undefined> {
  for (const step of steps) {
    const signal = await executeStep(step, state, stepContext);
    if (signal?.type === "return") {
      return signal;
    }
  }

  return undefined;
}

async function executeStep(
  step: WorkflowStep,
  state: ExecutionState,
  stepContext: StepExecutionContext
): Promise<ExecutionSignal | undefined> {
  enforceRunBudgets(state);
  state.visitedSteps += 1;
  const previousStepId = state.currentStepId;
  state.currentStepId = step.id;

  const scopedContext = withStepContext(stepContext, {
    currentStepId: step.id
  });

  if (step.when !== undefined) {
    const shouldRun = Boolean(
      evaluateRuntimeValue(step.when, state.runtime, scopedContext)
    );

    if (!shouldRun) {
      await emitTrace(state, {
        event: "step.skipped",
        stepId: step.id,
        kind: step.kind,
        status: "skipped",
        meta: {
          when: step.when
        }
      });
      await persistCheckpoint(state);
      state.currentStepId = previousStepId;
      return undefined;
    }
  }

  const stepStartedAtMs = Date.now();
  const timeoutMs = resolveEffectiveStepTimeout(step, state);

  await emitTrace(state, {
    event: "step.started",
    stepId: step.id,
    kind: step.kind
  });

  try {
    const result = await runWithTimeout(
      () => executeStepBody(step, state, scopedContext, timeoutMs),
      timeoutMs,
      step.id
    );
    const durationMs = Date.now() - stepStartedAtMs;

    state.counters.completedSteps += 1;

    await emitTrace(state, {
      event: "step.completed",
      stepId: step.id,
      kind: step.kind,
      status: "success",
      durationMs,
      output: result.output,
      stateDiff: result.stateDiff,
      meta: result.meta
    });
    await persistCheckpoint(state);

    if (result.returnOutput !== undefined) {
      state.currentStepId = previousStepId;
      return {
        type: "return",
        result
      };
    }

    state.currentStepId = previousStepId;
    return {
      type: "continue",
      result
    };
  } catch (error) {
    state.currentStepId = step.id;
    const failure = annotateFailure(error, {
      runId: state.runId,
      stepId: step.id
    });
    const durationMs = Date.now() - stepStartedAtMs;

    state.counters.failedSteps += 1;

    await emitTrace(state, {
      event: "step.failed",
      stepId: step.id,
      kind: step.kind,
      status: "failed",
      durationMs,
      meta: {
        error: {
          code: failure.glyphrailError.code,
          message: failure.glyphrailError.message
        }
      }
    });

    throw failure;
  }
}

async function executeStepBody(
  step: WorkflowStep,
  state: ExecutionState,
  stepContext: StepExecutionContext,
  timeoutMs?: number
): Promise<StepExecutionResult> {
  switch (step.kind) {
    case "assign":
      return executeAssignStep(step, state, stepContext);
    case "tool":
      return executeToolStep(step, state, stepContext, timeoutMs);
    case "if":
      return executeIfStep(step, state, stepContext);
    case "for_each":
      return executeForEachStep(step, state, stepContext);
    case "while":
      return executeWhileStep(step, state, stepContext);
    case "return":
      return executeReturnStep(step, state, stepContext);
    case "fail":
      return executeFailStep(step);
    case "noop":
      return executeNoopStep(step);
    case "agent":
    case "parallel":
      throw createFailure(
        "GENERIC_FAILURE",
        `Step kind '${step.kind}' is not executable in Slice 3.`,
        EXIT_CODES.executionFailure
      );
  }
}

function executeAssignStep(
  step: AssignStep,
  state: ExecutionState,
  stepContext: StepExecutionContext
): StepExecutionResult {
  const mutations: StateMutationResult[] = [];

  for (const [path, rawValue] of Object.entries(step.set)) {
    const resolvedValue = evaluateRuntimeValue(rawValue, state.runtime, stepContext);
    mutations.push(setStateValue(state.runtime.state, path, resolvedValue));
  }

  return {
    output: buildStateDiff(mutations),
    stateDiff: buildStateDiff(mutations)
  };
}

async function executeToolStep(
  step: ToolStep,
  state: ExecutionState,
  stepContext: StepExecutionContext,
  timeoutMs?: number
): Promise<StepExecutionResult> {
  enforceToolPolicy(step.tool, state);

  const tool = state.tools.get(step.tool);
  if (!tool) {
    throw createFailure(
      "NOT_FOUND",
      `Tool '${step.tool}' is not registered.`,
      EXIT_CODES.notFound
    );
  }

  if (!state.policies.allowExternalSideEffects && (tool.sideEffect === "write" || tool.sideEffect === "external")) {
    throw createFailure(
      "POLICY_VIOLATION",
      `Tool '${tool.name}' is blocked because external side effects are disabled.`,
      EXIT_CODES.policyViolation
    );
  }

  const resolvedInput = evaluateRuntimeValue(step.input ?? {}, state.runtime, stepContext);

  assertJsonSchema(resolvedInput, tool.inputSchema, {
    errorCode: "TOOL_INPUT_VALIDATION_ERROR",
    subject: `Tool '${tool.name}' input`
  });

  await emitTrace(state, {
    event: "tool.called",
    stepId: step.id,
    kind: step.kind,
    input: resolvedInput,
    meta: {
      tool: tool.name
    }
  });

  const controller = new AbortController();
  const toolTimeoutMs = timeoutMs === undefined
    ? tool.timeoutMs
    : tool.timeoutMs === undefined
      ? timeoutMs
      : Math.min(timeoutMs, tool.timeoutMs);

  let toolResult: Awaited<ReturnType<typeof tool.execute>>;
  try {
    toolResult = await runWithTimeout(
      () =>
        tool.execute(resolvedInput as never, {
          cwd: state.project.cwd,
          env: process.env,
          runId: state.runId,
          stepId: step.id,
          signal: controller.signal
        }),
      toolTimeoutMs,
      step.id,
      () => controller.abort()
    );
  } catch (error) {
    const failure = annotateFailure(
      error instanceof GlyphrailFailure
        ? error
        : createFailure(
            "TOOL_RUNTIME_ERROR",
            `Tool '${tool.name}' execution failed.`,
            exitCodeForErrorCode("TOOL_RUNTIME_ERROR"),
            error instanceof Error ? error.message : error
          ),
      {
        runId: state.runId,
        stepId: step.id
      }
    );

    await emitTrace(state, {
      event: "tool.failed",
      stepId: step.id,
      kind: step.kind,
      meta: {
        tool: tool.name,
        error: {
          code: failure.glyphrailError.code,
          message: failure.glyphrailError.message
        }
      }
    });

    throw failure;
  }

  if (!toolResult.ok) {
    const failure = annotateFailure(
      new GlyphrailFailure(
        {
          ...toolResult.error
        },
        exitCodeForErrorCode(toolResult.error.code)
      ),
      {
        runId: state.runId,
        stepId: step.id
      }
    );

    await emitTrace(state, {
      event: "tool.failed",
      stepId: step.id,
      kind: step.kind,
      meta: {
        tool: tool.name,
        error: {
          code: failure.glyphrailError.code,
          message: failure.glyphrailError.message
        }
      }
    });

    throw failure;
  }

  const output = cloneJsonValue(toolResult.output as JsonValue);

  if (tool.outputSchema) {
    assertJsonSchema(output, tool.outputSchema, {
      errorCode: "TOOL_OUTPUT_VALIDATION_ERROR",
      subject: `Tool '${tool.name}' output`
    });
  }

  await emitTrace(state, {
    event: "tool.completed",
    stepId: step.id,
    kind: step.kind,
    output,
    meta: {
      tool: tool.name
    }
  });

  const mutations = applyStepWrite(step, state.runtime.state, output);

  return {
    output,
    stateDiff: buildStateDiff(mutations),
    meta: {
      tool: tool.name
    }
  };
}

async function executeIfStep(
  step: IfStep,
  state: ExecutionState,
  stepContext: StepExecutionContext
): Promise<StepExecutionResult> {
  const conditionResult = Boolean(evaluateRuntimeValue(step.condition, state.runtime, stepContext));
  const branch = conditionResult ? step.then : step.else ?? [];
  const signal = await executeStepList(branch, state, stepContext);

  return {
    meta: {
      branch: conditionResult ? "then" : "else",
      matched: conditionResult,
      executedSteps: branch.length
    },
    returnOutput: signal?.result?.returnOutput
  };
}

async function executeForEachStep(
  step: ForEachStep,
  state: ExecutionState,
  stepContext: StepExecutionContext
): Promise<StepExecutionResult> {
  const evaluatedItems = evaluateRuntimeValue(step.items, state.runtime, stepContext);
  if (!Array.isArray(evaluatedItems)) {
    throw createFailure(
      "EXPRESSION_EVALUATION_ERROR",
      `for_each step '${step.id}' requires an array of items.`,
      exitCodeForErrorCode("EXPRESSION_EVALUATION_ERROR")
    );
  }

  const items = cloneJsonValue(evaluatedItems);
  for (const [index, item] of items.entries()) {
    state.counters.loopIterations += 1;
    const nestedContext = withStepContext(stepContext, {
      [step.as]: normalizeLoopContextValue(item),
      loop: {
        stepId: step.id,
        index
      }
    });
    const signal = await executeStepList(step.steps, state, {
      ...nestedContext,
      item
    });

    if (signal?.type === "return") {
      return {
        meta: {
          iterations: index + 1,
          itemCount: items.length
        },
        returnOutput: signal.result?.returnOutput
      };
    }
  }

  return {
    meta: {
      iterations: items.length,
      itemCount: items.length
    }
  };
}

async function executeWhileStep(
  step: WhileStep,
  state: ExecutionState,
  stepContext: StepExecutionContext
): Promise<StepExecutionResult> {
  let iterations = 0;

  while (Boolean(evaluateRuntimeValue(step.condition, state.runtime, stepContext))) {
    if (iterations >= step.maxIterations) {
      throw createFailure(
        "BUDGET_EXHAUSTION",
        `while step '${step.id}' exceeded maxIterations=${step.maxIterations}.`,
        exitCodeForErrorCode("BUDGET_EXHAUSTION")
      );
    }

    iterations += 1;
    state.counters.loopIterations += 1;

    const signal = await executeStepList(step.steps, state, withStepContext(stepContext, {
      loop: {
        stepId: step.id,
        iteration: iterations
      }
    }));

    if (signal?.type === "return") {
      return {
        meta: {
          iterations
        },
        returnOutput: signal.result?.returnOutput
      };
    }
  }

  return {
    meta: {
      iterations
    }
  };
}

function executeReturnStep(
  step: ReturnStep,
  state: ExecutionState,
  stepContext: StepExecutionContext
): StepExecutionResult {
  return {
    output: step.output === undefined ? undefined : evaluateRuntimeValue(step.output, state.runtime, stepContext),
    returnOutput:
      step.output === undefined ? materializeRunOutput(state) : evaluateRuntimeValue(step.output, state.runtime, stepContext)
  };
}

function executeFailStep(step: FailStep): never {
  throw createFailure(
    step.error ?? "WORKFLOW_FAILED",
    step.message ?? `Workflow failed at step '${step.id}'.`,
    EXIT_CODES.executionFailure
  );
}

function executeNoopStep(_step: NoopStep): StepExecutionResult {
  return {};
}

function materializeRunOutput(state: ExecutionState, returnOutput?: JsonValue): JsonValue {
  if (returnOutput !== undefined) {
    return returnOutput;
  }

  if (state.workflow.output !== undefined) {
    return evaluateRuntimeValue(state.workflow.output, state.runtime, {});
  }

  return getStateSnapshot(state.runtime.state);
}

function buildEffectivePolicies(options: ExecuteWorkflowOptions): EffectivePolicies {
  return {
    maxRunSteps:
      options.maxRunSteps ??
      options.workflow.policies?.maxRunSteps ??
      options.project.config.policies.maxRunSteps,
    maxRunDurationMs:
      options.maxRunDurationMs ??
      options.workflow.policies?.maxRunDurationMs ??
      options.project.config.policies.maxRunDurationMs,
    allowTools: options.workflow.policies?.allowTools,
    allowExternalSideEffects: options.project.config.policies.allowExternalSideEffects
  };
}

async function loadToolsMap(
  project: ResolvedProjectConfig,
  workflow: WorkflowDocument
): Promise<Map<string, Tool>> {
  if (!workflowContainsToolSteps(workflow.steps)) {
    return new Map();
  }

  const entryPath = resolveProjectPath(project, project.config.toolsEntry);
  const tools = await loadDeclaredTools(entryPath);
  return new Map(tools.map((tool) => [tool.name, tool]));
}

function enforceRunBudgets(state: ExecutionState): void {
  if (state.visitedSteps >= state.policies.maxRunSteps) {
    throw createFailure(
      "BUDGET_EXHAUSTION",
      `Run exceeded maxRunSteps=${state.policies.maxRunSteps}.`,
      exitCodeForErrorCode("BUDGET_EXHAUSTION")
    );
  }

  const elapsedMs = Date.now() - state.startedAtMs;
  if (elapsedMs >= state.policies.maxRunDurationMs) {
    throw createFailure(
      "TIMEOUT",
      `Run exceeded maxRunDurationMs=${state.policies.maxRunDurationMs}.`,
      exitCodeForErrorCode("TIMEOUT")
    );
  }
}

function resolveEffectiveStepTimeout(step: WorkflowStep, state: ExecutionState): number | undefined {
  const configuredTimeout =
    step.timeoutMs ??
    state.workflow.defaults?.timeoutMs;
  const remainingDurationMs = state.policies.maxRunDurationMs - (Date.now() - state.startedAtMs);

  if (remainingDurationMs <= 0) {
    throw createFailure(
      "TIMEOUT",
      `Run exceeded maxRunDurationMs=${state.policies.maxRunDurationMs}.`,
      exitCodeForErrorCode("TIMEOUT")
    );
  }

  if (configuredTimeout === undefined) {
    return remainingDurationMs;
  }

  return Math.min(configuredTimeout, remainingDurationMs);
}

function applyStepWrite(
  step: ToolStep,
  state: JsonObject,
  output: JsonValue
): StateMutationResult[] {
  if (step.save) {
    return [setStateValue(state, normalizeStatePath(step.save), output)];
  }

  if (step.append) {
    return [appendStateValue(state, normalizeStatePath(step.append), output)];
  }

  if (step.merge) {
    return [mergeStateValue(state, normalizeStatePath(step.merge), output)];
  }

  return [];
}

function buildStateDiff(mutations: StateMutationResult[]): JsonObject | undefined {
  if (mutations.length === 0) {
    return undefined;
  }

  return Object.fromEntries(mutations.map((mutation) => [mutation.path, mutation.value]));
}

async function persistCheckpoint(state: ExecutionState): Promise<void> {
  if (!state.checkpointEveryStep) {
    await writeRunState(state.paths, getStateSnapshot(state.runtime.state));
    return;
  }

  state.counters.checkpoints += 1;
  await writeRunState(state.paths, getStateSnapshot(state.runtime.state));

  const snapshot: RunCheckpoint = {
    runId: state.runId,
    checkpoint: state.counters.checkpoints,
    ts: nowIso(),
    currentStepId: state.currentStepId,
    state: getStateSnapshot(state.runtime.state),
    context: cloneJsonValue(state.runtime.context),
    system: cloneJsonValue(state.runtime.system),
    counters: {
      ...state.counters
    }
  };
  const checkpointFile = await saveCheckpoint(state.paths, snapshot);

  await emitTrace(state, {
    event: "checkpoint.saved",
    status: "success",
    meta: {
      checkpoint: state.counters.checkpoints,
      file: checkpointFile
    }
  });
}

async function emitTrace(
  state: ExecutionState,
  event: Omit<TraceEvent, "schemaVersion" | "ts" | "runId">
): Promise<void> {
  await appendTraceEvent(state.paths, {
    schemaVersion: SCHEMA_VERSION,
    ts: nowIso(),
    runId: state.runId,
    ...event
  });
  state.traceEventCount += 1;
}

function buildRunRecord(
  state: ExecutionState,
  status: RunStatus,
  completedAt: string,
  output?: JsonValue
): RunRecord {
  return {
    schemaVersion: SCHEMA_VERSION,
    runId: state.runId,
    workflow: {
      name: state.workflow.name,
      version: state.workflow.version,
      file: state.relativeWorkflowFile,
      description: state.workflow.description
    },
    status,
    startedAt: state.startedAt,
    completedAt,
    currentStepId: state.currentStepId,
    policies: {
      maxRunSteps: state.policies.maxRunSteps,
      maxRunDurationMs: state.policies.maxRunDurationMs,
      allowTools: state.policies.allowTools,
      allowExternalSideEffects: state.policies.allowExternalSideEffects
    },
    counters: {
      ...state.counters
    },
    input: state.runtime.input,
    output,
    artifactPaths: toArtifactPaths(state.paths, state.project)
  };
}

function enforceToolPolicy(toolName: string, state: ExecutionState): void {
  if (!state.policies.allowTools || state.policies.allowTools.length === 0) {
    return;
  }

  if (!state.policies.allowTools.includes(toolName)) {
    throw createFailure(
      "POLICY_VIOLATION",
      `Tool '${toolName}' is not allowlisted by workflow policy.`,
      EXIT_CODES.policyViolation
    );
  }
}

function withStepContext(stepContext: StepExecutionContext, additions: JsonObject): StepExecutionContext {
  return {
    ...stepContext,
    context: {
      ...(stepContext.context ?? {}),
      ...additions
    }
  };
}

function normalizeLoopContextValue(value: JsonValue): JsonValue {
  return cloneJsonValue(value);
}

function workflowContainsToolSteps(steps: WorkflowStep[]): boolean {
  for (const step of steps) {
    if (step.kind === "tool") {
      return true;
    }

    if (step.kind === "if") {
      if (workflowContainsToolSteps(step.then) || workflowContainsToolSteps(step.else ?? [])) {
        return true;
      }
      continue;
    }

    if (step.kind === "for_each" || step.kind === "while") {
      if (workflowContainsToolSteps(step.steps)) {
        return true;
      }
    }
  }

  return false;
}

async function runWithTimeout<T>(
  task: () => Promise<T> | T,
  timeoutMs?: number,
  stepId?: string,
  onTimeout?: () => void
): Promise<T> {
  if (timeoutMs === undefined) {
    return await task();
  }

  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      onTimeout?.();
      reject(
        createFailure(
          "TIMEOUT",
          stepId ? `Step '${stepId}' timed out after ${timeoutMs}ms.` : `Timed out after ${timeoutMs}ms.`,
          exitCodeForErrorCode("TIMEOUT")
        )
      );
    }, timeoutMs);

    Promise.resolve()
      .then(task)
      .then((result) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
  });
}
