import { DEFAULT_CONFIG } from "../../config/types";
import { EXIT_CODES } from "../../core/errors";
import { TRACE_EVENT_TYPES } from "../../core/events";
import { SCHEMA_CATALOG } from "../../core/schema-documents";
import { WORKFLOW_STEP_KINDS } from "../../core/ast";
import { VERSION } from "../../version";
import type { CommandDefinition } from "../types";

export const capabilitiesCommand: CommandDefinition = {
  path: ["capabilities"],
  summary: "Emit a machine-readable capability document.",
  description: "Describe the current installation, available commands, contracts, and implemented Slice 6 feature set.",
  usage: "glyphrail capabilities [--json]",
  examples: ["glyphrail capabilities", "glyphrail capabilities --json"],
  async handler(context) {
    const commandSet = new Set(context.availableCommands);
    const payload = {
      name: "glyphrail",
      version: VERSION,
      runtime: "bun",
      slice: 6,
      commands: context.availableCommands,
      stepKinds: [...WORKFLOW_STEP_KINDS],
      deferredStepKinds: ["parallel"],
      features: {
        projectInit: commandSet.has("init"),
        workflowCreate: commandSet.has("workflow create"),
        schemaInspection: commandSet.has("schema"),
        capabilityDiscovery: commandSet.has("capabilities"),
        workflowValidation: commandSet.has("workflow validate"),
        workflowExplain: commandSet.has("workflow explain"),
        workflowLint: commandSet.has("workflow lint"),
        execution: commandSet.has("run"),
        resume: commandSet.has("resume"),
        trace: commandSet.has("runs trace"),
        runsList: commandSet.has("runs list"),
        tools: commandSet.has("tool list"),
        toolDirectCall: commandSet.has("tool call"),
        structuredAgent: commandSet.has("runs explain"),
        projectCheck: commandSet.has("check"),
        packaging: false
      },
      outputModes: ["pretty", "json", "jsonl"],
      traceEventTypes: [...TRACE_EVENT_TYPES],
      exitCodes: EXIT_CODES,
      agentAdapters: ["mock"],
      jsonEnvelope: {
        success: {
          ok: true
        },
        error: {
          ok: false,
          error: {
            code: "string",
            message: "string",
            details: "unknown"
          }
        }
      },
      runArtifacts: {
        rootPattern: ".glyphrail/runs/run_<id>/",
        files: [
          "meta.json",
          "input.json",
          "state.latest.json",
          "output.json",
          "trace.jsonl",
          "checkpoints/"
        ]
      },
      toolRegistryEntry: {
        file: "glyphrail.tools.ts",
        export: "default",
        factory: "defineTools",
        valueType: "Tool[]"
      },
      schemas: SCHEMA_CATALOG.map((entry) => ({
        name: entry.name,
        title: entry.title
      })),
      policies: DEFAULT_CONFIG.policies
    };

    return {
      data: payload,
      human: [
        `glyphrail ${VERSION}`,
        "",
        "Available commands:",
        ...context.availableCommands.map((command) => `  ${command}`),
        "",
        `Workflow step kinds: ${WORKFLOW_STEP_KINDS.join(", ")}`,
        "Execution runtime: assign/tool/agent/if/for_each/while/return/fail/noop",
        "Tool runtime: list/show/call/validate/scaffold",
        `Trace events: ${TRACE_EVENT_TYPES.join(", ")}`,
        `Agent adapters: mock`,
        "Slice 6: resume/check/runs-list",
        `Schemas: ${SCHEMA_CATALOG.map((entry) => entry.name).join(", ")}`
      ].join("\n")
    };
  }
};
