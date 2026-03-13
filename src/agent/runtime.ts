import { createFailure, exitCodeForErrorCode } from "../core/errors";
import type { JsonObject, JsonValue } from "../core/json-schema";
import { stringifyJson } from "../util/json";
import type { AgentAdapter } from "./contracts";
import { mockAgentAdapter } from "./mock-adapter";

const BUILTIN_ADAPTERS = new Map<string, AgentAdapter>([[mockAgentAdapter.name, mockAgentAdapter]]);

export function getAgentAdapter(provider: string): AgentAdapter {
  const adapter = BUILTIN_ADAPTERS.get(provider);
  if (!adapter) {
    throw createFailure(
      "AGENT_RUNTIME_ERROR",
      `Agent adapter '${provider}' is not available.`,
      exitCodeForErrorCode("AGENT_RUNTIME_ERROR")
    );
  }

  return adapter;
}

export function buildStructuredPrompt(input: {
  objective: string;
  instructions?: string;
  input?: JsonValue;
}): string {
  const sections = [`Objective:\n${input.objective}`];

  if (input.instructions?.trim()) {
    sections.push(`Instructions:\n${input.instructions.trim()}`);
  }

  sections.push(`Input JSON:\n${stringifyJson(input.input ?? {})}`);

  return sections.join("\n\n");
}

export function repairStructuredOutput(rawOutput: string): {
  candidate: string;
  output: JsonValue;
} | undefined {
  for (const candidate of collectRepairCandidates(rawOutput)) {
    try {
      return {
        candidate,
        output: normalizeParsedJson(JSON.parse(candidate))
      };
    } catch {
      continue;
    }
  }

  return undefined;
}

function collectRepairCandidates(rawOutput: string): string[] {
  const candidates = new Set<string>();
  const trimmed = rawOutput.trim();

  if (trimmed.length === 0) {
    return [];
  }

  candidates.add(trimmed);

  const unfenced = stripCodeFences(trimmed);
  if (unfenced !== trimmed && unfenced.length > 0) {
    candidates.add(unfenced);
  }

  const fragment = extractJsonFragment(unfenced);
  if (fragment) {
    candidates.add(fragment);
  }

  return [...candidates];
}

function stripCodeFences(value: string): string {
  const fencedMatch = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fencedMatch?.[1]?.trim() ?? value;
}

function extractJsonFragment(value: string): string | undefined {
  const objectStart = value.indexOf("{");
  const arrayStart = value.indexOf("[");
  const startCandidates = [objectStart, arrayStart].filter((index) => index >= 0);

  if (startCandidates.length === 0) {
    return undefined;
  }

  const start = Math.min(...startCandidates);
  const openToken = value[start];
  const closeToken = openToken === "{" ? "}" : "]";
  const end = value.lastIndexOf(closeToken);

  if (end <= start) {
    return undefined;
  }

  return value.slice(start, end + 1).trim();
}

function normalizeParsedJson(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
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

  throw new Error(`Repaired output is not JSON-compatible: ${typeof value}`);
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
