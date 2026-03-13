import { ON_ERROR_STRATEGIES } from "../core/error-policy";

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
      additionalProperties: true
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
      additionalProperties: true
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
  $defs: {
    jsonSchema: {
      type: "object",
      description: "Minimal JSON Schema subset used by Glyphrail."
    },
    baseStep: {
      type: "object",
      required: ["id", "kind"],
      properties: {
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
              additionalProperties: true
            }
          },
          additionalProperties: true
        }
      },
      additionalProperties: true
    },
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
    assignStep: {
      allOf: [
        { $ref: "#/$defs/baseStep" },
        {
          type: "object",
          properties: {
            kind: { const: "assign" },
            set: { type: "object", additionalProperties: true }
          },
          required: ["set"]
        }
      ]
    },
    toolStep: {
      allOf: [
        { $ref: "#/$defs/baseStep" },
        {
          type: "object",
          properties: {
            kind: { const: "tool" },
            tool: { type: "string" },
            input: { type: "object", additionalProperties: true },
            save: { type: "string" },
            append: { type: "string" },
            merge: { type: "string" }
          },
          required: ["tool"]
        }
      ]
    },
    agentStep: {
      allOf: [
        { $ref: "#/$defs/baseStep" },
        {
          type: "object",
          properties: {
            kind: { const: "agent" },
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
          required: ["objective"]
        }
      ]
    },
    ifStep: {
      allOf: [
        { $ref: "#/$defs/baseStep" },
        {
          type: "object",
          properties: {
            kind: { const: "if" },
            condition: { type: "string" },
            then: { type: "array", items: { $ref: "#/$defs/step" } },
            else: { type: "array", items: { $ref: "#/$defs/step" } }
          },
          required: ["condition", "then"]
        }
      ]
    },
    forEachStep: {
      allOf: [
        { $ref: "#/$defs/baseStep" },
        {
          type: "object",
          properties: {
            kind: { const: "for_each" },
            items: { type: "string" },
            as: { type: "string" },
            steps: { type: "array", items: { $ref: "#/$defs/step" } }
          },
          required: ["items", "as", "steps"]
        }
      ]
    },
    whileStep: {
      allOf: [
        { $ref: "#/$defs/baseStep" },
        {
          type: "object",
          properties: {
            kind: { const: "while" },
            condition: { type: "string" },
            maxIterations: { type: "integer" },
            steps: { type: "array", items: { $ref: "#/$defs/step" } }
          },
          required: ["condition", "maxIterations", "steps"]
        }
      ]
    },
    parallelStep: {
      allOf: [
        { $ref: "#/$defs/baseStep" },
        {
          type: "object",
          properties: {
            kind: { const: "parallel" },
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
                required: ["steps"]
              }
            }
          },
          required: ["branches"]
        }
      ]
    },
    returnStep: {
      allOf: [
        { $ref: "#/$defs/baseStep" },
        {
          type: "object",
          properties: {
            kind: { const: "return" },
            output: {}
          }
        }
      ]
    },
    failStep: {
      allOf: [
        { $ref: "#/$defs/baseStep" },
        {
          type: "object",
          properties: {
            kind: { const: "fail" },
            message: { type: "string" },
            error: { type: "string" }
          }
        }
      ]
    },
    noopStep: {
      allOf: [
        { $ref: "#/$defs/baseStep" },
        {
          type: "object",
          properties: {
            kind: { const: "noop" }
          }
        }
      ]
    }
  }
} as const;
