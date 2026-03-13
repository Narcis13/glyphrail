import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createFailure, EXIT_CODES } from "../core/errors";
import type { JsonSchema } from "../core/json-schema";
import { validateSchemaDefinition } from "../core/schema-validator";
import type { Tool, ToolCategoryTag, ToolSideEffect } from "./contracts";
import { readTextFile, pathExists } from "../util/fs";

export interface ToolRegistryPreview {
  toolNames: string[];
  unresolvedIdentifiers: string[];
}

export interface ToolContractIssue {
  path: string;
  message: string;
}

export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  sideEffect: ToolSideEffect;
  timeoutMs?: number;
  tags: ToolCategoryTag[];
}

interface ParsedModule {
  localToolNames: Map<string, string>;
  exportedToolNames: Map<string, string>;
  imports: Map<string, ToolImport>;
  defineToolIdentifiers: string[];
}

interface ToolImport {
  source: string;
  importedName: string;
}

const FILE_CANDIDATES = [
  "",
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  "/index.ts",
  "/index.tsx",
  "/index.js",
  "/index.mjs"
] as const;

export async function discoverDeclaredTools(entryPath: string): Promise<ToolRegistryPreview> {
  if (!(await pathExists(entryPath))) {
    return {
      toolNames: [],
      unresolvedIdentifiers: []
    };
  }

  const moduleCache = new Map<string, ParsedModule>();
  const entryModule = await parseToolModule(entryPath, moduleCache);
  const toolNames = new Set<string>();
  const unresolvedIdentifiers: string[] = [];

  for (const identifier of entryModule.defineToolIdentifiers) {
    const toolName = await resolveToolIdentifier(entryPath, identifier, moduleCache);
    if (toolName) {
      toolNames.add(toolName);
    } else {
      unresolvedIdentifiers.push(identifier);
    }
  }

  return {
    toolNames: [...toolNames].sort(),
    unresolvedIdentifiers
  };
}

export async function loadDeclaredTools(entryPath: string): Promise<Tool[]> {
  if (!(await pathExists(entryPath))) {
    throw createFailure(
      "NOT_FOUND",
      `Tools entry was not found: ${entryPath}`,
      EXIT_CODES.notFound
    );
  }

  const module = await import(pathToFileURL(entryPath).href);
  const exportedValue = module.default;

  if (!Array.isArray(exportedValue)) {
    throw createFailure(
      "TOOL_VALIDATION_ERROR",
      `Tools entry must default-export defineTools([...]) from ${entryPath}.`,
      EXIT_CODES.genericFailure
    );
  }

  const seenToolNames = new Set<string>();
  for (const [index, tool] of exportedValue.entries()) {
    validateToolShape(tool, entryPath, index);

    if (seenToolNames.has(tool.name)) {
      throw createFailure(
        "TOOL_VALIDATION_ERROR",
        `Tool '${tool.name}' is declared more than once in ${entryPath}.`,
        EXIT_CODES.genericFailure,
        {
          tool: tool.name,
          path: "$.name",
          index
        }
      );
    }

    seenToolNames.add(tool.name);
  }

  return exportedValue as Tool[];
}

export function toToolDescriptor(tool: Tool): ToolDescriptor {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    sideEffect: tool.sideEffect,
    timeoutMs: tool.timeoutMs,
    tags: [...(tool.tags ?? [])]
  };
}

export function getToolContractIssues(tool: unknown): ToolContractIssue[] {
  const issues: ToolContractIssue[] = [];

  if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
    return [
      {
        path: "$",
        message: "Tool must be an object."
      }
    ];
  }

  const candidate = tool as Partial<Tool>;

  if (typeof candidate.name !== "string" || candidate.name.trim().length === 0) {
    issues.push({
      path: "$.name",
      message: "name must be a non-empty string."
    });
  }

  if (typeof candidate.description !== "string" || candidate.description.trim().length === 0) {
    issues.push({
      path: "$.description",
      message: "description must be a non-empty string."
    });
  }

  if (!isJsonSchemaObject(candidate.inputSchema)) {
    issues.push({
      path: "$.inputSchema",
      message: "inputSchema must be a JSON schema object."
    });
  } else {
    issues.push(...prefixSchemaIssues("$.inputSchema", validateSchemaDefinition(candidate.inputSchema)));
  }

  if (candidate.outputSchema !== undefined) {
    if (!isJsonSchemaObject(candidate.outputSchema)) {
      issues.push({
        path: "$.outputSchema",
        message: "outputSchema must be a JSON schema object when provided."
      });
    } else {
      issues.push(...prefixSchemaIssues("$.outputSchema", validateSchemaDefinition(candidate.outputSchema)));
    }
  }

  if (
    candidate.sideEffect !== "none" &&
    candidate.sideEffect !== "read" &&
    candidate.sideEffect !== "write" &&
    candidate.sideEffect !== "external"
  ) {
    issues.push({
      path: "$.sideEffect",
      message: "sideEffect must be one of: none, read, write, external."
    });
  }

  if (candidate.timeoutMs !== undefined && (!Number.isInteger(candidate.timeoutMs) || candidate.timeoutMs < 0)) {
    issues.push({
      path: "$.timeoutMs",
      message: "timeoutMs must be a non-negative integer when provided."
    });
  }

  if (candidate.tags !== undefined) {
    if (!Array.isArray(candidate.tags)) {
      issues.push({
        path: "$.tags",
        message: "tags must be an array when provided."
      });
    } else {
      for (const [index, tag] of candidate.tags.entries()) {
        if (
          tag !== "io" &&
          tag !== "http" &&
          tag !== "file" &&
          tag !== "compute" &&
          tag !== "ai" &&
          tag !== "db" &&
          tag !== "unsafe"
        ) {
          issues.push({
            path: `$.tags[${index}]`,
            message: `Unsupported tag '${String(tag)}'.`
          });
        }
      }
    }
  }

  if (typeof candidate.execute !== "function") {
    issues.push({
      path: "$.execute",
      message: "execute must be a function."
    });
  }

  return issues;
}

