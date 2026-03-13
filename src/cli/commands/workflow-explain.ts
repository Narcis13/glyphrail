import type { WorkflowStep } from "../../core/ast";
import { getStepWriteTargets } from "../../dsl/normalization";
import type { CommandDefinition } from "../types";
import { loadValidatedWorkflowAnalysis } from "./workflow-shared";

export const workflowExplainCommand: CommandDefinition = {
  path: ["workflow", "explain"],
  summary: "Explain workflow structure in human or JSON form.",
  description: "Summarize workflow metadata, step inventory, tools, control flow, policies, and lint-derived risk points.",
  usage: "glyphrail workflow explain <file> [--json]",
  examples: [
    "glyphrail workflow explain workflows/hello.gr.yaml",
    "glyphrail workflow explain workflows/hello.gr.yaml --json"
  ],
  async handler(context, args) {
    const { analysis, relativeFilePath } = await loadValidatedWorkflowAnalysis(
      context,
      args,
      "workflow explain"
    );

    const controlFlow = {
      conditionals: analysis.validation.inventory
        .filter((item) => item.step.kind === "if")
        .map((item) => item.step.id),
      loops: analysis.validation.inventory
        .filter((item) => item.step.kind === "for_each" || item.step.kind === "while")
        .map((item) => ({ id: item.step.id, kind: item.step.kind })),
      parallels: analysis.validation.inventory
        .filter((item) => item.step.kind === "parallel")
        .map((item) => item.step.id),
      terminals: analysis.validation.inventory
        .filter((item) => item.step.kind === "return" || item.step.kind === "fail")
        .map((item) => ({ id: item.step.id, kind: item.step.kind }))
    };

    const stepInventory = analysis.validation.inventory.map((item) => ({
      id: item.step.id,
      kind: item.step.kind,
      path: item.path,
      depth: item.depth,
      when: item.step.when,
      writes: getStepWriteTargets(item.step),
      tool: item.step.kind === "tool" ? item.step.tool : undefined,
      summary: summarizeStep(item.step)
    }));

    return {
      data: {
        command: "workflow.explain",
        file: relativeFilePath,
        metadata: {
          name: analysis.workflow.name,
          version: analysis.workflow.version,
          description: analysis.workflow.description
        },
        stepInventory,
        referencedTools: analysis.validation.referencedTools,
        controlFlow,
        policies: analysis.workflow.policies ?? {},
        riskPoints: analysis.warnings
      },
      human: [
        `Workflow: ${analysis.workflow.name}`,
        `Version: ${analysis.workflow.version}`,
        analysis.workflow.description ? `Description: ${analysis.workflow.description}` : undefined,
        `File: ${relativeFilePath}`,
        "",
        `Steps (${stepInventory.length}):`,
        ...stepInventory.map((step) => `  ${step.id} [${step.kind}] ${step.summary}`),
        "",
        `Referenced tools: ${
          analysis.validation.referencedTools.length > 0
            ? analysis.validation.referencedTools.join(", ")
            : "none"
        }`,
        `Conditionals: ${controlFlow.conditionals.length}`,
        `Loops: ${controlFlow.loops.length}`,
        `Parallel blocks: ${controlFlow.parallels.length}`,
        `Risk points: ${analysis.warnings.length}`
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n")
    };
  }
};

function summarizeStep(step: WorkflowStep): string {
  switch (step.kind) {
    case "assign":
      return `set ${Object.keys(step.set).join(", ")}`;
    case "tool":
      return `tool ${step.tool}`;
    case "agent":
      return `agent objective '${step.objective}'`;
    case "if":
      return `conditional branch`;
    case "for_each":
      return `iterate ${step.items} as ${step.as}`;
    case "while":
      return `loop while ${step.condition}`;
    case "parallel":
      return `${step.branches.length} branches`;
    case "return":
      return `return output`;
    case "fail":
      return step.message ?? step.error ?? "fail workflow";
    case "noop":
      return "no operation";
  }
}
