import { resolve } from "node:path";

import { resolveProjectPath } from "../../config";
import { createFailure, EXIT_CODES } from "../../core/errors";
import { ensureDir, pathExists, relativePath, writeTextFile } from "../../util/fs";
import { loadTemplate, renderTemplate } from "../../util/templates";
import type { CommandDefinition } from "../types";

export const workflowCreateCommand: CommandDefinition = {
  path: ["workflow", "create"],
  summary: "Create a workflow file from a bundled template.",
  description: "Scaffold a new workflow into the configured workflows directory.",
  usage: "glyphrail workflow create <name> [--template <name>] [--force] [--json]",
  options: [
    {
      name: "template",
      type: "string",
      description: "Template name to scaffold from.",
      valueLabel: "name"
    },
    {
      name: "force",
      type: "boolean",
      description: "Overwrite the workflow file if it already exists."
    }
  ],
  examples: [
    "glyphrail workflow create research-loop --template basic",
    "glyphrail workflow create demo --json"
  ],
  async handler(context, args) {
    if (args.positionals.length !== 1) {
      throw createFailure(
        "CLI_USAGE_ERROR",
        "workflow create requires exactly one workflow name.",
        EXIT_CODES.invalidCliUsage
      );
    }

    const workflowName = normalizeWorkflowName(args.positionals[0]);
    const templateName = (args.flags.template as string | undefined) ?? "basic";
    const force = Boolean(args.flags.force);
    const project = await context.getProjectConfig();
    const workflowsDir = resolveProjectPath(project, project.config.workflowsDir);
    const targetPath = resolve(workflowsDir, `${workflowName}.gr.yaml`);

    await ensureDir(workflowsDir);

    if ((await pathExists(targetPath)) && !force) {
      throw createFailure(
        "GENERIC_FAILURE",
        `Workflow already exists: ${relativePath(project.projectRoot, targetPath)}`,
        EXIT_CODES.genericFailure
      );
    }

    const template = renderTemplate(await loadTemplate(`${templateName}.gr.yaml`), {
      WORKFLOW_NAME: workflowName
    });
    await writeTextFile(targetPath, ensureTrailingNewline(template));

    const relativeTarget = relativePath(project.projectRoot, targetPath);

    return {
      data: {
        command: "workflow.create",
        workflowName,
        template: templateName,
        file: relativeTarget,
        projectRoot: project.projectRoot
      },
      human: `Created ${relativeTarget} from template ${templateName}.`
    };
  }
};

function normalizeWorkflowName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");

  if (!normalized) {
    throw createFailure(
      "CLI_USAGE_ERROR",
      "Workflow name must contain at least one alphanumeric character.",
      EXIT_CODES.invalidCliUsage
    );
  }

  return normalized;
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}
