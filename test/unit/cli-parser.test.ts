import { expect, test } from "bun:test";

import { COMMANDS } from "../../src/cli/commands";
import { parseArgv } from "../../src/cli/parser";

test("parseArgv extracts global flags regardless of placement", () => {
  const parsed = parseArgv(["workflow", "create", "demo", "--json", "--cwd", "/tmp/project"], COMMANDS);

  expect(parsed.globalOptions.json).toBe(true);
  expect(parsed.globalOptions.cwd).toBe("/tmp/project");
  expect(parsed.command?.path).toEqual(["workflow", "create"]);
  expect(parsed.commandArgs.positionals).toEqual(["demo"]);
});
