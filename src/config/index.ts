import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { createFailure, EXIT_CODES } from "../core/errors";
import { readJsonFile } from "../util/json";
import { DEFAULT_CONFIG, type GlyphrailConfig } from "./types";

export const CONFIG_FILE_NAME = "glyphrail.config.json";

export interface ResolvedProjectConfig {
  cwd: string;
  projectRoot: string;
  configPath?: string;
  config: GlyphrailConfig;
}

export interface LoadProjectConfigOptions {
  cwd: string;
  configPath?: string;
}

export async function loadProjectConfig(
  options: LoadProjectConfigOptions
): Promise<ResolvedProjectConfig> {
  const cwd = resolve(options.cwd);
  const explicitConfigPath = options.configPath ? resolve(cwd, options.configPath) : undefined;
  const discoveredConfigPath = explicitConfigPath ?? (await findConfigPath(cwd));

  if (!discoveredConfigPath) {
    return {
      cwd,
      projectRoot: cwd,
      config: structuredClone(DEFAULT_CONFIG)
    };
  }

  const configData = await readJsonFile<Partial<GlyphrailConfig>>(discoveredConfigPath, "CONFIG_ERROR");
  const projectRoot = dirname(discoveredConfigPath);

  return {
    cwd,
    projectRoot,
    configPath: discoveredConfigPath,
    config: applyConfigDefaults(configData)
  };
}

export function resolveProjectPath(project: ResolvedProjectConfig, value: string): string {
  return resolve(project.projectRoot, value);
}

async function findConfigPath(startDir: string): Promise<string | undefined> {
  let currentDir = startDir;

  while (true) {
    const candidate = resolve(currentDir, CONFIG_FILE_NAME);
    if (await fileExists(candidate)) {
      return candidate;
    }

    const parentDir = resolve(currentDir, "..");
    if (parentDir === currentDir) {
      return undefined;
    }

    currentDir = parentDir;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function applyConfigDefaults(value: Partial<GlyphrailConfig>): GlyphrailConfig {
  if (!value || typeof value !== "object") {
    throw createFailure(
      "CONFIG_ERROR",
      "Config file must contain a JSON object.",
      EXIT_CODES.genericFailure
    );
  }

  return {
    ...DEFAULT_CONFIG,
    ...value,
    policies: {
      ...DEFAULT_CONFIG.policies,
      ...(value.policies ?? {})
    }
  };
}
