import { dirname } from "node:path";
import { readFile } from "node:fs/promises";

import { createFailure, exitCodeForErrorCode } from "../core/errors";
import { ensureDir, writeTextFile } from "./fs";

export async function readJsonFile<T>(path: string, errorCode = "GENERIC_FAILURE"): Promise<T> {
  try {
    const content = await readFile(path, "utf8");
    return JSON.parse(content) as T;
  } catch (error) {
    throw createFailure(
      errorCode,
      `Failed to read JSON file: ${path}`,
      exitCodeForErrorCode(errorCode),
      error instanceof Error ? error.message : error
    );
  }
}

export async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await ensureDir(dirname(path));
  await writeTextFile(path, `${stringifyJson(value)}\n`);
}

export function stringifyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
