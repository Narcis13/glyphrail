import { readFile, stat } from "node:fs/promises";

import type { Tool } from "./contracts";
import { resolveSandboxedPath } from "./builtin-shared";
import { createFailure, exitCodeForErrorCode } from "../core/errors";

export const fileRead: Tool<
  {
    path: string;
    encoding?: "utf8" | "base64";
  },
  {
    path: string;
    content: string;
    encoding: "utf8" | "base64";
    sizeBytes: number;
  }
> = {
  name: "fileRead",
  description: "Read a file from within the current project root.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", minLength: 1 },
      encoding: {
        type: "string",
        enum: ["utf8", "base64"]
      }
    },
    required: ["path"],
    additionalProperties: false
  },
  outputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" },
      encoding: {
        type: "string",
        enum: ["utf8", "base64"]
      },
      sizeBytes: { type: "integer", minimum: 0 }
    },
    required: ["path", "content", "encoding", "sizeBytes"],
    additionalProperties: false
  },
  sideEffect: "read",
  tags: ["file", "io"],
  async execute(input, context) {
    const resolvedPath = resolveSandboxedPath(context, input.path);

    let entry;
    try {
      entry = await stat(resolvedPath);
    } catch (error) {
      throw createFailure(
        "NOT_FOUND",
        `File '${input.path}' was not found.`,
        exitCodeForErrorCode("NOT_FOUND"),
        error instanceof Error ? error.message : error
      );
    }

    if (!entry.isFile()) {
      throw toolRuntimeFailure(`Path '${input.path}' is not a file.`);
    }

    const encoding = input.encoding ?? "utf8";
    const content = await readFile(resolvedPath);

    return {
      ok: true,
      output: {
        path: input.path,
        content: encoding === "base64" ? Buffer.from(content).toString("base64") : content.toString("utf8"),
        encoding,
        sizeBytes: entry.size
      }
    };
  }
};
