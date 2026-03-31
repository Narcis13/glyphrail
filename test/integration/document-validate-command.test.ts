import { expect, test } from "bun:test"
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

test("document validate succeeds for valid .gr.md with blocks", () => {
  const result = runCli(
    ["document", "validate", "documents/report.gr.md", "--json"],
    playgroundDir
  )

  expect(result.exitCode).toBe(0)
  const payload = parseJsonOutput(result.stdout)
  expect(payload.ok).toBe(true)
  expect(payload.command).toBe("document.validate")
  expect(payload.valid).toBe(true)
  expect(payload.errors).toBe(0)
})

test("document validate succeeds for simple .gr.md", () => {
  const result = runCli(
    ["document", "validate", "documents/hello.gr.md", "--json"],
    playgroundDir
  )

  expect(result.exitCode).toBe(0)
  const payload = parseJsonOutput(result.stdout)
  expect(payload.ok).toBe(true)
  expect(payload.valid).toBe(true)
})

test("document validate fails for nonexistent file", () => {
  const result = runCli(
    ["document", "validate", "documents/nonexistent.gr.md", "--json"],
    playgroundDir
  )

  expect(result.exitCode).not.toBe(0)
})

test("document validate reports workflow name and version", () => {
  const result = runCli(
    ["document", "validate", "documents/report.gr.md", "--json"],
    playgroundDir
  )

  expect(result.exitCode).toBe(0)
  const payload = parseJsonOutput(result.stdout)
  expect(payload.workflow).toBeTruthy()
  expect(payload.workflow.name).toBeTruthy()
  expect(payload.workflow.version).toBe("1.0")
})

test("render command produces rendered markdown from .gr.md with blocks", () => {
  const result = runCli(
    ["render", "documents/report.gr.md", "--input-json", '{"title":"Weekly Report"}', "--json"],
    playgroundDir
  )

  expect(result.exitCode).toBe(0)
  const payload = parseJsonOutput(result.stdout)
  expect(payload.ok).toBe(true)
  expect(payload.rendered).toContain("Weekly Report")
  expect(payload.rendered).toContain("Feature A")
  expect(payload.rendered).toContain("No blockers")
})
