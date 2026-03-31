# Glyphrail

Bun-native, CLI-first deterministic workflow orchestration engine for AI-native applications. Version 0.1.2, published to npm as `glyphrail`.

## Quick Reference

```bash
bun run src/cli/index.ts --help          # CLI surface from source
bun test                                  # Full test suite
bun test test/unit/expression-engine.test.ts  # Focused test
bun run src/cli/index.ts --cwd playground/mvp check --json  # Validate sample project
./playground/mvp/smoke.sh                 # Manual CLI smoke pass
```

## Architecture

The engine owns control flow, persistence, budgets, and safety. Tools own typed side effects. Agent steps own bounded judgment inside a deterministic shell.

```
src/
  cli/            Command registry, parser, formatter, 22 command handlers
  core/           Execution engine, runtime state, expression engine, run store, errors
  dsl/            Workflow schema, validation, normalization, linting
  tools/          Tool contracts, registry, runtime invocation, 5 built-in tools
  agent/          Agent adapter contracts, prompt building, mock adapter, claude-code adapter
  config/         Project config discovery and defaults
  util/           FS, JSON, YAML, ID generation, timestamps, templates
test/
  unit/           CLI parser, expressions, validation, state, tools, version
  integration/    CLI contract, run lifecycle, workflows, tools, launchers
playground/mvp/   Self-contained verification project with 9 example workflows
templates/        Scaffolding templates for `init` command
```

### Entry Points

- **CLI**: `src/cli/index.ts` -> `runCli()` parses argv, routes to command handler, formats output
- **Executables**: `bin/glyphrail` and `bin/gr` (alias) via `bin/launcher.mjs` (spawns Bun)
- **Public API**: `src/index.ts` exports tool contracts, agent interfaces, config types for programmatic use

### Module Dependency Flow

```
CLI -> Parser -> Commands -> Execution Engine -> Runtime State
                                              -> Expression Engine
                                              -> Run Store (persistence)
                                              -> Tool Registry -> Tool Runtime -> Built-in Tools
                                              -> Agent Runtime -> Mock Adapter / Claude Code Adapter
                          -> DSL Validation -> Normalization -> Expression Engine
                          -> Config (lazy-loaded once per invocation)
```

## Runtime & Build

- **Runtime**: Bun >= 1.3.0 (executes TypeScript directly, no transpilation)
- **Zero production dependencies** — only Bun built-ins and Node standard libraries
- **No build step** — Bun runs TypeScript source directly
- **Package distribution**: npm package with `bin/` launchers that spawn Bun

## CLI Commands

All commands support `--json` for machine-parseable output with `{ok: true/false, ...}` envelope.

| Command | Purpose |
|---------|---------|
| `capabilities` | Machine-readable capability document (tools, adapters, schemas) |
| `check` | Validate entire project (workflows, tools, config) |
| `init` | Scaffold new project with config, tools, and sample workflow |
| `schema` | Export JSON schemas (workflow, config, tool, agent, etc.) |
| `run <file>` | Execute workflow with `--input`, `--dry-run`, `--no-checkpoint` |
| `resume <run-id>` | Resume paused run from checkpoint |
| `runs list` | List all persisted runs |
| `runs show <id>` | Show run metadata |
| `runs state <id>` | Show final state snapshot |
| `runs output <id>` | Show run output |
| `runs step <id> <step>` | Show specific step execution details |
| `runs trace <id>` | Show trace events (filterable by `--event`) |
| `runs explain <id>` | Summarized run analysis |
| `tool list` | List discovered tools with schemas |
| `tool show <name>` | Show specific tool contract |
| `tool call <name>` | Invoke tool directly with `--input` |
| `tool validate` | Validate tool registry |
| `tool scaffold` | Generate tool template |
| `render <file.gr.md>` | Execute .gr.md document and render template (`--from-run`, `--watch`, `--format html`) |
| `document validate <file>` | Validate .gr.md document without executing |
| `document explain <file>` | Explain both workflow and template structure of a .gr.md document |
| `workflow validate <file>` | Validate workflow YAML |
| `workflow lint <file>` | Lint for warnings and risks |
| `workflow explain <file>` | Explain workflow structure |
| `workflow create <name>` | Create workflow from template |

### Global Flags

`--cwd <path>`, `--config <path>`, `--json`, `--quiet`, `--verbose`, `--color <auto|always|never>`, `--trace`, `--profile`, `--help`, `--version`

## Workflow DSL (YAML v1.0)

```yaml
version: "1.0"
name: workflow-name
inputSchema: { type: object, properties: {...} }
outputSchema: { type: object, properties: {...} }
defaults: { model, timeoutMs, maxStepRetries, outputMode }
policies: { allowTools, maxRunSteps, maxRunDurationMs, maxAgentToolCalls }
state: { initial: values }
steps:
  - id: step-id
    kind: assign|tool|agent|if|for_each|while|return|fail|noop
    ...
output: ${state.result}
```

### Step Kinds

