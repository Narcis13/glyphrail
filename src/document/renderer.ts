import { resolve, dirname } from "node:path"
import { readFileSync } from "node:fs"

import type { ResolvedProjectConfig } from "../config"
import { executeWorkflow, type ExecuteWorkflowResult } from "../core/execution-engine"
import type { JsonValue } from "../core/json-schema"
import type { JsonObject } from "../core/json-schema"
import type { WorkflowDocument } from "../core/ast"
import { getRunPaths, readRunMeta, readRunOutput, readRunState, toArtifactPaths, type RunPaths } from "../core/run-store"
import { readTextFile, writeTextFile } from "../util/fs"
import { parseYaml } from "../util/yaml"
import { validateWorkflowDocument, lintWorkflow } from "../dsl/validation"
import { resolveProjectPath } from "../config"
import { createFailure, EXIT_CODES } from "../core/errors"
import type { DocumentRenderResult, DocumentRenderScope, TemplateIssue, TemplateNode, BlockNode } from "./contracts"
import { parseGrDocument } from "./parser"
import { parseTemplate, evaluateTemplate, type EvaluateTemplateOptions } from "./template-engine"
import { loadCustomFormatters } from "./custom-formatters"

export interface RenderDocumentOptions {
  project: ResolvedProjectConfig
  filePath: string
  input: JsonValue
  maxRunSteps?: number
  maxRunDurationMs?: number
  checkpointEveryStep?: boolean
  dryRun?: boolean
}

export interface ReRenderFromRunOptions {
  project: ResolvedProjectConfig
  filePath: string
  runId: string
}

export interface RenderDocumentResult extends DocumentRenderResult {
  workflow: WorkflowDocument
  relativeFilePath: string
}

export async function renderDocument(options: RenderDocumentOptions): Promise<RenderDocumentResult> {
  const { project, filePath, input } = options

  await loadCustomFormatters(project)

  const content = await readTextFile(filePath)
  const doc = parseGrDocument(content, filePath)

  const rawWorkflow = parseYaml<unknown>(doc.frontmatterRaw, filePath)
  const validation = await validateWorkflowDocument(rawWorkflow, {
    toolsEntryPath: resolveProjectPath(project, project.config.toolsEntry)
  })

  if (!validation.workflow || validation.errors.length > 0) {
    throw createFailure(
      "DOCUMENT_PARSE_ERROR",
      `Workflow validation failed in document frontmatter: ${filePath}`,
      EXIT_CODES.workflowValidationFailure,
      { errors: validation.errors }
    )
  }

  const workflow = validation.workflow
  const relativeFilePath = filePath

  const templateNodes = parseTemplate(doc.templateBody)

  if (options.dryRun) {
    return {
      runId: "",
      status: "completed",
      rendered: "",
      output: {},
      artifacts: {
        meta: "",
        input: "",
        state: "",
        output: "",
        trace: "",
        checkpointsDir: ""
      },
      templateWarnings: [],
      workflow,
      relativeFilePath
    }
  }

  const result = await executeWorkflow({
    project,
    relativeWorkflowFile: relativeFilePath,
    workflow,
    input,
    maxRunSteps: options.maxRunSteps,
    maxRunDurationMs: options.maxRunDurationMs,
    checkpointEveryStep: options.checkpointEveryStep
  })

  const scope: DocumentRenderScope = {
    input,
    state: result.state,
    output: (result.output && typeof result.output === "object" && !Array.isArray(result.output)
      ? result.output
      : { value: result.output }) as Record<string, unknown>,
    context: {
      runId: result.runId,
      workflowName: workflow.name,
      startedAt: result.record.startedAt
    },
    env: process.env as Record<string, string | undefined>
  }

  const evalOptions: EvaluateTemplateOptions = { basePath: filePath }

  const { nodes: resolvedNodes, overrides } = resolveInheritance(doc.extends, templateNodes, filePath)
  if (overrides) {
    evalOptions.blockOverrides = overrides
  }

  const { rendered, warnings } = evaluateTemplate(resolvedNodes, scope, evalOptions)

  await persistDocumentArtifacts(result, content, rendered, project)

  return {
    runId: result.runId,
    status: result.status,
    rendered,
    output: result.output,
    artifacts: toArtifactPaths(result.artifacts, project),
    templateWarnings: warnings,
    workflow,
    relativeFilePath
  }
}

