# Workflow Authoring Reference

## Workflow YAML Structure

```yaml
version: "1.0"
name: my-workflow
description: What this workflow does
inputSchema:
  type: object
  properties:
    name: { type: string }
  required: [name]
outputSchema:
  type: object
  properties:
    result: { type: string }
defaults:
  model: mock
  timeoutMs: 30000
  maxStepRetries: 3
  outputMode: structured
policies:
  allowTools: [bash, file-read]
  maxRunSteps: 100
  maxRunDurationMs: 300000
  maxAgentToolCalls: 10
state:
  results: []
  count: 0
steps:
  - id: step-1
    kind: assign
    set: { greeting: "Hello ${input.name}" }
output: ${state.greeting}
```

## Step Kinds

### assign

```yaml
- id: init
  kind: assign
  set:
    greeting: "Hello ${input.name}"
    count: ${state.count + 1}
```

### tool

```yaml
- id: read-file
  kind: tool
  tool: file-read
  input:
    path: "data.json"
  save: state.data
```

Write directives: `save` (replace), `append` (push to array), `merge` (deep merge object).

### agent (structured mode only)

Providers: `mock` (deterministic testing), `claude-code` (headless Claude Code via `claude --print`).

```yaml
# Mock adapter (for testing)
- id: classify
  kind: agent
  mode: structured
  provider: mock
  model: mock
  objective: Classify the text
  instructions: Return positive, negative, or neutral
  input: ${state.text}
  outputSchema:
    type: object
    properties:
      category: { type: string, enum: [positive, negative, neutral] }
    required: [category]
  save: state.classification
  meta:
    mockResponse:
      output: { category: positive }

# Claude Code adapter (for production)
- id: classify
  kind: agent
  mode: structured
  provider: claude-code
  model: sonnet
  objective: Classify the text
  instructions: Return positive, negative, or neutral
  input: ${state.text}
  outputSchema:
    type: object
    properties:
      category: { type: string, enum: [positive, negative, neutral] }
    required: [category]
  save: state.classification
  meta:
    maxTurns: 1
    allowedTools: [Read, Grep]
```

Claude Code meta options: `claudeBinary`, `claudeFlags`, `cwd`, `env`, `maxTurns`, `systemPrompt`, `verbose`, `allowedTools`, `mcpConfig`. Env var `GLYPHRAIL_CLAUDE_BINARY` overrides the binary path globally.

### if

```yaml
- id: check
  kind: if
  condition: ${state.count > 0}
  then:
    - id: has-items
      kind: assign
      set: { status: "has items" }
  else:
    - id: empty
      kind: assign
      set: { status: "empty" }
```

### for_each

```yaml
- id: process
  kind: for_each
  items: ${state.items}
  as: item
  steps:
    - id: transform
      kind: assign
      set: { current: ${item.value * 2} }
```

### while

```yaml
- id: poll
  kind: while
  condition: ${state.status != "done"}
  maxIterations: 10
  steps:
    - id: check-status
      kind: tool
      tool: fetch
      input: { url: "https://api.example.com/status" }
      save: state.response
```

### return / fail / noop

```yaml
- id: done
  kind: return
  output: { result: ${state.greeting} }

- id: abort
  kind: fail
  message: "Missing required data"

- id: placeholder
  kind: noop
```

## Expressions

`${...}` syntax. Available scopes: `input`, `state`, `env`, `context`, `item`, `branch`.

Operators: `==`, `!=`, `&&`, `||`, `+`, `-`, `*`, `/`, `%`, `!`, parentheses.

No function calls. No arbitrary JS. Literal array indices only.

## Error Policies

```yaml
onError:
  strategy: retry
  maxAttempts: 3
  delayMs: 1000

onError:
  strategy: continue

onError:
  strategy: goto
  label: recovery-step

onError:
  strategy: fail
```

## Built-in Tools

| Name | Input | Side Effect |
|------|-------|------------|
| `bash` | `{command, cwd?, timeoutMs?, env?}` | external |
| `fetch` | `{url, method?, headers?, query?, body?, timeoutMs?, responseType?}` | external |
| `file-read` | `{path, encoding?}` | read |
| `file-write` | `{path, content, encoding?, mode?, createDirectories?}` | write |
| `file-edit` | `{path, oldText, newText, replaceAll?, occurrence?}` | write |

## Custom Tool Definition

In `glyphrail.tools.ts`:

```typescript
import { defineTools } from "glyphrail";
export default defineTools([
  {
    name: "my-tool",
    description: "Purpose",
    inputSchema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
    sideEffect: "none",
    execute: async (input, ctx) => ({ ok: true, output: { result: input.key } })
  }
]);
```

## Configuration (glyphrail.config.json)

```json
{
  "schemaVersion": "0.1.0",
  "workflowsDir": "./workflows",
  "runsDir": "./.glyphrail/runs",
  "toolsEntry": "./glyphrail.tools.ts",
  "defaultOutputMode": "pretty",
  "defaultCheckpointEveryStep": true,
  "policies": {
    "maxRunSteps": 100,
    "maxRunDurationMs": 300000,
    "allowExternalSideEffects": false
  }
}
```
