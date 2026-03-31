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

// --from-run: execute once, then re-render from the run
test("render --from-run re-renders template against past run results", () => {
  // First, do a normal render to get a run ID
  const first = runCli(
    ["render", "documents/hello.gr.md", "--input-json", '{"name":"FromRun"}', "--json"],
    playgroundDir
  )
  expect(first.exitCode).toBe(0)
  const firstPayload = parseJsonOutput(first.stdout)
  const runId = firstPayload.runId as string
  expect(runId).toBeTruthy()

  // Now re-render from that run
  const second = runCli(
    ["render", "documents/hello.gr.md", "--from-run", runId, "--json"],
    playgroundDir
  )
  expect(second.exitCode).toBe(0)
  const secondPayload = parseJsonOutput(second.stdout)
  expect(secondPayload.ok).toBe(true)
  expect(secondPayload.fromRun).toBe(runId)
  expect(secondPayload.rendered).toContain("Hello FromRun")
})

// --format html: render as HTML
test("render --format html produces HTML output", () => {
  const result = runCli(
    ["render", "documents/hello.gr.md", "--input-json", '{"name":"HTML"}', "--format", "html", "--json"],
    playgroundDir
  )
  expect(result.exitCode).toBe(0)
  const payload = parseJsonOutput(result.stdout)
  expect(payload.ok).toBe(true)
  expect(payload.format).toBe("html")
  expect(payload.rendered).toContain("<!DOCTYPE html>")
  expect(payload.rendered).toContain("<html")
  expect(payload.rendered).toContain("Hello HTML")
  expect(payload.rendered).toContain("</html>")
})

// --format html + --from-run: combine both flags
test("render --from-run --format html combines re-render with HTML output", () => {
  const first = runCli(
    ["render", "documents/hello.gr.md", "--input-json", '{"name":"Combo"}', "--json"],
    playgroundDir
  )
  const runId = parseJsonOutput(first.stdout).runId as string

  const result = runCli(
    ["render", "documents/hello.gr.md", "--from-run", runId, "--format", "html", "--json"],
    playgroundDir
  )
  expect(result.exitCode).toBe(0)
  const payload = parseJsonOutput(result.stdout)
  expect(payload.rendered).toContain("<!DOCTYPE html>")
  expect(payload.rendered).toContain("Hello Combo")
})

// --format invalid: error
test("render --format invalid returns error", () => {
  const result = runCli(
    ["render", "documents/hello.gr.md", "--input-json", '{"name":"X"}', "--format", "pdf", "--json"],
    playgroundDir
  )
  expect(result.exitCode).not.toBe(0)
})

// document explain
test("document explain shows workflow and template structure", () => {
  const result = runCli(
    ["document", "explain", "documents/hello.gr.md", "--json"],
    playgroundDir
  )
  expect(result.exitCode).toBe(0)
  const payload = parseJsonOutput(result.stdout)
  expect(payload.ok).toBe(true)
  expect(payload.command).toBe("document.explain")
  expect(payload.valid).toBe(true)
  expect(payload.workflow.name).toBe("hello-document")
  expect(payload.workflow.stepCount).toBeGreaterThan(0)
  expect(payload.template.interpolations.length).toBeGreaterThan(0)
})

test("document explain shows blocks for report", () => {
  const result = runCli(
    ["document", "explain", "documents/report.gr.md", "--json"],
    playgroundDir
  )
  expect(result.exitCode).toBe(0)
  const payload = parseJsonOutput(result.stdout)
  expect(payload.ok).toBe(true)
  expect(payload.template.eachBlocks.length).toBeGreaterThan(0)
  expect(payload.template.ifBlocks.length).toBeGreaterThan(0)
})

test("document explain produces human-readable output", () => {
  const result = runCli(
    ["document", "explain", "documents/report.gr.md"],
    playgroundDir
  )
  expect(result.exitCode).toBe(0)
  expect(result.stdout).toContain("Document:")
  expect(result.stdout).toContain("Workflow")
  expect(result.stdout).toContain("Template")
  expect(result.stdout).toContain("report-document")
})

// HTML output preserves structure
test("HTML output converts markdown headings and lists", () => {
  const result = runCli(
    ["render", "documents/report.gr.md", "--input-json", '{"title":"HTML Report"}', "--format", "html", "--json"],
    playgroundDir
  )
  expect(result.exitCode).toBe(0)
  const payload = parseJsonOutput(result.stdout)
  expect(payload.rendered).toContain("<h1>")
  expect(payload.rendered).toContain("HTML Report")
  expect(payload.rendered).toContain("<li>")
  expect(payload.rendered).toContain("<strong>")
})
