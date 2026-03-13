import type { GlyphrailError } from "../core/errors";
import type { JsonSchema, JsonValue } from "../core/json-schema";
import type { Tool } from "../tools/contracts";

export interface StructuredAgentRequest {
  runId?: string;
  stepId?: string;
  provider: string;
  model: string;
  objective: string;
  instructions?: string;
  input?: JsonValue;
  outputSchema?: JsonSchema;
  timeoutMs?: number;
  prompt: string;
  attempt: number;
  meta?: Record<string, unknown>;
}

export type StructuredAgentResult =
  | {
      ok: true;
      output: JsonValue;
      rawOutput?: string;
      meta?: Record<string, unknown>;
    }
  | {
      ok: false;
      error: GlyphrailError;
      rawOutput?: string;
      meta?: Record<string, unknown>;
    };

export interface ToolUseAgentRequest extends StructuredAgentRequest {
  availableTools: Tool[];
  maxToolCalls: number;
}

export type ToolUseAgentResult = StructuredAgentResult & {
  toolCalls?: Array<{
    name: string;
    input: JsonValue;
    output?: JsonValue;
    ok: boolean;
  }>;
};

export interface AgentAdapter {
  name: string;
  runStructured(request: StructuredAgentRequest): Promise<StructuredAgentResult>;
  runToolUse?(request: ToolUseAgentRequest): Promise<ToolUseAgentResult>;
}
