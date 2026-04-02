import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const VALID_BUMPS = new Set([
  "patch",
  "minor",
  "major",
  "prepatch",
  "preminor",
  "premajor",
  "prerelease"
])

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "..")
const packageJsonPath = resolve(repoRoot, "package.json")
const versionFilePath = resolve(repoRoot, "src/version.ts")

const [bump] = process.argv.slice(2)

if (!bump || bump === "--help" || bump === "-h") {
  printUsage(bump ? 0 : 1)
}

if (!VALID_BUMPS.has(bump)) {
  process.stderr.write(`Unsupported version bump "${bump}".\n`)
  printUsage(1)
}

let releasedVersion = ""

try {
  ensureCleanWorktree()
  run("npm", ["run", "prepublishOnly"])
  run("npm", ["version", bump, "--no-git-tag-version"])

  releasedVersion = readPackageVersion()
  syncCliVersion(releasedVersion)

  run("git", ["add", "package.json", "src/version.ts"])
  run("git", ["commit", "-m", `release: v${releasedVersion}`])
  run("git", ["tag", `v${releasedVersion}`])
  run("npm", ["publish"])
  run("git", ["push"])
  run("git", ["push", "--tags"])

  process.stdout.write(`Released glyphrail v${releasedVersion}\n`)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`Release failed: ${message}\n`)

  if (releasedVersion) {
    process.stderr.write(
      `If the failure happened after the version bump, inspect the local release commit/tag for v${releasedVersion} before retrying.\n`
    )
  }

  process.exit(1)
}

function ensureCleanWorktree() {
  const status = execFileSync("git", ["status", "--short"], {
    cwd: repoRoot,
    encoding: "utf8"
  }).trim()

  if (status) {
    throw new Error("release requires a clean git worktree")
  }
}

function readPackageVersion() {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"))

  if (typeof packageJson.version !== "string" || !packageJson.version) {
    throw new Error("package.json is missing a valid version")
  }

  return packageJson.version
}

function syncCliVersion(version) {
  const current = readFileSync(versionFilePath, "utf8")
  const next = current.replace(/export const VERSION = ".*";/, `export const VERSION = "${version}";`)

  if (next === current) {
    throw new Error("failed to update src/version.ts")
  }

  writeFileSync(versionFilePath, next)
}

function run(command, args) {
  execFileSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit"
  })
}

function printUsage(exitCode) {
  process.stdout.write(
    "Usage: npm run release -- <patch|minor|major|prepatch|preminor|premajor|prerelease>\n"
  )
  process.exit(exitCode)
}
