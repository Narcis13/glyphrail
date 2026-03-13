import { resolve } from "node:path";

import type { CommandContext, ParsedCommandArgs } from "../types";
import { createFailure, EXIT_CODES } from "../../core/errors";
import type { JsonObject, JsonValue } from "../../core/json-schema";
import {
  getRunPaths,
  normalizeRunId,
  readRunMeta,
  readRunOutput,
  readRunState,
  readRunTrace,
  type RunPaths
} from "../../core/run-store";
import { readJsonFile } from "../../util/json";

export interface LoadedRunArtifacts {
  runId: string;
  paths: RunPaths;
  meta: Awaited<ReturnType<typeof readRunMeta>>;
}

export async function resolveRunInput(
  context: CommandContext,
  args: ParsedCommandArgs
): Promise<JsonValue> {
  const inputFile = args.flags.input as string | undefined;
  const inputJson = args.flags["input-json"] as string | undefined;
  const setFlags = (args.flags.set as string[] | undefined) ?? [];

  if (inputFile && inputJson) {
    throw createFailure(
      "CLI_USAGE_ERROR",
      "Use only one of --input or --input-json.",
      EXIT_CODES.invalidCliUsage
    );
  }

  let input: JsonValue = {};

  if (inputFile) {
    input = await readJsonFile<JsonValue>(resolve(context.cwd, inputFile), "INPUT_VALIDATION_ERROR");
  } else if (inputJson) {
    try {
      input = JSON.parse(inputJson) as JsonValue;
    } catch (error) {
      throw createFailure(
        "INPUT_VALIDATION_ERROR",
        "Failed to parse --input-json.",
        EXIT_CODES.inputValidationFailure,
        error instanceof Error ? error.message : error
      );
    }
  }

  if (setFlags.length === 0) {
    return input;
  }

  if (!isJsonObject(input)) {
    throw createFailure(
      "INPUT_VALIDATION_ERROR",
      "--set requires the effective input to be a JSON object.",
      EXIT_CODES.inputValidationFailure
    );
  }

  const nextInput = structuredClone(input);

  for (const setExpression of setFlags) {
    const separatorIndex = setExpression.indexOf("=");
    if (separatorIndex <= 0) {
      throw createFailure(
        "CLI_USAGE_ERROR",
        `Invalid --set value '${setExpression}'. Expected path=value.`,
        EXIT_CODES.invalidCliUsage
      );
    }

    const rawPath = setExpression.slice(0, separatorIndex).trim();
    const rawValue = setExpression.slice(separatorIndex + 1).trim();
    const path = rawPath.startsWith("input.") ? rawPath.slice("input.".length) : rawPath;

    assignInputPath(nextInput, path, parseCliValue(rawValue));
  }

  return nextInput;
}

export function parseOptionalIntegerFlag(
  args: ParsedCommandArgs,
  flagName: string
): number | undefined {
  const rawValue = args.flags[flagName];
  if (rawValue === undefined) {
    return undefined;
  }

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < 0) {
    throw createFailure(
      "CLI_USAGE_ERROR",
      `--${flagName} requires a non-negative integer.`,
      EXIT_CODES.invalidCliUsage
    );
  }

  return value;
}

export async function loadPersistedRun(
  context: CommandContext,
  args: ParsedCommandArgs,
  commandName: string
): Promise<LoadedRunArtifacts> {
  if (args.positionals.length !== 1) {
    throw createFailure(
      "CLI_USAGE_ERROR",
      `${commandName} requires exactly one run ID.`,
      EXIT_CODES.invalidCliUsage
    );
  }

  const project = await context.getProjectConfig();
  const runId = normalizeRunId(args.positionals[0]);
  const paths = getRunPaths(project, runId);

  try {
    const meta = await readRunMeta(paths);
    return {
      runId,
      paths,
      meta
    };
  } catch {
    throw createFailure(
      "NOT_FOUND",
      `Run '${runId}' was not found.`,
      EXIT_CODES.notFound
    );
  }
}

export { readRunOutput, readRunState, readRunTrace };

function parseCliValue(rawValue: string): JsonValue {
  if (rawValue.length === 0) {
    return "";
  }

  try {
    return JSON.parse(rawValue) as JsonValue;
  } catch {
    return rawValue;
  }
}

function assignInputPath(target: JsonObject, path: string, value: JsonValue): void {
  const segments = path
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    throw createFailure(
      "CLI_USAGE_ERROR",
      "--set path must not be empty.",
      EXIT_CODES.invalidCliUsage
    );
  }

  let current = target;
  for (const segment of segments.slice(0, -1)) {
    const nextValue = current[segment];
    if (!isJsonObject(nextValue)) {
      current[segment] = {};
    }
    current = current[segment] as JsonObject;
  }

  current[segments[segments.length - 1] as string] = value;
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
