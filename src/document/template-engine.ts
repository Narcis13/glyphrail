import { evaluateExpression, type ExpressionScope } from "../core/expression-engine"
import { createFailure, EXIT_CODES } from "../core/errors"
import type { TemplateNode, InterpolationNode, TextNode, EachBlockNode, IfBlockNode, TemplateIssue } from "./contracts"
import { getFormatter, stringifyValue } from "./formatters"

interface ParseContext {
  lines: string[]
  index: number
}

export function parseTemplate(body: string): TemplateNode[] {
  const lines = body.split("\n")
  const ctx: ParseContext = { lines, index: 0 }
  return parseNodes(ctx, null)
}

function parseNodes(ctx: ParseContext, endDirective: "each" | "if" | null): TemplateNode[] {
  const nodes: TemplateNode[] = []
  let hasContent = false

  while (ctx.index < ctx.lines.length) {
    const line = ctx.lines[ctx.index] as string
    const trimmed = line.trim()
    const lineNumber = ctx.index + 1

    if (endDirective === "each" && trimmed === "{{/each}}") {
      ctx.index++
      return nodes
    }
    if (endDirective === "if" && trimmed === "{{/if}}") {
      ctx.index++
      return nodes
    }

    if (endDirective === "if" && trimmed === "{{#else}}") {
      return nodes
    }

    const eachMatch = trimmed.match(/^\{\{#each\s+(.+?)\s+as\s+(\w+)\}\}$/)
    if (eachMatch) {
      if (hasContent) {
        nodes.push({ type: "text", value: "\n", line: lineNumber })
      }
      const openLine = lineNumber
      ctx.index++
      const bodyNodes = parseNodes(ctx, "each")
      nodes.push({
        type: "each",
        itemsExpression: eachMatch[1] as string,
        binding: eachMatch[2] as string,
        body: bodyNodes,
        line: openLine
      })
      hasContent = true
      continue
    }

    const ifMatch = trimmed.match(/^\{\{#if\s+(.+?)\}\}$/)
    if (ifMatch) {
      if (hasContent) {
        nodes.push({ type: "text", value: "\n", line: lineNumber })
      }
      const openLine = lineNumber
      ctx.index++
      const thenBody = parseNodes(ctx, "if")

      let elseBody: TemplateNode[] | undefined
      if (ctx.index < ctx.lines.length) {
        const nextTrimmed = (ctx.lines[ctx.index] as string).trim()
        if (nextTrimmed === "{{#else}}") {
          ctx.index++
          elseBody = parseNodes(ctx, "if")
        }
      }

      nodes.push({
        type: "if",
        condition: ifMatch[1] as string,
        thenBody,
        elseBody,
        line: openLine
      })
      hasContent = true
      continue
    }

    if (hasContent) {
      nodes.push({ type: "text", value: "\n", line: lineNumber })
    }
    const lineNodes = parseLineInterpolations(line, lineNumber)
    nodes.push(...lineNodes)
    hasContent = true
    ctx.index++
  }

  if (endDirective) {
    throw createFailure(
      "TEMPLATE_PARSE_ERROR",
      `Unterminated {{#${endDirective}}} block`,
      EXIT_CODES.workflowValidationFailure
    )
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

    if (node.type === "each") {
      rendered += evaluateEachBlock(node, scope, warnings)
      continue
    }

    if (node.type === "if") {
      rendered += evaluateIfBlock(node, scope, warnings)
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

function evaluateEachBlock(
  node: EachBlockNode,
  scope: ExpressionScope,
  warnings: TemplateIssue[]
): string {
  try {
    const wrappedExpr = `\${${node.itemsExpression}}`
    const items = evaluateExpression(wrappedExpr, scope)

    if (!Array.isArray(items)) {
      warnings.push({
        line: node.line,
        message: `each block expression '${node.itemsExpression}' did not evaluate to an array`,
        severity: "warning"
      })
      return ""
    }

    const parts: string[] = []
    for (const item of items) {
      const childScope = { ...scope, [node.binding]: item }
      const { rendered, warnings: childWarnings } = evaluateTemplate(node.body, childScope)
      warnings.push(...childWarnings)
      parts.push(rendered)
    }

    return parts.join("\n")
  } catch (error) {
    warnings.push({
      line: node.line,
      message: `each block expression failed: ${node.itemsExpression} — ${error instanceof Error ? error.message : String(error)}`,
      severity: "warning"
    })
    return ""
  }
}

function evaluateIfBlock(
  node: IfBlockNode,
  scope: ExpressionScope,
  warnings: TemplateIssue[]
): string {
  try {
    const wrappedExpr = `\${${node.condition}}`
    const condition = evaluateExpression(wrappedExpr, scope)

    const body = condition ? node.thenBody : node.elseBody
    if (!body || body.length === 0) return ""

    const { rendered, warnings: childWarnings } = evaluateTemplate(body, scope)
    warnings.push(...childWarnings)
    return rendered
  } catch (error) {
    warnings.push({
      line: node.line,
      message: `if block condition failed: ${node.condition} — ${error instanceof Error ? error.message : String(error)}`,
      severity: "warning"
    })
    return ""
  }
}
