import { expect, test } from "bun:test";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { startHttpFixtureServer } from "../support/http-fixture";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const cliEntry = join(repoRoot, "src/cli/index.ts");
const fixtureProjectRoot = join(repoRoot, "test/fixtures/workflow-project");
const initFixtureRoot = join(repoRoot, "test/fixtures/init-project");

test("tool list/show/call expose registered tool contracts and direct execution", async () => {
  const projectRoot = await createTempProject();

  const listResult = runCli(["--cwd", projectRoot, "tool", "list", "--json"], repoRoot);
  const listPayload = parseJson(listResult.stdout);
  const showResult = runCli(["--cwd", projectRoot, "tool", "show", "fileRead", "--json"], repoRoot);
  const showPayload = parseJson(showResult.stdout);
  const callResult = runCli(
    ["--cwd", projectRoot, "tool", "call", "makeGreeting", "--input-json", '{"name":"Ada"}', "--json"],
    repoRoot
  );
  const callPayload = parseJson(callResult.stdout);

  expect(listResult.exitCode).toBe(0);
  expect(listPayload.ok).toBe(true);
  expect(listPayload.toolCount).toBe(12);
  expect(listPayload.tools.some((tool: { name: string }) => tool.name === "fileRead")).toBe(true);
  expect(listPayload.tools.some((tool: { name: string }) => tool.name === "fileWrite")).toBe(true);
  expect(listPayload.tools.some((tool: { name: string }) => tool.name === "fileEdit")).toBe(true);
  expect(listPayload.tools.some((tool: { name: string }) => tool.name === "bash")).toBe(true);
  expect(listPayload.tools.some((tool: { name: string }) => tool.name === "fetch")).toBe(true);
  expect(listPayload.tools.some((tool: { name: string }) => tool.name === "formatHandle")).toBe(true);
  expect(listPayload.tools.some((tool: { name: string }) => tool.name === "interruptOnce")).toBe(true);
  expect(listPayload.tools.some((tool: { name: string }) => tool.name === "failOnceGreeting")).toBe(true);
  expect(listPayload.tools.find((tool: { name: string }) => tool.name === "makeGreeting").inputSchema.properties.name.type).toBe("string");

  expect(showResult.exitCode).toBe(0);
  expect(showPayload.tool.name).toBe("fileRead");
  expect(showPayload.tool.sideEffect).toBe("read");
  expect(showPayload.tool.tags).toEqual(["file", "io"]);
  expect(showPayload.tool.outputSchema.properties.content.type).toBe("string");

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

test("tool call exercises built-in file, shell, and fetch tools when policy allows side effects", async () => {
  const projectRoot = await createTempProject({
    allowExternalSideEffects: true
  });
  const server = await startHttpFixtureServer();

  try {
    const writeResult = runCli(
      [
        "--cwd",
        projectRoot,
        "tool",
        "call",
        "fileWrite",
        "--input-json",
        '{"path":"tmp/demo.txt","content":"alpha beta"}',
        "--json"
      ],
      repoRoot
    );
    const writePayload = parseJson(writeResult.stdout);
    expect(writeResult.exitCode).toBe(0);
    expect(writePayload.output).toEqual({
      path: "tmp/demo.txt",
      bytesWritten: 10,
      mode: "overwrite"
    });

    const readResult = runCli(
      [
        "--cwd",
        projectRoot,
        "tool",
        "call",
        "fileRead",
        "--input-json",
        '{"path":"tmp/demo.txt"}',
        "--json"
      ],
      repoRoot
    );
    const readPayload = parseJson(readResult.stdout);
    expect(readResult.exitCode).toBe(0);
    expect(readPayload.output.content).toBe("alpha beta");

    const editResult = runCli(
      [
        "--cwd",
        projectRoot,
        "tool",
        "call",
        "fileEdit",
        "--input-json",
        '{"path":"tmp/demo.txt","oldText":"beta","newText":"gamma"}',
        "--json"
      ],
      repoRoot
    );
    const editPayload = parseJson(editResult.stdout);
    expect(editResult.exitCode).toBe(0);
    expect(editPayload.output).toEqual({
      path: "tmp/demo.txt",
      replacements: 1
    });

    const finalContents = await readFile(join(projectRoot, "tmp/demo.txt"), "utf8");
    expect(finalContents).toBe("alpha gamma");

    const bashResult = runCli(
      [
        "--cwd",
        projectRoot,
        "tool",
        "call",
        "bash",
        "--input-json",
        '{"command":"printf shell-ok"}',
        "--json"
      ],
      repoRoot
    );
    const bashPayload = parseJson(bashResult.stdout);
    expect(bashResult.exitCode).toBe(0);
    expect(bashPayload.output.stdout).toBe("shell-ok");
    expect(bashPayload.output.succeeded).toBe(true);

    const fetchResult = runCli(
      [
        "--cwd",
        projectRoot,
        "tool",
        "call",
        "fetch",
        "--input-json",
        JSON.stringify({
          url: `${server.baseUrl}/json`,
          method: "PATCH",
          query: {
            source: "tool-call"
          },
          body: {
            greeting: "hello"
          }
        }),
        "--json"
      ],
      repoRoot
    );
    const fetchPayload = parseJson(fetchResult.stdout);
    expect(fetchResult.exitCode).toBe(0);
    expect(fetchPayload.output.status).toBe(200);
    expect(fetchPayload.output.body.method).toBe("PATCH");
    expect(fetchPayload.output.body.query.source).toBe("tool-call");
    expect(fetchPayload.output.body.body.greeting).toBe("hello");
  } finally {
    await server.stop();
  }
});

test("tool call rejects project-root escapes and invalid fetch json responses", async () => {
  const projectRoot = await createTempProject({
    allowExternalSideEffects: true
  });
  const server = await startHttpFixtureServer();

  try {
    const escapeResult = runCli(
      [
        "--cwd",
        projectRoot,
        "tool",
        "call",
        "fileRead",
        "--input-json",
        '{"path":"../outside.txt"}',
        "--json"
      ],
      repoRoot
    );
    const escapePayload = parseJson(escapeResult.stdout);
    expect(escapeResult.exitCode).toBe(8);
    expect(escapePayload.error.code).toBe("POLICY_VIOLATION");

    const invalidJsonResult = runCli(
      [
        "--cwd",
        projectRoot,
        "tool",
        "call",
        "fetch",
        "--input-json",
        JSON.stringify({
          url: `${server.baseUrl}/invalid-json`,
          responseType: "json"
        }),
        "--json"
      ],
      repoRoot
    );
    const invalidJsonPayload = parseJson(invalidJsonResult.stdout);
    expect(invalidJsonResult.exitCode).toBe(5);
    expect(invalidJsonPayload.error.code).toBe("TOOL_RUNTIME_ERROR");
  } finally {
    await server.stop();
  }
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

test("tool scaffold bootstraps native glyphrail tools when no entry exists yet", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "glyphrail-tool-bootstrap-"));
  const scaffoldResult = runCli(
    ["--cwd", projectRoot, "tool", "scaffold", "format-handle", "--json"],
    repoRoot
  );
  const scaffoldPayload = parseJson(scaffoldResult.stdout);
  const entrySource = await readFile(join(projectRoot, "glyphrail.tools.ts"), "utf8");
  const listResult = runCli(["--cwd", projectRoot, "tool", "list", "--json"], repoRoot);
  const listPayload = parseJson(listResult.stdout);

  expect(scaffoldResult.exitCode).toBe(0);
  expect(scaffoldPayload.created).toContain("tools/format-handle.ts");
  expect(scaffoldPayload.created).toContain("glyphrail.tools.ts");
  expect(entrySource).toContain(
    'import { bash, defineTools, fetch, fileEdit, fileRead, fileWrite } from "glyphrail";'
  );
  expect(entrySource).toContain("export default defineTools([");
  expect(entrySource).toContain("fileRead");
  expect(entrySource).toContain("fileWrite");
  expect(entrySource).toContain("fileEdit");
  expect(entrySource).toContain("bash");
  expect(entrySource).toContain("fetch");

  expect(listResult.exitCode).toBe(0);
  expect(listPayload.toolCount).toBe(6);
  expect(listPayload.tools.some((tool: { name: string }) => tool.name === "formatHandle")).toBe(true);
  expect(listPayload.tools.some((tool: { name: string }) => tool.name === "fileRead")).toBe(true);
  expect(listPayload.tools.some((tool: { name: string }) => tool.name === "fileWrite")).toBe(true);
  expect(listPayload.tools.some((tool: { name: string }) => tool.name === "fileEdit")).toBe(true);
  expect(listPayload.tools.some((tool: { name: string }) => tool.name === "bash")).toBe(true);
  expect(listPayload.tools.some((tool: { name: string }) => tool.name === "fetch")).toBe(true);
});

test("tool scaffold rejects names reserved by built-in glyphrail tools", async () => {
  const projectRoot = await createInitializedProject();
  const scaffoldResult = runCli(
    ["--cwd", projectRoot, "tool", "scaffold", "file-read", "--json"],
    repoRoot
  );
  const scaffoldPayload = parseJson(scaffoldResult.stdout);

  expect(scaffoldResult.exitCode).toBe(2);
  expect(scaffoldPayload.ok).toBe(false);
  expect(scaffoldPayload.error.code).toBe("CLI_USAGE_ERROR");
  expect(scaffoldPayload.error.message).toContain("reserved");
  expect(scaffoldPayload.error.message).toContain("fileRead");
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

async function createTempProject(options: {
  allowExternalSideEffects?: boolean;
} = {}): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), "glyphrail-tool-"));
  const targetRoot = join(tempDir, "project");
  await cp(fixtureProjectRoot, targetRoot, { recursive: true });

  if (options.allowExternalSideEffects !== undefined) {
    const configPath = join(targetRoot, "glyphrail.config.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.policies.allowExternalSideEffects = options.allowExternalSideEffects;
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  }

  return targetRoot;
}

async function createInitializedProject(): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), "glyphrail-tool-init-"));
  const targetRoot = join(tempDir, "project");
  await cp(initFixtureRoot, targetRoot, { recursive: true });
  return targetRoot;
}

function parseJson(output: string): any {
  return JSON.parse(output);
}
