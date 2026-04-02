---
extends: ./base-report.gr.md
version: "1.0"
name: weekly-report
inputSchema:
  type: object
  properties:
    title:
      type: string
    week:
      type: string
  required:
    - title
state:
  highlights: null
steps:
  - id: build-highlights
    kind: assign
    set:
      highlights:
        - "Shipped new document system"
        - "Added template inheritance"
        - "Created Obsidian plugin prototype"
output:
  title: ${input.title}
  week: ${input.week}
  highlights: ${state.highlights}
---

{{#block header}}
*Weekly Report — ${output.week}*
{{/block}}

{{#block content}}
## Highlights

{{#each output.highlights as item}}
- ${item}
{{/each}}
{{/block}}