- **assign**: `set: { key: value }` — set state values
- **tool**: `tool: name, input: {...}, save/append/merge: state.path` — invoke registered tool
- **agent**: `provider, model, objective, instructions, input, outputSchema, save` — bounded LLM step (structured mode only; providers: `mock`, `claude-code`)
- **if**: `condition, then: [...], else: [...]` — conditional branching
- **for_each**: `items, as, steps: [...]` — iterate with `${item}` binding
- **while**: `condition, maxIterations, steps: [...]` — bounded loop
- **return**: `output` — exit with value
- **fail**: `message` — exit with error
- **noop**: no operation
- **parallel**: DSL-only, not yet executable

### Expressions

`${...}` interpolations evaluated against scopes: `input`, `state`, `env`, `context`, `item`, `branch`. Operators: `==`, `!=`, `&&`, `||`, `+`, `-`, `*`, `/`, `%`, `!`.

### Error Policies (per-step)

```yaml
onError:
  strategy: retry|fail|continue|goto
  maxAttempts: 3
  label: step-id  # for goto
```

## Tool System

### Built-in Tools

| Tool | Side Effect | Purpose |
|------|------------|---------|
| `bash` | external | Execute shell commands (sandboxed to project root) |
| `fetch` | external | HTTP requests with timeout and abort |
| `file-read` | read | Read files (path-sandboxed) |
| `file-write` | write | Write/append files (path-sandboxed) |
| `file-edit` | write | Replace text in files (path-sandboxed) |

### Custom Tools

Define in `glyphrail.tools.ts`:

```typescript
import { defineTools } from "glyphrail";
export default defineTools([{
  name: "my-tool",
  description: "What it does",
  inputSchema: { type: "object", properties: {...}, required: [...] },
  sideEffect: "none",
  execute: async (input, ctx) => ({ ok: true, output: result })
}]);
```

### Tool Contract

```typescript
type Tool<I, O> = {
  name: string; description: string;
  inputSchema: JsonSchema; outputSchema?: JsonSchema;
  sideEffect: "none" | "read" | "write" | "external";
  timeoutMs?: number; tags?: ToolCategoryTag[];
  execute: (input: I, ctx: ToolContext) => Promise<ToolResult<O>>;
};
```

## Agent Adapters

### `mock` — Deterministic testing adapter (scripted responses via `meta.mockResponse`)

### `claude-code` — Claude Code headless adapter (`claude --print`)

Uses `claude -p` (headless mode) as the AI backend. Requires `claude` CLI installed and authenticated.

```yaml
- id: my-agent-step
  kind: agent
  mode: structured
  provider: claude-code
  model: sonnet
  objective: "Analyze the input"
  instructions: "Return a JSON object with summary and keyPoints fields"
  input: ${state.data}
  outputSchema: { type: object, properties: { summary: { type: string } }, required: [summary] }
  save: state.result
  meta:
    maxTurns: 1                    # limit claude agentic turns
    allowedTools: [Read, Grep]     # restrict claude's tools
    claudeFlags: ["--no-input"]    # extra CLI flags
```

Meta options: `claudeBinary`, `claudeFlags`, `cwd`, `env`, `maxTurns`, `systemPrompt`, `verbose`, `allowedTools`, `mcpConfig`. Env var `GLYPHRAIL_CLAUDE_BINARY` overrides the binary path globally.

## Persistence & Checkpointing

```
.glyphrail/runs/run_<id>/
  meta.json           Run record (status, cursor, counters)
  input.json          Original input
  state.latest.json   Current state snapshot
  output.json         Final output (on completion)
  trace.jsonl         Append-only trace events
  checkpoints/        Per-step state snapshots for resume
```

Run statuses: `running`, `completed`, `failed`, `paused`. Resume via `resume <run-id>`.

## Configuration

`glyphrail.config.json` (discovered by walking up from cwd):

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

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Generic failure |
| 2 | Invalid CLI usage |
| 3 | Workflow validation failure |
| 4 | Input validation failure |
| 5 | Execution failure |
| 6 | Paused |
| 7 | Cancelled |
| 8 | Policy violation |
| 9 | Not found |
| 10 | Internal error |

## Coding Conventions

- ESM imports, 2-space indent, double quotes, no semicolons
- Files and workflows: kebab-case (`workflow-validate.ts`, `agent-success.gr.yaml`)
- Tests: `.test.ts` suffix, `test/unit/` for isolated logic, `test/integration/` for CLI/persistence
- Prefer explicit named exports; keep fixture data in `test/fixtures/`
- Assert on stable JSON envelopes and persisted artifacts, not human-readable output

## Environment Variables

- `GLYPHRAIL_BUN` — Override Bun executable path in launcher
- `${env.*}` — Any env var accessible in workflow expressions

## Key Patterns

- **Lazy config**: loaded once per CLI invocation via `getProjectConfig()`
- **Path sandboxing**: built-in tools prevent directory traversal outside project root
- **Checkpoint-based resume**: execution cursor + state snapshots, no replay needed
- **Policy-first tool execution**: policies validated before every tool invocation
- **Expression interpolation**: `${...}` evaluated anywhere strings are used
- **Error annotation**: errors enriched with stepId/runId as they bubble up
- **JSON envelope contract**: all `--json` output uses `{ok: true/false, ...}` wrapper

