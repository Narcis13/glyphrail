import { expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const cliEntry = join(repoRoot, "src/cli/index.ts");
const fixtureProjectRoot = join(repoRoot, "test/fixtures/workflow-project");

test("workflow validate returns a stable JSON contract for a valid workflow", () => {
  const result = runCli(
    ["--cwd", fixtureProjectRoot, "workflow", "validate", "workflows/linear.gr.yaml", "--json"],
    repoRoot
  );
  const payload = parseJson(result.stdout);

  expect(result.exitCode).toBe(0);
  expect(payload.ok).toBe(true);
  expect(payload.command).toBe("workflow.validate");
  expect(payload.file).toBe("workflows/linear.gr.yaml");
  expect(payload.workflow.name).toBe("linear-demo");
  expect(payload.workflow.stepCount).toBe(3);
  expect(payload.referencedTools).toEqual(["makeGreeting"]);
});

test("workflow explain surfaces metadata, inventory, control flow, and risk points", () => {
  const result = runCli(
    ["--cwd", fixtureProjectRoot, "workflow", "explain", "workflows/conditional.gr.yaml", "--json"],
    repoRoot
  );
  const payload = parseJson(result.stdout);

  expect(result.exitCode).toBe(0);
  expect(payload.ok).toBe(true);
  expect(payload.command).toBe("workflow.explain");
  expect(payload.metadata.name).toBe("conditional-demo");
  expect(payload.referencedTools).toEqual(["selectVendor"]);
  expect(payload.controlFlow.conditionals).toContain("branch_on_score");
  expect(payload.stepInventory.some((step: { id: string; kind: string }) => step.id === "select" && step.kind === "tool")).toBe(true);
});

test("workflow lint reports warnings without failing the command", () => {
  const result = runCli(
    ["--cwd", fixtureProjectRoot, "workflow", "lint", "workflows/lint.gr.yaml", "--json"],
    repoRoot
  );
  const payload = parseJson(result.stdout);
  const warningCodes = payload.warnings.map((warning: { code: string }) => warning.code);

  expect(result.exitCode).toBe(0);
  expect(payload.ok).toBe(true);
  expect(payload.warningCount).toBeGreaterThanOrEqual(3);
  expect(warningCodes).toContain("AGENT_OUTPUT_SCHEMA_MISSING");
  expect(warningCodes).toContain("CONSTANT_CONDITION");
  expect(warningCodes).toContain("OUTPUT_PATH_MISSING");
});

test("workflow validate returns the documented error envelope for invalid workflows", () => {
  const result = runCli(
    ["--cwd", fixtureProjectRoot, "workflow", "validate", "workflows/invalid.gr.yaml", "--json"],
    repoRoot
  );
  const payload = parseJson(result.stdout);

  expect(result.exitCode).toBe(3);
  expect(payload.ok).toBe(false);
  expect(payload.error.code).toBe("WORKFLOW_VALIDATION_ERROR");
  expect(payload.error.details.file).toBe("workflows/invalid.gr.yaml");
  expect(payload.error.details.errors.some((error: { code: string }) => error.code === "MISSING_MAX_ITERATIONS")).toBe(
    true
  );
});

function runCli(args: string[], cwd: string) {
  const processResult = Bun.spawnSync(["bun", cliEntry, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe"
  });

  return {
    exitCode: processResult.exitCode,
    stdout: processResult.stdout.toString(),
    stderr: processResult.stderr.toString()
  };
}

function parseJson(output: string): any {
  return JSON.parse(output);
}
