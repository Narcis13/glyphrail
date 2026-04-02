import { expect, test } from "bun:test";
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const glyphrailBin = join(repoRoot, "bin/glyphrail");
const grBin = join(repoRoot, "bin/gr");

test("node launcher runs glyphrail in the current working directory", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "glyphrail-bin-"));
  const resolvedProjectRoot = await realpath(projectRoot);
  const initResult = runBin(glyphrailBin, ["init", "--json"], projectRoot);
  const initPayload = parseJson(initResult.stdout);

  expect(initResult.exitCode).toBe(0);
  expect(initPayload.ok).toBe(true);
  expect(initPayload.projectRoot).toBe(resolvedProjectRoot);

  const checkResult = runBin(glyphrailBin, ["check", "--json"], projectRoot);
  const checkPayload = parseJson(checkResult.stdout);

  expect(checkResult.exitCode).toBe(0);
  expect(checkPayload.ok).toBe(true);
  expect(checkPayload.projectRoot).toBe(resolvedProjectRoot);
});

test("gr launcher exposes the same CLI version output", () => {
  const result = runBin(grBin, ["--version"], repoRoot);

  expect(result.exitCode).toBe(0);
  expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
});

test("node launcher reports a missing bun binary clearly", () => {
  const result = runBin(glyphrailBin, ["--version"], repoRoot, {
    GLYPHRAIL_BUN: "bun-that-does-not-exist"
  });

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("glyphrail requires Bun >= 1.3.0");
});

function runBin(binPath: string, args: string[], cwd: string, extraEnv?: Record<string, string>) {
  const processResult = Bun.spawnSync(["node", binPath, ...args], {
    cwd,
    env: {
      ...process.env,
      ...extraEnv
    },
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
