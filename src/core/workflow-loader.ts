import { resolve } from "node:path";

import { type ResolvedProjectConfig, resolveProjectPath } from "../config";
import { readYamlFile } from "../util/yaml";
import { lintWorkflow, validateWorkflowDocument, type WorkflowIssue, type WorkflowValidationResult } from "../dsl/validation";
import type { WorkflowDocument } from "./ast";

export interface WorkflowAnalysis {
  filePath: string;
  workflow: WorkflowDocument;
  validation: WorkflowValidationResult;
  warnings: WorkflowIssue[];
}

export async function analyzeWorkflowFile(
  filePath: string,
  project: ResolvedProjectConfig
): Promise<WorkflowAnalysis> {
  const resolvedWorkflowPath = resolve(project.cwd, filePath);
  const rawWorkflow = await readYamlFile<unknown>(resolvedWorkflowPath);
  const validation = await validateWorkflowDocument(rawWorkflow, {
    toolsEntryPath: resolveProjectPath(project, project.config.toolsEntry)
  });

  if (!validation.workflow || validation.errors.length > 0) {
    return {
      filePath: resolvedWorkflowPath,
      workflow: (validation.workflow ?? {
        version: "",
        name: "",
        steps: []
      }) as WorkflowDocument,
      validation,
      warnings: []
    };
  }

  const lint = lintWorkflow(validation);

  return {
    filePath: resolvedWorkflowPath,
    workflow: validation.workflow,
    validation,
    warnings: lint.warnings
  };
}
