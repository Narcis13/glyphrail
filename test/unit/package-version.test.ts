import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { VERSION } from "../../src/version"

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const packageJsonPath = join(repoRoot, "package.json")

test("package version stays in sync with the CLI version", () => {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"))

  expect(VERSION).toBe(packageJson.version)
})