export async function reRenderFromRun(options: ReRenderFromRunOptions): Promise<RenderDocumentResult> {
  const { project, filePath, runId } = options

  await loadCustomFormatters(project)

  const paths = getRunPaths(project, runId)
  const meta = await readRunMeta(paths)
  const state = await readRunState(paths)
  const output = await readRunOutput(paths)

  let input: JsonValue = {}
  try {
    const { readJsonFile } = await import("../util/json")
    input = await readJsonFile<JsonValue>(paths.input, "NOT_FOUND")
  } catch {
    // input may not exist for all runs
  }

  const content = await readTextFile(filePath)
  const doc = parseGrDocument(content, filePath)

  const rawWorkflow = parseYaml<unknown>(doc.frontmatterRaw, filePath)
  const validation = await validateWorkflowDocument(rawWorkflow, {
    toolsEntryPath: resolveProjectPath(project, project.config.toolsEntry)
  })

  if (!validation.workflow || validation.errors.length > 0) {
    throw createFailure(
      "DOCUMENT_PARSE_ERROR",
      `Workflow validation failed in document frontmatter: ${filePath}`,
      EXIT_CODES.workflowValidationFailure,
      { errors: validation.errors }
    )
  }

  const workflow = validation.workflow

  const scope: DocumentRenderScope = {
    input,
    state,
    output: (output && typeof output === "object" && !Array.isArray(output)
      ? output
      : { value: output }) as Record<string, unknown>,
    context: {
      runId: meta.runId,
      workflowName: meta.workflow.name,
      startedAt: meta.startedAt
    },
    env: process.env as Record<string, string | undefined>
  }

  const templateNodes = parseTemplate(doc.templateBody)
  const evalOptions: EvaluateTemplateOptions = { basePath: filePath }

  const { nodes: resolvedNodes, overrides } = resolveInheritance(doc.extends, templateNodes, filePath)
  if (overrides) {
    evalOptions.blockOverrides = overrides
  }

  const { rendered, warnings } = evaluateTemplate(resolvedNodes, scope, evalOptions)

  return {
    runId: meta.runId,
    status: meta.status,
    rendered,
    output: output ?? {},
    artifacts: toArtifactPaths(paths, project),
    templateWarnings: warnings,
    workflow,
    relativeFilePath: filePath
  }
}

function collectBlockOverrides(nodes: TemplateNode[]): Map<string, TemplateNode[]> {
  const overrides = new Map<string, TemplateNode[]>()
  for (const node of nodes) {
    if (node.type === "block") {
      overrides.set(node.name, node.body)
    }
  }
  return overrides
}

function resolveInheritance(
  extendsPath: string | undefined,
  childNodes: TemplateNode[],
  childFilePath: string,
  chain: string[] = []
): { nodes: TemplateNode[]; overrides?: Map<string, TemplateNode[]> } {
  if (!extendsPath) {
    return { nodes: childNodes }
  }

  const resolvedParentPath = resolve(dirname(childFilePath), extendsPath)

  if (chain.includes(resolvedParentPath)) {
    throw createFailure(
      "DOCUMENT_PARSE_ERROR",
      `Circular template inheritance detected: ${extendsPath} (chain: ${chain.join(" -> ")})`,
      EXIT_CODES.workflowValidationFailure
    )
  }

  let parentContent: string
  try {
    parentContent = readFileSync(resolvedParentPath, "utf-8")
  } catch {
    throw createFailure(
      "DOCUMENT_PARSE_ERROR",
      `Parent template not found: ${extendsPath} (resolved to ${resolvedParentPath})`,
      EXIT_CODES.workflowValidationFailure
    )
  }

  const parentDoc = parseGrDocument(parentContent, resolvedParentPath)
  const parentNodes = parseTemplate(parentDoc.templateBody)

  // Collect block overrides from child
  const overrides = collectBlockOverrides(childNodes)

  // If parent also extends, recurse — merge overrides up the chain
  if (parentDoc.extends) {
    const parentResult = resolveInheritance(
      parentDoc.extends,
      parentNodes,
      resolvedParentPath,
      [...chain, resolvedParentPath]
    )
    // Child overrides take priority over grandparent defaults
    const mergedOverrides = parentResult.overrides
      ? new Map([...parentResult.overrides, ...overrides])
      : overrides
    return { nodes: parentResult.nodes, overrides: mergedOverrides }
  }

  return { nodes: parentNodes, overrides }
}

async function persistDocumentArtifacts(
  result: ExecuteWorkflowResult,
  sourceContent: string,
  rendered: string,
  project: ResolvedProjectConfig
): Promise<void> {
  const runDir = result.artifacts.runDir
  await writeTextFile(resolve(runDir, "rendered.md"), rendered)
  await writeTextFile(resolve(runDir, "source.gr.md"), sourceContent)
}
