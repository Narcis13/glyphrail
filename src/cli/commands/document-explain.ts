import { resolve } from "node:path"

import { createFailure, EXIT_CODES } from "../../core/errors"
import { readTextFile, relativePath } from "../../util/fs"
import { parseYaml } from "../../util/yaml"
import { validateWorkflowDocument } from "../../dsl/validation"
import { resolveProjectPath } from "../../config"
import { getStepWriteTargets } from "../../dsl/normalization"
import type { WorkflowStep } from "../../core/ast"
import { parseGrDocument } from "../../document/parser"
import { parseTemplate } from "../../document/template-engine"
import { validateTemplate } from "../../document/validation"
import { listFormatterNames } from "../../document/formatters"
import type { TemplateNode } from "../../document/contracts"
import type { CommandDefinition } from "../types"

export const documentExplainCommand: CommandDefinition = {
  path: ["document", "explain"],
  summary: "Explain both workflow and template structure of a .gr.md document.",
  description:
    "Parse a .gr.md document and show its workflow metadata, step inventory, template structure (interpolations, blocks, formatters), and validation status.",
  usage: "glyphrail document explain <file.gr.md> [--json]",
  examples: [
    "glyphrail document explain docs/report.gr.md",
    "glyphrail document explain docs/report.gr.md --json"
  ],
  async handler(context, args) {
    if (args.positionals.length !== 1) {
      throw createFailure(
        "CLI_USAGE_ERROR",
        "document explain requires exactly one .gr.md file path.",
        EXIT_CODES.invalidCliUsage
      )
    }

    const project = await context.getProjectConfig()
    const filePath = resolve(context.cwd, args.positionals[0] as string)
    const relFilePath = relativePath(project.projectRoot, filePath)

    const content = await readTextFile(filePath)
    const doc = parseGrDocument(content, filePath)

    // Validate workflow frontmatter
    const rawWorkflow = parseYaml<unknown>(doc.frontmatterRaw, filePath)
    const workflowValidation = await validateWorkflowDocument(rawWorkflow, {
      toolsEntryPath: resolveProjectPath(project, project.config.toolsEntry)
    })

    const workflow = workflowValidation.workflow

    // Parse and validate template
    const templateIssues = validateTemplate(doc.templateBody)
    let templateNodes: TemplateNode[] = []
    try {
      templateNodes = parseTemplate(doc.templateBody)
    } catch {
      // validation already captured parse errors
    }

    // Analyze template structure
    const templateAnalysis = analyzeTemplateNodes(templateNodes)

    // Build workflow analysis
    const workflowAnalysis = workflow
      ? {
          name: workflow.name,
          version: workflow.version,
          description: workflow.description,
          stepCount: workflow.steps.length,
          steps: workflow.steps.map((step) => ({
            id: step.id,
            kind: step.kind,
            writes: getStepWriteTargets(step),
            summary: summarizeStep(step)
          })),
          referencedTools: workflow.steps
            .filter((s) => s.kind === "tool")
            .map((s) => (s as any).tool as string),
          hasInput: Boolean(workflow.inputSchema),
          hasOutput: Boolean(workflow.output),
          policies: workflow.policies ?? {}
        }
      : null

    const valid = workflowValidation.errors.length === 0 &&
      templateIssues.filter((i) => i.severity === "error").length === 0

    return {
      data: {
        command: "document.explain",
        file: relFilePath,
        valid,
        workflow: workflowAnalysis,
        template: templateAnalysis,
        validation: {
          workflowErrors: workflowValidation.errors.length,
          templateErrors: templateIssues.filter((i) => i.severity === "error").length,
          templateWarnings: templateIssues.filter((i) => i.severity === "warning").length,
          issues: templateIssues
        }
      },
      human: formatHumanOutput(relFilePath, workflowAnalysis, templateAnalysis, valid, templateIssues)
    }
  }
}

interface TemplateAnalysis {
  interpolations: string[]
  formattersUsed: string[]
  eachBlocks: { expression: string; binding: string }[]
  ifBlocks: { condition: string }[]
  depth: number
  nodeCount: number
}

