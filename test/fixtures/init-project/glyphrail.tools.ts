import { defineTools, type Tool } from "glyphrail";

const makeGreeting: Tool<{ name: string }, string> = {
  name: "makeGreeting",
  description: "Create a friendly greeting for the provided name.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string" }
    },
    required: ["name"],
    additionalProperties: false
  },
  outputSchema: {
    type: "string"
  },
  sideEffect: "none",
  async execute(input) {
    return {
      ok: true,
      output: `Hello, ${input.name}!`
    };
  }
};

export default defineTools([makeGreeting]);
