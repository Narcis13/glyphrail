import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createFailure, EXIT_CODES } from "../core/errors";

const TEMPLATE_ROOT = fileURLToPath(new URL("../../templates/", import.meta.url));

export async function loadTemplate(name: string): Promise<string> {
  const path = join(TEMPLATE_ROOT, name);

  try {
    return await Bun.file(path).text();
  } catch {
    throw createFailure(
      "NOT_FOUND",
      `Unknown template: ${name}`,
      EXIT_CODES.notFound,
      { template: name }
    );
  }
}

export function renderTemplate(content: string, replacements: Record<string, string>): string {
  return Object.entries(replacements).reduce((result, [key, value]) => {
    return result.replaceAll(`__${key}__`, value);
  }, content);
}