async function resolveToolIdentifier(
  modulePath: string,
  identifier: string,
  moduleCache: Map<string, ParsedModule>
): Promise<string | undefined> {
  const parsedModule = await parseToolModule(modulePath, moduleCache);
  if (parsedModule.localToolNames.has(identifier)) {
    return parsedModule.localToolNames.get(identifier);
  }

  const imported = parsedModule.imports.get(identifier);
  if (!imported) {
    return undefined;
  }

  const importedModulePath = await resolveImportPath(dirname(modulePath), imported.source);
  if (!importedModulePath) {
    return undefined;
  }

  const importedModule = await parseToolModule(importedModulePath, moduleCache);
  return (
    importedModule.exportedToolNames.get(imported.importedName) ??
    importedModule.localToolNames.get(imported.importedName) ??
    (imported.importedName === "default" ? identifier : undefined)
  );
}

async function parseToolModule(
  modulePath: string,
  moduleCache: Map<string, ParsedModule>
): Promise<ParsedModule> {
  const cached = moduleCache.get(modulePath);
  if (cached) {
    return cached;
  }

  const source = await readTextFile(modulePath);
  const localToolNames = extractLocalToolNames(source);
  const parsedModule: ParsedModule = {
    localToolNames,
    exportedToolNames: extractExportedToolNames(source, localToolNames),
    imports: extractImports(source),
    defineToolIdentifiers: extractDefineToolIdentifiers(source)
  };

  for (const [localIdentifier, toolName] of localToolNames.entries()) {
    if (source.includes(`export const ${localIdentifier}`) || source.includes(`export { ${localIdentifier}`)) {
      parsedModule.exportedToolNames.set(localIdentifier, toolName);
    }
  }

  moduleCache.set(modulePath, parsedModule);
  return parsedModule;
}

function extractDefineToolIdentifiers(source: string): string[] {
  const match = source.match(/export\s+default\s+defineTools\s*\(\s*\[([\s\S]*?)\]\s*\)/m);
  if (!match) {
    return [];
  }

  const identifiers = match[1].match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? [];
  return identifiers.filter((identifier) => identifier !== "defineTools");
}

function extractLocalToolNames(source: string): Map<string, string> {
  const toolNames = new Map<string, string>();
  const declarationRegex = /(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)[\s\S]*?=\s*{([\s\S]*?)}\s*;/g;

  for (const match of source.matchAll(declarationRegex)) {
    const identifier = match[1];
    const body = match[2];
    const nameMatch = body.match(/name\s*:\s*["']([^"']+)["']/);
    if (nameMatch) {
      toolNames.set(identifier, nameMatch[1]);
    }
  }

  return toolNames;
}

function extractExportedToolNames(
  source: string,
  localToolNames: Map<string, string>
): Map<string, string> {
  const exportedNames = new Map<string, string>();
  const exportBlockRegex = /export\s*{\s*([^}]+)\s*}/g;

  for (const match of source.matchAll(exportBlockRegex)) {
    const exportEntries = match[1].split(",");
    for (const entry of exportEntries) {
      const [localIdentifier, exportedIdentifier] = entry.split(/\s+as\s+/).map((part) => part.trim());
      if (localIdentifier && localToolNames.has(localIdentifier)) {
        exportedNames.set(
          exportedIdentifier ?? localIdentifier,
          localToolNames.get(localIdentifier) as string
        );
      }
    }
  }

  return exportedNames;
}

function extractImports(source: string): Map<string, ToolImport> {
  const imports = new Map<string, ToolImport>();

  for (const match of source.matchAll(/import\s+{([^}]+)}\s+from\s+["']([^"']+)["']/g)) {
    const [, importBlock, importSource] = match;
    for (const entry of importBlock.split(",")) {
      const [importedName, localName] = entry.split(/\s+as\s+/).map((part) => part.trim());
      if (importedName) {
        imports.set(localName ?? importedName, {
          source: importSource,
          importedName
        });
      }
    }
  }

  for (const match of source.matchAll(/import\s+([A-Za-z_$][A-Za-z0-9_$]*)\s+from\s+["']([^"']+)["']/g)) {
    const [, localName, importSource] = match;
    imports.set(localName, {
      source: importSource,
      importedName: "default"
    });
  }

  return imports;
}

async function resolveImportPath(baseDir: string, importPath: string): Promise<string | undefined> {
  if (!importPath.startsWith(".")) {
    return undefined;
  }

  for (const suffix of FILE_CANDIDATES) {
    const candidatePath = resolve(baseDir, `${importPath}${suffix}`);
    if (await pathExists(candidatePath)) {
      return candidatePath;
    }
  }

  return undefined;
}

function validateToolShape(tool: unknown, entryPath: string, index: number): asserts tool is Tool {
  const issues = getToolContractIssues(tool);
  if (issues.length > 0) {
    throw createFailure(
      "TOOL_VALIDATION_ERROR",
      `Tool export at index ${index} in ${entryPath} failed contract validation.`,
      EXIT_CODES.genericFailure,
      {
        issues
      }
    );
  }
}

function isJsonSchemaObject(value: unknown): value is JsonSchema {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function prefixSchemaIssues(prefix: string, issues: ToolContractIssue[]): ToolContractIssue[] {
  return issues.map((issue) => ({
    path: `${prefix}${issue.path.slice(1)}`,
    message: issue.message
  }));
}
