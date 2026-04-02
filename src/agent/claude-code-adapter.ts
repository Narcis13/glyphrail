import { spawn } from "node:child_process"

import type { JsonValue } from "../core/json-schema"
import { stringifyJson } from "../util/json"
import type { AgentAdapter, StructuredAgentRequest, StructuredAgentResult } from "./contracts"

interface ClaudeCodeMeta {
  /** Override the claude binary path (default: "claude") */
  claudeBinary?: string
  /** Additional CLI flags passed to claude (e.g., ["--model", "sonnet"]) */
  claudeFlags?: string[]
  /** Working directory for the claude process */
  cwd?: string
  /** Extra environment variables for the claude process */
  env?: Record<string, string>
  /** Max output tokens hint passed via --max-turns if supported */
  maxTurns?: number
  /** System prompt override — prepended to the assembled prompt */
  systemPrompt?: string
  /** If true, pass --verbose flag */
  verbose?: boolean
  /** Allowed tools for claude code (passed via --allowedTools) */
  allowedTools?: string[]
  /** MCP server config JSON string (passed via --mcp-config) */
  mcpConfig?: string
}

export const claudeCodeAdapter: AgentAdapter = {
  name: "claude-code",

  async runStructured(request: StructuredAgentRequest): Promise<StructuredAgentResult> {
    const meta = (request.meta ?? {}) as ClaudeCodeMeta
    const binary = meta.claudeBinary ?? process.env.GLYPHRAIL_CLAUDE_BINARY ?? "claude"
    const startTime = Date.now()

    const prompt = buildClaudePrompt(request, meta)
    const args = buildClaudeArgs(request, meta)

    try {
      const result = await spawnClaude(binary, args, prompt, {
        cwd: meta.cwd,
        env: meta.env,
        timeoutMs: request.timeoutMs,
      })

      const durationMs = Date.now() - startTime

      if (result.exitCode !== 0) {
        return {
          ok: false,
          error: {
            code: "AGENT_RUNTIME_ERROR",
            message: `Claude Code exited with code ${result.exitCode}.`,
            details: {
              exitCode: result.exitCode,
              stderr: result.stderr.slice(0, 2000),
              durationMs,
            },
            retryable: result.exitCode !== 2,
          },
          rawOutput: result.stdout,
          meta: {
            adapter: "claude-code",
            binary,
            attempt: request.attempt,
            durationMs,
            exitCode: result.exitCode,
          },
        }
      }

      const rawOutput = result.stdout.trim()

      const parsed = tryParseJson(rawOutput)
      if (parsed !== undefined) {
        return {
          ok: true,
          output: extractClaudeOutput(parsed),
          rawOutput,
          meta: {
            adapter: "claude-code",
            binary,
            attempt: request.attempt,
            durationMs,
          },
        }
      }

      // Return rawOutput for the engine's repair pipeline to handle
      return {
        ok: true,
        output: rawOutput as JsonValue,
        rawOutput,
        meta: {
          adapter: "claude-code",
          binary,
          attempt: request.attempt,
          durationMs,
          outputParsedAsText: true,
        },
      }
    } catch (error) {
      const durationMs = Date.now() - startTime

      if (error instanceof Error && error.name === "AbortError") {
        return {
          ok: false,
          error: {
            code: "TIMEOUT",
            message: `Claude Code timed out after ${request.timeoutMs}ms.`,
            retryable: true,
          },
          meta: {
            adapter: "claude-code",
            binary,
            attempt: request.attempt,
            durationMs,
          },
        }
      }

      return {
        ok: false,
        error: {
          code: "AGENT_RUNTIME_ERROR",
          message: `Claude Code invocation failed: ${error instanceof Error ? error.message : String(error)}`,
          retryable: true,
        },
        meta: {
          adapter: "claude-code",
          binary,
          attempt: request.attempt,
          durationMs,
        },
      }
    }
  },
}

