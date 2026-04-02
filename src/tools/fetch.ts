import type { JsonValue } from "../core/json-schema";
import { createFailure, exitCodeForErrorCode } from "../core/errors";
import type { Tool } from "./contracts";
import { createLinkedAbortController, toolRuntimeFailure, toolTimeoutFailure } from "./builtin-shared";

export async function parseFetchResponseBody(
  response: Response,
  responseType: "json" | "text" | "base64"
): Promise<JsonValue | string> {
  if (responseType === "json") {
    try {
      return await response.json();
    } catch (error) {
      throw toolRuntimeFailure(
        "fetch expected a JSON response body but could not parse it.",
        error instanceof Error ? error.message : error
      );
    }
  }

  if (responseType === "text") {
    return await response.text();
  }

  const buffer = await response.arrayBuffer();
  return Buffer.from(buffer).toString("base64");
}

async function executeFetchTool(
  input: {
    url: string;
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
    headers?: Record<string, string>;
    query?: Record<string, string>;
    body?: JsonValue;
    timeoutMs?: number;
    responseType?: "json" | "text" | "base64";
  },
  context: {
    signal?: AbortSignal;
  }
) {
  const linkedAbort = createLinkedAbortController(context.signal, input.timeoutMs);
  const requestUrl = new URL(input.url);
  const method = input.method ?? "GET";

  for (const [key, value] of Object.entries(input.query ?? {})) {
    requestUrl.searchParams.set(key, value);
  }

  const headers = new Headers(input.headers);
  const requestInit: RequestInit = {
    method,
    headers,
    signal: linkedAbort.controller.signal
  };

  if (input.body !== undefined) {
    if (typeof input.body === "string") {
      requestInit.body = input.body;
    } else {
      if (!headers.has("content-type")) {
        headers.set("content-type", "application/json");
      }
      requestInit.body = JSON.stringify(input.body);
    }
  }

  try {
    const response = await fetch(requestUrl, requestInit);
    const contentType = response.headers.get("content-type") ?? "";
    const responseType =
      input.responseType ?? (contentType.includes("application/json") ? "json" : "text");
    const body = await parseFetchResponseBody(response, responseType);

    return {
      ok: true as const,
      output: {
        url: requestUrl.toString(),
        status: response.status,
        ok: response.ok,
        headers: Object.fromEntries(response.headers.entries()),
        body,
        responseType
      }
    };
  } catch (error) {
    if (linkedAbort.didTimeout()) {
      throw toolTimeoutFailure("fetch", input.timeoutMs as number);
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw toolTimeoutFailure("fetch", input.timeoutMs ?? 0);
    }

    if (error instanceof Error && "glyphrailError" in error) {
      throw error;
    }

    throw createFailure(
      "TOOL_RUNTIME_ERROR",
      "fetch request failed.",
      exitCodeForErrorCode("TOOL_RUNTIME_ERROR"),
      error instanceof Error ? error.message : error
    );
  } finally {
    linkedAbort.cleanup();
  }
}

export const fetchTool: Tool<
  {
    url: string;
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
    headers?: Record<string, string>;
    query?: Record<string, string>;
    body?: JsonValue;
    timeoutMs?: number;
    responseType?: "json" | "text" | "base64";
  },
  {
    url: string;
    status: number;
    ok: boolean;
    headers: Record<string, string>;
    body: JsonValue | string;
    responseType: "json" | "text" | "base64";
  }
> = {
  name: "fetch",
  description: "Call an HTTP endpoint with structured request and response handling.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", minLength: 1 },
      method: {
        type: "string",
        enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]
      },
      headers: {
        type: "object",
        additionalProperties: {
          type: "string"
        }
      },
      query: {
        type: "object",
        additionalProperties: {
          type: "string"
        }
      },
      body: {},
      timeoutMs: { type: "integer", minimum: 0 },
      responseType: {
        type: "string",
        enum: ["json", "text", "base64"]
      }
    },
    required: ["url"],
    additionalProperties: false
  },
  outputSchema: {
    type: "object",
    properties: {
      url: { type: "string" },
      status: { type: "integer" },
      ok: { type: "boolean" },
      headers: {
        type: "object",
        additionalProperties: {
          type: "string"
        }
      },
      body: {},
      responseType: {
        type: "string",
        enum: ["json", "text", "base64"]
      }
    },
    required: ["url", "status", "ok", "headers", "body", "responseType"],
    additionalProperties: false
  },
  sideEffect: "external",
  tags: ["http", "unsafe"],
  execute: executeFetchTool
};
