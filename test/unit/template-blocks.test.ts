import { expect, test, describe } from "bun:test"

import { parseTemplate, evaluateTemplate } from "../../src/document/template-engine"
import type { EachBlockNode, IfBlockNode } from "../../src/document/contracts"

describe("parseTemplate — each blocks", () => {
  test("parses simple each block", () => {
    const nodes = parseTemplate("{{#each output.items as item}}\n- ${item}\n{{/each}}")
    const eachNode = nodes.find((n) => n.type === "each") as EachBlockNode
    expect(eachNode).toBeDefined()
    expect(eachNode.itemsExpression).toBe("output.items")
    expect(eachNode.binding).toBe("item")
    expect(eachNode.body.length).toBeGreaterThan(0)
  })

  test("parses each block with dot-path expression", () => {
    const nodes = parseTemplate("{{#each output.data.list as entry}}\n${entry.name}\n{{/each}}")
    const eachNode = nodes.find((n) => n.type === "each") as EachBlockNode
    expect(eachNode.itemsExpression).toBe("output.data.list")
    expect(eachNode.binding).toBe("entry")
  })

  test("each block body contains interpolation nodes", () => {
    const nodes = parseTemplate("{{#each state.items as item}}\n- ${item}\n{{/each}}")
    const eachNode = nodes.find((n) => n.type === "each") as EachBlockNode
    const interpNodes = eachNode.body.filter((n) => n.type === "interpolation")
    expect(interpNodes.length).toBe(1)
  })

  test("throws on unterminated each block", () => {
    expect(() => parseTemplate("{{#each output.items as item}}\n- ${item}")).toThrow(
      /Unterminated.*each/
    )
  })
})

describe("parseTemplate — if blocks", () => {
  test("parses simple if block", () => {
    const nodes = parseTemplate("{{#if output.hasData}}\nHas data\n{{/if}}")
    const ifNode = nodes.find((n) => n.type === "if") as IfBlockNode
    expect(ifNode).toBeDefined()
    expect(ifNode.condition).toBe("output.hasData")
    expect(ifNode.thenBody.length).toBeGreaterThan(0)
    expect(ifNode.elseBody).toBeUndefined()
  })

  test("parses if/else block", () => {
    const nodes = parseTemplate("{{#if state.ok}}\nYes\n{{#else}}\nNo\n{{/if}}")
    const ifNode = nodes.find((n) => n.type === "if") as IfBlockNode
    expect(ifNode.thenBody.length).toBeGreaterThan(0)
    expect(ifNode.elseBody).toBeDefined()
    expect(ifNode.elseBody!.length).toBeGreaterThan(0)
  })

  test("throws on unterminated if block", () => {
    expect(() => parseTemplate("{{#if output.x}}\nstuff")).toThrow(/Unterminated.*if/)
  })
})

describe("parseTemplate — nested blocks", () => {
  test("parses if inside each", () => {
    const template = [
      "{{#each output.items as item}}",
      "{{#if item.active}}",
      "- ${item.name}",
      "{{/if}}",
      "{{/each}}"
    ].join("\n")

    const nodes = parseTemplate(template)
    const eachNode = nodes.find((n) => n.type === "each") as EachBlockNode
    const ifNode = eachNode.body.find((n) => n.type === "if") as IfBlockNode
    expect(ifNode).toBeDefined()
    expect(ifNode.condition).toBe("item.active")
  })

  test("parses each inside if", () => {
    const template = [
      "{{#if output.hasItems}}",
      "{{#each output.items as item}}",
      "- ${item}",
      "{{/each}}",
      "{{/if}}"
    ].join("\n")

    const nodes = parseTemplate(template)
    const ifNode = nodes.find((n) => n.type === "if") as IfBlockNode
    const eachNode = ifNode.thenBody.find((n) => n.type === "each") as EachBlockNode
    expect(eachNode).toBeDefined()
    expect(eachNode.itemsExpression).toBe("output.items")
  })

  test("parses deeply nested blocks", () => {
    const template = [
      "{{#each output.sections as section}}",
      "## ${section.title}",
      "{{#if section.items}}",
      "{{#each section.items as item}}",
      "- ${item}",
      "{{/each}}",
      "{{#else}}",
      "_No items._",
      "{{/if}}",
      "{{/each}}"
    ].join("\n")

    const nodes = parseTemplate(template)
    const eachNode = nodes.find((n) => n.type === "each") as EachBlockNode
    expect(eachNode).toBeDefined()
    const ifNode = eachNode.body.find((n) => n.type === "if") as IfBlockNode
    expect(ifNode).toBeDefined()
    expect(ifNode.elseBody).toBeDefined()
    const innerEach = ifNode.thenBody.find((n) => n.type === "each") as EachBlockNode
    expect(innerEach).toBeDefined()
  })
})

