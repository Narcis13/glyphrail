import { resolve } from "node:path";

import { executeWorkflow, type ResumeWorkflowState } from "../../core/execution-engine";
import { createFailure, exitCodeForErrorCode } from "../../core/errors";
import type { JsonObject, JsonValue } from "../../core/json-schema";
import { getRunPaths, readRunState } from "../../core/run-store";
import { analyzeWorkflowFile } from "../../core/workflow-loader";
import { readTextFile, writeTextFile } from "../../util/fs";
import { writeJsonFile } from "../../util/json";
import type { CommandDefinition } from "../types";
import { loadPersistedRun } from "./run-shared";

export const resumeCommand: CommandDefinition = {
  path: ["resume"],
  summary: "Resume a paused or interrupted workflow run.",
  description: "Restore workflow identity, policies, runtime state, counters, and cursor from persisted run artifacts.",
  usage: "glyphrail resume <run-id> [--output <file>] [--trace-out <file>] [--json]",
  options: [
    {
      name: "output",
      type: "string",
      description: "Write the resumed run output JSON to an explicit file.",
      valueLabel: "file"
    },
    {
      name: "trace-out",
      type: "string",
      description: "Copy the updated trace JSONL to an explicit file.",
      valueLabel: "file"
    }
  ],
  examples: ["glyphrail resume 20260313_abcdef12", "glyphrail resume run_20260313_abcdef12 --json"],
  async handler(context, args) {
    const { runId, paths, meta } = await loadPersistedRun(context, args, "resume");
    const project = await context.getProjectConfig();

    if (meta.status !== "paused") {
      throw createFailure(
        "CHECKPOINT_RESUME_ERROR",
        `Run '${runId}' is not resumable because it is ${meta.status}.`,
        exitCodeForErrorCode("CHECKPOINT_RESUME_ERROR")
      );
    }

    if (!meta.workflow.file) {
      throw createFailure(
        "CHECKPOINT_RESUME_ERROR",
        `Run '${runId}' does not record the workflow file required for resume.`,
        exitCodeForErrorCode("CHECKPOINT_RESUME_ERROR")
      );
    }

    if (!meta.cursor) {
      throw createFailure(
        "CHECKPOINT_RESUME_ERROR",
        `Run '${runId}' does not include a persisted execution cursor.`,
        exitCodeForErrorCode("CHECKPOINT_RESUME_ERROR")
      );
    }

    const analysis = await analyzeWorkflowFile(meta.workflow.file, project);
    if (analysis.validation.errors.length > 0) {
      throw createFailure(
        "CHECKPOINT_RESUME_ERROR",
        `Workflow validation failed for resumable run '${runId}'.`,
        exitCodeForErrorCode("CHECKPOINT_RESUME_ERROR"),
        {
          file: meta.workflow.file,
          errors: analysis.validation.errors
        }
      );
    }

    if (analysis.workflow.name !== meta.workflow.name || analysis.workflow.version !== meta.workflow.version) {
      throw createFailure(
        "CHECKPOINT_RESUME_ERROR",
        `Workflow identity changed since run '${runId}' started.`,
        exitCodeForErrorCode("CHECKPOINT_RESUME_ERROR"),
        {
          expected: meta.workflow,
          actual: {
            name: analysis.workflow.name,
            version: analysis.workflow.version,
            file: meta.workflow.file
          }
        }
      );
    }

    const stateSnapshot = await readRunState(paths);
    const runtime = buildResumedRuntime(runId, meta.workflow.file, meta.startedAt, meta.input ?? {}, stateSnapshot, analysis.workflow);
    const result = await executeWorkflow({
      project,
      relativeWorkflowFile: meta.workflow.file,
      workflow: analysis.workflow,
      input: meta.input ?? {},
      maxRunSteps: meta.policies?.maxRunSteps,
      maxRunDurationMs: meta.policies?.maxRunDurationMs,
      resume: {
        runId,
        startedAt: meta.startedAt,
        runtime,
        counters: meta.counters ?? {
          completedSteps: 0,
          failedSteps: 0,
          retries: 0,
          loopIterations: 0,
          checkpoints: 0
        },
        retryCounters: meta.retryCounters ?? {},
        cursor: meta.cursor,
        visitedSteps: meta.visitedSteps ?? 0,
        elapsedMs: meta.elapsedMs ?? 0
      } satisfies ResumeWorkflowState
    });

    await writeExplicitArtifacts(context.cwd, result.output, result.artifacts.trace, args.flags);

    return {
      data: {
        command: "resume",
        runId: result.runId,
        status: result.status,
        file: meta.workflow.file,
        workflow: {
          name: analysis.workflow.name,
          version: analysis.workflow.version
        },
        output: result.output,
        counters: result.record.counters,
        artifacts: result.record.artifactPaths,
        traceEventCount: result.traceEventCount
      },
      human: [
        `Run ${result.runId} resumed and completed`,
        `Workflow: ${analysis.workflow.name} (${meta.workflow.file})`,
        `Artifacts: ${result.record.artifactPaths?.meta}, ${result.record.artifactPaths?.state}, ${result.record.artifactPaths?.trace}`,
        `Output: ${JSON.stringify(result.output)}`
      ].join("\n")
    };
  }
};

function buildResumedRuntime(
  runId: string,
  workflowFile: string,
  startedAt: string,
  input: JsonValue,
  state: JsonObject,
  workflow: {
    name: string;
    version: string;
  }
) {
  return {
    input,
    state: structuredClone(state),
    context: {
      runId,
      workflow: {
        name: workflow.name,
        version: workflow.version
      }
    },
    system: {
      runId,
      workflowFile,
      startedAt
    }
  };
}

async function writeExplicitArtifacts(
  cwd: string,
  output: unknown,
  tracePath: string,
  flags: Record<string, unknown>
): Promise<void> {
  const outputTarget = flags.output as string | undefined;
  if (outputTarget) {
    await writeJsonFile(resolve(cwd, outputTarget), output);
  }

  const traceTarget = flags["trace-out"] as string | undefined;
  if (traceTarget) {
    await writeTextFile(resolve(cwd, traceTarget), await readTextFile(tracePath));
  }
}
