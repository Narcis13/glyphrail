---
name: glyphrail-operator
description: >
  Operate and manage the Glyphrail deterministic workflow orchestration engine via its CLI.
  Use when the user asks to: (1) create, validate, lint, or explain Glyphrail workflows (.gr.yaml files),
  (2) run or resume workflow executions, (3) inspect runs (trace, state, output, steps),
  (4) manage tools (list, show, call, validate, scaffold), (5) initialize Glyphrail projects,
  (6) debug failed or paused runs, (7) author workflow YAML with steps (assign, tool, agent, if, for_each, while, return, fail),
  (8) define custom TypeScript tools for Glyphrail, (9) configure Glyphrail policies and settings,
  (10) author and render Glyphrail Documents (.gr.md files) — executable Markdown with workflow frontmatter and template body.
  Trigger when user mentions "glyphrail", "gr", ".gr.yaml", ".gr.md", "gr render", workflow orchestration in the Glyphrail context,
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
├── Render a document          → gr render <file.gr.md> [--input '{}'] [--output out.md] --json
├── Re-render from past run    → gr render <file.gr.md> --from-run <id> [--output out.md] --json
├── Watch & auto-render        → gr render <file.gr.md> --watch --output out.md
├── Render as HTML             → gr render <file.gr.md> --format html --output out.html
├── Validate a document        → gr document validate <file.gr.md> --json
├── Explain a document         → gr document explain <file.gr.md> --json
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

## Glyphrail Documents (.gr.md)

A `.gr.md` file combines a workflow (YAML frontmatter) with a Markdown template (body). Execute it and the body fills itself in with real data.

### Render a document

```bash
gr render docs/report.gr.md --input '{"name": "World"}' --json
gr render docs/report.gr.md --input '{"name": "World"}' --output report.md
gr render docs/report.gr.md --dry-run --json   # Validate only
gr render docs/report.gr.md --from-run <run-id> --output report.md  # Re-render without re-executing
gr render docs/report.gr.md --watch --output report.md  # Watch and auto re-render
gr render docs/report.gr.md --format html --output report.html  # HTML output
```

| Option | Description |
|--------|-------------|
| `--input <file>` | Input from JSON file |
| `--input-json <json>` | Inline JSON input |
| `--output <file>` | Write rendered output to file |
| `--dry-run` | Validate without executing |
| `--no-checkpoint` | Skip checkpointing |
| `--max-steps <n>` | Override max run steps |
| `--max-duration-ms <n>` | Override max run duration |
| `--from-run <id>` | Re-render template against a past run's results (skip execution) |
| `--format <format>` | Output format: `markdown` (default) or `html` |
| `--watch` | Watch file for changes, auto re-render (requires `--output`) |

`--from-run` enables iterating on the template body without re-executing the workflow. `--watch` hashes frontmatter and body separately — body-only changes re-render from cached run data, frontmatter changes trigger full re-execution.

### Validate a document

```bash
gr document validate docs/report.gr.md --json
```

Validates both the workflow frontmatter (YAML structure, steps, tools) and the template body (expressions, formatters, block nesting) without executing.

### Explain a document

```bash
gr document explain docs/report.gr.md --json
```

Shows workflow metadata (name, steps, tools, policies) and template analysis (interpolations, formatters used, each/if blocks, nesting depth, validation status).

### Document format

```markdown
---
version: "1.0"
name: my-report
inputSchema:
  type: object
  properties:
    name: { type: string }
  required: [name]
state:
  greeting: null
steps:
  - id: build
    kind: assign
    set:
      greeting: ${"Hello " + input.name}
output:
  greeting: ${state.greeting}
  name: ${input.name}
---

# ${output.greeting}

Welcome, ${output.name | upper}!

${output.items | bullets}
```

**Rules**:
1. Frontmatter MUST be a valid Glyphrail workflow (all DSL rules apply)
2. Body is Markdown with `${expr}` inline interpolations
3. Body scope includes: `input`, `state` (final), `output`, `context`, `env`
4. Empty body is valid — equivalent to a regular `.gr.yaml` workflow
5. Source `.gr.md` is never mutated; rendered output is a separate artifact

### Template syntax

**Inline interpolation** — `${expr}`: Uses the existing expression engine. Any valid workflow expression works. `null`/`undefined` render as empty string.

**Pipe formatters** — `${expr | formatter}`: Transform values before stringification.

| Formatter | Purpose | Example |
|-----------|---------|---------|
| `bullets` | Array → bullet list | `${output.items \| bullets}` |
| `numbered` | Array → numbered list | `${output.items \| numbered}` |
| `table` | Array of objects → Markdown table | `${output.data \| table}` |
| `json` | Any → pretty JSON in code fence | `${output.raw \| json}` |
| `code "lang"` | String → fenced code block | `${output.sql \| code "sql"}` |
| `default "N/A"` | Fallback for null/undefined | `${output.x \| default "N/A"}` |
| `fixed N` | Number → toFixed(N) | `${output.score \| fixed 2}` |
| `upper` | String → UPPERCASE | `${output.name \| upper}` |
| `lower` | String → lowercase | `${output.name \| lower}` |
| `truncate N` | String → truncated with ... | `${output.text \| truncate 200}` |
| `date "fmt"` | Timestamp → formatted date | `${output.createdAt \| date "short"}` |

`date` format args: `iso` (default), `date`, `time`, `datetime`, `short`, `long`, `relative`.

**Block directives** — control flow in templates:

```markdown
{{#each output.items as item}}
- **${item.name}**: ${item.description}
{{/each}}

{{#if output.hasData}}
Data is available: ${output.data | json}
{{#else}}
No data found.
{{/if}}
```

Blocks can be nested. The `{{#each}}` binding variable (e.g. `item`) becomes a scope root inside the block.

**Escape hatch**: `\${not.interpolated}` renders as literal `${not.interpolated}`.

### Persistence

Rendered documents are stored alongside standard run artifacts:

```
.glyphrail/runs/run_<id>/
  meta.json, input.json, state.latest.json, output.json, trace.jsonl, checkpoints/  # standard
  rendered.md     # the rendered document
  source.gr.md    # copy of source for reproducibility
```

### JSON output envelope

```json
{
  "ok": true,
  "command": "render",
  "runId": "run_...",
  "status": "completed",
  "rendered": "# Hello World\n...",
  "output": { ... },
  "artifacts": { ... },
  "templateWarnings": []
}
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

`${...}` syntax in any string value. Scopes: `input`, `state`, `env`, `context`, `item`, `output` (in document templates).
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
