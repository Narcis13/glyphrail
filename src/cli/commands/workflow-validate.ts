import type { CommandDefinition } from "../types";
import { loadValidatedWorkflowAnalysis } from "./workflow-shared";

export const workflowValidateCommand: CommandDefinition = {
  path: ["workflow", "validate"],
  summary: "Validate a workflow definition and report static errors.",
  description: "Parse YAML, normalize the workflow AST, validate expressions and step structure, and verify referenced tools.",
  usage: "glyphrail workflow validate <file> [--json]",
  examples: [
    "glyphrail workflow validate workflows/hello.gr.yaml",
    "glyphrail workflow validate workflows/research.gr.yaml --json"
  ],
  async handler(context, args) {
    const { analysis, relativeFilePath } = await loadValidatedWorkflowAnalysis(
      context,
      args,
      "workflow validate"
    );
    const stepKinds = [...new Set(analysis.validation.inventory.map((item) => item.step.kind))];

    return {
      data: {
        command: "workflow.validate",
        file: relativeFilePath,
        valid: true,
        workflow: {
          name: analysis.workflow.name,
          version: analysis.workflow.version,
          stepCount: analysis.validation.inventory.length,
          stepKinds
        },
        referencedTools: analysis.validation.referencedTools,
        warningCount: analysis.warnings.length
      },
      human: [
        `Validated ${relativeFilePath}`,
        `Workflow: ${analysis.workflow.name} (${analysis.workflow.version})`,
        `Steps: ${analysis.validation.inventory.length}`,
        `Kinds: ${stepKinds.join(", ")}`,
        `Referenced tools: ${
          analysis.validation.referencedTools.length > 0
            ? analysis.validation.referencedTools.join(", ")
            : "none"
        }`,
        `Lint warnings: ${analysis.warnings.length}`
      ].join("\n")
    };
  }
};
