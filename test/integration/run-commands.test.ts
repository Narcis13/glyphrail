import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const cliEntry = join(repoRoot, "src/cli/index.ts");
const fixtureProjectRoot = join(repoRoot, "test/fixtures/workflow-project");

test("run executes a linear workflow and persists output and trace artifacts", async () => {
  const projectRoot = await createTempProject();
  const result = runCli(
    ["--cwd", projectRoot, "run", "workflows/linear.gr.yaml", "--input-json", '{"name":"Ada"}', "--json"],
    repoRoot
  );
  const payload = parseJson(result.stdout);

  expect(result.exitCode).toBe(0);
  expect(payload.ok).toBe(true);
  expect(payload.command).toBe("run");
  expect(payload.status).toBe("completed");
  expect(payload.output).toEqual({
    greeting: "Hello, Ada!"
  });

  const state = await readJson(join(projectRoot, payload.artifacts.state));
  const output = await readJson(join(projectRoot, payload.artifacts.output));
  const meta = await readJson(join(projectRoot, payload.artifacts.meta));
  const traceEvents = await readTrace(join(projectRoot, payload.artifacts.trace));

  expect(state).toEqual({
    name: "Ada",
    greeting: "Hello, Ada!"
  });
  expect(output).toEqual(payload.output);
  expect(meta.runId).toBe(payload.runId);
  expect(meta.status).toBe("completed");
  expect(meta.counters.completedSteps).toBe(3);
  expect(traceEvents.map((event: { event: string }) => event.event)).toEqual([
    "run.started",
    "step.started",
    "step.completed",
    "checkpoint.saved",
    "step.started",
    "tool.called",
    "tool.completed",
    "step.completed",
    "checkpoint.saved",
    "step.started",
    "step.completed",
    "checkpoint.saved",
    "run.completed"
  ]);
});

test("runs show/state/output/trace read persisted artifacts from a completed run", async () => {
  const projectRoot = await createTempProject();
  const runResult = runCli(
    ["--cwd", projectRoot, "run", "workflows/conditional.gr.yaml", "--json"],
    repoRoot
  );
  const runPayload = parseJson(runResult.stdout);
  expect(runResult.exitCode).toBe(0);

  const showResult = runCli(["--cwd", projectRoot, "runs", "show", runPayload.runId, "--json"], repoRoot);
  const showPayload = parseJson(showResult.stdout);
  const stateResult = runCli(["--cwd", projectRoot, "runs", "state", runPayload.runId, "--json"], repoRoot);
  const statePayload = parseJson(stateResult.stdout);
  const outputResult = runCli(["--cwd", projectRoot, "runs", "output", runPayload.runId, "--json"], repoRoot);
  const outputPayload = parseJson(outputResult.stdout);
  const traceResult = runCli(
    ["--cwd", projectRoot, "runs", "trace", runPayload.runId, "--event", "tool.completed", "--json"],
    repoRoot
  );
  const tracePayload = parseJson(traceResult.stdout);

  expect(showResult.exitCode).toBe(0);
  expect(showPayload.meta.workflow.name).toBe("conditional-demo");
  expect(statePayload.state.flags.enough).toBe(true);
  expect(outputPayload.output.result).toEqual({
    vendor: "demo-vendor"
  });
  expect(tracePayload.eventCount).toBe(1);
  expect(tracePayload.events[0].event).toBe("tool.completed");
});

test("run supports for_each aggregation and while loop success", async () => {
  const projectRoot = await createTempProject();

  const foreachResult = runCli(
    ["--cwd", projectRoot, "run", "workflows/foreach.gr.yaml", "--json"],
    repoRoot
  );
  const foreachPayload = parseJson(foreachResult.stdout);
  expect(foreachResult.exitCode).toBe(0);
  expect(foreachPayload.output).toEqual({
    greetings: ["Hello, Ada!", "Hello, Grace!"]
  });
  expect(foreachPayload.counters.loopIterations).toBe(2);

  const whileResult = runCli(
    ["--cwd", projectRoot, "run", "workflows/while-success.gr.yaml", "--json"],
    repoRoot
  );
  const whilePayload = parseJson(whileResult.stdout);
  expect(whileResult.exitCode).toBe(0);
  expect(whilePayload.output).toEqual({
    count: 3
  });
  expect(whilePayload.counters.loopIterations).toBe(3);
});

test("run records failure artifacts for while max-iterations exhaustion", async () => {
  const projectRoot = await createTempProject();
  const result = runCli(
    ["--cwd", projectRoot, "run", "workflows/while-max-iterations.gr.yaml", "--json"],
    repoRoot
  );
  const payload = parseJson(result.stdout);

  expect(result.exitCode).toBe(5);
  expect(payload.ok).toBe(false);
  expect(payload.error.code).toBe("BUDGET_EXHAUSTION");
  expect(payload.error.runId).toBeDefined();
  expect(payload.error.stepId).toBe("stuck_loop");

  const showResult = runCli(["--cwd", projectRoot, "runs", "show", payload.error.runId, "--json"], repoRoot);
  const showPayload = parseJson(showResult.stdout);
  const traceResult = runCli(["--cwd", projectRoot, "runs", "trace", payload.error.runId, "--json"], repoRoot);
  const tracePayload = parseJson(traceResult.stdout);

  expect(showResult.exitCode).toBe(0);
  expect(showPayload.meta.status).toBe("failed");
  expect(showPayload.meta.counters.failedSteps).toBeGreaterThanOrEqual(1);
  expect(tracePayload.events.some((event: { event: string }) => event.event === "run.failed")).toBe(true);
  expect(tracePayload.events.some((event: { event: string }) => event.event === "step.failed")).toBe(true);
});

test("run propagates fail-step errors and preserves latest state", async () => {
  const projectRoot = await createTempProject();
  const result = runCli(
    ["--cwd", projectRoot, "run", "workflows/fail.gr.yaml", "--json"],
    repoRoot
  );
  const payload = parseJson(result.stdout);

  expect(result.exitCode).toBe(5);
  expect(payload.ok).toBe(false);
  expect(payload.error.code).toBe("DEMO_FAILURE");

  const stateResult = runCli(["--cwd", projectRoot, "runs", "state", payload.error.runId, "--json"], repoRoot);
  const statePayload = parseJson(stateResult.stdout);

  expect(statePayload.state.stage).toBe("pre-fail");
});

function runCli(args: string[], cwd: string) {
  const processResult = Bun.spawnSync(["bun", "run", cliEntry, ...args], {
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

async function createTempProject(): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), "glyphrail-run-"));
  const targetRoot = join(tempDir, "project");
  await cp(fixtureProjectRoot, targetRoot, { recursive: true });
  await mkdir(join(targetRoot, "node_modules"), { recursive: true });
  await symlink(repoRoot, join(targetRoot, "node_modules/glyphrail"), "dir");
  return targetRoot;
}

function parseJson(output: string): any {
  return JSON.parse(output);
}

async function readJson(path: string): Promise<any> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readTrace(path: string): Promise<any[]> {
  const content = await readFile(path, "utf8");
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
