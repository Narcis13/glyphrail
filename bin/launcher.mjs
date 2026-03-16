import { spawnSync } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const BIN_DIR = dirname(fileURLToPath(import.meta.url))
const CLI_ENTRY = resolve(BIN_DIR, "../src/cli/index.ts")
const DEFAULT_BUN_COMMAND = "bun"

export function launchGlyphrail() {
  const bunCommand = process.env.GLYPHRAIL_BUN || DEFAULT_BUN_COMMAND
  const result = spawnSync(bunCommand, [CLI_ENTRY, ...process.argv.slice(2)], {
    stdio: "inherit"
  })

  if (result.error) {
    if (result.error.code === "ENOENT") {
      process.stderr.write(
        "glyphrail requires Bun >= 1.3.0 on your PATH. Install Bun from https://bun.sh and rerun the command.\n"
      )
      process.exit(1)
    }

    process.stderr.write(`Failed to start Glyphrail with ${bunCommand}: ${result.error.message}\n`)
    process.exit(1)
  }

  process.exit(result.status ?? 1)
}
