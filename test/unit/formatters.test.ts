import { expect, test } from "bun:test"

import { getFormatter, hasFormatter, listFormatterNames, stringifyValue } from "../../src/document/formatters"

test("stringifyValue handles all types", () => {
  expect(stringifyValue(null)).toBe("")
  expect(stringifyValue(undefined)).toBe("")
  expect(stringifyValue("hello")).toBe("hello")
  expect(stringifyValue(42)).toBe("42")
  expect(stringifyValue(true)).toBe("true")
  expect(stringifyValue({ a: 1 })).toBe('{"a":1}')
})

test("bullets formatter renders array as bullet list", () => {
  const fmt = getFormatter("bullets")!
  expect(fmt(["a", "b", "c"])).toBe("- a\n- b\n- c")
})

test("bullets formatter handles empty array", () => {
  const fmt = getFormatter("bullets")!
  expect(fmt([])).toBe("")
})

test("bullets formatter handles non-array", () => {
  const fmt = getFormatter("bullets")!
  expect(fmt("hello")).toBe("hello")
})

test("numbered formatter renders array as numbered list", () => {
  const fmt = getFormatter("numbered")!
  expect(fmt(["x", "y"])).toBe("1. x\n2. y")
})

test("table formatter renders array of objects as markdown table", () => {
  const fmt = getFormatter("table")!
  const result = fmt([
    { name: "Alice", age: 30 },
    { name: "Bob", age: 25 }
  ])
  expect(result).toContain("| name | age |")
  expect(result).toContain("| --- | --- |")
  expect(result).toContain("| Alice | 30 |")
  expect(result).toContain("| Bob | 25 |")
})

test("table formatter returns empty for empty array", () => {
  const fmt = getFormatter("table")!
  expect(fmt([])).toBe("")
})

test("table formatter handles non-object array", () => {
  const fmt = getFormatter("table")!
  expect(fmt(["a", "b"])).toBe('["a","b"]')
})

test("json formatter wraps value in code fence", () => {
  const fmt = getFormatter("json")!
  const result = fmt({ key: "value" })
  expect(result).toContain("```json")
  expect(result).toContain('"key": "value"')
  expect(result).toContain("```")
})

test("code formatter wraps string in fenced code block with language", () => {
  const fmt = getFormatter("code")!
  const result = fmt("SELECT * FROM users", "sql")
  expect(result).toBe("```sql\nSELECT * FROM users\n```")
})

test("code formatter works without language", () => {
  const fmt = getFormatter("code")!
  const result = fmt("some code")
  expect(result).toBe("```\nsome code\n```")
})

test("default formatter returns fallback for null", () => {
  const fmt = getFormatter("default")!
  expect(fmt(null, "N/A")).toBe("N/A")
  expect(fmt(undefined, "none")).toBe("none")
  expect(fmt(undefined)).toBe("N/A")
})

test("default formatter returns value for non-null", () => {
  const fmt = getFormatter("default")!
  expect(fmt("hello", "N/A")).toBe("hello")
})

test("fixed formatter formats number to fixed decimals", () => {
  const fmt = getFormatter("fixed")!
  expect(fmt(3.14159, "2")).toBe("3.14")
  expect(fmt(10, "3")).toBe("10.000")
})

test("upper formatter converts to uppercase", () => {
  const fmt = getFormatter("upper")!
  expect(fmt("hello")).toBe("HELLO")
})

test("lower formatter converts to lowercase", () => {
  const fmt = getFormatter("lower")!
  expect(fmt("HELLO")).toBe("hello")
})

test("truncate formatter truncates long strings", () => {
  const fmt = getFormatter("truncate")!
  expect(fmt("a".repeat(200), "10")).toBe("aaaaaaaaaa...")
  expect(fmt("short", "100")).toBe("short")
})

test("date formatter returns ISO by default", () => {
  const fmt = getFormatter("date")!
  const result = fmt("2025-01-15T10:30:00.000Z")
  expect(result).toBe("2025-01-15T10:30:00.000Z")
})

test("date formatter with date format", () => {
  const fmt = getFormatter("date")!
  const result = fmt("2025-01-15T10:30:00.000Z", "date")
  expect(result).toContain("2025")
  expect(result).toContain("15")
})

test("date formatter with short format", () => {
  const fmt = getFormatter("date")!
  const result = fmt("2025-01-15T10:30:00.000Z", "short")
  expect(result).toContain("2025")
  expect(result).toContain("15")
})

test("date formatter returns empty for null", () => {
  const fmt = getFormatter("date")!
  expect(fmt(null)).toBe("")
})

test("date formatter returns original for invalid date", () => {
  const fmt = getFormatter("date")!
  expect(fmt("not-a-date")).toBe("not-a-date")
})

test("date formatter with iso format", () => {
  const fmt = getFormatter("date")!
  expect(fmt("2025-06-01T00:00:00.000Z", "iso")).toBe("2025-06-01T00:00:00.000Z")
})

test("hasFormatter returns true for built-ins and false for unknown", () => {
  expect(hasFormatter("bullets")).toBe(true)
  expect(hasFormatter("table")).toBe(true)
  expect(hasFormatter("nonexistent")).toBe(false)
})

test("listFormatterNames includes all built-ins", () => {
  const names = listFormatterNames()
  expect(names).toContain("bullets")
  expect(names).toContain("numbered")
  expect(names).toContain("table")
  expect(names).toContain("json")
  expect(names).toContain("code")
  expect(names).toContain("default")
  expect(names).toContain("fixed")
  expect(names).toContain("upper")
  expect(names).toContain("lower")
  expect(names).toContain("truncate")
  expect(names).toContain("date")
})
