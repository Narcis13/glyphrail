import { expect, test } from "bun:test"

import { parseTemplate, evaluateTemplate } from "../../src/document/template-engine"

test("parseTemplate parses plain text with no interpolation", () => {
  const nodes = parseTemplate("Hello world")
  expect(nodes).toHaveLength(1)
  expect(nodes[0]).toMatchObject({ type: "text", value: "Hello world" })
})

test("parseTemplate parses single interpolation", () => {
  const nodes = parseTemplate("Hello ${input.name}")
  expect(nodes).toHaveLength(2)
  expect(nodes[0]).toMatchObject({ type: "text", value: "Hello " })
  expect(nodes[1]).toMatchObject({ type: "interpolation", expression: "input.name" })
})

test("parseTemplate parses multiple interpolations per line", () => {
  const nodes = parseTemplate("${input.first} ${input.last}")
  expect(nodes.filter((n) => n.type === "interpolation")).toHaveLength(2)
})

test("parseTemplate handles escaped expressions", () => {
  const nodes = parseTemplate("Literal \\${this.is.literal}")
  const textValues = nodes.filter((n) => n.type === "text").map((n) => (n as { value: string }).value)
  expect(textValues.join("")).toContain("${this.is.literal}")
  expect(nodes.every((n) => n.type === "text")).toBe(true)
})

test("parseTemplate parses pipe formatter", () => {
  const nodes = parseTemplate("${output.data | table}")
  expect(nodes).toHaveLength(1)
  const node = nodes[0] as { type: string; formatter?: string }
  expect(node.type).toBe("interpolation")
  expect(node.formatter).toBe("table")
})

test("parseTemplate parses pipe formatter with args", () => {
  const nodes = parseTemplate('${output.snippet | code "sql"}')
  const node = nodes[0] as { type: string; formatter?: string; formatterArgs?: string[] }
  expect(node.formatter).toBe("code")
  expect(node.formatterArgs).toEqual(["sql"])
})

test("parseTemplate handles multiline", () => {
  const nodes = parseTemplate("Line 1\nLine 2\nLine 3")
  const text = nodes.filter((n) => n.type === "text").map((n) => (n as { value: string }).value).join("")
  expect(text).toBe("Line 1\nLine 2\nLine 3")
})

test("parseTemplate does not confuse || operator with pipe", () => {
  const nodes = parseTemplate('${state.a || "fallback"}')
  const node = nodes[0] as { type: string; expression: string; formatter?: string }
  expect(node.type).toBe("interpolation")
  expect(node.expression).toContain("||")
  expect(node.formatter).toBeUndefined()
})

test("evaluateTemplate renders simple interpolation", () => {
  const nodes = parseTemplate("Hello ${input.name}!")
  const { rendered } = evaluateTemplate(nodes, { input: { name: "World" } })
  expect(rendered).toBe("Hello World!")
})

test("evaluateTemplate renders null/undefined as empty string", () => {
  const nodes = parseTemplate("Value: ${input.missing}")
  const { rendered } = evaluateTemplate(nodes, { input: {} })
  expect(rendered).toBe("Value: ")
})

test("evaluateTemplate applies formatter", () => {
  const nodes = parseTemplate("${output.items | bullets}")
  const { rendered } = evaluateTemplate(nodes, { output: { items: ["a", "b", "c"] } })
  expect(rendered).toBe("- a\n- b\n- c")
})

test("evaluateTemplate warns on unknown formatter", () => {
  const nodes = parseTemplate("${output.x | nonexistent}")
  const { rendered, warnings } = evaluateTemplate(nodes, { output: { x: "hello" } })
  expect(rendered).toBe("hello")
  expect(warnings).toHaveLength(1)
  expect(warnings[0]?.message).toContain("Unknown formatter")
})

test("evaluateTemplate warns on expression error instead of throwing", () => {
  const nodes = parseTemplate("Value: ${badroot.field}")
  const { rendered, warnings } = evaluateTemplate(nodes, {})
  expect(rendered).toBe("Value: ")
  expect(warnings).toHaveLength(1)
})

test("evaluateTemplate renders number and boolean values", () => {
  const nodes = parseTemplate("Count: ${state.count}, Done: ${state.done}")
  const { rendered } = evaluateTemplate(nodes, { state: { count: 42, done: true } })
  expect(rendered).toBe("Count: 42, Done: true")
})

test("evaluateTemplate renders objects as JSON string", () => {
  const nodes = parseTemplate("Data: ${state.obj}")
  const { rendered } = evaluateTemplate(nodes, { state: { obj: { a: 1 } } })
  expect(rendered).toBe('Data: {"a":1}')
})

test("evaluateTemplate handles output scope", () => {
  const nodes = parseTemplate("Result: ${output.result}")
  const { rendered } = evaluateTemplate(nodes, { output: { result: "success" } })
  expect(rendered).toBe("Result: success")
})

test("evaluateTemplate handles context scope", () => {
  const nodes = parseTemplate("Run: ${context.runId}")
  const { rendered } = evaluateTemplate(nodes, { context: { runId: "run_abc" } })
  expect(rendered).toBe("Run: run_abc")
})

test("evaluateTemplate applies default formatter", () => {
  const nodes = parseTemplate('${input.missing | default "N/A"}')
  const { rendered } = evaluateTemplate(nodes, { input: {} })
  expect(rendered).toBe("N/A")
})

test("evaluateTemplate applies fixed formatter", () => {
  const nodes = parseTemplate("${state.score | fixed 2}")
  const { rendered } = evaluateTemplate(nodes, { state: { score: 3.14159 } })
  expect(rendered).toBe("3.14")
})

test("evaluateTemplate renders nested property access", () => {
  const nodes = parseTemplate("${output.data.nested.value}")
  const { rendered } = evaluateTemplate(nodes, {
    output: { data: { nested: { value: "deep" } } }
  })
  expect(rendered).toBe("deep")
})
