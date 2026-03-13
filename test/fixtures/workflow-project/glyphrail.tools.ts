import { defineTools, type Tool } from "glyphrail";

const makeGreeting: Tool<{ name: string }, string> = {
  name: "makeGreeting",
  description: "Create a greeting.",
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

const selectVendor: Tool<{ goal: string }, { vendor: string }> = {
  name: "selectVendor",
  description: "Pick a vendor.",
  inputSchema: {
    type: "object",
    properties: {
      goal: { type: "string" }
    },
    required: ["goal"],
    additionalProperties: false
  },
  outputSchema: {
    type: "object",
    properties: {
      vendor: { type: "string" }
    },
    required: ["vendor"],
    additionalProperties: false
  },
  sideEffect: "none",
  async execute() {
    return {
      ok: true,
      output: {
        vendor: "demo-vendor"
      }
    };
  }
};

export default defineTools([makeGreeting, selectVendor]);
