import { expect, test } from "bun:test"

import { splitFrontmatter, parseGrDocument } from "../../src/document/parser"

test("splitFrontmatter splits a valid .gr.md into frontmatter and body", () => {
  const content = `---
version: "1.0"
name: test
steps: []
---

# Hello \${input.name}
`

  const result = splitFrontmatter(content, "test.gr.md")

  expect(result.frontmatterRaw).toContain('version: "1.0"')
  expect(result.frontmatterRaw).toContain("name: test")
  expect(result.templateBody).toContain("# Hello ${input.name}")
})

test("splitFrontmatter throws when no opening delimiter", () => {
  const content = `version: "1.0"
name: test
---
# Body`

  expect(() => splitFrontmatter(content, "bad.gr.md")).toThrow(/Missing opening frontmatter delimiter/)
})

test("splitFrontmatter throws when no closing delimiter", () => {
  const content = `---
version: "1.0"
name: test
# Body`

  expect(() => splitFrontmatter(content, "bad.gr.md")).toThrow(/Missing closing frontmatter delimiter/)
})

test("splitFrontmatter handles empty body", () => {
  const content = `---
version: "1.0"
name: test
steps: []
---`

  const result = splitFrontmatter(content, "test.gr.md")
  expect(result.frontmatterRaw).toContain("name: test")
  expect(result.templateBody).toBe("")
})

test("splitFrontmatter preserves body with multiple lines", () => {
  const content = `---
name: test
---
Line 1
Line 2
Line 3`

  const result = splitFrontmatter(content, "test.gr.md")
  expect(result.templateBody).toBe("Line 1\nLine 2\nLine 3")
})

test("parseGrDocument throws for empty frontmatter", () => {
  const content = `---
---
# Body`

  expect(() => parseGrDocument(content, "empty.gr.md")).toThrow(/Empty frontmatter/)
})

test("parseGrDocument returns parsed document", () => {
  const content = `---
version: "1.0"
name: hello
steps:
  - id: greet
    kind: assign
    set:
      greeting: hello
---

# \${output.greeting}`

  const doc = parseGrDocument(content, "hello.gr.md")
  expect(doc.filePath).toBe("hello.gr.md")
  expect(doc.frontmatterRaw).toContain("name: hello")
  expect(doc.templateBody).toContain("${output.greeting}")
})

test("splitFrontmatter handles frontmatter with --- inside YAML strings", () => {
  const content = `---
version: "1.0"
name: test
steps: []
---

Body here`

  const result = splitFrontmatter(content, "test.gr.md")
  expect(result.frontmatterRaw).toContain("name: test")
  expect(result.templateBody).toContain("Body here")
})
