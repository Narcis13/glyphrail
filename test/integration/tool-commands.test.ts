import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const cliEntry = join(repoRoot, "src/cli/index.ts");
const fixtureProjectRoot = join(repoRoot, "test/fixtures/workflow-project");
const initFixtureRoot = join(repoRoot, "test/fixtures/init-project");

test("tool list/show/call expose registered tool contracts and direct execution", async () => {
  const projectRoot = await createTempProject();

  const listResult = runCli(["--cwd", projectRoot, "tool", "list", "--json"], repoRoot);
  const listPayload = parseJson(listResult.stdout);
  const showResult = runCli(["--cwd", projectRoot, "tool", "show", "formatHandle", "--json"], repoRoot);
  const showPayload = parseJson(showResult.stdout);
  const callResult = runCli(
    ["--cwd", projectRoot, "tool", "call", "makeGreeting", "--input-json", '{"name":"Ada"}', "--json"],
    repoRoot
  );
  const callPayload = parseJson(callResult.stdout);

  expect(listResult.exitCode).toBe(0);
  expect(listPayload.ok).toBe(true);
  expect(listPayload.toolCount).toBe(6);
  expect(listPayload.tools.some((tool: { name: string }) => tool.name === "formatHandle")).toBe(true);
  expect(listPayload.tools.some((tool: { name: string }) => tool.name === "interruptOnce")).toBe(true);
  expect(listPayload.tools.find((tool: { name: string }) => tool.name === "makeGreeting").inputSchema.properties.name.type).toBe("string");

  expect(showResult.exitCode).toBe(0);
  expect(showPayload.tool.name).toBe("formatHandle");
  expect(showPayload.tool.tags).toEqual(["compute"]);
  expect(showPayload.tool.outputSchema.properties.handle.type).toBe("string");

  expect(callResult.exitCode).toBe(0);
  expect(callPayload.command).toBe("tool.call");
  expect(callPayload.output).toBe("Hello, Ada!");
});

test("tool call reports runtime errors from throwing tools", async () => {
  const projectRoot = await createTempProject();
  const result = runCli(
    ["--cwd", projectRoot, "tool", "call", "alwaysFails", "--input-json", '{"reason":"kaboom"}', "--json"],
    repoRoot
  );
  const payload = parseJson(result.stdout);

  expect(result.exitCode).toBe(5);
  expect(payload.ok).toBe(false);
  expect(payload.error.code).toBe("TOOL_RUNTIME_ERROR");
  expect(payload.error.message).toContain("alwaysFails");
});

test("tool call blocks external side effects when project policy disables them", async () => {
  const projectRoot = await createTempProject();
  const result = runCli(
    ["--cwd", projectRoot, "tool", "call", "sendWebhook", "--input-json", '{"url":"https://example.com"}', "--json"],
    repoRoot
  );
  const payload = parseJson(result.stdout);

  expect(result.exitCode).toBe(8);
  expect(payload.ok).toBe(false);
  expect(payload.error.code).toBe("POLICY_VIOLATION");
});

test("tool scaffold creates a module file and registers it in glyphrail.tools.ts", async () => {
  const projectRoot = await createInitializedProject();
  const scaffoldResult = runCli(
    ["--cwd", projectRoot, "tool", "scaffold", "format-handle", "--json"],
    repoRoot
  );
  const scaffoldPayload = parseJson(scaffoldResult.stdout);
  const entrySource = await readFile(join(projectRoot, "glyphrail.tools.ts"), "utf8");
  const moduleSource = await readFile(join(projectRoot, "tools/format-handle.ts"), "utf8");
  const listResult = runCli(["--cwd", projectRoot, "tool", "list", "--json"], repoRoot);
  const listPayload = parseJson(listResult.stdout);

  expect(scaffoldResult.exitCode).toBe(0);
  expect(scaffoldPayload.created).toContain("tools/format-handle.ts");
  expect(scaffoldPayload.updated).toContain("glyphrail.tools.ts");
  expect(entrySource).toContain('import { formatHandle } from "./tools/format-handle";');
  expect(entrySource).toContain("formatHandle");
  expect(moduleSource).toContain('name: "formatHandle"');

  expect(listResult.exitCode).toBe(0);
  expect(listPayload.tools.some((tool: { name: string }) => tool.name === "formatHandle")).toBe(true);
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
  const tempDir = await mkdtemp(join(tmpdir(), "glyphrail-tool-"));
  const targetRoot = join(tempDir, "project");
  await cp(fixtureProjectRoot, targetRoot, { recursive: true });
  await ensureGlyphrailPackageLink(targetRoot);
  return targetRoot;
}

async function createInitializedProject(): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), "glyphrail-tool-init-"));
  const targetRoot = join(tempDir, "project");
  await cp(initFixtureRoot, targetRoot, { recursive: true });
  await ensureGlyphrailPackageLink(targetRoot);
  return targetRoot;
}

async function ensureGlyphrailPackageLink(projectRoot: string): Promise<void> {
  await mkdir(join(projectRoot, "node_modules"), { recursive: true });
  await symlink(repoRoot, join(projectRoot, "node_modules/glyphrail"), "dir");
}

function parseJson(output: string): any {
  return JSON.parse(output);
}
