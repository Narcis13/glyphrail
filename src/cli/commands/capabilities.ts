import { DEFAULT_CONFIG } from "../../config/types";
import { SCHEMA_CATALOG } from "../../core/schema-documents";
import { WORKFLOW_STEP_KINDS } from "../../core/ast";
import { VERSION } from "../../version";
import type { CommandDefinition } from "../types";

export const capabilitiesCommand: CommandDefinition = {
  path: ["capabilities"],
  summary: "Emit a machine-readable capability document.",
  description: "Describe the current installation, available commands, contracts, and implemented Slice 3 feature set.",
  usage: "glyphrail capabilities [--json]",
  examples: ["glyphrail capabilities", "glyphrail capabilities --json"],
  async handler(context) {
    const payload = {
      name: "glyphrail",
      version: VERSION,
      runtime: "bun",
      slice: 3,
      commands: context.availableCommands,
      stepKinds: [...WORKFLOW_STEP_KINDS],
      deferredStepKinds: ["agent", "parallel"],
      features: {
        projectInit: true,
        workflowCreate: true,
        schemaInspection: true,
        capabilityDiscovery: true,
        workflowValidation: true,
        workflowExplain: true,
        workflowLint: true,
        execution: true,
        trace: true,
        structuredAgent: false,
        packaging: false
      },
      outputModes: ["pretty", "json", "jsonl"],
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
        "Execution runtime: assign/tool/if/for_each/while/return/fail/noop",
        `Schemas: ${SCHEMA_CATALOG.map((entry) => entry.name).join(", ")}`
      ].join("\n")
    };
  }
};
