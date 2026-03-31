import { resolve } from "node:path"

import { createFailure, EXIT_CODES } from "../../core/errors"
import { readTextFile } from "../../util/fs"
import { relativePath } from "../../util/fs"
import { parseYaml } from "../../util/yaml"
import { validateWorkflowDocument } from "../../dsl/validation"
import { resolveProjectPath } from "../../config"
import { parseGrDocument } from "../../document/parser"
import { validateTemplate } from "../../document/validation"
import type { CommandDefinition } from "../types"

export const documentValidateCommand: CommandDefinition = {
  path: ["document", "validate"],
  summary: "Validate a .gr.md document without executing.",
  description:
    "Parse and validate both the workflow frontmatter and the template body of a .gr.md document. Checks YAML structure, workflow validity, template syntax, expression validity, formatter existence, and directive nesting.",
  usage: "glyphrail document validate <file.gr.md> [--json]",
  examples: [
    "glyphrail document validate docs/report.gr.md",
    "glyphrail document validate docs/report.gr.md --json"
  ],
  async handler(context, args) {
    if (args.positionals.length !== 1) {
      throw createFailure(
        "CLI_USAGE_ERROR",
        "document validate requires exactly one .gr.md file path.",
        EXIT_CODES.invalidCliUsage
      )
    }

    const project = await context.getProjectConfig()
    const filePath = resolve(context.cwd, args.positionals[0] as string)
    const relFilePath = relativePath(project.projectRoot, filePath)

    const content = await readTextFile(filePath)
    const doc = parseGrDocument(content, filePath)

    const rawWorkflow = parseYaml<unknown>(doc.frontmatterRaw, filePath)
    const workflowValidation = await validateWorkflowDocument(rawWorkflow, {
      toolsEntryPath: resolveProjectPath(project, project.config.toolsEntry)
    })

    const workflowErrors = workflowValidation.errors.map((e) => ({
      line: 0,
      message: e.message,
      severity: "error" as const
    }))

    const templateIssues = validateTemplate(doc.templateBody)

    const allIssues = [...workflowErrors, ...templateIssues]
    const errors = allIssues.filter((i) => i.severity === "error")
    const warnings = allIssues.filter((i) => i.severity === "warning")
    const valid = errors.length === 0

    if (!valid && !context.json) {
      throw createFailure(
        "TEMPLATE_VALIDATION_ERROR",
        `Document validation failed with ${errors.length} error(s):\n${errors.map((e) => `  Line ${e.line}: ${e.message}`).join("\n")}`,
        EXIT_CODES.workflowValidationFailure
      )
    }

    return {
      data: {
        command: "document.validate",
        file: relFilePath,
        valid,
        errors: errors.length,
        warnings: warnings.length,
        issues: allIssues,
        workflow: workflowValidation.workflow
          ? {
              name: workflowValidation.workflow.name,
              version: workflowValidation.workflow.version
            }
          : null
      },
      human: valid
        ? [
            `Validated ${relFilePath}`,
            workflowValidation.workflow
              ? `Workflow: ${workflowValidation.workflow.name} (${workflowValidation.workflow.version})`
              : "",
            `Errors: 0`,
            `Warnings: ${warnings.length}`
          ]
            .filter(Boolean)
            .join("\n")
        : [
            `Validation FAILED for ${relFilePath}`,
            `Errors: ${errors.length}`,
            `Warnings: ${warnings.length}`,
            ...errors.map((e) => `  Line ${e.line}: ${e.message}`)
          ].join("\n")
    }
  }
}
