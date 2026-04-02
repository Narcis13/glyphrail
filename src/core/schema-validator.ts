import { isDeepStrictEqual } from "node:util";

import { createFailure, exitCodeForErrorCode } from "./errors";
import type { JsonObject, JsonSchema, JsonValue } from "./json-schema";

export interface SchemaValidationIssue {
  path: string;
  message: string;
}

const SUPPORTED_SCHEMA_KEYS = new Set([
  "$schema",
  "title",
  "description",
  "type",
  "properties",
  "items",
  "required",
  "enum",
  "const",
  "default",
  "additionalProperties",
  "minItems",
  "maxItems",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "oneOf",
  "anyOf"
]);

interface ValidationContext {
  errorCode: string;
  subject: string;
}

export function validateSchemaDefinition(schema: unknown): SchemaValidationIssue[] {
  const issues: SchemaValidationIssue[] = [];
  collectSchemaDefinitionIssues(schema, "$", issues);
  return issues;
}

export function assertJsonSchema(
  value: unknown,
  schema: JsonSchema,
  context: ValidationContext
): asserts value is JsonValue {
  const issues = validateJsonSchema(value, schema);
  if (issues.length === 0) {
    return;
  }

  throw createFailure(
    context.errorCode,
    `${context.subject} failed schema validation.`,
    exitCodeForErrorCode(context.errorCode),
    { issues }
  );
}

export function validateJsonSchema(value: unknown, schema: JsonSchema): SchemaValidationIssue[] {
  const issues: SchemaValidationIssue[] = [];
  collectSchemaIssues(value, schema, "$", issues);
  return issues;
}

function collectSchemaIssues(
  value: unknown,
  schema: JsonSchema,
  path: string,
  issues: SchemaValidationIssue[]
): void {
  collectUnsupportedKeywordIssues(schema, path, issues);

  if (schema.const !== undefined && !isDeepStrictEqual(value, schema.const)) {
    issues.push({
      path,
      message: `Expected constant value ${JSON.stringify(schema.const)}.`
    });
    return;
  }

  if (schema.enum && !schema.enum.some((entry) => isDeepStrictEqual(entry, value))) {
    issues.push({
      path,
      message: `Value must be one of ${schema.enum.map((entry) => JSON.stringify(entry)).join(", ")}.`
    });
    return;
  }

  if (schema.oneOf) {
    const matchCount = schema.oneOf.filter((candidate) => validateJsonSchema(value, candidate).length === 0).length;
    if (matchCount !== 1) {
      issues.push({
        path,
        message: `Value must match exactly one schema in oneOf, matched ${matchCount}.`
      });
    }
    return;
  }

  if (schema.anyOf) {
    const matchesAny = schema.anyOf.some((candidate) => validateJsonSchema(value, candidate).length === 0);
    if (!matchesAny) {
      issues.push({
        path,
        message: "Value must match at least one schema in anyOf."
      });
    }
    return;
  }

  if (!schema.type) {
    return;
  }

  switch (schema.type) {
    case "null":
      if (value !== null) {
        issues.push({ path, message: "Expected null." });
      }
      return;
    case "boolean":
      if (typeof value !== "boolean") {
        issues.push({ path, message: "Expected boolean." });
      }
      return;
    case "string":
      validateString(value, schema, path, issues);
      return;
    case "number":
      validateNumber(value, schema, path, issues, false);
      return;
    case "integer":
      validateNumber(value, schema, path, issues, true);
      return;
    case "array":
      validateArray(value, schema, path, issues);
      return;
    case "object":
      validateObject(value, schema, path, issues);
      return;
  }
}

function collectSchemaDefinitionIssues(
  schema: unknown,
  path: string,
  issues: SchemaValidationIssue[]
): void {
  if (!isJsonSchema(schema)) {
    issues.push({
      path,
      message: "Schema must be an object."
    });
    return;
  }

  collectUnsupportedKeywordIssues(schema, path, issues);

  if (schema.properties !== undefined) {
    if (!isJsonObject(schema.properties)) {
      issues.push({
        path: `${path}.properties`,
        message: "properties must be an object."
      });
    } else {
      for (const [key, propertySchema] of Object.entries(schema.properties)) {
        collectSchemaDefinitionIssues(propertySchema, `${path}.properties.${key}`, issues);
      }
    }
  }

  if (schema.items !== undefined) {
    collectSchemaDefinitionIssues(schema.items, `${path}.items`, issues);
  }

  if (schema.additionalProperties !== undefined && schema.additionalProperties !== false && schema.additionalProperties !== true) {
    collectSchemaDefinitionIssues(schema.additionalProperties, `${path}.additionalProperties`, issues);
  }

  if (schema.oneOf !== undefined) {
    if (!Array.isArray(schema.oneOf)) {
      issues.push({
        path: `${path}.oneOf`,
        message: "oneOf must be an array."
      });
    } else {
      for (const [index, candidate] of schema.oneOf.entries()) {
        collectSchemaDefinitionIssues(candidate, `${path}.oneOf[${index}]`, issues);
      }
    }
  }

  if (schema.anyOf !== undefined) {
    if (!Array.isArray(schema.anyOf)) {
      issues.push({
        path: `${path}.anyOf`,
        message: "anyOf must be an array."
      });
    } else {
      for (const [index, candidate] of schema.anyOf.entries()) {
        collectSchemaDefinitionIssues(candidate, `${path}.anyOf[${index}]`, issues);
      }
    }
  }
}