describe("parseTemplate — blocks with surrounding content", () => {
  test("preserves content before and after block", () => {
    const template = "# Title\n{{#each output.items as item}}\n- ${item}\n{{/each}}\nFooter"
    const nodes = parseTemplate(template)
    const textValues = nodes.filter((n) => n.type === "text").map((n) => (n as { value: string }).value)
    expect(textValues.join("")).toContain("Title")
    expect(textValues.join("")).toContain("Footer")
  })
})

describe("evaluateTemplate — each blocks", () => {
  test("renders each block with array of strings", () => {
    const nodes = parseTemplate("{{#each output.items as item}}\n- ${item}\n{{/each}}")
    const { rendered } = evaluateTemplate(nodes, { output: { items: ["a", "b", "c"] } })
    expect(rendered).toBe("- a\n- b\n- c")
  })

  test("renders each block with array of objects", () => {
    const nodes = parseTemplate(
      "{{#each output.items as item}}\n- ${item.name}: ${item.value}\n{{/each}}"
    )
    const { rendered } = evaluateTemplate(nodes, {
      output: {
        items: [
          { name: "x", value: 1 },
          { name: "y", value: 2 }
        ]
      }
    })
    expect(rendered).toBe("- x: 1\n- y: 2")
  })

  test("renders empty for non-array items expression", () => {
    const nodes = parseTemplate("{{#each output.items as item}}\n- ${item}\n{{/each}}")
    const { rendered, warnings } = evaluateTemplate(nodes, { output: { items: "not-array" } })
    expect(rendered).toBe("")
    expect(warnings.length).toBeGreaterThan(0)
  })

  test("renders empty for empty array", () => {
    const nodes = parseTemplate("{{#each output.items as item}}\n- ${item}\n{{/each}}")
    const { rendered } = evaluateTemplate(nodes, { output: { items: [] } })
    expect(rendered).toBe("")
  })

  test("renders each with multiline body", () => {
    const template = [
      "{{#each output.items as item}}",
      "## ${item.title}",
      "",
      "${item.body}",
      "{{/each}}"
    ].join("\n")
    const { rendered } = evaluateTemplate(parseTemplate(template), {
      output: {
        items: [
          { title: "A", body: "aaa" },
          { title: "B", body: "bbb" }
        ]
      }
    })
    expect(rendered).toContain("## A")
    expect(rendered).toContain("aaa")
    expect(rendered).toContain("## B")
    expect(rendered).toContain("bbb")
  })
})

describe("evaluateTemplate — if blocks", () => {
  test("renders then-body when condition is truthy", () => {
    const nodes = parseTemplate("{{#if output.show}}\nVisible\n{{/if}}")
    const { rendered } = evaluateTemplate(nodes, { output: { show: true } })
    expect(rendered).toBe("Visible")
  })

  test("renders nothing when condition is falsy and no else", () => {
    const nodes = parseTemplate("{{#if output.show}}\nVisible\n{{/if}}")
    const { rendered } = evaluateTemplate(nodes, { output: { show: false } })
    expect(rendered).toBe("")
  })

  test("renders else-body when condition is falsy", () => {
    const nodes = parseTemplate("{{#if output.show}}\nYes\n{{#else}}\nNo\n{{/if}}")
    const { rendered } = evaluateTemplate(nodes, { output: { show: false } })
    expect(rendered).toBe("No")
  })

  test("treats null as falsy", () => {
    const nodes = parseTemplate("{{#if output.value}}\nYes\n{{#else}}\nNo\n{{/if}}")
    const { rendered } = evaluateTemplate(nodes, { output: { value: null } })
    expect(rendered).toBe("No")
  })

  test("treats non-empty string as truthy", () => {
    const nodes = parseTemplate("{{#if output.value}}\nYes\n{{/if}}")
    const { rendered } = evaluateTemplate(nodes, { output: { value: "hello" } })
    expect(rendered).toBe("Yes")
  })

  test("treats empty string as falsy", () => {
    const nodes = parseTemplate("{{#if output.value}}\nYes\n{{#else}}\nNo\n{{/if}}")
    const { rendered } = evaluateTemplate(nodes, { output: { value: "" } })
    expect(rendered).toBe("No")
  })
})

