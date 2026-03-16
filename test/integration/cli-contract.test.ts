import { expect, test } from "bun:test";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const cliEntry = join(repoRoot, "src/cli/index.ts");
const fixturesRoot = join(repoRoot, "test/fixtures/init-project");

test("capabilities emits the Slice 6 JSON contract", () => {
  const result = runCli(["capabilities", "--json"], repoRoot);
  const payload = parseJsonOutput(result.stdout);

  expect(result.exitCode).toBe(0);
  expect(payload.ok).toBe(true);
  expect(payload.name).toBe("glyphrail");
  expect(payload.slice).toBe(6);
  expect(payload.commands).toContain("init");
  expect(payload.commands).toContain("check");
  expect(payload.commands).toContain("tool list");
  expect(payload.commands).toContain("tool call");
  expect(payload.commands).toContain("workflow create");
  expect(payload.commands).toContain("run");
  expect(payload.commands).toContain("resume");
  expect(payload.commands).toContain("runs list");
  expect(payload.commands).toContain("runs show");
  expect(payload.commands).toContain("runs step");
  expect(payload.commands).toContain("runs explain");
  expect(payload.features.execution).toBe(true);
  expect(payload.features.resume).toBe(true);
  expect(payload.features.runsList).toBe(true);
  expect(payload.features.tools).toBe(true);
  expect(payload.features.trace).toBe(true);
  expect(payload.features.structuredAgent).toBe(true);
  expect(payload.features.projectCheck).toBe(true);
  expect(payload.traceEventTypes).toContain("run.paused");
  expect(payload.exitCodes.paused).toBe(6);
  expect(payload.agentAdapters).toEqual(["mock"]);
  expect(payload.runArtifacts.rootPattern).toBe(".glyphrail/runs/run_<id>/");
  expect(payload.toolRegistryEntry.export).toBe("default");
  expect(payload.toolRegistryEntry.shape).toBe("Tool[]");
  expect(payload.toolRegistryEntry.helper).toBe("defineTools (optional)");
});

test("schema emits machine-readable schema documents", () => {
  const result = runCli(["schema", "--json"], repoRoot);
  const payload = parseJsonOutput(result.stdout);

  expect(result.exitCode).toBe(0);
  expect(payload.ok).toBe(true);
  expect(payload.schemaNames).toContain("workflow");
  expect(payload.schemaNames).toContain("json-schema-subset");
  expect(payload.schemas.config.properties.workflowsDir.type).toBe("string");
  expect(payload.schemas.workflow.additionalProperties).toBe(false);
  expect(payload.schemas.tool.properties.inputSchema.$ref).toBe("#/$defs/jsonSchema");
  expect(payload.schemas["json-schema-subset"].$defs.jsonSchema.additionalProperties).toBe(false);
  expect(payload.schemas["run-record"].title).toBe("RunRecord");
});

test("init creates the expected project files and directories", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "glyphrail-init-"));
  const result = runCli(["--cwd", tempDir, "init", "--json"], repoRoot);
  const payload = parseJsonOutput(result.stdout);

  expect(result.exitCode).toBe(0);
  expect(payload.ok).toBe(true);
  expect(payload.created).toContain("glyphrail.config.json");
  expect(payload.created).toContain("workflows/hello.gr.yaml");
  expect(payload.created).toContain("glyphrail.tools.ts");

  const generatedConfig = await readFile(join(tempDir, "glyphrail.config.json"), "utf8");
  const generatedWorkflow = await readFile(join(tempDir, "workflows/hello.gr.yaml"), "utf8");
  const generatedTools = await readFile(join(tempDir, "glyphrail.tools.ts"), "utf8");
  const expectedConfig = await readFile(join(fixturesRoot, "glyphrail.config.json"), "utf8");
  const expectedWorkflow = await readFile(join(fixturesRoot, "workflows/hello.gr.yaml"), "utf8");
  const expectedTools = await readFile(join(fixturesRoot, "glyphrail.tools.ts"), "utf8");
  const runsDirectory = await stat(join(tempDir, ".glyphrail/runs"));

  expect(generatedConfig).toBe(normalizeText(expectedConfig));
  expect(generatedWorkflow).toBe(normalizeText(expectedWorkflow));
  expect(generatedTools).toBe(normalizeText(expectedTools));
  expect(runsDirectory.isDirectory()).toBe(true);
});

test("workflow create scaffolds into the configured workflows directory", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "glyphrail-workflow-"));
  const initResult = runCli(["--cwd", tempDir, "init", "--json"], repoRoot);
  expect(initResult.exitCode).toBe(0);

  const result = runCli(
    ["--cwd", tempDir, "workflow", "create", "research-loop", "--template", "basic", "--json"],
    repoRoot
  );
  const payload = parseJsonOutput(result.stdout);
  const generatedWorkflow = await readFile(join(tempDir, "workflows/research-loop.gr.yaml"), "utf8");

  expect(result.exitCode).toBe(0);
  expect(payload.ok).toBe(true);
  expect(payload.file).toBe("workflows/research-loop.gr.yaml");
  expect(generatedWorkflow).toContain('name: research-loop');
  expect(generatedWorkflow).toContain("kind: assign");
});

test("check validates a clean initialized project", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "glyphrail-check-"));
  const initResult = runCli(["--cwd", tempDir, "init", "--json"], repoRoot);
  expect(initResult.exitCode).toBe(0);

  const result = runCli(["--cwd", tempDir, "check", "--json"], repoRoot);
  const payload = parseJsonOutput(result.stdout);

  expect(result.exitCode).toBe(0);
  expect(payload.ok).toBe(true);
  expect(payload.command).toBe("check");
  expect(payload.workflows.errorCount).toBe(0);
  expect(payload.tools.issues).toEqual([]);
  expect(payload.tools.toolCount).toBeGreaterThan(0);
});

test("run executes the initialized hello workflow without a local glyphrail package link", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "glyphrail-run-init-"));
  const initResult = runCli(["--cwd", tempDir, "init", "--json"], repoRoot);
  expect(initResult.exitCode).toBe(0);

  const result = runCli(
    ["--cwd", tempDir, "run", "workflows/hello.gr.yaml", "--input-json", '{"name":"Ada"}', "--json"],
    repoRoot
  );
  const payload = parseJsonOutput(result.stdout);

  expect(result.exitCode).toBe(0);
  expect(payload.ok).toBe(true);
  expect(payload.command).toBe("run");
  expect(payload.status).toBe("completed");
  expect(payload.output).toEqual({
    greeting: "Hello, Ada!"
  });
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

function parseJsonOutput(output: string): any {
  return JSON.parse(output);
}

function normalizeText(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}
