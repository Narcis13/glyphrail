import { resolve } from "node:path"
import { watch } from "node:fs"
import { createHash } from "node:crypto"

import { createFailure, EXIT_CODES } from "../../core/errors"
import { readTextFile, relativePath, writeTextFile } from "../../util/fs"
import type { CommandContext, CommandDefinition, ParsedCommandArgs } from "../types"
import type { ResolvedProjectConfig } from "../../config"
import { resolveRunInput, parseOptionalIntegerFlag } from "./run-shared"
import { renderDocument, reRenderFromRun } from "../../document/renderer"
import { splitFrontmatter } from "../../document/parser"

export const renderCommand: CommandDefinition = {
  path: ["render"],
  summary: "Execute a .gr.md document workflow and render the template.",
  description:
    "Parse a .gr.md file, execute the workflow defined in its YAML frontmatter, and render the Markdown template body with the results.",
  usage:
    "glyphrail render <file.gr.md> [--input <file> | --input-json <json>] [--output <file>] [--dry-run] [--no-checkpoint] [--json]",
  options: [
    {
      name: "input",
      type: "string",
      description: "Read run input from a JSON file.",
      valueLabel: "file"
    },
    {
      name: "input-json",
      type: "string",
      description: "Provide run input as an inline JSON string.",
      valueLabel: "json"
    },
    {
      name: "output",
      type: "string",
      description: "Write rendered Markdown to a file.",
      valueLabel: "file"
    },
    {
      name: "dry-run",
      type: "boolean",
      description: "Validate the document without executing."
    },
    {
      name: "no-checkpoint",
      type: "boolean",
      description: "Skip checkpointing during execution."
    },
    {
      name: "max-steps",
      type: "string",
      description: "Override the effective max run steps budget.",
      valueLabel: "n"
    },
    {
      name: "max-duration-ms",
      type: "string",
      description: "Override the effective max run duration budget.",
      valueLabel: "n"
    },
    {
      name: "from-run",
      type: "string",
      description: "Re-render template against a past run's results (skip execution).",
      valueLabel: "id"
    },
    {
      name: "format",
      type: "string",
      description: "Output format: markdown (default) or html.",
      valueLabel: "format"
    },
    {
      name: "watch",
      type: "boolean",
      description: "Watch the file and re-render on changes."
    }
  ],
  examples: [
    "glyphrail render docs/report.gr.md --input-json '{\"name\":\"world\"}'",
    "glyphrail render docs/report.gr.md --output report.md --json"
  ],
  async handler(context, args) {
    if (args.positionals.length !== 1) {
      throw createFailure(
        "CLI_USAGE_ERROR",
        "render requires exactly one .gr.md file path.",
        EXIT_CODES.invalidCliUsage
      )
    }

    const project = await context.getProjectConfig()
    const filePath = resolve(context.cwd, args.positionals[0] as string)
    const relFilePath = relativePath(project.projectRoot, filePath)
    const outputFormat = (args.flags.format as string | undefined) ?? "markdown"
    const fromRunId = args.flags["from-run"] as string | undefined
    const watchMode = args.flags.watch === true

    if (outputFormat !== "markdown" && outputFormat !== "html") {
      throw createFailure(
        "CLI_USAGE_ERROR",
        `--format must be 'markdown' or 'html', got '${outputFormat}'.`,
        EXIT_CODES.invalidCliUsage
      )
    }

    if (fromRunId) {
      const result = await reRenderFromRun({ project, filePath, runId: fromRunId })
      const finalRendered = outputFormat === "html" ? markdownToHtml(result.rendered) : result.rendered

      const outputTarget = args.flags.output as string | undefined
      if (outputTarget) {
        await writeTextFile(resolve(context.cwd, outputTarget), finalRendered)
      }

      return {
        data: {
          command: "render",
          fromRun: fromRunId,
          format: outputFormat,
          runId: result.runId,
          status: result.status,
          file: relFilePath,
          outputFile: outputTarget ?? null,
          rendered: finalRendered,
          output: result.output,
          artifacts: result.artifacts,
          templateWarnings: result.templateWarnings
        },
        human: outputTarget
          ? `Re-rendered from run ${fromRunId} -> ${outputTarget}`
          : finalRendered
      }
    }

    if (watchMode) {
      return await runWatchMode(context, args, project, filePath, relFilePath, outputFormat)
    }

    const input = await resolveRunInput(context, args)
    const isDryRun = args.flags["dry-run"] === true
    const noCheckpoint = args.flags["no-checkpoint"] === true

    const result = await renderDocument({
      project,
      filePath,
      input,
      maxRunSteps: parseOptionalIntegerFlag(args, "max-steps"),
      maxRunDurationMs: parseOptionalIntegerFlag(args, "max-duration-ms"),
      checkpointEveryStep: noCheckpoint ? false : undefined,
      dryRun: isDryRun
    })

    if (isDryRun) {
      return {
        data: {
          command: "render",
          dryRun: true,
          file: relFilePath,
          workflow: {
            name: result.workflow.name,
            version: result.workflow.version
          }
        },
        human: [
          `Dry run: document validated`,
          `File: ${relFilePath}`,
          `Workflow: ${result.workflow.name} (${result.workflow.version})`
        ].join("\n")
      }
    }

    const finalRendered = outputFormat === "html" ? markdownToHtml(result.rendered) : result.rendered

    const outputTarget = args.flags.output as string | undefined
    if (outputTarget) {
      await writeTextFile(resolve(context.cwd, outputTarget), finalRendered)
    }

    return {
      data: {
        command: "render",
        format: outputFormat,
        runId: result.runId,
        status: result.status,
        file: relFilePath,
        outputFile: outputTarget ?? null,
        rendered: finalRendered,
        output: result.output,
        artifacts: result.artifacts,
        templateWarnings: result.templateWarnings
      },
      human: outputTarget
        ? [
            `Run ${result.runId} completed`,
            `Rendered: ${outputTarget}`,
            result.templateWarnings.length > 0
              ? `Warnings: ${result.templateWarnings.length}`
              : ""
          ]
            .filter(Boolean)
            .join("\n")
        : finalRendered
    }
  }
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex")
}

