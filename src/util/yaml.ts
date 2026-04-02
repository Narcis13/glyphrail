import { exitCodeForErrorCode, createFailure } from "../core/errors";

export function parseYaml<T>(content: string, sourceLabel = "workflow"): T {
  try {
    return Bun.YAML.parse(content) as T;
  } catch (error) {
    throw createFailure(
      "WORKFLOW_PARSE_ERROR",
      `Failed to parse YAML from ${sourceLabel}.`,
      exitCodeForErrorCode("WORKFLOW_PARSE_ERROR"),
      error instanceof Error ? error.message : error
    );
  }
}

export async function readYamlFile<T>(path: string): Promise<T> {
  try {
    const content = await Bun.file(path).text();
    return parseYaml<T>(content, path);
  } catch (error) {
    if (error instanceof Error && error.name === "GlyphrailFailure") {
      throw error;
    }

    throw createFailure(
      "WORKFLOW_PARSE_ERROR",
      `Failed to read workflow YAML: ${path}`,
      exitCodeForErrorCode("WORKFLOW_PARSE_ERROR"),
      error instanceof Error ? error.message : error
    );
  }
}
