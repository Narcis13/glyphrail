import { createFailure, EXIT_CODES } from "../../core/errors";
import { SCHEMA_CATALOG, SCHEMA_DOCUMENTS } from "../../core/schema-documents";
import { stringifyJson } from "../../util/json";
import type { CommandDefinition } from "../types";

export const schemaCommand: CommandDefinition = {
  path: ["schema"],
  summary: "Print documented workflow, runtime, and contract schemas.",
  description: "Expose the static machine-readable schemas defined for the MVP contracts.",
  usage: "glyphrail schema [schema-name] [--json]",
  examples: ["glyphrail schema", "glyphrail schema workflow --json"],
  async handler(_context, args) {
    if (args.positionals.length > 1) {
      throw createFailure(
        "CLI_USAGE_ERROR",
        "schema accepts at most one schema name.",
        EXIT_CODES.invalidCliUsage
      );
    }

    const schemaName = args.positionals[0];
    if (!schemaName) {
      return {
        data: {
          schemaNames: SCHEMA_CATALOG.map((entry) => entry.name),
          schemas: SCHEMA_DOCUMENTS
        },
        human: [
          "Available schemas:",
          ...SCHEMA_CATALOG.map((entry) => `  ${entry.name}: ${entry.description}`)
        ].join("\n")
      };
    }

    const entry = SCHEMA_CATALOG.find((item) => item.name === schemaName);
    if (!entry) {
      throw createFailure(
        "NOT_FOUND",
        `Unknown schema: ${schemaName}`,
        EXIT_CODES.notFound
      );
    }

    return {
      data: {
        schemaName: entry.name,
        schema: entry.schema
      },
      human: `${entry.title}\n\n${stringifyJson(entry.schema)}`
    };
  }
};
