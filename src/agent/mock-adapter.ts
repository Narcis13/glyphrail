import type { GlyphrailError } from "../core/errors";
import type { JsonObject, JsonValue } from "../core/json-schema";
import type { AgentAdapter, StructuredAgentRequest, StructuredAgentResult } from "./contracts";

interface MockResponseEnvelope {
  output?: JsonValue;
  rawOutput?: string;
  error?: Partial<GlyphrailError> & {
    code?: string;
    message?: string;
  };
  meta?: Record<string, unknown>;
}

export const mockAgentAdapter: AgentAdapter = {
  name: "mock",
  async runStructured(request: StructuredAgentRequest): Promise<StructuredAgentResult> {
    const selectedResponse = selectMockResponse(request.meta, request.attempt);

    if (selectedResponse === undefined) {
      return {
        ok: false,
        error: {
          code: "AGENT_RUNTIME_ERROR",
          message: `Mock adapter requires meta.mockResponse or meta.mockResponses for step '${request.stepId ?? "unknown"}'.`
        },
        meta: {
          adapter: "mock"
        }
      };
    }

    const response = normalizeMockResponse(selectedResponse);
    const responseMeta = {
      adapter: "mock",
      attempt: request.attempt,
      ...(response.meta ?? {})
    };

    if (response.error) {
      return {
        ok: false,
        error: normalizeMockError(response.error),
        rawOutput: response.rawOutput,
        meta: responseMeta
      };
    }

    if (response.output !== undefined) {
      return {
        ok: true,
        output: structuredClone(response.output),
        rawOutput: response.rawOutput,
        meta: responseMeta
      };
    }

    if (response.rawOutput !== undefined) {
      try {
        return {
          ok: true,
          output: normalizeParsedJson(JSON.parse(response.rawOutput)),
          rawOutput: response.rawOutput,
          meta: responseMeta
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "AGENT_OUTPUT_PARSE_ERROR",
            message: "Mock agent returned output that is not valid JSON.",
            details: {
              parseError: error instanceof Error ? error.message : String(error)
            }
          },
          rawOutput: response.rawOutput,
          meta: responseMeta
        };
      }
    }

    return {
      ok: false,
      error: {
        code: "AGENT_RUNTIME_ERROR",
        message: "Mock response must provide output, rawOutput, or error."
      },
      meta: responseMeta
    };
  }
};

function selectMockResponse(
  meta: Record<string, unknown> | undefined,
  attempt: number
): unknown {
  const scriptedResponses = meta?.mockResponses;
  if (Array.isArray(scriptedResponses) && scriptedResponses.length > 0) {
    return scriptedResponses[Math.min(Math.max(attempt - 1, 0), scriptedResponses.length - 1)];
  }

  return meta?.mockResponse;
}

function normalizeMockResponse(value: unknown): MockResponseEnvelope {
  if (typeof value === "string") {
    return {
      rawOutput: value
    };
  }

  if (Array.isArray(value) || isJsonPrimitive(value)) {
    return {
      output: value as JsonValue
    };
  }

  if (isJsonObject(value) && !isMockResponseEnvelope(value)) {
    return {
      output: value
    };
  }

  if (isMockResponseEnvelope(value)) {
    return {
      output: value.output,
      rawOutput: typeof value.rawOutput === "string" ? value.rawOutput : undefined,
      error: isJsonObject(value.error) ? value.error : undefined,
      meta: isJsonObject(value.meta) ? value.meta : undefined
    };
  }

  return {};
}

function normalizeMockError(
  error: Partial<GlyphrailError> & {
    code?: string;
    message?: string;
  }
): GlyphrailError {
  return {
    code: error.code ?? "AGENT_RUNTIME_ERROR",
    message: error.message ?? "Mock agent returned an error.",
    details: error.details,
    retryable: error.retryable
  };
}

function normalizeParsedJson(value: unknown): JsonValue {
  if (isJsonPrimitive(value)) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeParsedJson(entry));
  }

  if (isJsonObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [key, normalizeParsedJson(entryValue)])
    );
  }

  throw new Error(`Mock adapter parsed a non-JSON value of type ${typeof value}.`);
}

function isMockResponseEnvelope(value: unknown): value is MockResponseEnvelope & JsonObject {
  if (!isJsonObject(value)) {
    return false;
  }

  return "output" in value || "rawOutput" in value || "error" in value || "meta" in value;
}

function isJsonPrimitive(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
