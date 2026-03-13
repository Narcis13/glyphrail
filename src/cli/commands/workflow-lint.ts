import type { CommandDefinition } from "../types";
import { loadValidatedWorkflowAnalysis } from "./workflow-shared";

export const workflowLintCommand: CommandDefinition = {
  path: ["workflow", "lint"],
  summary: "Run static lint checks over a workflow definition.",
  description: "Report non-fatal workflow risks such as missing output schemas, constant conditions, and missing declared state paths.",
  usage: "glyphrail workflow lint <file> [--json]",
  examples: [
    "glyphrail workflow lint workflows/demo.gr.yaml",
    "glyphrail workflow lint workflows/demo.gr.yaml --json"
  ],
  async handler(context, args) {
    const { analysis, relativeFilePath } = await loadValidatedWorkflowAnalysis(
      context,
      args,
      "workflow lint"
    );

    return {
      data: {
        command: "workflow.lint",
        file: relativeFilePath,
        warningCount: analysis.warnings.length,
        warnings: analysis.warnings
      },
      human:
        analysis.warnings.length === 0
          ? `No lint warnings for ${relativeFilePath}.`
          : [`Lint warnings for ${relativeFilePath}:`, ...analysis.warnings.map(formatWarning)].join("\n")
    };
  }
};

function formatWarning(warning: { code: string; message: string; path: string }): string {
  return `  [${warning.code}] ${warning.path}: ${warning.message}`;
}
