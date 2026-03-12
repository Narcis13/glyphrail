import { expect, test } from "bun:test";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const cliEntry = join(repoRoot, "src/cli/index.ts");
const fixturesRoot = join(repoRoot, "test/fixtures/init-project");

test("capabilities emits the Slice 1 JSON contract", () => {
  const result = runCli(["capabilities", "--json"], repoRoot);
  const payload = parseJsonOutput(result.stdout);

  expect(result.exitCode).toBe(0);
  expect(payload.ok).toBe(true);
  expect(payload.name).toBe("glyphrail");
  expect(payload.commands).toContain("init");
  expect(payload.commands).toContain("workflow create");
  expect(payload.features.execution).toBe(false);
});

test("schema emits machine-readable schema documents", () => {
  const result = runCli(["schema", "--json"], repoRoot);
  const payload = parseJsonOutput(result.stdout);

  expect(result.exitCode).toBe(0);
  expect(payload.ok).toBe(true);
  expect(payload.schemaNames).toContain("workflow");
  expect(payload.schemas.config.properties.workflowsDir.type).toBe("string");
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

function parseJsonOutput(output: string): any {
  return JSON.parse(output);
}

function normalizeText(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}
