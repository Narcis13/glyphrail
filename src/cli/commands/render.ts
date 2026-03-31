import { resolve } from "node:path"

import { createFailure, EXIT_CODES } from "../../core/errors"
import { assertJsonSchema } from "../../core/schema-validator"
import { relativePath } from "../../util/fs"
import { writeTextFile } from "../../util/fs"
import type { CommandDefinition } from "../types"
import { resolveRunInput, parseOptionalIntegerFlag } from "./run-shared"
import { renderDocument } from "../../document/renderer"

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

    const outputTarget = args.flags.output as string | undefined
    if (outputTarget) {
      await writeTextFile(resolve(context.cwd, outputTarget), result.rendered)
    }

    return {
      data: {
        command: "render",
        runId: result.runId,
        status: result.status,
        file: relFilePath,
        outputFile: outputTarget ?? null,
        rendered: result.rendered,
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
        : result.rendered
    }
  }
}
