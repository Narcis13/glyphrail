import { createFailure, EXIT_CODES } from "../../core/errors";
import type { CommandDefinition } from "../types";
import { loadProjectTools } from "./tool-shared";
import { toToolDescriptor } from "../../tools/registry";

export const toolListCommand: CommandDefinition = {
  path: ["tool", "list"],
  summary: "List registered tools from the configured tools entry.",
  description: "Load glyphrail.tools.ts, validate the declared tool contracts, and describe each registered tool.",
  usage: "glyphrail tool list [--json]",
  examples: ["glyphrail tool list", "glyphrail tool list --json"],
  async handler(context, args) {
    if (args.positionals.length > 0) {
      throw createFailure(
        "CLI_USAGE_ERROR",
        "tool list does not accept positional arguments.",
        EXIT_CODES.invalidCliUsage
      );
    }

    const loaded = await loadProjectTools(context);
    const tools = loaded.tools.map((tool) => toToolDescriptor(tool));

    return {
      data: {
        command: "tool.list",
        toolsEntry: loaded.relativeEntryPath,
        toolCount: tools.length,
        tools
      },
      human:
        tools.length === 0
          ? `No tools declared in ${loaded.relativeEntryPath}.`
          : [
              `Tools in ${loaded.relativeEntryPath}:`,
              ...tools.map((tool) => `  ${tool.name} [${tool.sideEffect}] ${tool.description}`)
            ].join("\n")
    };
  }
};
