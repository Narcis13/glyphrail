import { evaluateExpression, type ExpressionScope } from "../core/expression-engine"
import { createFailure, EXIT_CODES } from "../core/errors"
import type { TemplateNode, InterpolationNode, TextNode, TemplateIssue } from "./contracts"
import { getFormatter, stringifyValue } from "./formatters"

export function parseTemplate(body: string): TemplateNode[] {
  const nodes: TemplateNode[] = []
  const lines = body.split("\n")

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex] as string
    const lineNumber = lineIndex + 1

    if (lineIndex > 0) {
      nodes.push({ type: "text", value: "\n", line: lineNumber })
    }

    const lineNodes = parseLineInterpolations(line, lineNumber)
    nodes.push(...lineNodes)
  }

  return nodes
}

function parseLineInterpolations(line: string, lineNumber: number): TemplateNode[] {
  const nodes: TemplateNode[] = []
  let cursor = 0

  while (cursor < line.length) {
    const escapeIndex = line.indexOf("\\${", cursor)
    const interpIndex = line.indexOf("${", cursor)

    if (interpIndex === -1) {
      if (cursor < line.length) {
        const remaining = line.slice(cursor).replace(/\\\$\{/g, "${")
        nodes.push({ type: "text", value: remaining, line: lineNumber })
      }
      break
    }

    if (escapeIndex !== -1 && escapeIndex < interpIndex) {
      const text = line.slice(cursor, escapeIndex) + "${"
      nodes.push({ type: "text", value: text, line: lineNumber })
      cursor = escapeIndex + 3
      continue
    }

    if (interpIndex > cursor) {
      nodes.push({ type: "text", value: line.slice(cursor, interpIndex), line: lineNumber })
    }

    const closeIndex = findMatchingClose(line, interpIndex + 2)
    if (closeIndex === -1) {
      nodes.push({ type: "text", value: line.slice(interpIndex), line: lineNumber })
      cursor = line.length
      break
    }

    const rawExpression = line.slice(interpIndex + 2, closeIndex)
    const { expression, formatter, formatterArgs } = parseExpressionWithPipe(rawExpression)

    const node: InterpolationNode = {
      type: "interpolation",
      expression: expression.trim(),
      line: lineNumber
    }
    if (formatter) {
      node.formatter = formatter
      if (formatterArgs && formatterArgs.length > 0) {
        node.formatterArgs = formatterArgs
      }
    }
    nodes.push(node)
    cursor = closeIndex + 1
  }

  if (nodes.length === 0) {
    nodes.push({ type: "text", value: "", line: lineNumber })
  }

  return nodes
}

function findMatchingClose(line: string, start: number): number {
  let depth = 0
  for (let i = start; i < line.length; i++) {
    const ch = line[i]
    if (ch === "{") {
      depth++
    } else if (ch === "}") {
      if (depth === 0) return i
      depth--
    }
  }
  return -1
}

function parseExpressionWithPipe(raw: string): {
  expression: string
  formatter?: string
  formatterArgs?: string[]
} {
  const pipeIndex = findPipeOperator(raw)
  if (pipeIndex === -1) {
    return { expression: raw }
  }

  const expression = raw.slice(0, pipeIndex).trim()
  const formatterPart = raw.slice(pipeIndex + 1).trim()

  const parts = splitFormatterArgs(formatterPart)
  const formatter = parts[0]
  const formatterArgs = parts.slice(1)

  return { expression, formatter, formatterArgs: formatterArgs.length > 0 ? formatterArgs : undefined }
}

function findPipeOperator(raw: string): number {
  let inString = false
  let stringChar = ""
  let depth = 0

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]

    if (inString) {
      if (ch === "\\" && i + 1 < raw.length) {
        i++
        continue
      }
      if (ch === stringChar) inString = false
      continue
    }

    if (ch === '"' || ch === "'") {
      inString = true
      stringChar = ch
      continue
    }

    if (ch === "(") { depth++; continue }
    if (ch === ")") { depth--; continue }

    if (ch === "|" && raw[i + 1] !== "|" && (i === 0 || raw[i - 1] !== "|") && depth === 0) {
      return i
    }
  }

  return -1
}

function splitFormatterArgs(formatterPart: string): string[] {
  const parts: string[] = []
  let current = ""
  let inString = false
  let stringChar = ""

  for (let i = 0; i < formatterPart.length; i++) {
    const ch = formatterPart[i] as string

    if (inString) {
      if (ch === stringChar) {
        inString = false
        continue
      }
      current += ch
      continue
    }

    if (ch === '"' || ch === "'") {
      inString = true
      stringChar = ch
      continue
    }

    if (/\s/.test(ch)) {
      if (current) {
        parts.push(current)
        current = ""
      }
      continue
    }

    current += ch
  }

  if (current) parts.push(current)
  return parts
}

export function evaluateTemplate(
  nodes: TemplateNode[],
  scope: ExpressionScope
): { rendered: string; warnings: TemplateIssue[] } {
  const warnings: TemplateIssue[] = []
  let rendered = ""

  for (const node of nodes) {
    if (node.type === "text") {
      rendered += node.value
      continue
    }

    try {
      const wrappedExpr = `\${${node.expression}}`
      let value = evaluateExpression(wrappedExpr, scope)

      if (node.formatter) {
        const fmt = getFormatter(node.formatter)
        if (!fmt) {
          warnings.push({
            line: node.line,
            message: `Unknown formatter '${node.formatter}'`,
            severity: "warning"
          })
          rendered += stringifyValue(value)
          continue
        }
        rendered += fmt(value, ...(node.formatterArgs ?? []))
      } else {
        rendered += stringifyValue(value)
      }
    } catch (error) {
      warnings.push({
        line: node.line,
        message: `Expression evaluation failed: ${node.expression} — ${error instanceof Error ? error.message : String(error)}`,
        severity: "warning"
      })
      rendered += ""
    }
  }

  return { rendered, warnings }
}
