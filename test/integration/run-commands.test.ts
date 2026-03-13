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

test("run executes a workflow backed by an imported scaffold-style tool", async () => {
  const projectRoot = await createTempProject();
  const result = runCli(
    ["--cwd", projectRoot, "run", "workflows/scaffolded.gr.yaml", "--input-json", '{"value":"Ada Lovelace"}', "--json"],
    repoRoot
  );
  const payload = parseJson(result.stdout);

  expect(result.exitCode).toBe(0);
  expect(payload.ok).toBe(true);
  expect(payload.output).toEqual({
    handle: "ada-lovelace"
  });
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

  const runDir = join(projectRoot, ".glyphrail/runs", `run_${payload.error.runId}`);
  const meta = await readJson(join(runDir, "meta.json"));
  const trace = await readTrace(join(runDir, "trace.jsonl"));

  expect(meta.status).toBe("failed");
  expect(meta.counters.failedSteps).toBeGreaterThanOrEqual(1);
  expect(trace.some((event: { event: string }) => event.event === "run.failed")).toBe(true);
  expect(trace.some((event: { event: string }) => event.event === "step.failed")).toBe(true);
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

test("run executes structured agent steps with repair and records agent trace events", async () => {
  const projectRoot = await createTempProject();
  const result = runCli(
    ["--cwd", projectRoot, "run", "workflows/agent-success.gr.yaml", "--json"],
    repoRoot
  );
  const payload = parseJson(result.stdout);

  expect(result.exitCode).toBe(0);
  expect(payload.output).toEqual({
    decision: {
      enoughEvidence: true,
      reason: "Two vendors are enough for the demo."
    }
  });

  const traceResult = runCli(["--cwd", projectRoot, "runs", "trace", payload.runId, "--json"], repoRoot);
  const tracePayload = parseJson(traceResult.stdout);
  const agentCompleted = tracePayload.events.find((event: { event: string }) => event.event === "agent.completed");

  expect(traceResult.exitCode).toBe(0);
  expect(tracePayload.events.some((event: { event: string }) => event.event === "agent.called")).toBe(true);
  expect(tracePayload.events.some((event: { event: string }) => event.event === "agent.completed")).toBe(true);
  expect(agentCompleted.meta.repairAttempted).toBe(true);
  expect(agentCompleted.meta.repairSucceeded).toBe(true);
});

test("agent validation failures remain inspectable through runs step and runs explain", async () => {
  const projectRoot = await createTempProject();
  const result = runCli(
    ["--cwd", projectRoot, "run", "workflows/agent-validation-failure.gr.yaml", "--json"],
    repoRoot
  );
  const payload = parseJson(result.stdout);

  expect(result.exitCode).toBe(5);
  expect(payload.error.code).toBe("AGENT_OUTPUT_VALIDATION_ERROR");

  const stepResult = runCli(
    ["--cwd", projectRoot, "runs", "step", payload.error.runId, "analyze", "--json"],
    repoRoot
  );
  const stepPayload = parseJson(stepResult.stdout);
  const explainResult = runCli(
    ["--cwd", projectRoot, "runs", "explain", payload.error.runId, "--json"],
    repoRoot
  );
  const explainPayload = parseJson(explainResult.stdout);

  expect(stepResult.exitCode).toBe(0);
  expect(stepPayload.summary.status).toBe("failed");
  expect(stepPayload.summary.agentCalls).toBe(1);
  expect(stepPayload.summary.lastError.code).toBe("AGENT_OUTPUT_VALIDATION_ERROR");

  expect(explainResult.exitCode).toBe(0);
  expect(explainPayload.failure.code).toBe("AGENT_OUTPUT_VALIDATION_ERROR");
  expect(explainPayload.steps.find((step: { stepId: string }) => step.stepId === "analyze").lastError.code).toBe(
    "AGENT_OUTPUT_VALIDATION_ERROR"
  );
});

test("run retries a structured agent step and persists retry counters", async () => {
  const projectRoot = await createTempProject();
  const result = runCli(
    ["--cwd", projectRoot, "run", "workflows/agent-retry.gr.yaml", "--json"],
    repoRoot
  );
  const payload = parseJson(result.stdout);

  expect(result.exitCode).toBe(0);
  expect(payload.output).toEqual({
    decision: {
      choice: "vendor-a"
    }
  });
  expect(payload.counters.retries).toBe(1);

  const showResult = runCli(["--cwd", projectRoot, "runs", "show", payload.runId, "--json"], repoRoot);
  const showPayload = parseJson(showResult.stdout);
  const explainResult = runCli(["--cwd", projectRoot, "runs", "explain", payload.runId, "--json"], repoRoot);
  const explainPayload = parseJson(explainResult.stdout);

  expect(showPayload.meta.retryCounters.analyze).toBe(1);
  expect(explainPayload.steps.find((step: { stepId: string }) => step.stepId === "analyze").attempts).toBe(2);
  expect(explainPayload.steps.find((step: { stepId: string }) => step.stepId === "analyze").retries).toBe(1);
});

test("run applies continue onError strategy for structured agent failures", async () => {
  const projectRoot = await createTempProject();

  const continueResult = runCli(
    ["--cwd", projectRoot, "run", "workflows/agent-continue.gr.yaml", "--json"],
    repoRoot
  );
  const continuePayload = parseJson(continueResult.stdout);
  expect(continueResult.exitCode).toBe(0);
  expect(continuePayload.output).toEqual({
    primary: null,
    status: "continued"
  });
});

test("run applies goto onError strategy for structured agent failures", async () => {
  const projectRoot = await createTempProject();
  const gotoResult = runCli(
    ["--cwd", projectRoot, "run", "workflows/agent-goto.gr.yaml", "--json"],
    repoRoot
  );
  const gotoPayload = parseJson(gotoResult.stdout);
  expect(gotoResult.exitCode).toBe(0);
  expect(gotoPayload.output).toEqual({
    primary: null,
    path: "fallback",
    skipped: false
  });
});

test("resume restores a paused run from a while-body checkpoint", async () => {
  const projectRoot = await createTempProject();
  const interruptedResult = runCli(
    ["--cwd", projectRoot, "run", "workflows/resume-loop.gr.yaml", "--json"],
    repoRoot
  );

  expect(interruptedResult.exitCode).toBe(86);
  expect(interruptedResult.stdout.trim()).toBe("");

  const listResult = runCli(["--cwd", projectRoot, "runs", "list", "--json"], repoRoot);
  const listPayload = parseJson(listResult.stdout);
  const pausedRun = listPayload.runs.find((run: { status: string }) => run.status === "paused");

  expect(listResult.exitCode).toBe(0);
  expect(pausedRun).toBeDefined();

  const showResult = runCli(["--cwd", projectRoot, "runs", "show", pausedRun.runId, "--json"], repoRoot);
  const showPayload = parseJson(showResult.stdout);
  const stateResult = runCli(["--cwd", projectRoot, "runs", "state", pausedRun.runId, "--json"], repoRoot);
  const statePayload = parseJson(stateResult.stdout);

  expect(showResult.exitCode).toBe(0);
  expect(showPayload.meta.status).toBe("paused");
  expect(showPayload.meta.currentStepId).toBe("maybe_interrupt");
  expect(showPayload.meta.counters.loopIterations).toBe(2);
  expect(statePayload.state.count).toBe(2);

  const resumeResult = runCli(["--cwd", projectRoot, "resume", pausedRun.runId, "--json"], repoRoot);
  const resumePayload = parseJson(resumeResult.stdout);

  expect(resumeResult.exitCode).toBe(0);
  expect(resumePayload.command).toBe("resume");
  expect(resumePayload.output).toEqual({
    count: 3,
    resumeSignal: {
      resumed: true
    }
  });
  expect(resumePayload.counters.loopIterations).toBe(3);

  const finalShowResult = runCli(["--cwd", projectRoot, "runs", "show", pausedRun.runId, "--json"], repoRoot);
  const finalShowPayload = parseJson(finalShowResult.stdout);

  expect(finalShowResult.exitCode).toBe(0);
  expect(finalShowPayload.meta.status).toBe("completed");
  expect(finalShowPayload.meta.counters.loopIterations).toBe(3);
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
