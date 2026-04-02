import type { CommandDefinition } from "../types";
import { loadNamedTool } from "./tool-shared";

export const toolShowCommand: CommandDefinition = {
  path: ["tool", "show"],
  summary: "Show one registered tool and its contract details.",
  description: "Inspect a single tool's metadata, input schema, output schema, and execution policy-relevant fields.",
  usage: "glyphrail tool show <name> [--json]",
  examples: ["glyphrail tool show makeGreeting", "glyphrail tool show makeGreeting --json"],
  async handler(context, args) {
    const loaded = await loadNamedTool(context, args, "tool show");

    return {
      data: {
        command: "tool.show",
        toolsEntry: loaded.relativeEntryPath,
        tool: loaded.descriptor
      },
      human: [
        `Tool: ${loaded.tool.name}`,
        `Description: ${loaded.tool.description}`,
        `Side effect: ${loaded.tool.sideEffect}`,
        `Timeout: ${loaded.tool.timeoutMs ?? "none"}`,
        `Tags: ${loaded.tool.tags?.join(", ") ?? "none"}`
      ].join("\n")
    };
  }
};
