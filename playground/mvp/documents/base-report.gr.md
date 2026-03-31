---
version: "1.0"
name: base-report
inputSchema:
  type: object
  properties:
    title:
      type: string
  required:
    - title
state:
  data: null
steps:
  - id: init
    kind: noop
output:
  title: ${input.title}
---

# ${output.title}

{{#block header}}
*A Glyphrail Report*
{{/block}}

---

{{#block content}}
No content provided.
{{/block}}

---

{{#block footer}}
*End of report*
{{/block}}