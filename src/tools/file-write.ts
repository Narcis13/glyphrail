import { stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { Tool } from "./contracts";
import { ensureDir } from "../util/fs";
import { resolveSandboxedPath, toolRuntimeFailure } from "./builtin-shared";

export const fileWrite: Tool<
  {
    path: string;
    content: string;
    encoding?: "utf8" | "base64";
    mode?: "overwrite" | "append";
    createDirectories?: boolean;
  },
  {
    path: string;
    bytesWritten: number;
    mode: "overwrite" | "append";
  }
> = {
  name: "fileWrite",
  description: "Write a file within the current project root.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", minLength: 1 },
      content: { type: "string" },
      encoding: {
        type: "string",
        enum: ["utf8", "base64"]
      },
      mode: {
        type: "string",
        enum: ["overwrite", "append"]
      },
      createDirectories: { type: "boolean" }
    },
    required: ["path", "content"],
    additionalProperties: false
  },
  outputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      bytesWritten: { type: "integer", minimum: 0 },
      mode: {
        type: "string",
        enum: ["overwrite", "append"]
      }
    },
    required: ["path", "bytesWritten", "mode"],
    additionalProperties: false
  },
  sideEffect: "write",
  tags: ["file", "io", "unsafe"],
  async execute(input, context) {
    const resolvedPath = resolveSandboxedPath(context, input.path);
    const mode = input.mode ?? "overwrite";
    const encoding = input.encoding ?? "utf8";
    const createDirectories = input.createDirectories ?? true;

    try {
      const entry = await stat(resolvedPath);
      if (entry.isDirectory()) {
        throw toolRuntimeFailure(`Path '${input.path}' is a directory, expected a file.`);
      }
    } catch (error) {
      if (error instanceof Error && "glyphrailError" in error) {
        throw error;
      }
    }

    if (createDirectories) {
      await ensureDir(dirname(resolvedPath));
    }

    const content =
      encoding === "base64" ? Buffer.from(input.content, "base64") : Buffer.from(input.content, "utf8");

    await writeFile(resolvedPath, content, {
      flag: mode === "append" ? "a" : "w"
    });

    return {
      ok: true,
      output: {
        path: input.path,
        bytesWritten: content.byteLength,
        mode
      }
    };
  }
};
