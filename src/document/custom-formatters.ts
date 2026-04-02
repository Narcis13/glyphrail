import { resolve } from "node:path"
import { access } from "node:fs/promises"

import type { ResolvedProjectConfig } from "../config"
import { resolveProjectPath } from "../config"
import { registerFormatters, type FormatterDefinition } from "./formatters"

let loaded = false

export async function loadCustomFormatters(project: ResolvedProjectConfig): Promise<void> {
  if (loaded) return

  const entry = project.config.formattersEntry
  if (!entry) return

  const entryPath = resolveProjectPath(project, entry)

  try {
    await access(entryPath)
  } catch {
    return
  }

  const mod = await import(entryPath)
  const defs: FormatterDefinition[] = mod.default ?? mod

  if (!Array.isArray(defs)) {
    throw new Error(`Formatters entry ${entry} must export an array of formatter definitions.`)
  }

  registerFormatters(defs)
  loaded = true
}

export function resetCustomFormattersState(): void {
  loaded = false
}
