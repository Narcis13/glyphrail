---
version: "1.0"
name: composed-document
inputSchema:
  type: object
  properties:
    title:
      type: string
  required:
    - title
state:
  items: null
steps:
  - id: build-data
    kind: assign
    set:
      items:
        - "Template includes"
        - "Block directives"
        - "Custom formatters"
output:
  title: ${input.title}
  items: ${state.items}
---

{{#include ./partials/header.md}}

# ${output.title}

## Features

{{#each output.items as item}}
- ${item}
{{/each}}

{{#include ./partials/footer.md}}