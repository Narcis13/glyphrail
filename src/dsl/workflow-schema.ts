import { JSON_SCHEMA_SUBSET_DEFINITION } from "../core/json-schema";
import { ON_ERROR_STRATEGIES } from "../core/error-policy";

const commonStepProperties = {
  id: { type: "string" },
  kind: { type: "string" },
  name: { type: "string" },
  description: { type: "string" },
  when: { type: "string" },
  timeoutMs: { type: "integer" },
  onError: {
    type: "object",
    properties: {
      strategy: {
        enum: [...ON_ERROR_STRATEGIES]
      },
      maxAttempts: { type: "integer" },
      goto: { type: "string" },
      retry: {
        type: "object",
        properties: {
          maxAttempts: { type: "integer" }
        },
        additionalProperties: false
      }
    },
    additionalProperties: false
  },
  meta: {
    type: "object",
    additionalProperties: true
  }
} as const;

function createStepSchema(
  kind: string,
  extraProperties: Record<string, unknown>,
  requiredFields: string[]
): Record<string, unknown> {
  return {
    type: "object",
    required: ["id", "kind", ...requiredFields],
    properties: {
      ...commonStepProperties,
      kind: { const: kind },
      ...extraProperties
    },
    additionalProperties: false
  };
}

export const workflowDocumentSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "GlyphrailWorkflowDocument",
  type: "object",
  required: ["version", "name", "steps"],
  properties: {
    version: { type: "string" },
    name: { type: "string" },
    description: { type: "string" },
    inputSchema: { $ref: "#/$defs/jsonSchema" },
    outputSchema: { $ref: "#/$defs/jsonSchema" },
    defaults: {
      type: "object",
      properties: {
        model: { type: "string" },
        timeoutMs: { type: "integer" },
        maxStepRetries: { type: "integer" },
        outputMode: {
          enum: ["structured", "text", "json"]
        }
      },
      additionalProperties: false
    },
    policies: {
      type: "object",
      properties: {
        allowTools: {
          type: "array",
          items: { type: "string" }
        },
        maxRunSteps: { type: "integer" },
        maxRunDurationMs: { type: "integer" },
        maxAgentToolCalls: { type: "integer" }
      },
      additionalProperties: false
    },
    state: {
      type: "object",
      additionalProperties: true
    },
    steps: {
      type: "array",
      items: { $ref: "#/$defs/step" }
    },
    output: {
      description: "Any JSON-compatible output mapping or expression-bearing object."
    }
  },
  additionalProperties: false,
  $defs: {
    jsonSchema: JSON_SCHEMA_SUBSET_DEFINITION,
    step: {
      oneOf: [
        { $ref: "#/$defs/assignStep" },
        { $ref: "#/$defs/toolStep" },
        { $ref: "#/$defs/agentStep" },
        { $ref: "#/$defs/ifStep" },
        { $ref: "#/$defs/forEachStep" },
        { $ref: "#/$defs/whileStep" },
        { $ref: "#/$defs/parallelStep" },
        { $ref: "#/$defs/returnStep" },
        { $ref: "#/$defs/failStep" },
        { $ref: "#/$defs/noopStep" }
      ]
    },
    assignStep: createStepSchema(
      "assign",
      {
        set: { type: "object", additionalProperties: true }
      },
      ["set"]
    ),
    toolStep: createStepSchema(
      "tool",
      {
        tool: { type: "string" },
        input: { type: "object", additionalProperties: true },
        save: { type: "string" },
        append: { type: "string" },
        merge: { type: "string" }
      },
      ["tool"]
    ),
    agentStep: createStepSchema(
      "agent",
      {
        mode: { enum: ["structured", "tool-use"] },
        provider: { type: "string" },
        model: { type: "string" },
        objective: { type: "string" },
        instructions: { type: "string" },
        input: { type: "object", additionalProperties: true },
        outputSchema: { $ref: "#/$defs/jsonSchema" },
        save: { type: "string" },
        append: { type: "string" },
        merge: { type: "string" }
      },
      ["objective"]
    ),
    ifStep: createStepSchema(
      "if",
      {
        condition: { type: "string" },
        then: { type: "array", items: { $ref: "#/$defs/step" } },
        else: { type: "array", items: { $ref: "#/$defs/step" } }
      },
      ["condition", "then"]
    ),
    forEachStep: createStepSchema(
      "for_each",
      {
        items: { type: "string" },
        as: { type: "string" },
        steps: { type: "array", items: { $ref: "#/$defs/step" } }
      },
      ["items", "as", "steps"]
    ),
    whileStep: createStepSchema(
      "while",
      {
        condition: { type: "string" },
        maxIterations: { type: "integer" },
        steps: { type: "array", items: { $ref: "#/$defs/step" } }
      },
      ["condition", "maxIterations", "steps"]
    ),
    parallelStep: createStepSchema(
      "parallel",
      {
        branches: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              steps: {
                type: "array",
                items: { $ref: "#/$defs/step" }
              }
            },
            required: ["steps"],
            additionalProperties: false
          }
        }
      },
      ["branches"]
    ),
    returnStep: createStepSchema(
      "return",
      {
        output: {}
      },
      []
    ),
    failStep: createStepSchema(
      "fail",
      {
        message: { type: "string" },
        error: { type: "string" }
      },
      []
    ),
    noopStep: createStepSchema("noop", {}, [])
  }
};
