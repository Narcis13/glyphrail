import { type Tool } from "glyphrail";

export const __TOOL_IDENTIFIER__: Tool<{ value: string }, { value: string }> = {
  name: "__TOOL_NAME__",
  description: "__TOOL_DESCRIPTION__",
  inputSchema: {
    type: "object",
    properties: {
      value: { type: "string" }
    },
    required: ["value"],
    additionalProperties: false
  },
  outputSchema: {
    type: "object",
    properties: {
      value: { type: "string" }
    },
    required: ["value"],
    additionalProperties: false
  },
  sideEffect: "none",
  async execute(input) {
    return {
      ok: true,
      output: {
        value: input.value
      }
    };
  }
};