async function runWatchMode(
  context: CommandContext,
  args: ParsedCommandArgs,
  project: ResolvedProjectConfig,
  filePath: string,
  relFilePath: string,
  outputFormat: string
): Promise<never> {
  const outputTarget = args.flags.output as string | undefined
  if (!outputTarget) {
    throw createFailure(
      "CLI_USAGE_ERROR",
      "--watch requires --output to write rendered results.",
      EXIT_CODES.invalidCliUsage
    )
  }

  const input = await resolveRunInput(context, args)
  const noCheckpoint = args.flags["no-checkpoint"] === true

  let lastFrontmatterHash = ""
  let lastBodyHash = ""
  let lastRunId: string | null = null
  let rendering = false

  const doRender = async () => {
    if (rendering) return
    rendering = true

    try {
      const content = await readTextFile(filePath)
      const { frontmatterRaw, templateBody } = splitFrontmatter(content, filePath)

      const fmHash = hashContent(frontmatterRaw)
      const bodyHash = hashContent(templateBody)

      const frontmatterChanged = fmHash !== lastFrontmatterHash
      const bodyChanged = bodyHash !== lastBodyHash

      if (!frontmatterChanged && !bodyChanged) {
        rendering = false
        return
      }

      lastFrontmatterHash = fmHash
      lastBodyHash = bodyHash

      let result
      if (!frontmatterChanged && lastRunId) {
        // Body-only change: re-render from cached run (skip execution)
        if (!context.quiet) {
          process.stderr.write(`[watch] Body changed, re-rendering from run ${lastRunId}\n`)
        }
        result = await reRenderFromRun({ project, filePath, runId: lastRunId })
      } else {
        // Frontmatter changed or first run: full execution
        if (!context.quiet) {
          process.stderr.write(`[watch] ${frontmatterChanged ? "Frontmatter changed, re-executing" : "Initial render"}\n`)
        }
        result = await renderDocument({
          project,
          filePath,
          input,
          maxRunSteps: parseOptionalIntegerFlag(args, "max-steps"),
          maxRunDurationMs: parseOptionalIntegerFlag(args, "max-duration-ms"),
          checkpointEveryStep: noCheckpoint ? false : undefined
        })
        lastRunId = result.runId
      }

      const finalRendered = outputFormat === "html" ? markdownToHtml(result.rendered) : result.rendered
      await writeTextFile(resolve(context.cwd, outputTarget), finalRendered)

      if (!context.quiet) {
        const ts = new Date().toLocaleTimeString()
        process.stderr.write(`[watch] ${ts} Rendered -> ${outputTarget}\n`)
      }
    } catch (error) {
      process.stderr.write(
        `[watch] Error: ${error instanceof Error ? error.message : String(error)}\n`
      )
    } finally {
      rendering = false
    }
  }

  // Initial render
  await doRender()

  if (!context.quiet) {
    process.stderr.write(`[watch] Watching ${relFilePath} for changes...\n`)
  }

  const watcher = watch(filePath, { persistent: true }, (_eventType) => {
    doRender()
  })

  // Keep process alive indefinitely
  await new Promise<never>(() => {
    process.on("SIGINT", () => {
      watcher.close()
      process.exit(0)
    })
    process.on("SIGTERM", () => {
      watcher.close()
      process.exit(0)
    })
  })
}

