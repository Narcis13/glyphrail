import { resolveProjectPath, type ResolvedProjectConfig } from "../../config";
import { createFailure, EXIT_CODES } from "../../core/errors";
import type { Tool } from "../../tools/contracts";
import { loadDeclaredTools, toToolDescriptor, type ToolDescriptor } from "../../tools/registry";
import { relativePath } from "../../util/fs";
import type { CommandContext, ParsedCommandArgs } from "../types";

export interface LoadedProjectTools {
  project: ResolvedProjectConfig;
  entryPath: string;
  relativeEntryPath: string;
  tools: Tool[];
}

export interface LoadedNamedTool extends LoadedProjectTools {
  tool: Tool;
  descriptor: ToolDescriptor;
}

export async function loadProjectTools(context: CommandContext): Promise<LoadedProjectTools> {
  const project = await context.getProjectConfig();
  const entryPath = resolveProjectPath(project, project.config.toolsEntry);
  const tools = await loadDeclaredTools(entryPath);

  return {
    project,
    entryPath,
    relativeEntryPath: relativePath(project.projectRoot, entryPath),
    tools
  };
}

export async function loadNamedTool(
  context: CommandContext,
  args: ParsedCommandArgs,
  commandName: string
): Promise<LoadedNamedTool> {
  if (args.positionals.length !== 1) {
    throw createFailure(
      "CLI_USAGE_ERROR",
      `${commandName} requires exactly one tool name.`,
      EXIT_CODES.invalidCliUsage
    );
  }

  const loaded = await loadProjectTools(context);
  const toolName = args.positionals[0] as string;
  const tool = loaded.tools.find((candidate) => candidate.name === toolName);

  if (!tool) {
    throw createFailure(
      "NOT_FOUND",
      `Tool '${toolName}' was not found in ${loaded.relativeEntryPath}.`,
      EXIT_CODES.notFound,
      {
        availableTools: loaded.tools.map((candidate) => candidate.name)
      }
    );
  }

  return {
    ...loaded,
    tool,
    descriptor: toToolDescriptor(tool)
  };
}
