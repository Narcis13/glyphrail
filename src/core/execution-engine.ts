import { buildStructuredPrompt, getAgentAdapter, repairStructuredOutput } from "../agent/runtime";
import type { Tool } from "../tools/contracts";
import { loadDeclaredTools } from "../tools/registry";
import { invokeTool } from "../tools/runtime";
import { createRunId } from "../util/id";
import { nowIso } from "../util/time";
import { resolveProjectPath, type ResolvedProjectConfig } from "../config";
import { normalizeStatePath } from "../dsl/normalization";
import { resolveOnErrorPolicy } from "./error-policy";
import { EXIT_CODES, GlyphrailFailure, annotateFailure, createFailure, exitCodeForErrorCode } from "./errors";
import type { TraceEvent } from "./events";
import type {
  AgentStep,
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
import type {
  ExecutionCursor,
  ExecutionCursorFrame,
  ForEachCursorFrame,
  IfCursorFrame,
  RootCursorFrame,
  RunCounters,
  RunRecord,
  RunStatus,
  WhileCursorFrame
} from "./run-record";
import type { JsonObject, JsonValue } from "./json-schema";
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
  resume?: ResumeWorkflowState;
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

export interface ResumeWorkflowState {
  runId: string;
  startedAt: string;
  runtime: RuntimeNamespaces;
  counters: RunCounters;
  retryCounters: Record<string, number>;
  cursor: ExecutionCursor;
  visitedSteps: number;
  elapsedMs: number;
}

interface ExecutionState {
  project: ResolvedProjectConfig;
  workflow: WorkflowDocument;
  relativeWorkflowFile: string;
  runId: string;
  startedAt: string;
  sessionStartedAtMs: number;
  elapsedMsBase: number;
  runtime: RuntimeNamespaces;
  tools: Map<string, Tool>;
  policies: EffectivePolicies;
  counters: RunCounters;
  paths: RunPaths;
  checkpointEveryStep: boolean;
  cursor: ExecutionCursor;
  currentStepId?: string;
  retryCounters: Record<string, number>;
  visitedSteps: number;
  traceEventCount: number;
}

interface StepExecutionResult {
  stateDiff?: JsonObject;
  output?: JsonValue;
  returnOutput?: JsonValue;
  meta?: JsonObject;
  control?: {
    type: "goto";
    targetStepId: string;
  };
}

interface ExecutionSignal {
  type: "continue" | "return" | "goto";
  result?: StepExecutionResult;
  targetStepId?: string;
}

export async function executeWorkflow(options: ExecuteWorkflowOptions): Promise<ExecuteWorkflowResult> {
  const isResume = options.resume !== undefined;
  const runId = options.resume?.runId ?? createRunId();
  const startedAt = options.resume?.startedAt ?? nowIso();
  const runtime =
    options.resume?.runtime ??
    createRuntimeNamespaces(options.workflow, options.input, {
      runId,
      workflowFile: options.relativeWorkflowFile,
      startedAt
    });
  const tools = await loadToolsMap(options.project, options.workflow);
  const policies = buildEffectivePolicies(options);
  const paths = getRunPaths(options.project, runId);
  const counters: RunCounters = options.resume?.counters ?? {
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
    sessionStartedAtMs: Date.now(),
    elapsedMsBase: options.resume?.elapsedMs ?? 0,
    runtime,
    tools,
    policies,
    counters,
    paths,
    checkpointEveryStep: options.checkpointEveryStep ?? options.project.config.defaultCheckpointEveryStep,
    cursor: cloneExecutionCursor(options.resume?.cursor ?? createInitialCursor()),
    retryCounters: { ...(options.resume?.retryCounters ?? {}) },
    visitedSteps: options.resume?.visitedSteps ?? 0,
    traceEventCount: 0
  };

  if (!isResume) {
    await initializeRunArtifacts(paths, options.input, runtime.state);
    await persistRunSnapshot(state, {
      saveCheckpointFile: false
    });
    await emitTrace(state, {
      event: "run.started",
      status: "completed",
      input: options.input,
      meta: {
        workflow: options.workflow.name,
        file: options.relativeWorkflowFile
      }
    });
  }

  try {
    const executionSignal = await executeStepList(options.workflow.steps, state, {}, 0);
    if (executionSignal?.type === "goto" && executionSignal.targetStepId) {
      throw createFailure(
        "NOT_FOUND",
        `Goto target '${executionSignal.targetStepId}' could not be resolved in the current workflow scope.`,
        EXIT_CODES.notFound
      );
    }
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
    const record = buildRunRecord(state, status, completedAt, undefined, {
      currentStepId: failure.glyphrailError.stepId ?? state.currentStepId
    });

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
  stepContext: StepExecutionContext,
  depth: number
): Promise<ExecutionSignal | undefined> {
  const frame = getCursorFrameAtDepth(state, depth);

  for (let index = frame.nextIndex; index < steps.length;) {
    frame.nextIndex = index;
    const step = steps[index];
    const signal = await executeStep(step, state, stepContext, depth);
    if (signal?.type === "return") {
      frame.nextIndex = index + 1;
      trimCursor(state, depth + 1);
      await persistCheckpoint(state);
      return signal;
    }

    if (signal?.type === "goto" && signal.targetStepId) {
      const targetIndex = steps.findIndex((candidate) => candidate.id === signal.targetStepId);
      if (targetIndex >= 0) {
        frame.nextIndex = targetIndex;
        trimCursor(state, depth + 1);
        await persistCheckpoint(state);
        index = frame.nextIndex;
        continue;
      }

      return signal;
    }

    frame.nextIndex = index + 1;
    trimCursor(state, depth + 1);
    await persistCheckpoint(state);
    index = frame.nextIndex;
  }

  return undefined;
}

async function executeStep(
  step: WorkflowStep,
  state: ExecutionState,
  stepContext: StepExecutionContext,
  depth: number
): Promise<ExecutionSignal | undefined> {
  const previousStepId = state.currentStepId;
  state.currentStepId = step.id;

  const scopedContext = withStepContext(stepContext, {
    currentStepId: step.id
  });

  enforceRunBudgets(state);
  state.visitedSteps += 1;

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
      state.currentStepId = previousStepId;
      return {
        type: "continue"
      };
    }
  }

  while (true) {
    const attempt = (state.retryCounters[step.id] ?? 0) + 1;
    const stepStartedAtMs = Date.now();
    const timeoutMs = resolveEffectiveStepTimeout(step, state);

    await emitTrace(state, {
      event: "step.started",
      stepId: step.id,
      kind: step.kind,
      meta: {
        attempt
      }
    });

    try {
      const result = await runWithTimeout(
        () => executeStepBody(step, state, scopedContext, depth, timeoutMs, attempt),
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
        meta: buildStepMeta(result.meta, attempt, result.control?.targetStepId)
      });

      if (result.returnOutput !== undefined) {
        state.currentStepId = previousStepId;
        return {
          type: "return",
          result
        };
      }

      if (result.control?.type === "goto") {
        state.currentStepId = previousStepId;
        return {
          type: "goto",
          targetStepId: result.control.targetStepId,
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
      const errorPolicy = resolveOnErrorPolicy(step.onError, state.workflow.defaults);

      if (errorPolicy.strategy === "retry") {
        const maxAttempts = errorPolicy.maxAttempts ?? 2;
        if (attempt < maxAttempts) {
          state.retryCounters[step.id] = attempt;
          state.counters.retries += 1;

          await emitTrace(state, {
            event: "step.failed",
            stepId: step.id,
            kind: step.kind,
            status: "retrying",
            durationMs,
            meta: {
              attempt,
              nextAttempt: attempt + 1,
              maxAttempts,
              strategy: "retry",
              error: {
                code: failure.glyphrailError.code,
                message: failure.glyphrailError.message
              }
            }
          });
          await persistRunSnapshot(state, {
            saveCheckpointFile: false
          });
          enforceRunBudgets(state);
          state.visitedSteps += 1;
          continue;
        }
      }

      state.counters.failedSteps += 1;

      await emitTrace(state, {
        event: "step.failed",
        stepId: step.id,
        kind: step.kind,
        status: "failed",
        durationMs,
        meta: {
          attempt,
          strategy: errorPolicy.strategy,
          ...(errorPolicy.goto ? { goto: errorPolicy.goto } : {}),
          error: {
            code: failure.glyphrailError.code,
            message: failure.glyphrailError.message
          }
        }
      });

      if (errorPolicy.strategy === "continue") {
        state.currentStepId = previousStepId;
        return {
          type: "continue"
        };
      }

      if (errorPolicy.strategy === "goto") {
        if (!errorPolicy.goto) {
          throw annotateFailure(
            createFailure(
              "GENERIC_FAILURE",
              `Step '${step.id}' uses onError.strategy=goto but does not define a goto target.`,
              EXIT_CODES.executionFailure
            ),
            {
              runId: state.runId,
              stepId: step.id
            }
          );
        }

        state.currentStepId = previousStepId;
        return {
          type: "goto",
          targetStepId: errorPolicy.goto
        };
      }

      throw failure;
    }
  }
}

async function executeStepBody(
  step: WorkflowStep,
  state: ExecutionState,
  stepContext: StepExecutionContext,
  depth: number,
  timeoutMs?: number,
  attempt = 1
): Promise<StepExecutionResult> {
  switch (step.kind) {
    case "assign":
      return executeAssignStep(step, state, stepContext);
    case "tool":
      return executeToolStep(step, state, stepContext, timeoutMs);
    case "agent":
      return executeAgentStep(step, state, stepContext, timeoutMs, attempt);
    case "if":
      return executeIfStep(step, state, stepContext, depth);
    case "for_each":
      return executeForEachStep(step, state, stepContext, depth);
    case "while":
      return executeWhileStep(step, state, stepContext, depth);
    case "return":
      return executeReturnStep(step, state, stepContext);
    case "fail":
      return executeFailStep(step);
    case "noop":
      return executeNoopStep(step);
    case "parallel":
      throw createFailure(
        "GENERIC_FAILURE",
        `Step kind '${step.kind}' is not executable in the current slice.`,
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
  const tool = state.tools.get(step.tool);
  if (!tool) {
    throw createFailure(
      "NOT_FOUND",
      `Tool '${step.tool}' is not registered.`,
      EXIT_CODES.notFound
    );
  }

  const resolvedInput = evaluateRuntimeValue(step.input ?? {}, state.runtime, stepContext);

  await emitTrace(state, {
    event: "tool.called",
    stepId: step.id,
    kind: step.kind,
    input: resolvedInput,
    meta: {
      tool: tool.name
    }
  });

  let invocationResult: Awaited<ReturnType<typeof invokeTool>>;
  try {
    invocationResult = await invokeTool({
      tool,
      input: resolvedInput as JsonValue,
      cwd: state.project.cwd,
      projectRoot: state.project.projectRoot,
      env: process.env,
      runId: state.runId,
      stepId: step.id,
      allowTools: state.policies.allowTools,
      allowExternalSideEffects: state.policies.allowExternalSideEffects,
      timeoutMs
    });
  } catch (error) {
    const failure = annotateFailure(error, {
      runId: state.runId,
      stepId: step.id
    });

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

  const output = invocationResult.output;

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

async function executeAgentStep(
  step: AgentStep,
  state: ExecutionState,
  stepContext: StepExecutionContext,
  timeoutMs: number | undefined,
  attempt: number
): Promise<StepExecutionResult> {
  const mode = step.mode ?? "structured";
  if (mode !== "structured") {
    throw createFailure(
      "AGENT_RUNTIME_ERROR",
      `Agent step '${step.id}' requires mode=structured in Slice 5.`,
      exitCodeForErrorCode("AGENT_RUNTIME_ERROR")
    );
  }

  const provider = step.provider ?? "mock";
  const model = step.model ?? state.workflow.defaults?.model ?? "mock";
  const resolvedInput = evaluateRuntimeValue(step.input ?? {}, state.runtime, stepContext);
  const prompt = buildStructuredPrompt({
    objective: step.objective,
    instructions: step.instructions,
    input: resolvedInput
  });

  await emitTrace(state, {
    event: "agent.called",
    stepId: step.id,
    kind: step.kind,
    input: resolvedInput,
    meta: {
      provider,
      model,
      mode,
      attempt,
      prompt
    }
  });

  const repairState = {
    attempted: false,
    succeeded: false,
    candidate: undefined as string | undefined
  };
  let rawOutput: string | undefined;

  try {
    const adapter = getAgentAdapter(provider);
    const adapterResult = await adapter.runStructured({
      runId: state.runId,
      stepId: step.id,
      provider,
      model,
      objective: step.objective,
      instructions: step.instructions,
      input: resolvedInput,
      outputSchema: step.outputSchema,
      timeoutMs,
      prompt,
      attempt,
      meta: step.meta
    });

    rawOutput = adapterResult.rawOutput;

    let output: JsonValue | undefined = adapterResult.ok ? adapterResult.output : undefined;
    let failure: GlyphrailFailure | undefined = adapterResult.ok
      ? undefined
      : toAgentFailure(adapterResult.error, step.id, state.runId);

    if (!adapterResult.ok && adapterResult.rawOutput) {
      const repaired = repairStructuredOutput(adapterResult.rawOutput);
      repairState.attempted = true;
      if (repaired) {
        repairState.succeeded = true;
        repairState.candidate = repaired.candidate;
        output = repaired.output;
        failure = undefined;
      }
    }

    if (failure && output === undefined) {
      return await emitAgentFailureAndThrow(
        state,
        step,
        provider,
        model,
        attempt,
        failure,
        rawOutput,
        repairState
      );
    }

    if (step.outputSchema && output !== undefined) {
      try {
        assertJsonSchema(output, step.outputSchema, {
          errorCode: "AGENT_OUTPUT_VALIDATION_ERROR",
          subject: `Agent step '${step.id}' output`
        });
      } catch (error) {
        const validationFailure = annotateFailure(error, {
          runId: state.runId,
          stepId: step.id
        });

        if (adapterResult.rawOutput && !repairState.attempted) {
          repairState.attempted = true;
          const repaired = repairStructuredOutput(adapterResult.rawOutput);
          if (repaired) {
            repairState.succeeded = true;
            repairState.candidate = repaired.candidate;
            output = repaired.output;

            try {
              assertJsonSchema(output, step.outputSchema, {
                errorCode: "AGENT_OUTPUT_VALIDATION_ERROR",
                subject: `Agent step '${step.id}' output`
              });
            } catch (repairError) {
              return await emitAgentFailureAndThrow(
                state,
                step,
                provider,
                model,
                attempt,
                annotateFailure(repairError, {
                  runId: state.runId,
                  stepId: step.id
                }),
                rawOutput,
                repairState
              );
            }
          } else {
            return await emitAgentFailureAndThrow(
              state,
              step,
              provider,
              model,
              attempt,
              validationFailure,
              rawOutput,
              repairState
            );
          }
        } else {
          return await emitAgentFailureAndThrow(
            state,
            step,
            provider,
            model,
            attempt,
            validationFailure,
            rawOutput,
            repairState
          );
        }
      }
    }

    if (output === undefined) {
      return await emitAgentFailureAndThrow(
        state,
        step,
        provider,
        model,
        attempt,
        annotateFailure(
          createFailure(
            "AGENT_RUNTIME_ERROR",
            `Agent step '${step.id}' completed without output.`,
            exitCodeForErrorCode("AGENT_RUNTIME_ERROR")
          ),
          {
            runId: state.runId,
            stepId: step.id
          }
        ),
        rawOutput,
        repairState
      );
    }

    await emitTrace(state, {
      event: "agent.completed",
      stepId: step.id,
      kind: step.kind,
      output,
      meta: {
        provider,
        model,
        attempt,
        rawOutput: rawOutput ?? null,
        repairAttempted: repairState.attempted,
        repairSucceeded: repairState.succeeded,
        repairCandidate: repairState.candidate ?? null
      }
    });

    const mutations = applyStepWrite(step, state.runtime.state, output);

    return {
      output,
      stateDiff: buildStateDiff(mutations),
      meta: {
        provider,
        model,
        attempt,
        repairAttempted: repairState.attempted,
        repairSucceeded: repairState.succeeded
      }
    };
  } catch (error) {
    if (error instanceof GlyphrailFailure && "__agentFailureEmitted" in error) {
      throw error;
    }

    const failure = annotateFailure(error, {
      runId: state.runId,
      stepId: step.id
    });

    return await emitAgentFailureAndThrow(
      state,
      step,
      provider,
      model,
      attempt,
      failure,
      rawOutput,
      repairState
    );
  }
}

async function executeIfStep(
  step: IfStep,
  state: ExecutionState,
  stepContext: StepExecutionContext,
  depth: number
): Promise<StepExecutionResult> {
  const resumedFrame = getNestedCursorFrame<IfCursorFrame>(state, depth + 1, "if", step.id);
  const branchName = resumedFrame?.branch ?? (
    Boolean(evaluateRuntimeValue(step.condition, state.runtime, stepContext)) ? "then" : "else"
  );
  const branch = branchName === "then" ? step.then : step.else ?? [];

  state.cursor.frames[depth + 1] = resumedFrame ?? {
    kind: "if",
    stepId: step.id,
    branch: branchName,
    nextIndex: 0
  };

  const signal = await executeStepList(branch, state, stepContext, depth + 1);
  trimCursor(state, depth + 1);

  return {
    meta: {
      branch: branchName,
      matched: branchName === "then",
      executedSteps: branch.length
    },
    returnOutput: signal?.result?.returnOutput,
    control:
      signal?.type === "goto" && signal.targetStepId
        ? {
            type: "goto",
            targetStepId: signal.targetStepId
          }
        : undefined
  };
}

async function executeForEachStep(
  step: ForEachStep,
  state: ExecutionState,
  stepContext: StepExecutionContext,
  depth: number
): Promise<StepExecutionResult> {
  const resumedFrame = getNestedCursorFrame<ForEachCursorFrame>(state, depth + 1, "for_each", step.id);
  let frame = resumedFrame;

  if (!frame) {
    const evaluatedItems = evaluateRuntimeValue(step.items, state.runtime, stepContext);
    if (!Array.isArray(evaluatedItems)) {
      throw createFailure(
        "EXPRESSION_EVALUATION_ERROR",
        `for_each step '${step.id}' requires an array of items.`,
        exitCodeForErrorCode("EXPRESSION_EVALUATION_ERROR")
      );
    }

    frame = {
      kind: "for_each",
      stepId: step.id,
      as: step.as,
      items: cloneJsonValue(evaluatedItems),
      itemIndex: 0,
      nextIndex: 0
    };
    state.cursor.frames[depth + 1] = frame;
  }

  for (let index = frame.itemIndex; index < frame.items.length; index += 1) {
    const item = frame.items[index];
    if (index !== frame.itemIndex || frame.nextIndex === 0) {
      state.counters.loopIterations += 1;
    }

    frame.itemIndex = index;
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
    }, depth + 1);

    if (signal?.type === "return") {
      trimCursor(state, depth + 1);
      return {
        meta: {
          iterations: index + 1,
          itemCount: frame.items.length
        },
        returnOutput: signal.result?.returnOutput
      };
    }

    if (signal?.type === "goto" && signal.targetStepId) {
      trimCursor(state, depth + 1);
      return {
        meta: {
          iterations: index + 1,
          itemCount: frame.items.length
        },
        control: {
          type: "goto",
          targetStepId: signal.targetStepId
        }
      };
    }

    frame.itemIndex = index + 1;
    frame.nextIndex = 0;
  }

  trimCursor(state, depth + 1);

  return {
    meta: {
      iterations: frame.items.length,
      itemCount: frame.items.length
    }
  };
}

async function executeWhileStep(
  step: WhileStep,
  state: ExecutionState,
  stepContext: StepExecutionContext,
  depth: number
): Promise<StepExecutionResult> {
  let frame = getNestedCursorFrame<WhileCursorFrame>(state, depth + 1, "while", step.id);
  let iterations = frame?.iteration ?? 0;

  while (frame || Boolean(evaluateRuntimeValue(step.condition, state.runtime, stepContext))) {
    if (!frame) {
      if (iterations >= step.maxIterations) {
        throw createFailure(
          "BUDGET_EXHAUSTION",
          `while step '${step.id}' exceeded maxIterations=${step.maxIterations}.`,
          exitCodeForErrorCode("BUDGET_EXHAUSTION")
        );
      }

      iterations += 1;
      state.counters.loopIterations += 1;
      frame = {
        kind: "while",
        stepId: step.id,
        iteration: iterations,
        nextIndex: 0
      };
      state.cursor.frames[depth + 1] = frame;
    }

    const signal = await executeStepList(step.steps, state, withStepContext(stepContext, {
      loop: {
        stepId: step.id,
        iteration: frame.iteration
      }
    }), depth + 1);

    if (signal?.type === "return") {
      trimCursor(state, depth + 1);
      return {
        meta: {
          iterations: frame.iteration
        },
        returnOutput: signal.result?.returnOutput
      };
    }

    if (signal?.type === "goto" && signal.targetStepId) {
      trimCursor(state, depth + 1);
      return {
        meta: {
          iterations: frame.iteration
        },
        control: {
          type: "goto",
          targetStepId: signal.targetStepId
        }
      };
    }

    iterations = frame.iteration;
    frame.nextIndex = 0;

    if (!Boolean(evaluateRuntimeValue(step.condition, state.runtime, stepContext))) {
      trimCursor(state, depth + 1);
      break;
    }

    if (iterations >= step.maxIterations) {
      throw createFailure(
        "BUDGET_EXHAUSTION",
        `while step '${step.id}' exceeded maxIterations=${step.maxIterations}.`,
        exitCodeForErrorCode("BUDGET_EXHAUSTION")
      );
    }

    frame.iteration = iterations + 1;
    state.counters.loopIterations += 1;
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

  const elapsedMs = getElapsedMs(state);
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
  const remainingDurationMs = state.policies.maxRunDurationMs - getElapsedMs(state);

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
  step: ToolStep | AgentStep,
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
  await persistRunSnapshot(state, {
    saveCheckpointFile: state.checkpointEveryStep
  });
}

async function persistRunSnapshot(
  state: ExecutionState,
  options: {
    saveCheckpointFile: boolean;
  }
): Promise<void> {
  await writeRunState(state.paths, getStateSnapshot(state.runtime.state));

  if (options.saveCheckpointFile) {
    state.counters.checkpoints += 1;

    const snapshot: RunCheckpoint = {
      runId: state.runId,
      checkpoint: state.counters.checkpoints,
      ts: nowIso(),
      currentStepId: resolveNextStepId(state.workflow, state.cursor),
      cursor: cloneExecutionCursor(state.cursor),
      elapsedMs: getElapsedMs(state),
      visitedSteps: state.visitedSteps,
      state: getStateSnapshot(state.runtime.state),
      context: cloneJsonValue(state.runtime.context),
      system: cloneJsonValue(state.runtime.system),
      counters: {
        ...state.counters
      },
      retryCounters: {
        ...state.retryCounters
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

  await writeRunMeta(
    state.paths,
    buildRunRecord(state, "paused", undefined, undefined, {
      currentStepId: resolveNextStepId(state.workflow, state.cursor)
    })
  );
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
  completedAt?: string,
  output?: JsonValue,
  overrides?: {
    currentStepId?: string;
  }
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
    currentStepId: overrides?.currentStepId,
    cursor: cloneExecutionCursor(state.cursor),
    elapsedMs: getElapsedMs(state),
    visitedSteps: state.visitedSteps,
    policies: {
      maxRunSteps: state.policies.maxRunSteps,
      maxRunDurationMs: state.policies.maxRunDurationMs,
      allowTools: state.policies.allowTools,
      allowExternalSideEffects: state.policies.allowExternalSideEffects
    },
    counters: {
      ...state.counters
    },
    retryCounters: {
      ...state.retryCounters
    },
    input: state.runtime.input,
    output,
    artifactPaths: toArtifactPaths(state.paths, state.project)
  };
}

function createInitialCursor(): ExecutionCursor {
  return {
    frames: [
      {
        kind: "root",
        nextIndex: 0
      }
    ]
  };
}

function cloneExecutionCursor(cursor: ExecutionCursor): ExecutionCursor {
  return structuredClone(cursor);
}

function getCursorFrameAtDepth(state: ExecutionState, depth: number): ExecutionCursorFrame {
  const frame = state.cursor.frames[depth];
  if (!frame) {
    throw createFailure(
      "CHECKPOINT_RESUME_ERROR",
      `Execution cursor is missing frame depth ${depth}.`,
      exitCodeForErrorCode("CHECKPOINT_RESUME_ERROR")
    );
  }

  if (depth === 0 && frame.kind !== "root") {
    throw createFailure(
      "CHECKPOINT_RESUME_ERROR",
      "Execution cursor must start with a root frame.",
      exitCodeForErrorCode("CHECKPOINT_RESUME_ERROR")
    );
  }

  return frame;
}

function trimCursor(state: ExecutionState, frameCount: number): void {
  state.cursor.frames = state.cursor.frames.slice(0, Math.max(frameCount, 1));
}

function getNestedCursorFrame<T extends ExecutionCursorFrame>(
  state: ExecutionState,
  depth: number,
  kind: T["kind"],
  stepId: string
): T | undefined {
  const frame = state.cursor.frames[depth];
  if (!frame) {
    return undefined;
  }

  if (frame.kind !== kind || !("stepId" in frame) || frame.stepId !== stepId) {
    trimCursor(state, depth);
    return undefined;
  }

  return frame as T;
}

function getElapsedMs(state: ExecutionState): number {
  return state.elapsedMsBase + (Date.now() - state.sessionStartedAtMs);
}

function resolveNextStepId(
  workflow: WorkflowDocument,
  cursor: ExecutionCursor
): string | undefined {
  return resolveCursorStepIdFromList(workflow.steps, cursor.frames, 0);
}

function resolveCursorStepIdFromList(
  steps: WorkflowStep[],
  frames: ExecutionCursorFrame[],
  depth: number
): string | undefined {
  const frame = frames[depth];
  if (!frame) {
    return undefined;
  }

  const nextStep = steps[frame.nextIndex];
  if (!nextStep) {
    return undefined;
  }

  const child = frames[depth + 1];
  if (!child) {
    return nextStep.id;
  }

  if (child.kind === "if" && nextStep.kind === "if" && child.stepId === nextStep.id) {
    return resolveCursorStepIdFromList(child.branch === "then" ? nextStep.then : nextStep.else ?? [], frames, depth + 1);
  }

  if (child.kind === "for_each" && nextStep.kind === "for_each" && child.stepId === nextStep.id) {
    return resolveCursorStepIdFromList(nextStep.steps, frames, depth + 1);
  }

  if (child.kind === "while" && nextStep.kind === "while" && child.stepId === nextStep.id) {
    return resolveCursorStepIdFromList(nextStep.steps, frames, depth + 1);
  }

  return nextStep.id;
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

function buildStepMeta(
  meta: JsonObject | undefined,
  attempt: number,
  gotoTarget?: string
): JsonObject {
  return {
    ...(meta ?? {}),
    attempt,
    ...(gotoTarget ? { goto: gotoTarget } : {})
  };
}

function toAgentFailure(error: GlyphrailFailure["glyphrailError"], stepId: string, runId: string): GlyphrailFailure {
  return annotateFailure(
    new GlyphrailFailure(error, exitCodeForErrorCode(error.code)),
    {
      stepId,
      runId
    }
  );
}

function buildAgentFailureMeta(
  provider: string,
  model: string,
  attempt: number,
  failure: GlyphrailFailure,
  rawOutput: string | undefined,
  repairState: {
    attempted: boolean;
    succeeded: boolean;
    candidate?: string;
  }
): JsonObject {
  return {
    provider,
    model,
    attempt,
    rawOutput: rawOutput ?? null,
    repairAttempted: repairState.attempted,
    repairSucceeded: repairState.succeeded,
    repairCandidate: repairState.candidate ?? null,
    error: {
      code: failure.glyphrailError.code,
      message: failure.glyphrailError.message
    }
  };
}

async function emitAgentFailureAndThrow(
  state: ExecutionState,
  step: AgentStep,
  provider: string,
  model: string,
  attempt: number,
  failure: GlyphrailFailure,
  rawOutput: string | undefined,
  repairState: {
    attempted: boolean;
    succeeded: boolean;
    candidate?: string;
  }
): Promise<never> {
  await emitTrace(state, {
    event: "agent.failed",
    stepId: step.id,
    kind: step.kind,
    meta: buildAgentFailureMeta(provider, model, attempt, failure, rawOutput, repairState)
  });

  const emittedFailure = failure as GlyphrailFailure & {
    __agentFailureEmitted?: true;
  };
  emittedFailure.__agentFailureEmitted = true;
  throw emittedFailure;
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