function collectUnsupportedKeywordIssues(schema: JsonSchema, path: string, issues: SchemaValidationIssue[]): void {
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED_SCHEMA_KEYS.has(key)) {
      issues.push({
        path: `${path}.${key}`,
        message: `Unsupported schema keyword '${key}'.`
      });
    }
  }
}

function validateString(
  value: unknown,
  schema: JsonSchema,
  path: string,
  issues: SchemaValidationIssue[]
): void {
  if (typeof value !== "string") {
    issues.push({ path, message: "Expected string." });
    return;
  }

  if (schema.minLength !== undefined && value.length < schema.minLength) {
    issues.push({ path, message: `Expected string length >= ${schema.minLength}.` });
  }

  if (schema.maxLength !== undefined && value.length > schema.maxLength) {
    issues.push({ path, message: `Expected string length <= ${schema.maxLength}.` });
  }
}

function validateNumber(
  value: unknown,
  schema: JsonSchema,
  path: string,
  issues: SchemaValidationIssue[],
  integerOnly: boolean
): void {
  if (typeof value !== "number" || Number.isNaN(value)) {
    issues.push({ path, message: `Expected ${integerOnly ? "integer" : "number"}.` });
    return;
  }

  if (integerOnly && !Number.isInteger(value)) {
    issues.push({ path, message: "Expected integer." });
  }

  if (schema.minimum !== undefined && value < schema.minimum) {
    issues.push({ path, message: `Expected number >= ${schema.minimum}.` });
  }

  if (schema.maximum !== undefined && value > schema.maximum) {
    issues.push({ path, message: `Expected number <= ${schema.maximum}.` });
  }
}

function validateArray(
  value: unknown,
  schema: JsonSchema,
  path: string,
  issues: SchemaValidationIssue[]
): void {
  if (!Array.isArray(value)) {
    issues.push({ path, message: "Expected array." });
    return;
  }

  if (schema.minItems !== undefined && value.length < schema.minItems) {
    issues.push({ path, message: `Expected array length >= ${schema.minItems}.` });
  }

  if (schema.maxItems !== undefined && value.length > schema.maxItems) {
    issues.push({ path, message: `Expected array length <= ${schema.maxItems}.` });
  }

  if (schema.items) {
    for (const [index, item] of value.entries()) {
      collectSchemaIssues(item, schema.items, `${path}[${index}]`, issues);
    }
  }
}

function validateObject(
  value: unknown,
  schema: JsonSchema,
  path: string,
  issues: SchemaValidationIssue[]
): void {
  if (!isJsonObject(value)) {
    issues.push({ path, message: "Expected object." });
    return;
  }

  const requiredProperties = new Set(schema.required ?? []);
  for (const key of requiredProperties) {
    if (!(key in value)) {
      issues.push({
        path: `${path}.${key}`,
        message: "Missing required property."
      });
    }
  }

  const declaredProperties = schema.properties ?? {};
  for (const [key, propertySchema] of Object.entries(declaredProperties)) {
    if (key in value) {
      collectSchemaIssues(value[key], propertySchema, `${path}.${key}`, issues);
    }
  }

  for (const [key, propertyValue] of Object.entries(value)) {
    if (key in declaredProperties) {
      continue;
    }

    if (schema.additionalProperties === false) {
      issues.push({
        path: `${path}.${key}`,
        message: "Unexpected property."
      });
      continue;
    }

    if (isJsonSchema(schema.additionalProperties)) {
      collectSchemaIssues(propertyValue, schema.additionalProperties, `${path}.${key}`, issues);
    }
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isJsonSchema(value: boolean | JsonSchema | undefined): value is JsonSchema {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
