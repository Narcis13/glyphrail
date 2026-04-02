import { readdir } from "node:fs/promises";

import { resolveProjectPath } from "../../config";
import { analyzeWorkflowFile } from "../../core/workflow-loader";
import { createFailure, EXIT_CODES, normalizeError } from "../../core/errors";
import { discoverDeclaredTools, getToolContractIssues, loadDeclaredTools, toToolDescriptor } from "../../tools/registry";
import { pathExists, relativePath } from "../../util/fs";
import type { CommandDefinition } from "../types";

export const checkCommand: CommandDefinition = {
  path: ["check"],
  summary: "Run project-level validation over config, workflows, and tools.",
  description: "Aggregate workflow validation/linting and tools entry resolution into one operator-grade project health check.",
  usage: "glyphrail check [--json]",
  examples: ["glyphrail check", "glyphrail check --json"],
  async handler(context, args) {
    if (args.positionals.length > 0) {
      throw createFailure(
        "CLI_USAGE_ERROR",
        "check does not accept positional arguments.",
        EXIT_CODES.invalidCliUsage
      );
    }

    const project = await context.getProjectConfig();
    const workflowsRoot = resolveProjectPath(project, project.config.workflowsDir);
    const workflowFiles = await findWorkflowFiles(workflowsRoot);
    const workflowChecks = await Promise.all(
      workflowFiles.map(async (filePath) => {
        const analysis = await analyzeWorkflowFile(filePath, project);
        return {
          file: relativePath(project.projectRoot, analysis.filePath),
          workflow: analysis.validation.workflow
            ? {
                name: analysis.workflow.name,
                version: analysis.workflow.version
              }
            : undefined,
          errorCount: analysis.validation.errors.length,
          warningCount: analysis.warnings.length,
          errors: analysis.validation.errors,
          warnings: analysis.warnings
        };
      })
    );

    const toolsEntryPath = resolveProjectPath(project, project.config.toolsEntry);
    const toolsPreview = await discoverDeclaredTools(toolsEntryPath);
    const toolCheck = await loadToolCheck(toolsEntryPath);
    const toolIssues = [
      ...toolCheck.issues,
      ...toolsPreview.unresolvedIdentifiers.map((identifier) => ({
        path: toolsEntryPath,
        message: `Unable to resolve exported tool identifier '${identifier}'.`
      }))
    ];

    const payload = {
      command: "check",
      projectRoot: project.projectRoot,
      config: {
        path: project.configPath ? relativePath(project.projectRoot, project.configPath) : undefined,
        workflowsDir: project.config.workflowsDir,
        toolsEntry: project.config.toolsEntry
      },
      workflows: {
        count: workflowChecks.length,
        validCount: workflowChecks.filter((entry) => entry.errorCount === 0).length,
        errorCount: workflowChecks.reduce((sum, entry) => sum + entry.errorCount, 0),
        warningCount: workflowChecks.reduce((sum, entry) => sum + entry.warningCount, 0),
        files: workflowChecks
      },
      tools: {
        entry: relativePath(project.projectRoot, toolsEntryPath),
        found: await pathExists(toolsEntryPath),
        declaredNames: toolsPreview.toolNames,
        unresolvedIdentifiers: toolsPreview.unresolvedIdentifiers,
        toolCount: toolCheck.tools.length,
        issues: toolIssues,
        tools: toolCheck.tools
      }
    };

    const hasErrors = payload.workflows.errorCount > 0 || payload.tools.issues.length > 0;
    if (hasErrors) {
      throw createFailure(
        "CHECK_FAILED",
        "Project check failed.",
        EXIT_CODES.genericFailure,
        payload
      );
    }

    return {
      data: payload,
      human: [
        `Check passed for ${project.projectRoot}`,
        `Workflows: ${payload.workflows.count} checked, ${payload.workflows.warningCount} warnings`,
        `Tools: ${payload.tools.toolCount} loaded from ${payload.tools.entry}`
      ].join("\n")
    };
  }
};

async function loadToolCheck(entryPath: string): Promise<{
  tools: ReturnType<typeof toToolDescriptor>[];
  issues: Array<{
    path: string;
    message: string;
  }>;
}> {
  try {
    const tools = await loadDeclaredTools(entryPath);
    const issues = tools.flatMap((tool) => getToolContractIssues(tool));

    return {
      tools: tools.map((tool) => toToolDescriptor(tool)),
      issues
    };
  } catch (error) {
    const failure = normalizeError(error);
    return {
      tools: [],
      issues: [
        {
          path: entryPath,
          message: `${failure.glyphrailError.code}: ${failure.glyphrailError.message}`
        }
      ]
    };
  }
}

async function findWorkflowFiles(rootDir: string): Promise<string[]> {
  if (!(await pathExists(rootDir))) {
    return [];
  }

  const entries = await readdir(rootDir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = `${rootDir}/${entry.name}`;
      if (entry.isDirectory()) {
        return findWorkflowFiles(absolutePath);
      }

      if (entry.isFile() && (entry.name.endsWith(".gr.yaml") || entry.name.endsWith(".gr.yml"))) {
        return [absolutePath];
      }

      return [];
    })
  );

  return files.flat().sort();
}
