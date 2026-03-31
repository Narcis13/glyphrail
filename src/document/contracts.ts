import type { JsonValue } from "../core/json-schema"
import type { RunArtifactPaths, RunStatus } from "../core/run-record"

export interface TextNode {
  type: "text"
  value: string
  line: number
}

export interface InterpolationNode {
  type: "interpolation"
  expression: string
  formatter?: string
  formatterArgs?: string[]
  line: number
}

export interface EachBlockNode {
  type: "each"
  itemsExpression: string
  binding: string
  body: TemplateNode[]
  line: number
}

export interface IfBlockNode {
  type: "if"
  condition: string
  thenBody: TemplateNode[]
  elseBody?: TemplateNode[]
  line: number
}

export type TemplateNode = TextNode | InterpolationNode | EachBlockNode | IfBlockNode

export interface ParsedGrDocument {
  frontmatterRaw: string
  templateBody: string
  filePath: string
}

export interface DocumentRenderScope {
  input: JsonValue
  state: Record<string, unknown>
  output: Record<string, unknown>
  context: Record<string, unknown>
  env: Record<string, string | undefined>
}

export interface TemplateIssue {
  line: number
  message: string
  severity: "error" | "warning"
}

export interface DocumentRenderResult {
  runId: string
  status: RunStatus
  rendered: string
  output: JsonValue
  artifacts: RunArtifactPaths
  templateWarnings: TemplateIssue[]
}
