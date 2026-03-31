import { parseExpression } from "../core/expression-engine"
import type { TemplateNode, TemplateIssue } from "./contracts"
import { hasFormatter } from "./formatters"
import { parseTemplate } from "./template-engine"

export function validateTemplate(body: string): TemplateIssue[] {
  const issues: TemplateIssue[] = []

  try {
    const nodes = parseTemplate(body)
    validateNodes(nodes, issues)
  } catch (error) {
    if (error instanceof Error) {
      issues.push({ line: 0, message: error.message, severity: "error" })
    }
  }

  return issues
}

function validateNodes(nodes: TemplateNode[], issues: TemplateIssue[]): void {
  for (const node of nodes) {
    if (node.type === "interpolation") {
      validateExpression(node.expression, node.line, issues)
      if (node.formatter && !hasFormatter(node.formatter)) {
        issues.push({
          line: node.line,
          message: `Unknown formatter '${node.formatter}'`,
          severity: "error"
        })
      }
    } else if (node.type === "each") {
      validateExpression(node.itemsExpression, node.line, issues)
      validateNodes(node.body, issues)
    } else if (node.type === "if") {
      validateExpression(node.condition, node.line, issues)
      validateNodes(node.thenBody, issues)
      if (node.elseBody) {
        validateNodes(node.elseBody, issues)
      }
    }
  }
}

function validateExpression(expr: string, line: number, issues: TemplateIssue[]): void {
  try {
    parseExpression(`\${${expr}}`)
  } catch (error) {
    issues.push({
      line,
      message: `Invalid expression: ${expr} — ${error instanceof Error ? error.message : String(error)}`,
      severity: "error"
    })
  }
}
