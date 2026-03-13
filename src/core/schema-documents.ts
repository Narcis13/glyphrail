import { WORKFLOW_STEP_KINDS } from "./ast";
import { TRACE_EVENT_TYPES } from "./events";
import { CURSOR_FRAME_KINDS, RUN_STATUSES, STEP_STATUSES } from "./run-record";
import { workflowDocumentSchema } from "../dsl/workflow-schema";

export interface SchemaCatalogEntry {
  name: string;
  title: string;
  description: string;
  schema: Record<string, unknown>;
}

export const SCHEMA_CATALOG: SchemaCatalogEntry[] = [
  {
    name: "workflow",
    title: "Workflow DSL",
    description: "Top-level workflow authoring document and step shapes.",
    schema: workflowDocumentSchema
  },
  {
    name: "config",
    title: "Project Config",
    description: "The glyphrail.config.json project configuration file.",
    schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: "GlyphrailConfig",
      type: "object",
      required: [
        "schemaVersion",
        "workflowsDir",
        "runsDir",
        "toolsEntry",
        "defaultOutputMode",
        "defaultCheckpointEveryStep",
        "policies"
      ],
      properties: {
        schemaVersion: { type: "string" },
        workflowsDir: { type: "string" },
        runsDir: { type: "string" },
        toolsEntry: { type: "string" },
        defaultOutputMode: {
          enum: ["pretty", "json", "jsonl"]
        },
        defaultCheckpointEveryStep: { type: "boolean" },
        policies: {
          type: "object",
          required: ["maxRunSteps", "maxRunDurationMs", "allowExternalSideEffects"],
          properties: {
            maxRunSteps: { type: "integer" },
            maxRunDurationMs: { type: "integer" },
            allowExternalSideEffects: { type: "boolean" }
          }
        }
      }
    }
  },
  {
    name: "tool",
    title: "Tool Contract",
    description: "TypeScript tool contract exposed through glyphrail.tools.ts.",
    schema: {
      title: "ToolContract",
      type: "object",
      required: ["name", "description", "inputSchema", "sideEffect", "execute"],
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        inputSchema: { type: "object" },
        outputSchema: { type: "object" },
        sideEffect: {
          enum: ["none", "read", "write", "external"]
        },
        timeoutMs: { type: "integer" },
        tags: {
          type: "array",
          items: {
            enum: ["io", "http", "file", "compute", "ai", "db", "unsafe"]
          }
        }
      }
    }
  },
  {
    name: "agent",
    title: "Agent Adapter",
    description: "Structured and tool-use agent adapter contracts.",
    schema: {
      title: "AgentAdapterContract",
      type: "object",
      required: ["name", "runStructured"],
      properties: {
        name: { type: "string" },
        runStructured: {
          description: "Function(request) => StructuredAgentResult"
        },
        runToolUse: {
          description: "Optional Function(request) => ToolUseAgentResult"
        }
      }
    }
  },
  {
    name: "run-record",
    title: "Run Record",
    description: "Persisted run metadata record for a workflow run.",
    schema: {
      title: "RunRecord",
      type: "object",
      required: ["schemaVersion", "runId", "workflow", "status", "startedAt"],
      properties: {
        schemaVersion: { type: "string" },
        runId: { type: "string" },
        workflow: {
          type: "object",
          required: ["name", "version"],
          properties: {
            name: { type: "string" },
            version: { type: "string" },
            file: { type: "string" },
            description: { type: "string" }
          }
        },
        status: { enum: RUN_STATUSES },
        startedAt: { type: "string" },
        completedAt: { type: "string" },
        currentStepId: { type: "string" },
        elapsedMs: { type: "integer" },
        visitedSteps: { type: "integer" },
        cursor: {
          type: "object",
          properties: {
            frames: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  kind: { enum: CURSOR_FRAME_KINDS },
                  stepId: { type: "string" },
                  branch: { enum: ["then", "else"] },
                  as: { type: "string" },
                  itemIndex: { type: "integer" },
                  iteration: { type: "integer" },
                  nextIndex: { type: "integer" },
                  items: {
                    type: "array"
                  }
                }
              }
            }
          }
        },
        counters: {
          type: "object",
          properties: {
            completedSteps: { type: "integer" },
            failedSteps: { type: "integer" },
            retries: { type: "integer" },
            loopIterations: { type: "integer" },
            checkpoints: { type: "integer" }
          }
        },
        retryCounters: {
          type: "object",
          additionalProperties: {
            type: "integer"
          }
        },
        policies: {
          type: "object",
          properties: {
            maxRunSteps: { type: "integer" },
            maxRunDurationMs: { type: "integer" },
            allowTools: {
              type: "array",
              items: { type: "string" }
            },
            allowExternalSideEffects: { type: "boolean" }
          }
        },
        input: {},
        output: {},
        artifactPaths: {
          type: "object",
          properties: {
            meta: { type: "string" },
            input: { type: "string" },
            state: { type: "string" },
            output: { type: "string" },
            trace: { type: "string" },
            checkpointsDir: { type: "string" }
          }
        }
      }
    }
  },
  {
    name: "trace-event",
    title: "Trace Event",
    description: "Append-only JSONL trace event envelope.",
    schema: {
      title: "TraceEvent",
      type: "object",
      required: ["schemaVersion", "ts", "runId", "event"],
      properties: {
        schemaVersion: { type: "string" },
        ts: { type: "string" },
        runId: { type: "string" },
        event: { enum: TRACE_EVENT_TYPES },
        stepId: { type: "string" },
        kind: { enum: WORKFLOW_STEP_KINDS },
        status: { enum: [...STEP_STATUSES, ...RUN_STATUSES] },
        durationMs: { type: "integer" }
      }
    }
  },
  {
    name: "error",
    title: "Error Shape",
    description: "Canonical Glyphrail error payload.",
    schema: {
      title: "GlyphrailError",
      type: "object",
      required: ["code", "message"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        stepId: { type: "string" },
        runId: { type: "string" },
        details: {},
        retryable: { type: "boolean" }
      }
    }
  },
  {
    name: "json-envelope",
    title: "JSON Output Envelope",
    description: "Standard top-level CLI JSON success and error envelope.",
    schema: {
      title: "JsonOutputEnvelope",
      oneOf: [
        {
          type: "object",
          required: ["ok"],
          properties: {
            ok: { const: true }
          },
          additionalProperties: true
        },
        {
          type: "object",
          required: ["ok", "error"],
          properties: {
            ok: { const: false },
            error: {
              $ref: "#/$defs/error"
            }
          },
          $defs: {
            error: {
              type: "object",
              required: ["code", "message"],
              properties: {
                code: { type: "string" },
                message: { type: "string" },
                details: {}
              }
            }
          }
        }
      ]
    }
  }
];

export const SCHEMA_DOCUMENTS = Object.fromEntries(
  SCHEMA_CATALOG.map((entry) => [entry.name, entry.schema])
);
