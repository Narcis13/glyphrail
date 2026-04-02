import { createFailure, exitCodeForErrorCode } from "./errors";
import { evaluateExpression, type ExpressionScope } from "./expression-engine";
import type { WorkflowDocument } from "./ast";
import type { JsonObject, JsonValue } from "./json-schema";

export interface RuntimeNamespaces {
  input: JsonValue;
  state: JsonObject;
  context: JsonObject;
  system: JsonObject;
}

export interface StepExecutionContext {
  item?: JsonValue;
  branch?: JsonObject;
  context?: JsonObject;
}

export interface StateMutationResult {
  path: string;
  value: JsonValue;
}

export function createRuntimeNamespaces(
  workflow: WorkflowDocument,
  input: JsonValue,
  params: {
    runId: string;
    workflowFile: string;
    startedAt: string;
  }
): RuntimeNamespaces {
  return {
    input,
    state: cloneJsonObject((workflow.state ?? {}) as JsonObject),
    context: {
      runId: params.runId,
      workflow: {
        name: workflow.name,
        version: workflow.version
      }
    },
    system: {
      runId: params.runId,
      workflowFile: params.workflowFile,
      startedAt: params.startedAt
    }
  };
}

export function evaluateRuntimeValue(
  value: unknown,
  runtime: RuntimeNamespaces,
  stepContext: StepExecutionContext = {}
): JsonValue {
  return normalizeResolvedValue(resolveRuntimeValue(value, runtime, stepContext));
}

export function buildExpressionScope(
  runtime: RuntimeNamespaces,
  stepContext: StepExecutionContext = {}
): ExpressionScope {
  return {
    input: runtime.input as Record<string, unknown>,
    state: runtime.state,
    env: process.env,
    context: {
      ...runtime.context,
      ...(stepContext.context ?? {})
    },
    item: stepContext.item,
    branch: stepContext.branch
  };
}

export function setStateValue(
  state: JsonObject,
  path: string,
  value: JsonValue
): StateMutationResult {
  assignAtPath(state, path, value);
  return {
    path,
    value: normalizeResolvedValue(value)
  };
}

export function appendStateValue(
  state: JsonObject,
  path: string,
  value: JsonValue
): StateMutationResult {
  const target = ensureContainerPath(state, path, "array");
  target.parent[target.key] = [...target.current, normalizeResolvedValue(value)];

  return {
    path,
    value: normalizeResolvedValue(target.parent[target.key])
  };
}

export function mergeStateValue(
  state: JsonObject,
  path: string,
  value: JsonValue
): StateMutationResult {
  if (!isJsonObject(value)) {
    throw createFailure(
      "EXPRESSION_EVALUATION_ERROR",
      `merge target '${path}' requires an object value.`,
      exitCodeForErrorCode("EXPRESSION_EVALUATION_ERROR")
    );
  }

  const target = ensureContainerPath(state, path, "object");
  target.parent[target.key] = mergeJsonObjects(target.current, value);

  return {
    path,
    value: normalizeResolvedValue(target.parent[target.key])
  };
}

export function getStateSnapshot(state: JsonObject): JsonObject {
  return cloneJsonObject(state);
}

export function cloneJsonValue<T extends JsonValue>(value: T): T {
  return structuredClone(value);
}

function resolveRuntimeValue(
  value: unknown,
  runtime: RuntimeNamespaces,
  stepContext: StepExecutionContext
): unknown {
  if (typeof value === "string") {
    return value.trim().startsWith("${") && value.trim().endsWith("}")
      ? evaluateExpression(value, buildExpressionScope(runtime, stepContext))
      : value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => resolveRuntimeValue(entry, runtime, stepContext));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [
        key,
        resolveRuntimeValue(entryValue, runtime, stepContext)
      ])
    );
  }

  return value;
}

function assignAtPath(target: JsonObject, path: string, value: JsonValue): void {
  const segments = toPathSegments(path);
  let current: JsonObject = target;

  for (const segment of segments.slice(0, -1)) {
    const nextValue = current[segment];
    if (!isJsonObject(nextValue)) {
      current[segment] = {};
    }
    current = current[segment] as JsonObject;
  }

  current[segments[segments.length - 1] as string] = normalizeResolvedValue(value);
}

function ensureContainerPath(
  target: JsonObject,
  path: string,
  expectedType: "array" | "object"
): {
  parent: JsonObject;
  key: string;
  current: JsonValue[] | JsonObject;
} {
  const segments = toPathSegments(path);
  let current: JsonObject = target;

  for (const segment of segments.slice(0, -1)) {
    const nextValue = current[segment];
    if (!isJsonObject(nextValue)) {
      current[segment] = {};
    }
    current = current[segment] as JsonObject;
  }

  const key = segments[segments.length - 1] as string;
  const existingValue = current[key];

  if (existingValue === undefined || existingValue === null) {
    current[key] = expectedType === "array" ? [] : {};
  }

  if (expectedType === "array" && !Array.isArray(current[key])) {
    throw createFailure(
      "EXPRESSION_EVALUATION_ERROR",
      `State path '${path}' must be an array for append.`,
      exitCodeForErrorCode("EXPRESSION_EVALUATION_ERROR")
    );
  }

  if (expectedType === "object" && !isJsonObject(current[key])) {
    throw createFailure(
      "EXPRESSION_EVALUATION_ERROR",
      `State path '${path}' must be an object for merge.`,
      exitCodeForErrorCode("EXPRESSION_EVALUATION_ERROR")
    );
  }

  return {
    parent: current,
    key,
    current: current[key] as JsonValue[] | JsonObject
  };
}

function mergeJsonObjects(base: JsonObject, patch: JsonObject): JsonObject {
  const result = cloneJsonObject(base);

  for (const [key, value] of Object.entries(patch)) {
    if (isJsonObject(value) && isJsonObject(result[key])) {
      result[key] = mergeJsonObjects(result[key] as JsonObject, value);
      continue;
    }

    result[key] = normalizeResolvedValue(value);
  }

  return result;
}

function toPathSegments(path: string): string[] {
  const segments = path
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    throw createFailure(
      "EXPRESSION_EVALUATION_ERROR",
      "State path must not be empty.",
      exitCodeForErrorCode("EXPRESSION_EVALUATION_ERROR")
    );
  }

  return segments;
}

function normalizeResolvedValue(value: unknown): JsonValue {
  if (value === undefined) {
    return null;
  }

  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeResolvedValue(entry));
  }

  if (isJsonObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [key, normalizeResolvedValue(entryValue)])
    );
  }

  throw createFailure(
    "EXPRESSION_EVALUATION_ERROR",
    `Resolved value is not JSON-compatible: ${typeof value}`,
    exitCodeForErrorCode("EXPRESSION_EVALUATION_ERROR")
  );
}

function cloneJsonObject(value: JsonObject): JsonObject {
  return structuredClone(value);
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
