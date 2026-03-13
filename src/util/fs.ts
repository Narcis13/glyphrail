import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function writeTextFile(path: string, content: string): Promise<void> {
  await ensureDir(dirname(path));
  await writeFile(path, content, "utf8");
}

export async function readTextFile(path: string): Promise<string> {
  return readFile(path, "utf8");
}

export function relativePath(from: string, to: string): string {
  return relative(resolve(from), resolve(to)) || ".";
}
