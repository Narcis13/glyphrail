import { resolve } from "node:path";

import { CONFIG_FILE_NAME } from "../../config";
import { DEFAULT_CONFIG } from "../../config/types";
import { createFailure, EXIT_CODES } from "../../core/errors";
import { ensureDir, pathExists, relativePath, writeTextFile } from "../../util/fs";
import { writeJsonFile } from "../../util/json";
import { loadTemplate, renderTemplate } from "../../util/templates";
import type { CommandDefinition } from "../types";

export const initCommand: CommandDefinition = {
  path: ["init"],
  summary: "Initialize a Glyphrail project in the current directory.",
  description: "Create the baseline config, hello workflow, tools entrypoint, and run storage directories.",
  usage: "glyphrail init [--name <workflow-name>] [--force] [--json]",
  options: [
    {
      name: "name",
      type: "string",
      description: "Name to use for the generated hello workflow.",
      valueLabel: "workflow-name"
    },
    {
      name: "force",
      type: "boolean",
      description: "Overwrite generated files if they already exist."
    }
  ],
  examples: ["glyphrail init", "glyphrail init --name demo --json"],
  async handler(context, args) {
    if (args.positionals.length > 0) {
      throw createFailure(
        "CLI_USAGE_ERROR",
        "init does not accept positional arguments.",
        EXIT_CODES.invalidCliUsage
      );
    }

    const force = Boolean(args.flags.force);
    const workflowName = normalizeWorkflowName((args.flags.name as string | undefined) ?? "hello-world");
    const projectRoot = context.cwd;
    const configPath = resolve(projectRoot, CONFIG_FILE_NAME);
    const helloWorkflowPath = resolve(projectRoot, DEFAULT_CONFIG.workflowsDir, "hello.gr.yaml");
    const toolsEntryPath = resolve(projectRoot, DEFAULT_CONFIG.toolsEntry);
    const runsDirPath = resolve(projectRoot, DEFAULT_CONFIG.runsDir);

    const helloWorkflow = renderTemplate(await loadTemplate("hello.gr.yaml"), {
      WORKFLOW_NAME: workflowName
    });
    const toolsEntry = await loadTemplate("glyphrail.tools.ts");

    const created: string[] = [];
    const updated: string[] = [];
    const skipped: string[] = [];

    await ensureTrackedDirectory(projectRoot, resolve(projectRoot, DEFAULT_CONFIG.workflowsDir), created, skipped);
    await ensureTrackedDirectory(projectRoot, runsDirPath, created, skipped);
    await writeGeneratedJsonFile(projectRoot, configPath, DEFAULT_CONFIG, force, created, updated, skipped);
    await writeGeneratedTextFile(projectRoot, helloWorkflowPath, helloWorkflow, force, created, updated, skipped);
    await writeGeneratedTextFile(projectRoot, toolsEntryPath, toolsEntry, force, created, updated, skipped);

    return {
      data: {
        command: "init",
        projectRoot,
        workflowName,
        created,
        updated,
        skipped
      },
      human: [
        `Initialized Glyphrail project in ${projectRoot}`,
        `Workflow name: ${workflowName}`,
        created.length > 0 ? `Created: ${created.join(", ")}` : "Created: none",
        updated.length > 0 ? `Updated: ${updated.join(", ")}` : "Updated: none",
        skipped.length > 0 ? `Skipped: ${skipped.join(", ")}` : "Skipped: none"
      ].join("\n")
    };
  }
};

async function writeGeneratedJsonFile(
  projectRoot: string,
  path: string,
  value: unknown,
  force: boolean,
  created: string[],
  updated: string[],
  skipped: string[]
): Promise<void> {
  if (await pathExists(path)) {
    if (!force) {
      skipped.push(relativePath(projectRoot, path));
      return;
    }
    await writeJsonFile(path, value);
    updated.push(relativePath(projectRoot, path));
    return;
  }

  await writeJsonFile(path, value);
  created.push(relativePath(projectRoot, path));
}

async function writeGeneratedTextFile(
  projectRoot: string,
  path: string,
  content: string,
  force: boolean,
  created: string[],
  updated: string[],
  skipped: string[]
): Promise<void> {
  const normalizedContent = ensureTrailingNewline(content);

  if (await pathExists(path)) {
    if (!force) {
      skipped.push(relativePath(projectRoot, path));
      return;
    }
    await writeTextFile(path, normalizedContent);
    updated.push(relativePath(projectRoot, path));
    return;
  }

  await writeTextFile(path, normalizedContent);
  created.push(relativePath(projectRoot, path));
}

async function ensureTrackedDirectory(
  projectRoot: string,
  path: string,
  created: string[],
  skipped: string[]
): Promise<void> {
  if (await pathExists(path)) {
    skipped.push(relativePath(projectRoot, path));
    return;
  }

  await ensureDir(path);
  created.push(relativePath(projectRoot, path));
}

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
