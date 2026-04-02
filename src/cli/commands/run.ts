import { resolve } from "node:path";

import { executeWorkflow } from "../../core/execution-engine";
import { assertJsonSchema } from "../../core/schema-validator";
import { getRunPaths } from "../../core/run-store";
import { readTextFile, writeTextFile } from "../../util/fs";
import { writeJsonFile } from "../../util/json";
import type { CommandDefinition } from "../types";
import { loadValidatedWorkflowAnalysis } from "./workflow-shared";
import { parseOptionalIntegerFlag, resolveRunInput } from "./run-shared";

export const runCommand: CommandDefinition = {
  path: ["run"],
  summary: "Execute a workflow and persist run artifacts.",
  description: "Run a validated workflow with JSON input, explicit state persistence, and append-only trace output.",
  usage:
    "glyphrail run <file> [--input <file> | --input-json <json>] [--set <path=value>] [--dry-run] [--max-steps <n>] [--max-duration-ms <n>] [--checkpoint-every-step] [--output <file>] [--trace-out <file>] [--json]",
  options: [
    {
      name: "input",
      type: "string",
      description: "Read run input from a JSON file.",
      valueLabel: "file"
    },
    {
      name: "input-json",
      type: "string",
      description: "Provide run input as an inline JSON string.",
      valueLabel: "json"
    },
    {
      name: "set",
      type: "string",
      multiple: true,
      description: "Override input paths via path=value pairs.",
      valueLabel: "path=value"
    },
    {
      name: "dry-run",
      type: "boolean",
      description: "Validate the workflow and input without executing steps."
    },
    {
      name: "max-steps",
      type: "string",
      description: "Override the effective max run steps budget.",
      valueLabel: "n"
    },
    {
      name: "max-duration-ms",
      type: "string",
      description: "Override the effective max run duration budget.",
      valueLabel: "n"
    },
    {
      name: "checkpoint-every-step",
      type: "boolean",
      description: "Persist checkpoint files after every completed step."
    },
    {
      name: "output",
      type: "string",
      description: "Write the final output JSON to an explicit file.",
      valueLabel: "file"
    },
    {
      name: "trace-out",
      type: "string",
      description: "Copy the persisted trace JSONL to an explicit file.",
      valueLabel: "file"
    }
  ],
  examples: [
    "glyphrail run workflows/hello.gr.yaml --input examples/hello-input.json",
    `glyphrail run workflows/hello.gr.yaml --input-json '{"name":"Ada"}' --json`
  ],
  async handler(context, args) {
    const { analysis, relativeFilePath } = await loadValidatedWorkflowAnalysis(context, args, "run");
    const project = await context.getProjectConfig();
    const input = await resolveRunInput(context, args);

    if (analysis.workflow.inputSchema) {
      assertJsonSchema(input, analysis.workflow.inputSchema, {
        errorCode: "INPUT_VALIDATION_ERROR",
        subject: "Workflow input"
      });
    }

    const effectivePolicies = {
      maxRunSteps:
        parseOptionalIntegerFlag(args, "max-steps") ??
        analysis.workflow.policies?.maxRunSteps ??
        project.config.policies.maxRunSteps,
      maxRunDurationMs:
        parseOptionalIntegerFlag(args, "max-duration-ms") ??
        analysis.workflow.policies?.maxRunDurationMs ??
        project.config.policies.maxRunDurationMs
    };

    if (args.flags["dry-run"] === true) {
      return {
        data: {
          command: "run",
          dryRun: true,
          file: relativeFilePath,
          workflow: {
            name: analysis.workflow.name,
            version: analysis.workflow.version,
            stepCount: analysis.validation.inventory.length
          },
          input,
          policies: effectivePolicies,
          referencedTools: analysis.validation.referencedTools
        },
        human: [
          `Dry run ready for ${relativeFilePath}`,
          `Workflow: ${analysis.workflow.name} (${analysis.workflow.version})`,
          `Steps: ${analysis.validation.inventory.length}`,
          `Referenced tools: ${
            analysis.validation.referencedTools.length > 0
              ? analysis.validation.referencedTools.join(", ")
              : "none"
          }`,
          `Policies: maxSteps=${effectivePolicies.maxRunSteps}, maxDurationMs=${effectivePolicies.maxRunDurationMs}`
        ].join("\n")
      };
    }

    const checkpointEveryStep =
      args.flags["checkpoint-every-step"] === undefined
        ? undefined
        : Boolean(args.flags["checkpoint-every-step"]);

    try {
      const result = await executeWorkflow({
        project,
        relativeWorkflowFile: relativeFilePath,
        workflow: analysis.workflow,
        input,
        maxRunSteps: effectivePolicies.maxRunSteps,
        maxRunDurationMs: effectivePolicies.maxRunDurationMs,
        checkpointEveryStep
      });

      await writeExplicitArtifacts(context.cwd, result.output, result.artifacts.trace, args);

      return {
        data: {
          command: "run",
          runId: result.runId,
          status: result.status,
          file: relativeFilePath,
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
          `Run ${result.runId} completed`,
          `Workflow: ${analysis.workflow.name} (${relativeFilePath})`,
          `Artifacts: ${result.record.artifactPaths?.meta}, ${result.record.artifactPaths?.state}, ${result.record.artifactPaths?.trace}`,
          `Output: ${JSON.stringify(result.output)}`
        ].join("\n")
      };
    } catch (error) {
      const runId = error instanceof Error && "glyphrailError" in error
        ? (error as { glyphrailError?: { runId?: string } }).glyphrailError?.runId
        : undefined;

      if (runId && args.flags["trace-out"]) {
        const tracePath = getRunPaths(project, runId).trace;
        const traceTargetPath = resolve(context.cwd, args.flags["trace-out"] as string);
        try {
          await writeTextFile(traceTargetPath, await readTextFile(tracePath));
        } catch {
          // Ignore best-effort copy failures when the run itself already failed.
        }
      }

      throw error;
    }
  }
};

async function writeExplicitArtifacts(
  cwd: string,
  output: unknown,
  tracePath: string,
  args: { flags: Record<string, unknown> }
): Promise<void> {
  const outputTarget = args.flags.output as string | undefined;
  if (outputTarget) {
    await writeJsonFile(resolve(cwd, outputTarget), output);
  }

  const traceTarget = args.flags["trace-out"] as string | undefined;
  if (traceTarget) {
    await writeTextFile(resolve(cwd, traceTarget), await readTextFile(tracePath));
  }
}
