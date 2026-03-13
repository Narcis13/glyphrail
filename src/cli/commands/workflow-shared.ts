import type { CommandContext, ParsedCommandArgs } from "../types";
import { analyzeWorkflowFile, type WorkflowAnalysis } from "../../core/workflow-loader";
import { createFailure, EXIT_CODES } from "../../core/errors";
import { relativePath } from "../../util/fs";

export interface LoadedWorkflowAnalysis {
  analysis: WorkflowAnalysis;
  relativeFilePath: string;
}

export async function loadValidatedWorkflowAnalysis(
  context: CommandContext,
  args: ParsedCommandArgs,
  commandName: string
): Promise<LoadedWorkflowAnalysis> {
  if (args.positionals.length !== 1) {
    throw createFailure(
      "CLI_USAGE_ERROR",
      `${commandName} requires exactly one workflow file path.`,
      EXIT_CODES.invalidCliUsage
    );
  }

  const project = await context.getProjectConfig();
  const analysis = await analyzeWorkflowFile(args.positionals[0], project);
  const relativeFilePath = relativePath(project.projectRoot, analysis.filePath);

  if (analysis.validation.errors.length > 0) {
    throw createFailure(
      "WORKFLOW_VALIDATION_ERROR",
      `Workflow validation failed for ${relativeFilePath}.`,
      EXIT_CODES.workflowValidationFailure,
      {
        file: relativeFilePath,
        errors: analysis.validation.errors
      }
    );
  }

  return {
    analysis,
    relativeFilePath
  };
}
