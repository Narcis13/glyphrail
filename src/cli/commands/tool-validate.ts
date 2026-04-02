import { createFailure, EXIT_CODES } from "../../core/errors";
import { getToolContractIssues, toToolDescriptor } from "../../tools/registry";
import type { CommandDefinition } from "../types";
import { loadNamedTool, loadProjectTools } from "./tool-shared";

export const toolValidateCommand: CommandDefinition = {
  path: ["tool", "validate"],
  summary: "Validate one tool or the whole declared tool registry.",
  description: "Check tool contracts, supported schema subset usage, and required metadata in glyphrail.tools.ts.",
  usage: "glyphrail tool validate [name] [--json]",
  examples: ["glyphrail tool validate", "glyphrail tool validate makeGreeting --json"],
  async handler(context, args) {
    if (args.positionals.length > 1) {
      throw createFailure(
        "CLI_USAGE_ERROR",
        "tool validate accepts at most one tool name.",
        EXIT_CODES.invalidCliUsage
      );
    }

    const toolName = args.positionals[0] as string | undefined;
    const tools = toolName
      ? [(await loadNamedTool(context, args, "tool validate")).tool]
      : (await loadProjectTools(context)).tools;
    const validations = tools.map((tool) => ({
      tool: toToolDescriptor(tool),
      issues: getToolContractIssues(tool)
    }));

    const invalidTools = validations.filter((validation) => validation.issues.length > 0);
    if (invalidTools.length > 0) {
      throw createFailure(
        "TOOL_VALIDATION_ERROR",
        "One or more tools failed contract validation.",
        EXIT_CODES.genericFailure,
        {
          tools: invalidTools
        }
      );
    }

    return {
      data: {
        command: "tool.validate",
        valid: true,
        toolCount: validations.length,
        tools: validations.map((validation) => validation.tool)
      },
      human:
        toolName
          ? `Validated tool ${toolName}.`
          : `Validated ${validations.length} tool${validations.length === 1 ? "" : "s"}.`
    };
  }
};
