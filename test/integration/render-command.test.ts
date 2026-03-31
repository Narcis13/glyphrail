import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const cliEntry = join(repoRoot, "src/cli/index.ts")
const playgroundDir = join(repoRoot, "playground/mvp")

function runCli(args: string[], cwd: string) {
  const processResult = Bun.spawnSync(["bun", cliEntry, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe"
  })

  return {
    exitCode: processResult.exitCode,
    stdout: processResult.stdout.toString(),
    stderr: processResult.stderr.toString()
  }
}

function parseJsonOutput(output: string): any {
  return JSON.parse(output)
}

test("render command produces rendered markdown from .gr.md file", () => {
  const result = runCli(
    ["render", "documents/hello.gr.md", "--input-json", '{"name":"World"}', "--json"],
    playgroundDir
  )

  expect(result.exitCode).toBe(0)
  const payload = parseJsonOutput(result.stdout)
  expect(payload.ok).toBe(true)
  expect(payload.command).toBe("render")
  expect(payload.runId).toBeTruthy()
  expect(payload.status).toBe("completed")
  expect(payload.rendered).toContain("Hello World")
})

test("render command writes output to file when --output is specified", () => {
  const tmpOutput = join(playgroundDir, ".glyphrail/test-output.md")
  const result = runCli(
    ["render", "documents/hello.gr.md", "--input-json", '{"name":"Test"}', "--output", tmpOutput, "--json"],
    playgroundDir
  )

  expect(result.exitCode).toBe(0)
  const payload = parseJsonOutput(result.stdout)
  expect(payload.ok).toBe(true)
  expect(payload.outputFile).toBeTruthy()
})

test("render command exits with error for invalid .gr.md file", () => {
  const result = runCli(
    ["render", "documents/nonexistent.gr.md", "--json"],
    playgroundDir
  )

  expect(result.exitCode).not.toBe(0)
})

test("render command supports --dry-run", () => {
  const result = runCli(
    ["render", "documents/hello.gr.md", "--input-json", '{"name":"DryRun"}', "--dry-run", "--json"],
    playgroundDir
  )

  expect(result.exitCode).toBe(0)
  const payload = parseJsonOutput(result.stdout)
  expect(payload.ok).toBe(true)
  expect(payload.dryRun).toBe(true)
})

test("render command persists rendered.md and source.gr.md in run artifacts", () => {
  const result = runCli(
    ["render", "documents/hello.gr.md", "--input-json", '{"name":"Artifacts"}', "--json"],
    playgroundDir
  )

  expect(result.exitCode).toBe(0)
  const payload = parseJsonOutput(result.stdout)
  const runId = payload.runId as string

  const metaResult = runCli(["runs", "show", runId, "--json"], playgroundDir)
  expect(metaResult.exitCode).toBe(0)
})
