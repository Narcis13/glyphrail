import {
  GlyphrailFailure,
  annotateFailure,
  createFailure,
  exitCodeForErrorCode,
  isGlyphrailFailureLike,
  normalizeError
} from "../core/errors";
import type { JsonValue } from "../core/json-schema";
import { assertJsonSchema } from "../core/schema-validator";
import type { Tool, ToolMeta } from "./contracts";

export interface ToolInvocationPolicy {
  allowTools?: string[];
  allowExternalSideEffects: boolean;
  timeoutMs?: number;
}

export interface InvokeToolOptions extends ToolInvocationPolicy {
  tool: Tool;
  input: JsonValue;
  cwd: string;
  projectRoot?: string;
  env: Record<string, string | undefined>;
  runId?: string;
  stepId?: string;
  inputValidationErrorCode?: string;
  outputValidationErrorCode?: string;
}

export interface InvokeToolResult {
  output: JsonValue;
  meta?: ToolMeta;
  effectiveTimeoutMs?: number;
}

export function enforceToolPolicies(tool: Tool, policy: ToolInvocationPolicy): void {
  if (policy.allowTools && policy.allowTools.length > 0 && !policy.allowTools.includes(tool.name)) {
    throw createFailure(
      "POLICY_VIOLATION",
      `Tool '${tool.name}' is not allowlisted by workflow policy.`,
      exitCodeForErrorCode("POLICY_VIOLATION")
    );
  }

  if (
    !policy.allowExternalSideEffects &&
    (tool.sideEffect === "write" || tool.sideEffect === "external")
  ) {
    throw createFailure(
      "POLICY_VIOLATION",
      `Tool '${tool.name}' is blocked because external side effects are disabled.`,
      exitCodeForErrorCode("POLICY_VIOLATION")
    );
  }
}

export function resolveToolTimeout(tool: Tool, overrideTimeoutMs?: number): number | undefined {
  if (overrideTimeoutMs === undefined) {
    return tool.timeoutMs;
  }

  if (tool.timeoutMs === undefined) {
    return overrideTimeoutMs;
  }

  return Math.min(tool.timeoutMs, overrideTimeoutMs);
}

export async function invokeTool(options: InvokeToolOptions): Promise<InvokeToolResult> {
  enforceToolPolicies(options.tool, options);

  assertJsonSchema(options.input, options.tool.inputSchema, {
    errorCode: options.inputValidationErrorCode ?? "TOOL_INPUT_VALIDATION_ERROR",
    subject: `Tool '${options.tool.name}' input`
  });

  const controller = new AbortController();
  const effectiveTimeoutMs = resolveToolTimeout(options.tool, options.timeoutMs);

  let toolResult: Awaited<ReturnType<typeof options.tool.execute>>;
  try {
    toolResult = await runWithTimeout(
      () =>
        options.tool.execute(options.input as never, {
          cwd: options.cwd,
          projectRoot: options.projectRoot,
          env: options.env,
          runId: options.runId,
          stepId: options.stepId,
          signal: controller.signal
        }),
      effectiveTimeoutMs,
      options.stepId,
      () => controller.abort()
    );
  } catch (error) {
    throw annotateFailure(
      error instanceof GlyphrailFailure || isGlyphrailFailureLike(error)
        ? normalizeError(error)
        : createFailure(
            "TOOL_RUNTIME_ERROR",
            `Tool '${options.tool.name}' execution failed.`,
            exitCodeForErrorCode("TOOL_RUNTIME_ERROR"),
            error instanceof Error ? error.message : error
          ),
      {
        runId: options.runId,
        stepId: options.stepId
      }
    );
  }

  if (!toolResult.ok) {
    throw annotateFailure(
      new GlyphrailFailure(
        {
          ...toolResult.error
        },
        exitCodeForErrorCode(toolResult.error.code)
      ),
      {
        runId: options.runId,
        stepId: options.stepId
      }
    );
  }

  const output = structuredClone(toolResult.output as JsonValue);

  if (options.tool.outputSchema) {
    assertJsonSchema(output, options.tool.outputSchema, {
      errorCode: options.outputValidationErrorCode ?? "TOOL_OUTPUT_VALIDATION_ERROR",
      subject: `Tool '${options.tool.name}' output`
    });
  }

  return {
    output,
    meta: toolResult.meta,
    effectiveTimeoutMs
  };
}

async function runWithTimeout<T>(
  task: () => Promise<T> | T,
  timeoutMs?: number,
  stepId?: string,
  onTimeout?: () => void
): Promise<T> {
  if (timeoutMs === undefined) {
    return await task();
  }

  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      onTimeout?.();
      reject(
        createFailure(
          "TIMEOUT",
          stepId ? `Step '${stepId}' timed out after ${timeoutMs}ms.` : `Timed out after ${timeoutMs}ms.`,
          exitCodeForErrorCode("TIMEOUT")
        )
      );
    }, timeoutMs);

    Promise.resolve()
      .then(task)
      .then((result) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
  });
}
