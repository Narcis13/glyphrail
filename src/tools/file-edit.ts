import { readFile, stat, writeFile } from "node:fs/promises";

import type { Tool } from "./contracts";
import { resolveSandboxedPath, toolRuntimeFailure } from "./builtin-shared";
import { createFailure, exitCodeForErrorCode } from "../core/errors";

export interface FileEditOptions {
  replaceAll?: boolean;
  occurrence?: number;
}

export function replaceExactText(
  content: string,
  oldText: string,
  newText: string,
  options: FileEditOptions = {}
): {
  content: string;
  replacements: number;
} {
  if (oldText.length === 0) {
    throw toolRuntimeFailure("fileEdit requires oldText to be non-empty.");
  }

  if (options.replaceAll && options.occurrence !== undefined) {
    throw toolRuntimeFailure("fileEdit does not allow replaceAll and occurrence together.");
  }

  if (options.replaceAll) {
    let replacements = 0;
    let nextContent = "";
    let cursor = 0;

    while (true) {
      const index = content.indexOf(oldText, cursor);
      if (index === -1) {
        break;
      }

      nextContent += `${content.slice(cursor, index)}${newText}`;
      replacements += 1;
      cursor = index + oldText.length;
    }

    if (replacements === 0) {
      throw toolRuntimeFailure(`fileEdit could not find '${oldText}' in the target file.`);
    }

    nextContent += content.slice(cursor);
    return {
      content: nextContent,
      replacements
    };
  }

  if (options.occurrence !== undefined) {
    let cursor = 0;
    let currentOccurrence = 0;

    while (true) {
      const index = content.indexOf(oldText, cursor);
      if (index === -1) {
        break;
      }

      currentOccurrence += 1;
      if (currentOccurrence === options.occurrence) {
        return {
          content: `${content.slice(0, index)}${newText}${content.slice(index + oldText.length)}`,
          replacements: 1
        };
      }

      cursor = index + oldText.length;
    }

    throw toolRuntimeFailure(
      `fileEdit could not find occurrence ${options.occurrence} of '${oldText}' in the target file.`
    );
  }

  const index = content.indexOf(oldText);
  if (index === -1) {
    throw toolRuntimeFailure(`fileEdit could not find '${oldText}' in the target file.`);
  }

  return {
    content: `${content.slice(0, index)}${newText}${content.slice(index + oldText.length)}`,
    replacements: 1
  };
}

async function executeFileEdit(
  input: {
    path: string;
    oldText: string;
    newText: string;
    replaceAll?: boolean;
    occurrence?: number;
  },
  context: {
    cwd: string;
    projectRoot?: string;
  }
) {
  const resolvedPath = resolveSandboxedPath(context, input.path);

  try {
    const entry = await stat(resolvedPath);
    if (!entry.isFile()) {
      throw toolRuntimeFailure(`Path '${input.path}' is not a file.`);
    }
  } catch (error) {
    if (error instanceof Error && "glyphrailError" in error) {
      throw error;
    }

    throw createFailure(
      "NOT_FOUND",
      `File '${input.path}' was not found.`,
      exitCodeForErrorCode("NOT_FOUND"),
      error instanceof Error ? error.message : error
    );
  }

  try {
    const content = await readFile(resolvedPath, "utf8");
    const replaced = replaceExactText(content, input.oldText, input.newText, {
      replaceAll: input.replaceAll,
      occurrence: input.occurrence
    });

    await writeFile(resolvedPath, replaced.content, "utf8");

    return {
      ok: true as const,
      output: {
        path: input.path,
        replacements: replaced.replacements
      }
    };
  } catch (error) {
    if (error instanceof Error && "glyphrailError" in error) {
      throw error;
    }

    throw toolRuntimeFailure("fileEdit failed to update the target file.", error instanceof Error ? error.message : error);
  }
}

export const fileEdit: Tool<
  {
    path: string;
    oldText: string;
    newText: string;
    replaceAll?: boolean;
    occurrence?: number;
  },
  {
    path: string;
    replacements: number;
  }
> = {
  name: "fileEdit",
  description: "Replace exact text inside a file within the current project root.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", minLength: 1 },
      oldText: { type: "string", minLength: 1 },
      newText: { type: "string" },
      replaceAll: { type: "boolean" },
      occurrence: { type: "integer", minimum: 1 }
    },
    required: ["path", "oldText", "newText"],
    additionalProperties: false
  },
  outputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      replacements: { type: "integer", minimum: 0 }
    },
    required: ["path", "replacements"],
    additionalProperties: false
  },
  sideEffect: "write",
  tags: ["file", "io", "unsafe"],
  execute: executeFileEdit
};
