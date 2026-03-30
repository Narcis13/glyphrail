---
name: glyphrail-operator
description: >
  Operate and manage the Glyphrail deterministic workflow orchestration engine via its CLI.
  Use when the user asks to: (1) create, validate, lint, or explain Glyphrail workflows (.gr.yaml files),
  (2) run or resume workflow executions, (3) inspect runs (trace, state, output, steps),
  (4) manage tools (list, show, call, validate, scaffold), (5) initialize Glyphrail projects,
  (6) debug failed or paused runs, (7) author workflow YAML with steps (assign, tool, agent, if, for_each, while, return, fail),
  (8) define custom TypeScript tools for Glyphrail, (9) configure Glyphrail policies and settings.
  Trigger when user mentions "glyphrail", "gr", ".gr.yaml", workflow orchestration in the Glyphrail context,
  or any Glyphrail CLI operation.
---

# Glyphrail Operator

Glyphrail is a Bun-native, CLI-first deterministic workflow orchestration engine. The CLI binary is `glyphrail` (alias: `gr`). Always use `--json` when parsing output programmatically.

## Decision Tree

```
User wants to...
├── Set up a new project       → gr init
├── Create a workflow          → gr workflow create <name>
├── Validate/lint a workflow   → gr workflow validate/lint <file> --json
├── Understand a workflow      → gr workflow explain <file>
├── Run a workflow             → gr run <file> [--input '{}'] --json
├── Resume a paused run        → gr resume <run-id> --json
├── Inspect run results        → gr runs show/state/output/trace/explain <id> --json
├── Debug a failed step        → gr runs step <id> <step-id> --json + gr runs trace <id> --event step.failed --json
├── Work with tools            → gr tool list/show/call/validate/scaffold --json
├── Check project health       → gr check --json
├── Discover capabilities      → gr capabilities --json
├── Export schemas             → gr schema [name] --json
└── Develop glyphrail itself   → Read CLAUDE.md at project root, use bun test
```

## Core Workflow: Execute and Inspect

```bash
# 1. Validate before running
gr workflow validate workflows/my-flow.gr.yaml --json

# 2. Execute
gr run workflows/my-flow.gr.yaml --input '{"key": "value"}' --json

# 3. Inspect results (runId from step 2 output)
gr runs show <run-id> --json        # Metadata + status
gr runs output <run-id> --json      # Final output
gr runs state <run-id> --json       # Full state snapshot
gr runs trace <run-id> --json       # Complete trace

# 4. Debug failures
gr runs trace <run-id> --event step.failed --json
gr runs step <run-id> <failed-step-id> --json
```

## Authoring Workflows

Workflows are YAML files (convention: `*.gr.yaml`) in the `workflows/` directory.

Minimal workflow:

```yaml
version: "1.0"
name: hello
steps:
  - id: greet
    kind: assign
    set: { message: "Hello World" }
  - id: done
    kind: return
    output: { message: ${state.message} }
```

### Step kinds

| Kind | Key fields | Purpose |
|------|-----------|---------|
| `assign` | `set: {k: v}` | Write to state |
| `tool` | `tool, input, save/append/merge` | Invoke registered tool |
| `agent` | `mode: structured, provider, objective, outputSchema, save` | Bounded LLM call (providers: `mock`, `claude-code`) |
| `if` | `condition, then, else` | Branch |
| `for_each` | `items, as, steps` | Iterate |
| `while` | `condition, maxIterations, steps` | Bounded loop |
| `return` | `output` | Exit with value |
| `fail` | `message` | Exit with error |
| `noop` | (none) | Placeholder |

Every step supports: `id` (required), `when` (conditional guard), `timeoutMs`, `onError`, `meta`.

### Expressions

`${...}` syntax in any string value. Scopes: `input`, `state`, `env`, `context`, `item`.
Operators: `==`, `!=`, `&&`, `||`, `+`, `-`, `*`, `/`, `%`, `!`. No function calls.

### Error policies

```yaml
onError:
  strategy: retry|fail|continue|goto
  maxAttempts: 3       # retry only
  label: step-id       # goto only
```

### Write directives (tool/agent steps)

- `save: state.path` - replace value
- `append: state.path` - push to array
- `merge: state.path` - deep merge into object

For full workflow YAML reference, see [workflow-authoring.md](references/workflow-authoring.md).

## Agent Adapters

### `mock` — Deterministic testing (scripted responses via `meta.mockResponse`)

### `claude-code` — Claude Code headless adapter

Uses `claude --print` (headless mode) as the AI backend. Requires `claude` CLI installed and authenticated.

```yaml
- id: analyze
  kind: agent
  mode: structured
  provider: claude-code
  model: sonnet
  objective: "Analyze the input data"
  instructions: "Return a JSON object with summary and keyPoints fields"
  input: ${state.data}
  outputSchema:
    type: object
    properties:
      summary: { type: string }
      keyPoints: { type: array, items: { type: string } }
    required: [summary, keyPoints]
  save: state.analysis
  meta:
    maxTurns: 1                    # limit claude agentic turns
    allowedTools: [Read, Grep]     # restrict claude's tools
    claudeFlags: ["--no-input"]    # extra CLI flags
```

Meta options: `claudeBinary` (override binary path), `claudeFlags` (extra CLI flags), `cwd` (working directory), `env` (extra env vars), `maxTurns` (limit agentic turns), `systemPrompt` (prepended to prompt), `verbose` (pass --verbose), `allowedTools` (restrict claude tools), `mcpConfig` (MCP server config JSON).

Env var `GLYPHRAIL_CLAUDE_BINARY` overrides the binary path globally.

## Tool Operations

### Built-in tools

| Tool | Input | Effect |
|------|-------|--------|
| `bash` | `{command}` | external |
| `fetch` | `{url, method?, headers?, body?}` | external |
| `file-read` | `{path}` | read |
| `file-write` | `{path, content}` | write |
| `file-edit` | `{path, oldText, newText}` | write |

Tools with `write`/`external` side effects are blocked by default. Set `policies.allowExternalSideEffects: true` in config or workflow to enable.

### Define custom tools

In `glyphrail.tools.ts`:

```typescript
import { defineTools } from "glyphrail";
export default defineTools([{
  name: "my-tool",
  description: "What it does",
  inputSchema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
  sideEffect: "none",
  execute: async (input) => ({ ok: true, output: { result: input.key } })
}]);
```

## Configuration

`glyphrail.config.json` at project root. Key settings:

- `workflowsDir` (default: `./workflows`)
- `toolsEntry` (default: `./glyphrail.tools.ts`)
- `policies.maxRunSteps` (default: 100)
- `policies.maxRunDurationMs` (default: 300000)
- `policies.allowExternalSideEffects` (default: false)

## Debugging Runs

```bash
# List recent runs
gr runs list --json

# Check why a run failed
gr runs show <id> --json           # Status + error info
gr runs trace <id> --event step.failed --json  # Failed steps
gr runs trace <id> --event tool.failed --json  # Failed tools
gr runs step <id> <step-id> --json # Specific step detail

# Resume a paused run
gr resume <run-id> --json
```

## Development Commands (for working on glyphrail source)

```bash
bun run src/cli/index.ts --help     # Run CLI from source
bun test                             # Full test suite
bun test test/unit/<file>.test.ts    # Focused test
bun run src/cli/index.ts --cwd playground/mvp check --json  # Validate sample project
```

For complete CLI flag reference, see [cli-reference.md](references/cli-reference.md).
