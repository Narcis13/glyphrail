import { stat } from "node:fs/promises";
import { relative, resolve } from "node:path";

import { createFailure, exitCodeForErrorCode } from "../core/errors";

export interface BuiltinToolContext {
  cwd: string;
  projectRoot?: string;
  signal?: AbortSignal;
}

export function getToolProjectRoot(context: BuiltinToolContext): string {
  return resolve(context.projectRoot ?? context.cwd);
}

export function resolveSandboxedPath(context: BuiltinToolContext, path: string): string {
  const projectRoot = getToolProjectRoot(context);
  const resolvedPath = resolve(projectRoot, path);
  const relativePath = relative(projectRoot, resolvedPath);

  if (
    relativePath.startsWith("..") ||
    relativePath === ".." ||
    relativePath.includes("/../") ||
    relativePath.includes("\\..\\")
  ) {
    throw createFailure(
      "POLICY_VIOLATION",
      `Path '${path}' resolves outside the project root.`,
      exitCodeForErrorCode("POLICY_VIOLATION"),
      {
        path,
        projectRoot
      }
    );
  }

  return resolvedPath;
}

export async function assertNotDirectory(path: string): Promise<void> {
  try {
    const entry = await stat(path);
    if (entry.isDirectory()) {
      throw toolRuntimeFailure(`Path '${path}' is a directory, expected a file.`);
    }
  } catch (error) {
    if (error instanceof Error && "glyphrailError" in error) {
      throw error;
    }
  }
}

export function toolRuntimeFailure(message: string, details?: unknown) {
  return createFailure(
    "TOOL_RUNTIME_ERROR",
    message,
    exitCodeForErrorCode("TOOL_RUNTIME_ERROR"),
    details
  );
}

export function toolTimeoutFailure(toolName: string, timeoutMs: number) {
  return createFailure(
    "TIMEOUT",
    `Tool '${toolName}' timed out after ${timeoutMs}ms.`,
    exitCodeForErrorCode("TIMEOUT")
  );
}

export function createLinkedAbortController(
  signal?: AbortSignal,
  timeoutMs?: number,
  onTimeout?: () => void
): {
  controller: AbortController;
  cleanup: () => void;
  didTimeout: () => boolean;
} {
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const abortFromParent = () => {
    controller.abort(signal?.reason);
  };

  if (signal) {
    if (signal.aborted) {
      controller.abort(signal.reason);
    } else {
      signal.addEventListener("abort", abortFromParent, { once: true });
    }
  }

  if (timeoutMs !== undefined) {
    timer = setTimeout(() => {
      timedOut = true;
      onTimeout?.();
      controller.abort();
    }, timeoutMs);
  }

  return {
    controller,
    cleanup() {
      if (timer) {
        clearTimeout(timer);
      }
      signal?.removeEventListener("abort", abortFromParent);
    },
    didTimeout() {
      return timedOut;
    }
  };
}