function buildClaudePrompt(request: StructuredAgentRequest, meta: ClaudeCodeMeta): string {
  const sections: string[] = []

  if (meta.systemPrompt) {
    sections.push(meta.systemPrompt.trim())
    sections.push("---")
  }

  sections.push(`Objective:\n${request.objective}`)

  if (request.instructions?.trim()) {
    sections.push(`Instructions:\n${request.instructions.trim()}`)
  }

  if (request.input !== undefined) {
    sections.push(`Input JSON:\n${stringifyJson(request.input)}`)
  }

  if (request.outputSchema) {
    sections.push(
      `Output Requirements:\nRespond with ONLY a valid JSON object matching this schema — no markdown fences, no explanation, just raw JSON:\n${stringifyJson(request.outputSchema)}`
    )
  }

  if (request.attempt > 1) {
    sections.push(`Note: This is retry attempt ${request.attempt}. Previous attempts failed — ensure your output is valid JSON matching the schema.`)
  }

  return sections.join("\n\n")
}

function buildClaudeArgs(request: StructuredAgentRequest, meta: ClaudeCodeMeta): string[] {
  const args: string[] = [
    "--print",        // headless mode — print response and exit
    "--output-format", "text",  // raw text output (we parse JSON ourselves)
  ]

  if (request.model && request.model !== "mock") {
    args.push("--model", request.model)
  }

  if (meta.maxTurns !== undefined) {
    args.push("--max-turns", String(meta.maxTurns))
  }

  if (meta.verbose) {
    args.push("--verbose")
  }

  if (meta.allowedTools && meta.allowedTools.length > 0) {
    args.push("--allowedTools", meta.allowedTools.join(","))
  }

  if (meta.mcpConfig) {
    args.push("--mcp-config", meta.mcpConfig)
  }

  if (meta.claudeFlags) {
    args.push(...meta.claudeFlags)
  }

  return args
}

function spawnClaude(
  binary: string,
  args: string[],
  prompt: string,
  options: {
    cwd?: string
    env?: Record<string, string>
    timeoutMs?: number
  }
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      ...(options.env ?? {}),
    }

    const child = spawn(binary, args, {
      cwd: options.cwd ?? process.cwd(),
      env,
      stdio: ["pipe", "pipe", "pipe"],
    })

    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    if (options.timeoutMs !== undefined && options.timeoutMs > 0) {
      timer = setTimeout(() => {
        if (settled) return
        settled = true
        child.kill("SIGTERM")
        // Give it a moment to clean up, then force kill
        setTimeout(() => child.kill("SIGKILL"), 3000)
        reject(new DOMException("Aborted", "AbortError"))
      }, options.timeoutMs)
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutChunks.push(Buffer.from(chunk))
    })

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrChunks.push(Buffer.from(chunk))
    })

    // Write prompt to stdin and close
    child.stdin?.write(prompt)
    child.stdin?.end()

    child.once("error", (error) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      reject(error)
    })

    child.once("close", (code) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
      })
    })
  })
}

function tryParseJson(value: string): JsonValue | undefined {
  const trimmed = value.trim()
  if (trimmed.length === 0) return undefined

  // Try direct parse
  try {
    return JSON.parse(trimmed) as JsonValue
  } catch {
    // continue
  }

  // Try stripping code fences
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fencedMatch?.[1]) {
    try {
      return JSON.parse(fencedMatch[1].trim()) as JsonValue
    } catch {
      // continue
    }
  }

  // Try extracting largest JSON object/array
  const objectStart = trimmed.indexOf("{")
  const arrayStart = trimmed.indexOf("[")
  const starts = [objectStart, arrayStart].filter((i) => i >= 0)
  if (starts.length > 0) {
    const start = Math.min(...starts)
    const openChar = trimmed[start]
    const closeChar = openChar === "{" ? "}" : "]"
    const end = trimmed.lastIndexOf(closeChar)
    if (end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as JsonValue
      } catch {
        // continue
      }
    }
  }

  return undefined
}

function extractClaudeOutput(parsed: JsonValue): JsonValue {
  // If claude --print --output-format json was used, the result may be wrapped
  // in a { result: "..." } envelope. Extract the inner value if so.
  if (
    parsed !== null &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    "result" in parsed &&
    Object.keys(parsed).length === 1
  ) {
    const inner = (parsed as Record<string, JsonValue>).result
    // If the inner result is a string that looks like JSON, try to parse it
    if (typeof inner === "string") {
      const nested = tryParseJson(inner)
      if (nested !== undefined) return nested
    }
    return inner
  }

  return parsed
}
