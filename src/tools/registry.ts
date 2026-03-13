import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createFailure, EXIT_CODES } from "../core/errors";
import type { Tool } from "./contracts";
import { readTextFile, pathExists } from "../util/fs";

export interface ToolRegistryPreview {
  toolNames: string[];
  unresolvedIdentifiers: string[];
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
  const exportedValue = module.default ?? module.tools ?? module.registry;

  if (!Array.isArray(exportedValue)) {
    throw createFailure(
      "GENERIC_FAILURE",
      `Tools entry must default-export an array of tools: ${entryPath}`,
      EXIT_CODES.genericFailure
    );
  }

  for (const [index, tool] of exportedValue.entries()) {
    validateToolShape(tool, entryPath, index);
  }

  return exportedValue as Tool[];
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
  const match = source.match(/defineTools\s*\(\s*\[([\s\S]*?)\]\s*\)/m);
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
  if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
    throw createFailure(
      "GENERIC_FAILURE",
      `Tool export at index ${index} in ${entryPath} is not an object.`,
      EXIT_CODES.genericFailure
    );
  }

  const candidate = tool as Partial<Tool>;
  if (
    typeof candidate.name !== "string" ||
    typeof candidate.description !== "string" ||
    typeof candidate.execute !== "function"
  ) {
    throw createFailure(
      "GENERIC_FAILURE",
      `Tool export at index ${index} in ${entryPath} is missing required fields.`,
      EXIT_CODES.genericFailure
    );
  }
}
