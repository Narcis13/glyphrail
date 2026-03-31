---
version: "1.0"
name: report-document
inputSchema:
  type: object
  properties:
    title:
      type: string
  required:
    - title
state:
  items: null
  summary: null
steps:
  - id: build-data
    kind: assign
    set:
      items:
        - name: "Feature A"
          status: "shipped"
          description: "New dashboard layout"
        - name: "Feature B"
          status: "in-progress"
          description: "API rate limiting"
        - name: "Bug Fix C"
          status: "shipped"
          description: "Login timeout fix"
      summary:
        shipped: 2
        inProgress: 1
        blockers: []
        hasBlockers: false
output:
  title: ${input.title}
  items: ${state.items}
  summary: ${state.summary}
---

# ${output.title}

## Items

{{#each output.items as item}}
- **${item.name}** (${item.status}): ${item.description}
{{/each}}

## Summary

- Shipped: ${output.summary.shipped}
- In Progress: ${output.summary.inProgress}

## Blockers

{{#if output.summary.hasBlockers}}
There are blockers to address:

{{#each output.summary.blockers as blocker}}
> ${blocker}
{{/each}}
{{#else}}
No blockers this week.
{{/if}}

---
*Report: ${output.title}*
