import type { GlyphrailError } from "../core/errors";
import type { JsonSchema } from "../core/json-schema";

export type ToolCategoryTag = "io" | "http" | "file" | "compute" | "ai" | "db" | "unsafe";
export type ToolSideEffect = "none" | "read" | "write" | "external";

export interface ToolMeta {
  durationMs?: number;
  tags?: ToolCategoryTag[];
  [key: string]: unknown;
}

export interface ToolContext {
  cwd: string;
  projectRoot?: string;
  env: Record<string, string | undefined>;
  runId?: string;
  stepId?: string;
  signal?: AbortSignal;
}

export type ToolResult<T> =
  | { ok: true; output: T; meta?: ToolMeta }
  | { ok: false; error: GlyphrailError; meta?: ToolMeta };

export type Tool<Input = unknown, Output = unknown> = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  sideEffect: ToolSideEffect;
  timeoutMs?: number;
  tags?: ToolCategoryTag[];
  execute: (input: Input, ctx: ToolContext) => Promise<ToolResult<Output>>;
};

export type ToolRegistry = readonly Tool[];

export function defineTools<const TTools extends ToolRegistry>(tools: TTools): TTools {
  return tools;
}
