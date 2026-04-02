import type { JsonValue } from "../../core/json-schema";
import { invokeTool } from "../../tools/runtime";
import type { CommandDefinition } from "../types";
import { parseOptionalIntegerFlag, resolveRunInput } from "./run-shared";
import { loadNamedTool } from "./tool-shared";

export const toolCallCommand: CommandDefinition = {
  path: ["tool", "call"],
  summary: "Call a registered tool directly.",
  description: "Invoke a single tool from glyphrail.tools.ts with JSON input, schema validation, and policy enforcement.",
  usage:
    "glyphrail tool call <name> [--input <file> | --input-json <json>] [--set <path=value>] [--timeout-ms <n>] [--json]",
  options: [
    {
      name: "input",
      type: "string",
      description: "Read tool input from a JSON file.",
      valueLabel: "file"
    },
    {
      name: "input-json",
      type: "string",
      description: "Provide tool input as an inline JSON string.",
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
      name: "timeout-ms",
      type: "string",
      description: "Cap the tool execution timeout for this direct call.",
      valueLabel: "n"
    }
  ],
  examples: [
    `glyphrail tool call makeGreeting --input-json '{"name":"Ada"}'`,
    "glyphrail tool call selectVendor --input input.json --json"
  ],
  async handler(context, args) {
    const loaded = await loadNamedTool(context, args, "tool call");
    const input = await resolveRunInput(context, args);
    const timeoutMs = parseOptionalIntegerFlag(args, "timeout-ms");
    const result = await invokeTool({
      tool: loaded.tool,
      input: input as JsonValue,
      cwd: context.cwd,
      projectRoot: loaded.project.projectRoot,
      env: process.env,
      allowExternalSideEffects: loaded.project.config.policies.allowExternalSideEffects,
      timeoutMs
    });

    return {
      data: {
        command: "tool.call",
        toolsEntry: loaded.relativeEntryPath,
        tool: loaded.descriptor,
        input,
        output: result.output,
        meta: result.meta,
        effectiveTimeoutMs: result.effectiveTimeoutMs,
        policies: {
          allowExternalSideEffects: loaded.project.config.policies.allowExternalSideEffects
        }
      },
      human: [
        `Tool ${loaded.tool.name} completed`,
        `Output: ${JSON.stringify(result.output)}`
      ].join("\n")
    };
  }
};
