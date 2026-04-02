import { defineFormatters } from "../../src/document/formatters"

export default defineFormatters([
  {
    name: "currency",
    description: "Format a number as currency",
    format: (value, symbol = "$") => {
      const n = Number(value)
      if (Number.isNaN(n)) return String(value)
      return `${symbol}${n.toFixed(2)}`
    }
  },
  {
    name: "badge",
    description: "Wrap value in a markdown badge-style label",
    format: (value, color = "blue") => {
      return `**[${value}]**`
    }
  },
  {
    name: "capitalize",
    description: "Capitalize first letter of each word",
    format: (value) => {
      return String(value).replace(/\b\w/g, (c) => c.toUpperCase())
    }
  }
])
