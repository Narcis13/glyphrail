import { type Tool } from "glyphrail";

export const formatHandle: Tool<{ value: string }, { handle: string }> = {
  name: "formatHandle",
  description: "Normalize a string into a handle.",
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
      handle: { type: "string" }
    },
    required: ["handle"],
    additionalProperties: false
  },
  sideEffect: "none",
  tags: ["compute"],
  async execute(input) {
    return {
      ok: true,
      output: {
        handle: input.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
      }
    };
  }
};