function analyzeTemplateNodes(nodes: TemplateNode[]): TemplateAnalysis {
  const interpolations: string[] = []
  const formattersUsed = new Set<string>()
  const eachBlocks: { expression: string; binding: string }[] = []
  const ifBlocks: { condition: string }[] = []
  let maxDepth = 0
  let nodeCount = 0

  function walk(nodes: TemplateNode[], depth: number): void {
    if (depth > maxDepth) maxDepth = depth

    for (const node of nodes) {
      nodeCount++

      if (node.type === "interpolation") {
        interpolations.push(
          node.formatter
            ? `\${${node.expression} | ${node.formatter}}`
            : `\${${node.expression}}`
        )
        if (node.formatter) {
          formattersUsed.add(node.formatter)
        }
      } else if (node.type === "each") {
        eachBlocks.push({ expression: node.itemsExpression, binding: node.binding })
        walk(node.body, depth + 1)
      } else if (node.type === "if") {
        ifBlocks.push({ condition: node.condition })
        walk(node.thenBody, depth + 1)
        if (node.elseBody) {
          walk(node.elseBody, depth + 1)
        }
      }
    }
  }

  walk(nodes, 0)

  return {
    interpolations,
    formattersUsed: [...formattersUsed],
    eachBlocks,
    ifBlocks,
    depth: maxDepth,
    nodeCount
  }
}

function summarizeStep(step: WorkflowStep): string {
  switch (step.kind) {
    case "assign":
      return `set ${Object.keys(step.set).join(", ")}`
    case "tool":
      return `tool ${step.tool}`
    case "agent":
      return `agent: ${step.objective}`
    case "if":
      return "conditional branch"
    case "for_each":
      return `iterate ${step.items} as ${step.as}`
    case "while":
      return `loop while ${step.condition}`
    case "return":
      return "return output"
    case "fail":
      return step.message ?? step.error ?? "fail workflow"
    case "noop":
      return "no operation"
    case "parallel":
      return `${step.branches.length} branches`
  }
}

function formatHumanOutput(
  file: string,
  workflow: ReturnType<typeof analyzeTemplateNodes> extends infer _ ? any : never,
  template: TemplateAnalysis,
  valid: boolean,
  issues: { line: number; message: string; severity: string }[]
): string {
  const lines: string[] = []

  lines.push(`Document: ${file}`)
  lines.push(`Valid: ${valid ? "yes" : "no"}`)
  lines.push("")

  if (workflow) {
    lines.push("## Workflow")
    lines.push(`  Name: ${workflow.name}`)
    lines.push(`  Version: ${workflow.version}`)
    if (workflow.description) lines.push(`  Description: ${workflow.description}`)
    lines.push(`  Steps: ${workflow.stepCount}`)
    for (const step of workflow.steps) {
      lines.push(`    ${step.id} [${step.kind}] ${step.summary}`)
    }
    if (workflow.referencedTools.length > 0) {
      lines.push(`  Tools: ${workflow.referencedTools.join(", ")}`)
    }
    lines.push("")
  } else {
    lines.push("## Workflow")
    lines.push("  (invalid — could not parse)")
    lines.push("")
  }

  lines.push("## Template")
  lines.push(`  Interpolations: ${template.interpolations.length}`)
  if (template.interpolations.length > 0) {
    for (const expr of template.interpolations) {
      lines.push(`    ${expr}`)
    }
  }
  if (template.formattersUsed.length > 0) {
    lines.push(`  Formatters: ${template.formattersUsed.join(", ")}`)
  }
  if (template.eachBlocks.length > 0) {
    lines.push(`  Each blocks: ${template.eachBlocks.length}`)
    for (const b of template.eachBlocks) {
      lines.push(`    {{#each ${b.expression} as ${b.binding}}}`)
    }
  }
  if (template.ifBlocks.length > 0) {
    lines.push(`  If blocks: ${template.ifBlocks.length}`)
    for (const b of template.ifBlocks) {
      lines.push(`    {{#if ${b.condition}}}`)
    }
  }
  lines.push(`  Max nesting depth: ${template.depth}`)

  const errors = issues.filter((i) => i.severity === "error")
  if (errors.length > 0) {
    lines.push("")
    lines.push("## Issues")
    for (const e of errors) {
      lines.push(`  Line ${e.line}: ${e.message}`)
    }
  }

  return lines.join("\n")
}
