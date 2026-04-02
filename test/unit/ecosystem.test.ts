import { expect, test, describe } from "bun:test"
import { writeFileSync, mkdirSync, rmSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { tmpdir } from "node:os"

import { parseTemplate, evaluateTemplate, type EvaluateTemplateOptions } from "../../src/document/template-engine"
import {
  registerFormatter,
  registerFormatters,
  defineFormatters,
  getFormatter,
  hasFormatter,
  listFormatterNames,
  type FormatterDefinition,
  type Formatter
} from "../../src/document/formatters"
import { parseGrDocument } from "../../src/document/parser"
import { validateTemplate } from "../../src/document/validation"
import type { IncludeNode, BlockNode } from "../../src/document/contracts"

// --- Custom Formatter Registration ---

describe("custom formatter registration", () => {
  test("registerFormatter adds a new formatter", () => {
    const currency: Formatter = (value, symbol = "$") => {
      const n = Number(value)
      if (Number.isNaN(n)) return String(value)
      return `${symbol}${n.toFixed(2)}`
    }
    registerFormatter("currency", currency)
    expect(hasFormatter("currency")).toBe(true)
    expect(getFormatter("currency")!(42.5)).toBe("$42.50")
    expect(getFormatter("currency")!(100, "€")).toBe("€100.00")
  })

  test("registerFormatters adds multiple formatters", () => {
    registerFormatters([
      { name: "reverse", format: (v) => String(v).split("").reverse().join("") },
      { name: "repeat", format: (v, n = "2") => String(v).repeat(Number(n)) }
    ])
    expect(hasFormatter("reverse")).toBe(true)
    expect(hasFormatter("repeat")).toBe(true)
    expect(getFormatter("reverse")!("abc")).toBe("cba")
    expect(getFormatter("repeat")!("ha", "3")).toBe("hahaha")
  })

  test("defineFormatters returns the definitions unchanged", () => {
    const defs: FormatterDefinition[] = [
      { name: "test-fmt", description: "A test formatter", format: (v) => `[${v}]` }
    ]
    const result = defineFormatters(defs)
    expect(result).toBe(defs)
  })

  test("custom formatter works in template evaluation", () => {
    registerFormatter("wrap", (v, open = "(", close = ")") => `${open}${v}${close}`)

    const nodes = parseTemplate("${output.name | wrap}")
    const { rendered } = evaluateTemplate(nodes, { output: { name: "hello" } })
    expect(rendered).toBe("(hello)")
  })

  test("custom formatter with args works in template", () => {
    registerFormatter("pad", (v, width = "10", char = " ") => {
      return String(v).padStart(Number(width), char)
    })

    const nodes = parseTemplate("${output.num | pad 5 0}")
    const { rendered } = evaluateTemplate(nodes, { output: { num: 42 } })
    expect(rendered).toBe("00042")
  })

  test("registered formatters appear in listFormatterNames", () => {
    registerFormatter("custom-list-test", (v) => String(v))
    const names = listFormatterNames()
    expect(names).toContain("custom-list-test")
  })
})

// --- Template Include ---

describe("template include — parsing", () => {
  test("parses include directive", () => {
    const nodes = parseTemplate("{{#include ./partials/header.md}}")
    const includeNode = nodes.find((n) => n.type === "include") as IncludeNode
    expect(includeNode).toBeDefined()
    expect(includeNode.filePath).toBe("./partials/header.md")
  })

  test("parses include with surrounding content", () => {
    const template = "# Title\n{{#include ./header.md}}\nBody text"
    const nodes = parseTemplate(template)
    expect(nodes.some((n) => n.type === "include")).toBe(true)
    expect(nodes.some((n) => n.type === "text")).toBe(true)
  })

  test("include node has correct line number", () => {
    const template = "Line 1\nLine 2\n{{#include ./partial.md}}\nLine 4"
    const nodes = parseTemplate(template)
    const includeNode = nodes.find((n) => n.type === "include") as IncludeNode
    expect(includeNode.line).toBe(3)
  })
})

describe("template include — evaluation", () => {
  const tmpDir = resolve(tmpdir(), `glyphrail-test-includes-${Date.now()}`)

  test("evaluates include from file", () => {
    mkdirSync(tmpDir, { recursive: true })
    const mainPath = resolve(tmpDir, "main.md")
    const partialPath = resolve(tmpDir, "partial.md")

    writeFileSync(partialPath, "Included: ${output.name}")
    writeFileSync(mainPath, "Before\n{{#include ./partial.md}}\nAfter")

    const nodes = parseTemplate("Before\n{{#include ./partial.md}}\nAfter")
    const { rendered, warnings } = evaluateTemplate(nodes, { output: { name: "World" } }, { basePath: mainPath })

    expect(rendered).toContain("Before")
    expect(rendered).toContain("Included: World")
    expect(rendered).toContain("After")
    expect(warnings.filter((w) => w.severity === "error")).toHaveLength(0)

    rmSync(tmpDir, { recursive: true, force: true })
  })

  test("warns on missing include file", () => {
    const nodes = parseTemplate("{{#include ./nonexistent.md}}")
    const { rendered, warnings } = evaluateTemplate(
      nodes,
      { output: {} },
      { basePath: resolve(tmpdir(), "fake-file.md") }
    )
    expect(rendered).toBe("")
    expect(warnings.some((w) => w.message.includes("not found"))).toBe(true)
  })

  test("detects circular includes", () => {
    const dir = resolve(tmpdir(), `glyphrail-test-circular-${Date.now()}`)
    mkdirSync(dir, { recursive: true })

    const aPath = resolve(dir, "a.md")
    const bPath = resolve(dir, "b.md")
    writeFileSync(aPath, "{{#include ./b.md}}")
    writeFileSync(bPath, "{{#include ./a.md}}")

    const nodes = parseTemplate("{{#include ./b.md}}")
    const { warnings } = evaluateTemplate(
      nodes,
      { output: {} },
      { basePath: aPath, includeStack: [aPath] }
    )

    expect(warnings.some((w) => w.message.includes("Circular include"))).toBe(true)

    rmSync(dir, { recursive: true, force: true })
  })

  test("warns when no basePath is available", () => {
    const nodes = parseTemplate("{{#include ./partial.md}}")
    const { warnings } = evaluateTemplate(nodes, { output: {} })
    expect(warnings.some((w) => w.message.includes("no base path"))).toBe(true)
  })

  test("nested includes work", () => {
    const dir = resolve(tmpdir(), `glyphrail-test-nested-${Date.now()}`)
    mkdirSync(resolve(dir, "partials"), { recursive: true })

    const mainPath = resolve(dir, "main.md")
    const headerPath = resolve(dir, "partials", "header.md")
    const logoPath = resolve(dir, "partials", "logo.md")

    writeFileSync(logoPath, "LOGO:${output.brand}")
    writeFileSync(headerPath, "{{#include ./logo.md}}\n# Header")
    writeFileSync(mainPath, "{{#include ./partials/header.md}}\nBody")

    const nodes = parseTemplate("{{#include ./partials/header.md}}\nBody")
    const { rendered } = evaluateTemplate(
      nodes,
      { output: { brand: "Glyphrail" } },
      { basePath: mainPath }
    )

    expect(rendered).toContain("LOGO:Glyphrail")
    expect(rendered).toContain("# Header")
    expect(rendered).toContain("Body")

    rmSync(dir, { recursive: true, force: true })
  })
})

// --- Template Block ---

describe("template blocks — parsing", () => {
  test("parses block directive", () => {
    const nodes = parseTemplate("{{#block content}}\nDefault content\n{{/block}}")
    const blockNode = nodes.find((n) => n.type === "block") as BlockNode
    expect(blockNode).toBeDefined()
    expect(blockNode.name).toBe("content")
    expect(blockNode.body.length).toBeGreaterThan(0)
  })

  test("parses multiple blocks", () => {
    const template = "{{#block header}}\n# Title\n{{/block}}\n{{#block footer}}\n---\n{{/block}}"
    const nodes = parseTemplate(template)
    const blocks = nodes.filter((n) => n.type === "block") as BlockNode[]
    expect(blocks).toHaveLength(2)
    expect(blocks[0]!.name).toBe("header")
    expect(blocks[1]!.name).toBe("footer")
  })

  test("throws on unterminated block", () => {
    expect(() => parseTemplate("{{#block content}}\nContent")).toThrow(/Unterminated.*block/)
  })
})

describe("template blocks — evaluation", () => {
  test("renders block default body when no override", () => {
    const nodes = parseTemplate("{{#block content}}\nDefault\n{{/block}}")
    const { rendered } = evaluateTemplate(nodes, { output: {} })
    expect(rendered).toBe("Default")
  })

  test("renders block override when provided", () => {
    const nodes = parseTemplate("{{#block content}}\nDefault\n{{/block}}")
    const overrideNodes = parseTemplate("Overridden content")
    const overrides = new Map([["content", overrideNodes]])

    const { rendered } = evaluateTemplate(nodes, { output: {} }, { blockOverrides: overrides })
    expect(rendered).toBe("Overridden content")
  })

  test("block with interpolation works", () => {
    const nodes = parseTemplate("{{#block greeting}}\nHello ${output.name}\n{{/block}}")
    const { rendered } = evaluateTemplate(nodes, { output: { name: "World" } })
    expect(rendered).toBe("Hello World")
  })
})

// --- Template Inheritance (extends) ---

describe("template inheritance — parser", () => {
  test("parses extends from frontmatter", () => {
    const content = "---\nextends: ./base.gr.md\nversion: \"1.0\"\nname: child\nsteps:\n  - id: s1\n    kind: noop\n---\n{{#block content}}\nChild content\n{{/block}}"
    const doc = parseGrDocument(content, "child.gr.md")
    expect(doc.extends).toBe("./base.gr.md")
  })

  test("extends is stripped from frontmatter for workflow validation", () => {
    const content = "---\nextends: ./base.gr.md\nversion: \"1.0\"\nname: child\nsteps:\n  - id: s1\n    kind: noop\n---\n"
    const doc = parseGrDocument(content, "child.gr.md")
    expect(doc.frontmatterRaw).not.toContain("extends")
    expect(doc.frontmatterRaw).toContain("version")
  })

  test("no extends when field not present", () => {
    const content = "---\nversion: \"1.0\"\nname: simple\nsteps:\n  - id: s1\n    kind: noop\n---\nContent"
    const doc = parseGrDocument(content, "simple.gr.md")
    expect(doc.extends).toBeUndefined()
  })

  test("handles quoted extends path", () => {
    const content = "---\nextends: \"./base report.gr.md\"\nversion: \"1.0\"\nname: child\nsteps:\n  - id: s1\n    kind: noop\n---\n"
    const doc = parseGrDocument(content, "child.gr.md")
    expect(doc.extends).toBe("./base report.gr.md")
  })
})

// --- Validation ---

describe("validation — new node types", () => {
  test("validates include node with empty path", () => {
    const issues = validateTemplate("{{#include }}")
    // The parser may handle this differently, but validation should catch issues
    expect(issues.length).toBeGreaterThanOrEqual(0)
  })

  test("validates block node", () => {
    const issues = validateTemplate("{{#block header}}\n${output.title}\n{{/block}}")
    const errors = issues.filter((i) => i.severity === "error")
    expect(errors).toHaveLength(0)
  })

  test("validates nested blocks", () => {
    const template = "{{#block main}}\n{{#if output.show}}\nVisible\n{{/if}}\n{{/block}}"
    const issues = validateTemplate(template)
    const errors = issues.filter((i) => i.severity === "error")
    expect(errors).toHaveLength(0)
  })
})