export function markdownToHtml(markdown: string): string {
  let html = markdown

  // Fenced code blocks (must come before inline processing)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    const langAttr = lang ? ` class="language-${lang}"` : ""
    const escaped = escapeHtml(code.trimEnd())
    return `<pre><code${langAttr}>${escaped}</code></pre>`
  })

  const lines = html.split("\n")
  const output: string[] = []
  let inList = false
  let listType: "ul" | "ol" | null = null
  let inPre = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string

    // Track pre blocks (already converted above, but track for safety)
    if (line.startsWith("<pre>")) inPre = true
    if (line.includes("</pre>")) { inPre = false; output.push(line); continue }
    if (inPre) { output.push(line); continue }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/)
    if (headingMatch) {
      if (inList) { output.push(listType === "ol" ? "</ol>" : "</ul>"); inList = false; listType = null }
      const level = (headingMatch[1] as string).length
      output.push(`<h${level}>${convertInline(headingMatch[2] as string)}</h${level}>`)
      continue
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      if (inList) { output.push(listType === "ol" ? "</ol>" : "</ul>"); inList = false; listType = null }
      output.push("<hr>")
      continue
    }

    // Unordered list items
    const ulMatch = line.match(/^- (.*)$/)
    if (ulMatch) {
      if (!inList || listType !== "ul") {
        if (inList) output.push(listType === "ol" ? "</ol>" : "</ul>")
        output.push("<ul>")
        inList = true
        listType = "ul"
      }
      output.push(`<li>${convertInline(ulMatch[1] as string)}</li>`)
      continue
    }

    // Ordered list items
    const olMatch = line.match(/^\d+\.\s+(.*)$/)
    if (olMatch) {
      if (!inList || listType !== "ol") {
        if (inList) output.push(listType === "ol" ? "</ol>" : "</ul>")
        output.push("<ol>")
        inList = true
        listType = "ol"
      }
      output.push(`<li>${convertInline(olMatch[1] as string)}</li>`)
      continue
    }

    // Blockquote
    const bqMatch = line.match(/^>\s?(.*)$/)
    if (bqMatch) {
      if (inList) { output.push(listType === "ol" ? "</ol>" : "</ul>"); inList = false; listType = null }
      output.push(`<blockquote>${convertInline(bqMatch[1] as string)}</blockquote>`)
      continue
    }

    // Close list if needed
    if (inList) {
      output.push(listType === "ol" ? "</ol>" : "</ul>")
      inList = false
      listType = null
    }

    // Table rows (pass through — Markdown tables)
    if (line.startsWith("|")) {
      output.push(convertTableLine(line, lines, i, output))
      // Skip separator row
      const next = lines[i + 1]
      if (next && /^\|[\s-:|]+\|$/.test(next.trim())) {
        i++ // skip separator
      }
      continue
    }

    // Empty line
    if (line.trim() === "") {
      output.push("")
      continue
    }

    // Paragraph
    output.push(`<p>${convertInline(line)}</p>`)
  }

  if (inList) {
    output.push(listType === "ol" ? "</ol>" : "</ul>")
  }

  const body = output.join("\n")

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Glyphrail">
<style>
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; line-height: 1.6; max-width: 48rem; margin: 2rem auto; padding: 0 1rem; color: #24292f; }
h1, h2, h3, h4, h5, h6 { margin-top: 1.5em; margin-bottom: 0.5em; }
pre { background: #f6f8fa; padding: 1rem; border-radius: 6px; overflow-x: auto; }
code { background: #f6f8fa; padding: 0.2em 0.4em; border-radius: 3px; font-size: 0.9em; }
pre code { background: none; padding: 0; }
blockquote { border-left: 4px solid #d0d7de; margin: 0; padding: 0.5rem 1rem; color: #57606a; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; }
th, td { border: 1px solid #d0d7de; padding: 0.5rem 0.75rem; text-align: left; }
th { background: #f6f8fa; }
hr { border: none; border-top: 1px solid #d0d7de; margin: 1.5em 0; }
</style>
</head>
<body>
${body}
</body>
</html>`
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function convertInline(text: string): string {
  let result = text
  // Bold
  result = result.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
  // Italic
  result = result.replace(/\*(.+?)\*/g, "<em>$1</em>")
  // Inline code
  result = result.replace(/`([^`]+)`/g, "<code>$1</code>")
  return result
}

function convertTableLine(line: string, lines: string[], index: number, output: string[]): string {
  const cells = line.split("|").slice(1, -1).map((c) => c.trim())
  const nextLine = lines[index + 1]
  const isSeparatorNext = nextLine && /^\|[\s-:|]+\|$/.test(nextLine.trim())

  // Check if this is a header row (separator follows)
  if (isSeparatorNext) {
    const headerCells = cells.map((c) => `<th>${convertInline(c)}</th>`).join("")
    return `<table>\n<thead><tr>${headerCells}</tr></thead>\n<tbody>`
  }

  // Check if next line is NOT a table row — close table
  const nextIsTable = lines[index + 1]?.startsWith("|")
  const row = cells.map((c) => `<td>${convertInline(c)}</td>`).join("")

  if (!nextIsTable) {
    return `<tr>${row}</tr>\n</tbody></table>`
  }

  return `<tr>${row}</tr>`
}
