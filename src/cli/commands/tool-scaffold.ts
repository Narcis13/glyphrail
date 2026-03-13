import { dirname, resolve } from "node:path";

import { resolveProjectPath } from "../../config";
import { createFailure, EXIT_CODES } from "../../core/errors";
import { ensureDir, pathExists, readTextFile, relativePath, writeTextFile } from "../../util/fs";
import { loadTemplate, renderTemplate } from "../../util/templates";
import type { CommandDefinition } from "../types";

export const toolScaffoldCommand: CommandDefinition = {
  path: ["tool", "scaffold"],
  summary: "Create a new local tool module and register it.",
  description: "Scaffold a typed tool module under tools/ and wire it into the configured glyphrail.tools.ts entry file.",
  usage: "glyphrail tool scaffold <name> [--force] [--json]",
  options: [
    {
      name: "force",
      type: "boolean",
      description: "Overwrite scaffolded files when they already exist."
    }
  ],
  examples: ["glyphrail tool scaffold format-handle", "glyphrail tool scaffold fetch-page --force --json"],
  async handler(context, args) {
    if (args.positionals.length !== 1) {
      throw createFailure(
        "CLI_USAGE_ERROR",
        "tool scaffold requires exactly one tool name.",
        EXIT_CODES.invalidCliUsage
      );
    }

    const force = Boolean(args.flags.force);
    const toolIdentifier = normalizeToolIdentifier(args.positionals[0] as string);
    const toolFileBase = toKebabCase(toolIdentifier);
    const project = await context.getProjectConfig();
    const toolModulePath = resolve(project.projectRoot, "tools", `${toolFileBase}.ts`);
    const entryPath = resolveProjectPath(project, project.config.toolsEntry);
    const importPath = `./tools/${toolFileBase}`;
    const toolModule = renderTemplate(await loadTemplate("tool.module.ts"), {
      TOOL_IDENTIFIER: toolIdentifier,
      TOOL_NAME: toolIdentifier,
      TOOL_DESCRIPTION: buildToolDescription(toolIdentifier)
    });

    const created: string[] = [];
    const updated: string[] = [];
    const skipped: string[] = [];

    await writeGeneratedModuleFile(project.projectRoot, toolModulePath, toolModule, force, created, updated, skipped);

    const existingEntry = await pathExists(entryPath) ? await readTextFile(entryPath) : undefined;
    const nextEntry = buildToolsEntrySource(existingEntry, toolIdentifier, importPath);
    await writeRegistryEntryFile(project.projectRoot, entryPath, existingEntry, nextEntry, created, updated, skipped);

    return {
      data: {
        command: "tool.scaffold",
        toolName: toolIdentifier,
        file: relativePath(project.projectRoot, toolModulePath),
        toolsEntry: relativePath(project.projectRoot, entryPath),
        created,
        updated,
        skipped
      },
      human: [
        `Scaffolded tool ${toolIdentifier}`,
        created.length > 0 ? `Created: ${created.join(", ")}` : "Created: none",
        updated.length > 0 ? `Updated: ${updated.join(", ")}` : "Updated: none",
        skipped.length > 0 ? `Skipped: ${skipped.join(", ")}` : "Skipped: none"
      ].join("\n")
    };
  }
};

function buildToolsEntrySource(
  source: string | undefined,
  toolIdentifier: string,
  importPath: string
): string {
  if (!source) {
    return [
      'import { defineTools } from "glyphrail";',
      `import { ${toolIdentifier} } from "${importPath}";`,
      "",
      "export default defineTools([",
      `  ${toolIdentifier}`,
      "]);"
    ].join("\n");
  }

  let nextSource = source;
  if (!hasToolImport(nextSource, toolIdentifier)) {
    nextSource = insertImport(nextSource, `import { ${toolIdentifier} } from "${importPath}";`);
  }

  const registryMatch = nextSource.match(/defineTools\s*\(\s*\[([\s\S]*?)\]\s*\)/m);
  if (!registryMatch) {
    throw createFailure(
      "GENERIC_FAILURE",
      "The configured tools entry does not contain a defineTools([...]) registry.",
      EXIT_CODES.genericFailure
    );
  }

  const identifiers = registryMatch[1]
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (!identifiers.includes(toolIdentifier)) {
    identifiers.push(toolIdentifier);
  }

  const registryBlock = `defineTools([\n  ${identifiers.join(",\n  ")}\n])`;
  return nextSource.replace(/defineTools\s*\(\s*\[[\s\S]*?\]\s*\)/m, registryBlock);
}

