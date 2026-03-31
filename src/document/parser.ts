import { createFailure, EXIT_CODES } from "../core/errors"
import type { ParsedGrDocument } from "./contracts"

const FRONTMATTER_DELIMITER = "---"

export function splitFrontmatter(content: string, filePath: string): { frontmatterRaw: string; templateBody: string } {
  const lines = content.split("\n")

  if (lines[0]?.trim() !== FRONTMATTER_DELIMITER) {
    throw createFailure(
      "DOCUMENT_PARSE_ERROR",
      `Missing opening frontmatter delimiter in ${filePath}. Expected '---' on the first line.`,
      EXIT_CODES.workflowValidationFailure
    )
  }

  let closingIndex = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === FRONTMATTER_DELIMITER) {
      closingIndex = i
      break
    }
  }

  if (closingIndex === -1) {
    throw createFailure(
      "DOCUMENT_PARSE_ERROR",
      `Missing closing frontmatter delimiter in ${filePath}. Expected a second '---'.`,
      EXIT_CODES.workflowValidationFailure
    )
  }

  const frontmatterRaw = lines.slice(1, closingIndex).join("\n")
  const templateBody = lines.slice(closingIndex + 1).join("\n")

  return { frontmatterRaw, templateBody }
}

export function parseGrDocument(content: string, filePath: string): ParsedGrDocument {
  const { frontmatterRaw, templateBody } = splitFrontmatter(content, filePath)

  if (!frontmatterRaw.trim()) {
    throw createFailure(
      "DOCUMENT_PARSE_ERROR",
      `Empty frontmatter in ${filePath}. The frontmatter must contain a valid workflow definition.`,
      EXIT_CODES.workflowValidationFailure
    )
  }

  // Extract extends directive from frontmatter
  const extendsMatch = frontmatterRaw.match(/^extends:\s*(.+)$/m)
  const extendsPath = extendsMatch ? (extendsMatch[1] as string).trim().replace(/^["']|["']$/g, "") : undefined

  // Strip extends from frontmatter before workflow validation (it's not a workflow field)
  const cleanedFrontmatter = extendsPath
    ? frontmatterRaw.replace(/^extends:\s*.+$/m, "").trim()
    : frontmatterRaw

  return {
    frontmatterRaw: cleanedFrontmatter,
    templateBody,
    filePath,
    extends: extendsPath
  }
}