describe("evaluateTemplate — nested blocks", () => {
  test("renders if inside each", () => {
    const template = [
      "{{#each output.items as item}}",
      "{{#if item.active}}",
      "- ${item.name}",
      "{{/if}}",
      "{{/each}}"
    ].join("\n")

    const { rendered } = evaluateTemplate(parseTemplate(template), {
      output: {
        items: [
          { name: "a", active: true },
          { name: "b", active: false },
          { name: "c", active: true }
        ]
      }
    })

    expect(rendered).toContain("- a")
    expect(rendered).not.toContain("- b")
    expect(rendered).toContain("- c")
  })

  test("renders each inside if with else", () => {
    const template = [
      "{{#if output.hasItems}}",
      "{{#each output.items as item}}",
      "- ${item}",
      "{{/each}}",
      "{{#else}}",
      "No items.",
      "{{/if}}"
    ].join("\n")

    const withItems = evaluateTemplate(parseTemplate(template), {
      output: { hasItems: true, items: ["x", "y"] }
    })
    expect(withItems.rendered).toBe("- x\n- y")

    const withoutItems = evaluateTemplate(parseTemplate(template), {
      output: { hasItems: false, items: [] }
    })
    expect(withoutItems.rendered).toBe("No items.")
  })

  test("renders deeply nested blocks", () => {
    const template = [
      "{{#each output.sections as section}}",
      "## ${section.title}",
      "{{#if section.items}}",
      "{{#each section.items as item}}",
      "- ${item}",
      "{{/each}}",
      "{{#else}}",
      "_Empty_",
      "{{/if}}",
      "{{/each}}"
    ].join("\n")

    const { rendered } = evaluateTemplate(parseTemplate(template), {
      output: {
        sections: [
          { title: "A", items: ["a1", "a2"] },
          { title: "B", items: null }
        ]
      }
    })

    expect(rendered).toContain("## A")
    expect(rendered).toContain("- a1")
    expect(rendered).toContain("- a2")
    expect(rendered).toContain("## B")
    expect(rendered).toContain("_Empty_")
  })
})

describe("evaluateTemplate — blocks with surrounding content", () => {
  test("renders content before and after block", () => {
    const template = "# Title\n\n{{#each output.items as item}}\n- ${item}\n{{/each}}\n\nFooter"
    const { rendered } = evaluateTemplate(parseTemplate(template), {
      output: { items: ["a", "b"] }
    })
    expect(rendered).toContain("# Title")
    expect(rendered).toContain("- a")
    expect(rendered).toContain("- b")
    expect(rendered).toContain("Footer")
  })

  test("renders inline interpolation alongside blocks", () => {
    const template = "Count: ${output.count}\n{{#each output.items as item}}\n- ${item}\n{{/each}}"
    const { rendered } = evaluateTemplate(parseTemplate(template), {
      output: { count: 2, items: ["a", "b"] }
    })
    expect(rendered).toContain("Count: 2")
    expect(rendered).toContain("- a")
    expect(rendered).toContain("- b")
  })
})

describe("evaluateTemplate — error handling in blocks", () => {
  test("warns on expression error in each items", () => {
    const nodes = parseTemplate("{{#each badroot.items as item}}\n- ${item}\n{{/each}}")
    const { rendered, warnings } = evaluateTemplate(nodes, {})
    expect(rendered).toBe("")
    expect(warnings.length).toBeGreaterThan(0)
  })

  test("warns on expression error in if condition", () => {
    const nodes = parseTemplate("{{#if badroot.field}}\nYes\n{{/if}}")
    const { rendered, warnings } = evaluateTemplate(nodes, {})
    expect(rendered).toBe("")
    expect(warnings.length).toBeGreaterThan(0)
  })
})
