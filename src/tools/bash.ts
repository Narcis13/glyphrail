import { spawn } from "node:child_process";

import type { Tool } from "./contracts";
import {
  createLinkedAbortController,
  getToolProjectRoot,
  resolveSandboxedPath,
  toolRuntimeFailure,
  toolTimeoutFailure
} from "./builtin-shared";

export const bash: Tool<
  {
    command: string;
    cwd?: string;
    timeoutMs?: number;
    env?: Record<string, string>;
  },
  {
    exitCode: number;
    stdout: string;
    stderr: string;
    succeeded: boolean;
  }
> = {
  name: "bash",
  description: "Execute a shell command from within the current project root.",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", minLength: 1 },
      cwd: { type: "string", minLength: 1 },
      timeoutMs: { type: "integer", minimum: 0 },
      env: {
        type: "object",
        additionalProperties: {
          type: "string"
        }
      }
    },
    required: ["command"],
    additionalProperties: false
  },
  outputSchema: {
    type: "object",
    properties: {
      exitCode: { type: "integer" },
      stdout: { type: "string" },
      stderr: { type: "string" },
      succeeded: { type: "boolean" }
    },
    required: ["exitCode", "stdout", "stderr", "succeeded"],
    additionalProperties: false
  },
  sideEffect: "external",
  tags: ["compute", "unsafe"],
  async execute(input, context) {
    const projectRoot = getToolProjectRoot(context);
    const commandCwd = input.cwd ? resolveSandboxedPath(context, input.cwd) : projectRoot;
    const linkedAbort = createLinkedAbortController(context.signal, input.timeoutMs);

    try {
      const result = await runShellCommand(input.command, commandCwd, {
        ...context.env,
        ...input.env
      }, linkedAbort.controller.signal);

      return {
        ok: true,
        output: {
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          succeeded: result.exitCode === 0
        }
      };
    } catch (error) {
      if (linkedAbort.didTimeout()) {
        throw toolTimeoutFailure("bash", input.timeoutMs as number);
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw toolTimeoutFailure("bash", input.timeoutMs ?? 0);
      }

      throw toolRuntimeFailure("bash execution failed.", error instanceof Error ? error.message : error);
    } finally {
      linkedAbort.cleanup();
    }
  }
};

function runShellCommand(
  command: string,
  cwd: string,
  env: Record<string, string | undefined>,
  signal: AbortSignal
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  return awaitResult(
    new Promise((resolvePromise, rejectPromise) => {
      const child = spawn("bash", ["-lc", command], {
        cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"]
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let settled = false;

      const onAbort = () => {
        if (settled) {
          return;
        }
        child.kill("SIGTERM");
        settled = true;
        rejectPromise(new DOMException("Aborted", "AbortError"));
      };

      signal.addEventListener("abort", onAbort, { once: true });

      child.stdout?.on("data", (chunk: Buffer) => {
        stdoutChunks.push(Buffer.from(chunk));
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderrChunks.push(Buffer.from(chunk));
      });

      child.once("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        signal.removeEventListener("abort", onAbort);
        rejectPromise(error);
      });

      child.once("close", (code) => {
        if (settled) {
          return;
        }
        settled = true;
        signal.removeEventListener("abort", onAbort);
        resolvePromise({
          exitCode: code ?? 1,
          stdout: Buffer.concat(stdoutChunks).toString("utf8"),
          stderr: Buffer.concat(stderrChunks).toString("utf8")
        });
      });
    })
  );
}

async function awaitResult<T>(promise: Promise<T>): Promise<T> {
  return await promise;
}
