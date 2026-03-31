export type Formatter = (value: unknown, ...args: string[]) => string

const formatters: Map<string, Formatter> = new Map()

function stringify(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return JSON.stringify(value)
}

formatters.set("bullets", (value: unknown): string => {
  if (!Array.isArray(value)) return stringify(value)
  return value.map((item) => `- ${stringify(item)}`).join("\n")
})

formatters.set("numbered", (value: unknown): string => {
  if (!Array.isArray(value)) return stringify(value)
  return value.map((item, i) => `${i + 1}. ${stringify(item)}`).join("\n")
})

formatters.set("table", (value: unknown): string => {
  if (!Array.isArray(value) || value.length === 0) return ""
  const first = value[0]
  if (!first || typeof first !== "object" || Array.isArray(first)) return stringify(value)

  const keys = Object.keys(first as Record<string, unknown>)
  if (keys.length === 0) return ""

  const header = `| ${keys.join(" | ")} |`
  const separator = `| ${keys.map(() => "---").join(" | ")} |`
  const rows = value.map((row) => {
    const record = (row && typeof row === "object" ? row : {}) as Record<string, unknown>
    return `| ${keys.map((k) => stringify(record[k])).join(" | ")} |`
  })

  return [header, separator, ...rows].join("\n")
})

formatters.set("json", (value: unknown): string => {
  const content = typeof value === "string" ? value : JSON.stringify(value, null, 2)
  return "```json\n" + content + "\n```"
})

formatters.set("code", (value: unknown, lang?: string): string => {
  const language = lang ?? ""
  return "```" + language + "\n" + stringify(value) + "\n```"
})

formatters.set("default", (value: unknown, fallback?: string): string => {
  if (value == null) return fallback ?? "N/A"
  return stringify(value)
})

formatters.set("fixed", (value: unknown, digits?: string): string => {
  const n = Number(value)
  if (Number.isNaN(n)) return stringify(value)
  return n.toFixed(Number(digits) || 0)
})

formatters.set("upper", (value: unknown): string => {
  return stringify(value).toUpperCase()
})

formatters.set("lower", (value: unknown): string => {
  return stringify(value).toLowerCase()
})

formatters.set("truncate", (value: unknown, maxLength?: string): string => {
  const str = stringify(value)
  const limit = Number(maxLength) || 100
  if (str.length <= limit) return str
  return str.slice(0, limit) + "..."
})

export function getFormatter(name: string): Formatter | undefined {
  return formatters.get(name)
}

export function hasFormatter(name: string): boolean {
  return formatters.has(name)
}

export function listFormatterNames(): string[] {
  return [...formatters.keys()]
}

export { stringify as stringifyValue }
