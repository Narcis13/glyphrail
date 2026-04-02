import { expect, test, describe } from "bun:test"

import { validateTemplate } from "../../src/document/validation"

describe("validateTemplate — valid templates", () => {
  test("returns no issues for plain text", () => {
    const issues = validateTemplate("Hello world")
    expect(issues).toHaveLength(0)
  })

  test("returns no issues for valid interpolation", () => {
    const issues = validateTemplate("${output.name}")
    expect(issues).toHaveLength(0)
  })

  test("returns no issues for valid each block", () => {
    const issues = validateTemplate("{{#each output.items as item}}\n- ${item}\n{{/each}}")
    expect(issues).toHaveLength(0)
  })

  test("returns no issues for valid if/else block", () => {
    const issues = validateTemplate("{{#if output.show}}\nYes\n{{#else}}\nNo\n{{/if}}")
    expect(issues).toHaveLength(0)
  })

  test("returns no issues for nested blocks", () => {
    const template = [
      "{{#each output.items as item}}",
      "{{#if item.active}}",
      "- ${item.name}",
      "{{/if}}",
      "{{/each}}"
    ].join("\n")
    const issues = validateTemplate(template)
    expect(issues).toHaveLength(0)
  })

  test("returns no issues for valid formatter", () => {
    const issues = validateTemplate("${output.items | bullets}")
    expect(issues).toHaveLength(0)
  })
})

describe("validateTemplate — invalid expressions", () => {
  test("reports invalid expression in interpolation", () => {
    const issues = validateTemplate("${!!!}")
    const errors = issues.filter((i) => i.severity === "error")
    expect(errors.length).toBeGreaterThan(0)
  })

  test("reports invalid expression in each block", () => {
    const issues = validateTemplate("{{#each (output.items as item}}\n${item}\n{{/each}}")
    const errors = issues.filter((i) => i.severity === "error")
    expect(errors.length).toBeGreaterThan(0)
  })

  test("reports invalid expression in if block", () => {
    const issues = validateTemplate("{{#if (output.show}}\nYes\n{{/if}}")
    const errors = issues.filter((i) => i.severity === "error")
    expect(errors.length).toBeGreaterThan(0)
  })
})

describe("validateTemplate — unknown formatters", () => {
  test("reports unknown formatter", () => {
    const issues = validateTemplate("${output.x | nonexistent_formatter}")
    const errors = issues.filter((i) => i.severity === "error")
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]?.message).toContain("Unknown formatter")
  })
})

describe("validateTemplate — unterminated blocks", () => {
  test("reports unterminated each block", () => {
    const issues = validateTemplate("{{#each output.items as item}}\n- ${item}")
    const errors = issues.filter((i) => i.severity === "error")
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]?.message).toContain("Unterminated")
  })

  test("reports unterminated if block", () => {
    const issues = validateTemplate("{{#if output.show}}\nYes")
    const errors = issues.filter((i) => i.severity === "error")
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]?.message).toContain("Unterminated")
  })
})