## Document System (.gr.md)

`.gr.md` files combine a workflow (YAML frontmatter) with a template body (Markdown with `${...}` interpolation and `{{#...}}` block directives).

### Render Command Flags

| Flag | Purpose |
|------|---------|
| `--input <file>` | JSON/YAML input file |
| `--input-json <json>` | Inline JSON input |
| `--output <file>` | Write rendered output to file |
| `--dry-run` | Validate without executing |
| `--from-run <id>` | Re-render template against past run results (skip execution) |
| `--watch` | Watch file and smart re-render (body-only changes skip execution) |
| `--format <md\|html>` | Output format: `markdown` (default) or `html` |

### Template Syntax

- `${expr}` — inline interpolation
- `${expr | formatter arg1 arg2}` — interpolation with formatter
- `{{#each expr as binding}} ... {{/each}}` — iteration
- `{{#if expr}} ... {{#else}} ... {{/if}}` — conditional
- `\${...}` — escaped (renders literal `${...}`)

### Formatters (11 built-in + custom)

`bullets`, `numbered`, `table`, `json`, `code`, `default`, `fixed`, `upper`, `lower`, `truncate`, `date`

Custom formatters registered via `formattersEntry` config or `registerFormatter()` API.

The `date` formatter accepts format args: `iso` (default), `date`, `time`, `datetime`, `short`, `long`, `relative`.

### Additional Template Directives

- `{{#include ./path.md}}` — include and evaluate a partial template
- `{{#block name}} ... {{/block}}` — define an overridable block (for template inheritance)
- `\${...}` — escaped (renders literal `${...}`)

### Document Files

```
src/document/
  contracts.ts          Type definitions (AST nodes incl. IncludeNode, BlockNode, render scope, results)
  parser.ts             Split .gr.md into frontmatter + template body, extract extends
  template-engine.ts    Parse template to AST, evaluate against scope (includes, blocks, inheritance)
  formatters.ts         11 built-in formatters + custom formatter registration API
  custom-formatters.ts  Load custom formatters from config entry file
  renderer.ts           Orchestrate: parse → resolve inheritance → execute → render → persist
  validation.ts         Pre-flight validation of template expressions and blocks
```

## Custom Formatters

Define in `glyphrail.formatters.ts` (path configurable via `formattersEntry` in config):

```typescript
import { defineFormatters } from "glyphrail";
export default defineFormatters([
  {
    name: "currency",
    description: "Format number as currency",
    format: (value, symbol = "$") => `${symbol}${Number(value).toFixed(2)}`
  }
]);
```

Programmatic registration:
```typescript
import { registerFormatter, registerFormatters } from "glyphrail";
registerFormatter("myFmt", (value, ...args) => String(value));
```

## Template Includes

`{{#include ./path/to/partial.md}}` includes a template file and evaluates it with the current scope. Path is resolved relative to the including document. Circular includes are detected and produce an error.

```markdown
{{#include ./partials/header.md}}

# Content

{{#include ./partials/footer.md}}
```

## Template Inheritance

Documents can extend a base template using `extends:` in frontmatter. The base template defines `{{#block name}}...{{/block}}` regions. The child overrides blocks selectively.

**Base template** (`base-report.gr.md`):
```markdown
{{#block header}}
*Default header*
{{/block}}

{{#block content}}
No content.
{{/block}}
```

**Child template** (`weekly.gr.md`):
```yaml
---
extends: ./base-report.gr.md
# ... child workflow ...
---
{{#block content}}
Overridden content here
{{/block}}
```

Multi-level inheritance is supported. Child overrides take priority.

## Obsidian Plugin

Prototype at `obsidian-plugin/`. Desktop-only, calls `gr` CLI as subprocess.

Commands:
- **Render current .gr.md document** — executes workflow, shows rendered output in side panel
- **Render and save as Markdown** — writes `.rendered.md` file
- **Validate current .gr.md document** — validates without executing

Settings: `grBinary` (CLI path), `autoRender` (on open), `outputFormat` (markdown/html).

Build: `cd obsidian-plugin && npm install && npm run build`

## Not Yet Implemented

- `parallel` step execution (DSL exists, runtime rejects)
- `agent.mode=tool-use` (AST exists, validation rejects)
- Workflow imports/packaging

## Adding New Features

**New command**: Create `src/cli/commands/my-command.ts` implementing `CommandDefinition`, add to `COMMANDS` array in `src/cli/commands/index.ts`.

**New tool**: Create `src/tools/my-tool.ts` implementing `Tool` interface, or define in project's `glyphrail.tools.ts` via `defineTools()`.

**New agent adapter**: Implement `AgentAdapter` interface, register in `BUILTIN_ADAPTERS` map in `src/agent/runtime.ts`. See `src/agent/claude-code-adapter.ts` as reference.