function insertImport(source: string, importStatement: string): string {
  const matches = [...source.matchAll(/^import .*;$/gm)];
  if (matches.length === 0) {
    return `${importStatement}\n\n${source}`;
  }

  const lastMatch = matches[matches.length - 1];
  const insertionIndex = (lastMatch.index ?? 0) + lastMatch[0].length;
  return `${source.slice(0, insertionIndex)}\n${importStatement}${source.slice(insertionIndex)}`;
}

function hasToolImport(source: string, toolIdentifier: string): boolean {
  return new RegExp(`import\\s+{[^}]*\\b${toolIdentifier}\\b[^}]*}\\s+from\\s+["'][^"']+["']`, "m").test(source);
}

function normalizeToolIdentifier(value: string): string {
  const segments = splitNameSegments(value);
  if (segments.length === 0) {
    throw createFailure(
      "CLI_USAGE_ERROR",
      "Tool name must contain at least one alphanumeric character.",
      EXIT_CODES.invalidCliUsage
    );
  }

  const identifier = segments
    .map((segment, index) => {
      const lower = segment.toLowerCase();
      return index === 0 ? lower : `${lower[0]?.toUpperCase() ?? ""}${lower.slice(1)}`;
    })
    .join("");

  return /^[A-Za-z_$]/.test(identifier) ? identifier : `tool${identifier[0]?.toUpperCase() ?? ""}${identifier.slice(1)}`;
}

function toKebabCase(value: string): string {
  return splitNameSegments(value)
    .map((segment) => segment.toLowerCase())
    .join("-");
}

function splitNameSegments(value: string): string[] {
  return value
    .trim()
    .replace(/[^A-Za-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((token) => token.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|[0-9]+/g) ?? []);
}

function buildToolDescription(toolIdentifier: string): string {
  return `TODO: implement ${toolIdentifier}.`;
}

async function writeGeneratedModuleFile(
  projectRoot: string,
  path: string,
  content: string,
  force: boolean,
  created: string[],
  updated: string[],
  skipped: string[]
): Promise<void> {
  const normalizedContent = content.endsWith("\n") ? content : `${content}\n`;

  if (await pathExists(path)) {
    if (!force) {
      skipped.push(relativePath(projectRoot, path));
      return;
    }

    await ensureDir(dirname(path));
    await writeTextFile(path, normalizedContent);
    updated.push(relativePath(projectRoot, path));
    return;
  }

  await ensureDir(dirname(path));
  await writeTextFile(path, normalizedContent);
  created.push(relativePath(projectRoot, path));
}

async function writeRegistryEntryFile(
  projectRoot: string,
  path: string,
  existingContent: string | undefined,
  nextContent: string,
  created: string[],
  updated: string[],
  skipped: string[]
): Promise<void> {
  const normalizedContent = nextContent.endsWith("\n") ? nextContent : `${nextContent}\n`;

  if (existingContent === undefined) {
    await ensureDir(dirname(path));
    await writeTextFile(path, normalizedContent);
    created.push(relativePath(projectRoot, path));
    return;
  }

  const normalizedExisting = existingContent.endsWith("\n") ? existingContent : `${existingContent}\n`;
  if (normalizedExisting === normalizedContent) {
    skipped.push(relativePath(projectRoot, path));
    return;
  }

  await ensureDir(dirname(path));
  await writeTextFile(path, normalizedContent);
  updated.push(relativePath(projectRoot, path));
}
