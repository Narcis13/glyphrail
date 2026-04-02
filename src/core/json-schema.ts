export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export interface JsonSchema {
  $schema?: string;
  title?: string;
  description?: string;
  type?: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: JsonValue[];
  const?: JsonValue;
  default?: JsonValue;
  additionalProperties?: boolean | JsonSchema;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
}

export const JSON_SCHEMA_TYPES = [
  "object",
  "array",
  "string",
  "number",
  "integer",
  "boolean",
  "null"
] as const;

export const JSON_SCHEMA_SUBSET_DEFINITION: Record<string, unknown> = {
  title: "GlyphrailJsonSchemaSubset",
  description: "Minimal JSON Schema subset supported by Glyphrail for workflow, tool, and agent contracts.",
  type: "object",
  properties: {
    $schema: { type: "string" },
    title: { type: "string" },
    description: { type: "string" },
    type: {
      enum: [...JSON_SCHEMA_TYPES]
    },
    properties: {
      type: "object",
      additionalProperties: {
        $ref: "#/$defs/jsonSchema"
      }
    },
    items: {
      $ref: "#/$defs/jsonSchema"
    },
    required: {
      type: "array",
      items: {
        type: "string"
      }
    },
    enum: {
      type: "array"
    },
    const: {},
    default: {},
    additionalProperties: {
      anyOf: [
        { type: "boolean" },
        {
          $ref: "#/$defs/jsonSchema"
        }
      ]
    },
    minItems: { type: "integer" },
    maxItems: { type: "integer" },
    minLength: { type: "integer" },
    maxLength: { type: "integer" },
    minimum: { type: "number" },
    maximum: { type: "number" },
    oneOf: {
      type: "array",
      items: {
        $ref: "#/$defs/jsonSchema"
      }
    },
    anyOf: {
      type: "array",
      items: {
        $ref: "#/$defs/jsonSchema"
      }
    }
  },
  additionalProperties: false
};

export const JSON_SCHEMA_SUBSET_DOCUMENT: Record<string, unknown> = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $ref: "#/$defs/jsonSchema",
  $defs: {
    jsonSchema: JSON_SCHEMA_SUBSET_DEFINITION
  }
};
