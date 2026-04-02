# Glyphrail Capabilities

A comprehensive reference for every capability, feature, and integration point in the Glyphrail workflow orchestration engine (v0.1.2).

---

## Table of Contents

1. [Overview](#1-overview)
2. [Installation & Setup](#2-installation--setup)
3. [Project Initialization](#3-project-initialization)
4. [CLI Command Reference](#4-cli-command-reference)
5. [Workflow DSL Reference](#5-workflow-dsl-reference)
6. [Step Kind Reference](#6-step-kind-reference)
7. [Expression Language](#7-expression-language)
8. [Tool System](#8-tool-system)
9. [Agent System](#9-agent-system)
10. [Execution Engine](#10-execution-engine)
10b. [Glyphrail Documents (.gr.md)](#10b-glyphrail-documents-grmd)
11. [Persistence & Checkpointing](#11-persistence--checkpointing)
12. [Run Inspection & Debugging](#12-run-inspection--debugging)
13. [Error Handling & Policies](#13-error-handling--policies)
14. [Configuration System](#14-configuration-system)
15. [Schema System](#15-schema-system)
16. [Validation & Linting](#16-validation--linting)
17. [Output Formats & JSON Contract](#17-output-formats--json-contract)
18. [Public API (Programmatic)](#18-public-api-programmatic)
19. [Security & Sandboxing](#19-security--sandboxing)
20. [Extensibility](#20-extensibility)
21. [Limitations & Deferred Features](#21-limitations--deferred-features)

---

## 1. Overview

Glyphrail is a **deterministic workflow orchestration engine** designed from the ground up for AI-native applications. Its core design philosophy:

- **The engine owns** control flow, persistence, budgets, and safety
- **Tools own** typed side effects with explicit schemas
- **Agent steps own** bounded judgment inside a deterministic shell
- **The CLI is** a machine-operable contract enabling external AI agents to automate workflows

### What Glyphrail Does

1. **Authors workflows** as declarative YAML with typed inputs/outputs, control flow, tool calls, and bounded agent steps
2. **Validates workflows** against a strict schema with expression parsing, tool reference checking, and lint warnings
3. **Executes workflows** deterministically with persisted state, checkpointing, and trace events
4. **Inspects runs** through a rich set of commands for viewing metadata, state, output, traces, and individual steps
5. **Resumes paused runs** from checkpoints without replaying completed steps
6. **Manages tools** with a typed registry, input/output validation, and policy enforcement
7. **Scaffolds projects** with templates for config, tools, and workflows
8. **Renders documents** (`.gr.md`) combining workflow frontmatter with Markdown templates that fill in with execution results

### Key Properties

| Property | Description |
|----------|-------------|
| Runtime | Bun >= 1.3.0 (TypeScript executed directly, no transpilation) |
| Dependencies | Zero production dependencies |
| Package | npm: `glyphrail`, binaries: `glyphrail` and `gr` |
| Language | TypeScript (ESM, strict typing throughout) |
| Execution Model | Sequential, deterministic, with persisted state |
| Output | JSON envelope (`--json`) or human-readable (default) |
| Persistence | File-based (JSON, JSONL for traces) |
| Version | 0.1.2 (schema version 0.1.0) |

---

## 2. Installation & Setup

### Global Installation

```bash
npm install -g glyphrail
# or
bun install -g glyphrail
```

### From Source

```bash
git clone https://github.com/Narcis13/glyphrail.git
cd glyphrail
bun run src/cli/index.ts --help
```

### Prerequisites

- **Bun >= 1.3.0** (primary runtime)
- **Node.js >= 18** (for npm package distribution launcher)

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `GLYPHRAIL_BUN` | Override path to Bun executable in launcher scripts |
| Any env var | Accessible in workflows via `${env.VAR_NAME}` expressions |

---

## 3. Project Initialization

```bash
glyphrail init [--cwd <path>]
# or
gr init
```

Creates a project skeleton:

```
<project>/
  glyphrail.config.json    # Project configuration
  glyphrail.tools.ts       # Custom tool definitions
  workflows/
    hello.gr.yaml          # Sample workflow
```

The `init` command:
- Creates configuration with sensible defaults
- Scaffolds a typed tool entry file with `defineTools()`
- Creates a sample workflow demonstrating basic features
- Will not overwrite existing files

---

## 4. CLI Command Reference

### Global Flags (available on all commands)

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--cwd <path>` | string | `process.cwd()` | Working directory for project resolution |
| `--config <path>` | string | auto-discovered | Path to `glyphrail.config.json` |
| `--json` | boolean | false | Output JSON envelope instead of human text |
| `--quiet` | boolean | false | Suppress all human-readable output |
| `--verbose` | boolean | false | Enable verbose logging |
| `--color <mode>` | `auto\|always\|never` | auto | Color output control |
| `--no-color` | boolean | false | Disable color (shorthand) |
| `--trace` | boolean | false | Enable trace-level logging |
| `--profile` | boolean | false | Enable profiling |
| `--help` | boolean | false | Show help for command |
| `--version` | boolean | false | Show version |

### Discovery Commands

#### `capabilities`

List all available tools, adapters, schemas, and project capabilities as a machine-readable document.

```bash
gr capabilities --json
```

Returns: tool descriptors, adapter names, schema catalog entries, project paths, and version info.

#### `schema [name]`

Export JSON schema definitions for all Glyphrail contracts.

```bash
gr schema                    # List all available schemas
gr schema workflow --json    # Export workflow schema
gr schema config --json      # Export config schema
gr schema tool --json        # Export tool contract schema
```

Available schemas: `workflow`, `json-schema-subset`, `config`, `tool`, `agent`, `run-record`, `trace-event`, `error`, `json-envelope`.

#### `check`

Validate entire project health: config, tools, and all workflows.

```bash
gr check --json
```

Returns: validation status for each component, list of issues with severity.

### Project Commands

#### `init`

Initialize a new Glyphrail project (see [Section 3](#3-project-initialization)).

```bash
gr init [--cwd <path>]
```

### Workflow Commands

#### `workflow create <name>`

Create a new workflow file from template.

```bash
gr workflow create my-workflow
```

Creates `workflows/my-workflow.gr.yaml` with scaffolded structure.

#### `workflow validate <file>`

Validate a workflow YAML file against the schema.

```bash
gr workflow validate workflows/my-workflow.gr.yaml --json
```

Returns: validation result with errors (code, message, path, severity) and tool reference status.

#### `workflow lint <file>`

Lint a workflow for warnings, risks, and best practices beyond schema validity.

```bash
gr workflow lint workflows/my-workflow.gr.yaml --json
```

Returns: lint warnings including unused variables, unreachable steps, missing descriptions, risky patterns.

#### `workflow explain <file>`

Generate a human-readable explanation of workflow structure and behavior.

```bash
gr workflow explain workflows/my-workflow.gr.yaml
```

Returns: step-by-step breakdown, data flow analysis, tool dependencies, state mutations.

### Tool Commands

#### `tool list`

List all discovered tools from the project's tool registry.

```bash
gr tool list --json
```

Returns: array of tool descriptors (name, description, inputSchema, outputSchema, sideEffect, tags).

#### `tool show <name>`

Show detailed contract for a specific tool.

```bash
gr tool show bash --json
```

Returns: complete tool descriptor including schemas, side effect classification, and timeout.

#### `tool call <name>`

Invoke a tool directly with input.

```bash
gr tool call bash --input '{"command": "echo hello"}' --json
gr tool call file-read --input '{"path": "README.md"}' --json
```

Returns: tool result with `ok: true/false`, output or error.

#### `tool validate`

Validate the tool registry for contract compliance.

```bash
gr tool validate --json
```

Returns: validation results for each tool, schema compliance issues.

#### `tool scaffold`

Generate a tool implementation template.

```bash
gr tool scaffold
```

Creates a tool template file with typed contract structure.

### Execution Commands

#### `run <file>`

Execute a workflow.

```bash
gr run workflows/hello.gr.yaml --json
gr run workflows/process.gr.yaml --input '{"name": "World"}' --json
gr run workflows/test.gr.yaml --dry-run --json
gr run workflows/task.gr.yaml --no-checkpoint --json
```

| Option | Type | Description |
|--------|------|-------------|
| `<file>` | positional | Path to workflow YAML file |
| `--input <json>` | string | JSON input matching workflow's inputSchema |
| `--input-file <path>` | string | Path to JSON file containing input |
| `--dry-run` | boolean | Validate and prepare but don't execute |
| `--no-checkpoint` | boolean | Disable per-step checkpointing |

Returns: run result with runId, status, output, state, counters, artifact paths.

#### `render <file.gr.md>`

Execute a `.gr.md` document workflow and render its Markdown template with results.

```bash
gr render docs/report.gr.md --json
gr render docs/report.gr.md --input-json '{"name": "World"}' --json
gr render docs/report.gr.md --output report.md --json
gr render docs/report.gr.md --dry-run --json
```

| Option | Type | Description |
|--------|------|-------------|
| `<file.gr.md>` | positional | Path to `.gr.md` document |
| `--input <file>` | string | Read input from JSON file |
| `--input-json <json>` | string | Inline JSON input |
| `--output <file>` | string | Write rendered Markdown to file |
| `--dry-run` | boolean | Validate without executing |
| `--no-checkpoint` | boolean | Skip checkpointing |
| `--max-steps <n>` | string | Override max run steps |
| `--max-duration-ms <n>` | string | Override max run duration |
| `--from-run <id>` | string | Re-render template against past run results (skip execution) |
| `--format <format>` | string | Output format: `markdown` (default) or `html` |
| `--watch` | boolean | Watch file and smart re-render on changes |

Returns: JSON envelope with `runId`, `status`, `rendered` (Markdown/HTML string), `output`, `artifacts`, `templateWarnings`.

Rendered documents are persisted as `rendered.md` and `source.gr.md` alongside standard run artifacts.

`--from-run` enables iterating on the template without re-executing the workflow. `--watch` hashes frontmatter and body separately — body-only changes re-render from cached run data, frontmatter changes trigger full re-execution.

#### `document validate <file.gr.md>`

Validate both the workflow frontmatter and the template body of a `.gr.md` document without executing.

```bash
gr document validate docs/report.gr.md --json
```

Returns: validation results with error/warning counts, individual issues with line numbers, and workflow metadata if parseable.

#### `document explain <file.gr.md>`

Explain both workflow and template structure of a `.gr.md` document.

```bash
gr document explain docs/report.gr.md --json
```

Returns: workflow metadata (name, steps, tools), template analysis (interpolations, formatters, blocks, nesting depth), and validation status.

#### `resume <run-id>`

Resume a paused run from its last checkpoint.

```bash
gr resume run_2026-03-17T10-00-00_abc12345 --json
```

Validates: run is paused, workflow file exists and matches, cursor is present. Reconstructs runtime state and continues from cursor position.

### Run Inspection Commands

#### `runs list`

List all persisted runs sorted by date (most recent first).

```bash
gr runs list --json
```

Returns: array of run records with runId, workflow name, status, timestamps, counters.

#### `runs show <run-id>`

Show full run metadata.

```bash
gr runs show <run-id> --json
```

Returns: complete RunRecord including cursor, counters, retry history, error history.

#### `runs state <run-id>`

Show the final state snapshot of a run.

```bash
gr runs state <run-id> --json
```

Returns: the full `state` namespace as it existed at run completion/pause/failure.

#### `runs output <run-id>`

Show the final output of a completed run.

```bash
gr runs output <run-id> --json
```

Returns: the output value (from `return` step or workflow `output` mapping).

#### `runs step <run-id> <step-id>`

Show execution details for a specific step within a run.

```bash
gr runs step <run-id> greet --json
```

Returns: step trace events (started, completed/failed), input, output, duration, state changes.

#### `runs trace <run-id>`

Show all trace events for a run.

```bash
gr runs trace <run-id> --json
gr runs trace <run-id> --event step.completed --json
gr runs trace <run-id> --event tool.failed --json
```

| Option | Description |
|--------|-------------|
| `--event <type>` | Filter to specific event type |

Returns: array of trace events in chronological order.

#### `runs explain <run-id>`

Generate a summarized analysis of a run.

```bash
gr runs explain <run-id> --json
```

Returns: run summary with step count, retries, duration, status, key events.

---

## 5. Workflow DSL Reference

### Top-Level Structure

```yaml
version: "1.0"                    # Required: DSL version
name: my-workflow                  # Required: unique workflow name
description: What this does        # Optional: human documentation

inputSchema:                       # Optional: JSON Schema for input validation
  type: object
  properties:
    name: { type: string }
  required: [name]

outputSchema:                      # Optional: JSON Schema for output validation
  type: object
  properties:
    result: { type: string }

defaults:                          # Optional: step defaults
  model: mock                     # Default agent model
  timeoutMs: 30000                # Default step timeout
  maxStepRetries: 3               # Default retry count
  outputMode: structured          # Default agent output mode

policies:                          # Optional: execution bounds
  allowTools: [bash, file-read]   # Tool allowlist (empty = all)
  maxRunSteps: 100                # Max total step executions
  maxRunDurationMs: 300000        # Max run duration (5 min default)
  maxAgentToolCalls: 10           # Max tool calls per agent step

state:                             # Optional: initial state values
  results: []
  count: 0

steps:                             # Required: step list
  - id: step-1
    kind: assign
    set: { greeting: "Hello ${input.name}" }

output: ${state.greeting}          # Optional: explicit output mapping
```

### Base Step Fields (all step kinds)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique step identifier |
| `kind` | string | Yes | Step type: assign, tool, agent, if, for_each, while, return, fail, noop |
| `name` | string | No | Human-readable display name |
| `description` | string | No | Documentation |
| `when` | expression | No | Conditional guard; step skipped if evaluates false |
| `timeoutMs` | number | No | Step-level timeout override |
| `onError` | object | No | Error handling policy |
| `meta` | object | No | Arbitrary metadata (passed to adapters) |

### Write Directives (on tool and agent steps)

| Directive | Behavior |
|-----------|----------|
| `save: state.path` | Replace value at the specified state path |
| `append: state.arrayPath` | Append value to array at path (target must be array) |
| `merge: state.objectPath` | Deep merge value into object at path (target must be object) |

---

## 6. Step Kind Reference

### `assign`

Set one or more state values.

```yaml
- id: set-greeting
  kind: assign
  set:
    greeting: "Hello ${input.name}"
    count: ${state.count + 1}
    items: [1, 2, 3]
```

- `set` is a `Record<string, expression>` where each value is evaluated and written to `state`

### `tool`

Invoke a registered tool.

```yaml
- id: read-config
  kind: tool
  tool: file-read
  input:
    path: config.json
  save: state.config

- id: run-command
  kind: tool
  tool: bash
  input:
    command: "echo ${state.config.name}"
  save: state.output
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tool` | string | Yes | Registered tool name |
| `input` | object/expression | Yes | Tool input (validated against tool's inputSchema) |
| `save` | string | No | State path to write `output` |
| `append` | string | No | State array path to append `output` |
| `merge` | string | No | State object path to merge `output` |

Tool output is validated against `outputSchema` if the tool defines one.

### `agent`

Execute a bounded LLM step with structured output.

```yaml
- id: classify
  kind: agent
  mode: structured
  provider: mock
  model: mock
  objective: Classify the input text
  instructions: |
    Analyze the following text and return a classification.
    Categories: positive, negative, neutral.
  input: ${state.text}
  outputSchema:
    type: object
    properties:
      category: { type: string, enum: [positive, negative, neutral] }
      confidence: { type: number, minimum: 0, maximum: 1 }
    required: [category, confidence]
  save: state.classification
  meta:
    mockResponse:
      output: { category: positive, confidence: 0.95 }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `mode` | string | Yes | `structured` (only mode currently supported) |
| `provider` | string | Yes | Adapter name (`mock` in MVP) |
| `model` | string | No | Model identifier |
| `objective` | string | Yes | What the agent should accomplish |
| `instructions` | string | No | Detailed guidance for the agent |
| `input` | any | No | Input data passed to agent |
| `outputSchema` | JsonSchema | No | Schema for validating agent output |
| `save/append/merge` | string | No | Write directive for result |
| `meta` | object | No | Adapter-specific metadata |

**Output Repair**: If the agent returns raw text instead of valid JSON, Glyphrail attempts automatic repair:
1. Trim whitespace
2. Extract content from markdown code fences
3. Extract largest JSON fragment

### `if`

Conditional branching.

```yaml
- id: check-count
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

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `condition` | expression | Yes | Boolean expression |
| `then` | step[] | Yes | Steps executed when condition is true |
| `else` | step[] | No | Steps executed when condition is false |

### `for_each`

Iterate over a collection.

```yaml
- id: process-items
  kind: for_each
  items: ${state.items}
  as: item
  steps:
    - id: transform
      kind: assign
      set:
        processed: ${item.value * 2}
    - id: save-result
      kind: tool
      tool: file-write
      input:
        path: "output/${item.name}.txt"
        content: "${state.processed}"
      append: state.results
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `items` | expression (array) | Yes | Collection to iterate |
| `as` | string | No | Variable name for current item (default: `item`) |
| `steps` | step[] | Yes | Steps to execute per item |

Inside the loop, `${item}` (or `${<as-name>}`) refers to the current element.

### `while`

Bounded loop with condition.

```yaml
- id: retry-loop
  kind: while
  condition: ${state.status != "done"}
  maxIterations: 10
  steps:
    - id: attempt
      kind: tool
      tool: fetch
      input:
        url: "https://api.example.com/status"
      save: state.response
    - id: update-status
      kind: assign
      set:
        status: ${state.response.status}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `condition` | expression | Yes | Continue while true |
| `maxIterations` | number | No | Safety bound (prevents infinite loops) |
| `steps` | step[] | Yes | Steps to execute per iteration |

### `return`

Exit the workflow with output.

```yaml
- id: done
  kind: return
  output:
    result: ${state.greeting}
    count: ${state.count}
```

If no `output` is specified, the entire materialized `state` namespace becomes the output.

### `fail`

Exit with an explicit error.

```yaml
- id: abort
  kind: fail
  message: "Missing required data: ${state.missingField}"
```

### `noop`

Intentionally does nothing. Useful as a placeholder or documentation anchor.

```yaml
- id: placeholder
  kind: noop
  description: Will be implemented in next iteration
```

### `parallel` (DSL-only)

Declared in the schema but **not yet executable**. Validation accepts it; runtime rejects it with a clear error.

```yaml
- id: parallel-work
  kind: parallel
  branches:
    - steps: [...]
    - steps: [...]
```

---

## 7. Expression Language

Expressions are used wherever `${...}` appears in workflow YAML values.

### Syntax

```
${<expression>}
```

### Supported Features

| Feature | Examples |
|---------|---------|
| References | `${input.name}`, `${state.count}`, `${env.HOME}` |
| Nested paths | `${state.users[0].name}`, `${input.config.key}` |
| Arithmetic | `${state.count + 1}`, `${state.price * 0.9}` |
| Comparison | `${state.count > 0}`, `${state.name == "test"}` |
| Logical | `${state.a && state.b}`, `${!state.done}` |
| String concat | `${"Hello " + input.name}` |
| Modulo | `${state.index % 2}` |
| Grouping | `${(state.a + state.b) * 2}` |

### Available Scopes

| Scope | Description | Mutability |
|-------|-------------|------------|
| `input` | Workflow input data | Read-only |
| `state` | Mutable workflow state | Read-write (via write directives) |
| `env` | Environment variables | Read-only |
| `context` | Step execution context (stepId, loopIndex) | Read-only |
| `item` | Current `for_each` item | Read-only (loop-scoped) |
| `branch` | Current `parallel` branch | Read-only (branch-scoped) |
| `output` | Workflow output (in document templates) | Read-only (template-scoped) |

### Operators

| Operator | Type | Precedence |
|----------|------|------------|
| `!` | Unary NOT | Highest |
| `-` | Unary negation | High |
| `*`, `/`, `%` | Multiplicative | Medium-high |
| `+`, `-` | Additive | Medium |
| `==`, `!=` | Equality | Medium-low |
| `&&` | Logical AND | Low |
| `\|\|` | Logical OR | Lowest |

### Not Supported

- Function calls (no `len()`, `toUpper()`, etc.)
- Array indexing with expressions (only literal indices)
- Arbitrary JavaScript
- Template literals within expressions

---

## 8. Tool System

### Architecture

```
Tool Contract (types) -> Tool Registry (discovery/loading) -> Tool Runtime (invocation + policy)
```

### Tool Contract

Every tool implements:

```typescript
type Tool<Input, Output> = {
  name: string;                        // Unique identifier
  description: string;                 // Human-readable purpose
  inputSchema: JsonSchema;             // Input validation schema
  outputSchema?: JsonSchema;           // Output validation schema
  sideEffect: "none"|"read"|"write"|"external";  // Side effect classification
  timeoutMs?: number;                  // Tool-level timeout
  tags?: ("io"|"http"|"file"|"compute"|"ai"|"db"|"unsafe")[];
  execute: (input: Input, ctx: ToolContext) => Promise<ToolResult<Output>>;
};
```

### Side Effect Classification

| Level | Meaning | Policy Impact |
|-------|---------|---------------|
| `none` | Pure computation, no side effects | Always allowed |
| `read` | Reads external state | Always allowed |
| `write` | Modifies local state | Blocked when `allowExternalSideEffects: false` |
| `external` | Network, processes, etc. | Blocked when `allowExternalSideEffects: false` |

### Built-in Tools

#### `bash`

Execute shell commands from the project root.

```yaml
input:
  command: string       # Required: shell command
  cwd: string          # Optional: working directory (relative to project root)
  timeoutMs: number    # Optional: command timeout
  env: object          # Optional: additional environment variables

output:
  exitCode: number
  stdout: string
  stderr: string
  succeeded: boolean
```

- Side effect: `external`
- Tags: `compute`, `unsafe`
- Blocked when `allowExternalSideEffects: false`

#### `fetch`

Make HTTP requests.

```yaml
input:
  url: string                    # Required: target URL
  method: string                 # Optional: GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS (default: GET)
  headers: object                # Optional: request headers
  query: object                  # Optional: query parameters
  body: any                      # Optional: request body (JSON-serialized)
  timeoutMs: number              # Optional: request timeout
  responseType: string           # Optional: json|text|base64 (auto-detected)

output:
  url: string
  status: number
  ok: boolean
  headers: object
  body: any
  responseType: string
```

- Side effect: `external`
- Tags: `http`, `io`
- Supports AbortSignal for cancellation

#### `file-read`

Read file contents (sandboxed to project root).

```yaml
input:
  path: string                   # Required: file path (relative to project root)
  encoding: string               # Optional: utf8|base64 (default: utf8)

output:
  path: string
  content: string
  encoding: string
  sizeBytes: number
```

- Side effect: `read`
- Tags: `file`, `io`
- Path sandboxing prevents directory traversal

#### `file-write`

Write or append to files (sandboxed to project root).

```yaml
input:
  path: string                   # Required: file path
  content: string                # Required: file content
  encoding: string               # Optional: utf8|base64 (default: utf8)
  mode: string                   # Optional: overwrite|append (default: overwrite)
  createDirectories: boolean     # Optional: create parent dirs (default: false)

output:
  path: string
  bytesWritten: number
  mode: string
```

- Side effect: `write`
- Tags: `file`, `io`, `unsafe`

#### `file-edit`

Replace text in files with precise control.

```yaml
input:
  path: string                   # Required: file path
  oldText: string                # Required: text to find
  newText: string                # Required: replacement text
  replaceAll: boolean            # Optional: replace all occurrences (default: false)
  occurrence: number             # Optional: replace Nth occurrence (1-based)

output:
  path: string
  content: string
  replacements: number
```

- Side effect: `write`
- Tags: `file`, `io`, `unsafe`
- Modes: single (default), all (`replaceAll: true`), specific (`occurrence: N`)

### Custom Tool Definition

Create `glyphrail.tools.ts` in your project root:

```typescript
import { defineTools } from "glyphrail";

export default defineTools([
  {
    name: "format-handle",
    description: "Format a user handle",
    inputSchema: {
      type: "object",
      properties: {
        firstName: { type: "string" },
        lastName: { type: "string" }
      },
      required: ["firstName", "lastName"]
    },
    outputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" }
      }
    },
    sideEffect: "none",
    execute: async (input) => ({
      ok: true,
      output: { handle: `@${input.firstName.toLowerCase()}.${input.lastName.toLowerCase()}` }
    })
  }
]);
```

### Tool Discovery

The registry system:
1. Reads the TypeScript entry file (default: `glyphrail.tools.ts`)
2. Statically analyzes imports and `defineTools()` calls
3. Dynamically imports the module
4. Validates each tool contract (name uniqueness, schema validity)
5. Returns the loaded `Tool[]` array

### Tool Policy Enforcement

Before every invocation:
1. Check tool against allowlist (`policies.allowTools`)
2. Check side effect against `allowExternalSideEffects` policy
3. Resolve effective timeout (minimum of tool timeout and policy timeout)
4. Validate input against `inputSchema`
5. Execute with AbortController for timeout
6. Validate output against `outputSchema` (if defined)

---

## 9. Agent System

### Current Status

The agent system ships with two built-in adapters: the **mock adapter** for deterministic testing and the **claude-code adapter** for headless Claude Code integration.

### Agent Adapter Interface

```typescript
interface AgentAdapter {
  name: string;
  runStructured(request: StructuredAgentRequest): Promise<StructuredAgentResult>;
  runToolUse?(request: ToolUseAgentRequest): Promise<ToolUseAgentResult>;
}
```

### Structured Agent Request

```typescript
interface StructuredAgentRequest {
  runId?: string;
  stepId?: string;
  provider: string;
  model: string;
  objective: string;           // What to accomplish
  instructions?: string;       // Detailed guidance
  input?: JsonValue;           // Input data
  outputSchema?: JsonSchema;   // Expected output structure
  timeoutMs?: number;
  prompt: string;              // Assembled prompt text
  attempt: number;             // Current attempt (for retries)
  meta?: Record<string, unknown>;  // Adapter-specific metadata
}
```

### Prompt Assembly

The runtime builds prompts from agent step fields:

```
Objective:
<objective text>

Instructions:
<instructions text>

Input JSON:
<formatted JSON input>
```

### Mock Adapter

For deterministic testing and workflow development:

```yaml
meta:
  mockResponse:
    output: { result: "success" }     # Direct JSON output
    # OR
    rawOutput: '{"result": "success"}' # Triggers repair pipeline
    # OR
    error: { code: "AGENT_FAILED", message: "Simulated failure" }

  # OR for multi-attempt scenarios:
  mockResponses:
    - error: { code: "TIMEOUT", message: "First attempt fails" }
    - output: { result: "success" }   # Second attempt succeeds
```

### Claude Code Adapter (`claude-code`)

Runs Claude Code in headless mode (`claude --print`) as the AI backend. Requires the `claude` CLI installed and authenticated.

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
    maxTurns: 1
    allowedTools: [Read, Grep]
```

#### Meta Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `claudeBinary` | string | `"claude"` | Path to the claude CLI binary |
| `claudeFlags` | string[] | `[]` | Extra CLI flags (e.g., `["--no-input"]`) |
| `cwd` | string | `process.cwd()` | Working directory for the claude process |
| `env` | Record | `{}` | Extra environment variables |
| `maxTurns` | number | — | Limit claude agentic turns (`--max-turns`) |
| `systemPrompt` | string | — | Prepended to the assembled prompt |
| `verbose` | boolean | `false` | Pass `--verbose` to claude |
| `allowedTools` | string[] | — | Restrict claude's available tools (`--allowedTools`) |
| `mcpConfig` | string | — | MCP server config JSON string (`--mcp-config`) |

#### Environment Variable Override

Set `GLYPHRAIL_CLAUDE_BINARY` to override the claude binary path globally (takes precedence over default, but `meta.claudeBinary` overrides it).

#### How It Works

1. Builds a prompt from `objective` + `instructions` + `input` + `outputSchema`
2. Spawns `claude --print --output-format text` with assembled args
3. Writes the prompt to stdin and captures stdout/stderr
4. Parses JSON from output (handles code fences, wrapped envelopes, embedded JSON fragments)
5. On non-zero exit, returns a retryable error (except exit code 2 = non-retryable CLI usage error)
6. On timeout, sends SIGTERM then SIGKILL after 3s grace period

#### Prompt Assembly

```
[System prompt (if provided)]
---
Objective:
<objective text>

Instructions:
<instructions text>

Input JSON:
<formatted JSON>

Output Requirements:
Respond with ONLY a valid JSON object matching this schema — no markdown fences, no explanation, just raw JSON:
<outputSchema JSON>

Note: This is retry attempt N. (if attempt > 1)
```

### Output Repair Pipeline

When an agent returns `rawOutput` instead of parsed `output`:
1. **Trim**: Strip whitespace
2. **Unfence**: Extract from markdown code fences (`` ```json ... ``` ``)
3. **Fragment**: Find largest extractable JSON object/array

Repair metadata is recorded in trace events: `repairAttempted`, `repairSucceeded`, `repairCandidate`.

### Agent Execution Flow

1. Evaluate `when` condition (skip if false)
2. Resolve `input` expressions against runtime
3. Build prompt from `objective` + `instructions` + `input`
4. Call adapter's `runStructured()` method
5. If raw text returned, attempt output repair
6. Validate output against `outputSchema`
7. Apply write directive (`save`/`append`/`merge`)
8. Record trace events and checkpoint

---

## 10. Execution Engine

### Core Function

```typescript
executeWorkflow(options: ExecuteWorkflowOptions): Promise<ExecuteWorkflowResult>
```

### Execution Flow

```
1. Initialize
   ├── Create runtime namespaces (input, state, context, system)
   ├── Load tool registry
   ├── Build effective policies (merge workflow + config)
   ├── Create run directory and initial artifacts
   └── Emit run.started trace event

2. Step Execution Loop
   For each step in order:
   ├── Evaluate 'when' condition (skip if false)
   ├── Check policy limits (maxRunSteps, maxRunDurationMs)
   ├── Execute step by kind
   │   ├── assign: evaluate expressions, write to state
   │   ├── tool: invoke with validation, apply write directive
   │   ├── agent: call adapter, repair output, validate, write
   │   ├── if: evaluate condition, execute then/else branch
   │   ├── for_each: iterate items, execute steps per item
   │   ├── while: loop with condition check, bounded by maxIterations
   │   ├── return: produce output, exit
   │   ├── fail: produce error, exit
   │   └── noop: no-op
   ├── Handle errors via onError policy
   ├── Emit trace events (step.started, step.completed, etc.)
   └── Persist checkpoint (if checkpointEveryStep)

3. Finalize
   ├── Write final state, output, metadata
   ├── Emit run.completed or run.failed
   └── Return result with counters and artifact paths
```

### Runtime Namespaces

| Namespace | Purpose | Mutability |
|-----------|---------|------------|
| `input` | Workflow input data | Immutable |
| `state` | Mutable workflow state | Written by assign/save/append/merge |
| `context` | Per-step context (stepId, loopIndex) | Engine-managed |
| `system` | Run metadata (workflowFile, startedAt, runId) | Engine-managed |

### State Mutations

| Operation | Function | Behavior |
|-----------|----------|----------|
| `save: state.path` | `setStateValue()` | Replace value at dotted path |
| `append: state.path` | `appendStateValue()` | Push to array at path |
| `merge: state.path` | `mergeStateValue()` | Deep merge into object at path |
| `set: { key: val }` | (assign step) | Evaluate and write each key |

Path syntax supports dot notation and array indexing: `state.users[0].name`

### Execution Counters

Tracked per run and persisted in metadata:

| Counter | Description |
|---------|-------------|
| `completedSteps` | Successfully executed steps |
| `failedSteps` | Steps that failed |
| `retries` | Total retry attempts across all steps |
| `loopIterations` | Total for_each and while iterations |
| `checkpoints` | Number of saved checkpoints |

### Dry Run Mode

`--dry-run` validates the workflow and prepares execution without actually running steps. Useful for validating input, checking tool availability, and verifying policies.

---

## 10b. Glyphrail Documents (.gr.md)

### Overview

A `.gr.md` file combines a Glyphrail workflow (YAML frontmatter) with a Markdown template (body). When rendered via `gr render`, the workflow executes and the template body fills itself in with the results — producing a living, traceable document.

This is **result-first authoring**: you start with the document you want to exist, and the workflow makes it real.

### Document Format

```markdown
---
version: "1.0"
name: weekly-status
inputSchema:
  type: object
  properties:
    team: { type: string }
  required: [team]
state:
  data: null
steps:
  - id: gather
    kind: tool
    tool: bash
    input:
      command: "echo gathered data"
    save: state.data
output:
  data: ${state.data}
  team: ${input.team}
---

# Status Report: ${output.team}

## Data

${output.data | json}

---
*Generated on ${context.startedAt} | Run ${context.runId}*
```

**Rules:**
1. Frontmatter MUST be a complete, valid Glyphrail workflow (all existing DSL rules apply)
2. Body is Markdown with `${expr}` inline interpolations and pipe formatters
3. Body scope includes: `input`, `state` (final), `output`, `context`, `env`
4. Empty body is valid — equivalent to a regular `.gr.yaml` workflow
5. Source `.gr.md` is never mutated; rendered output is a separate artifact

### Template Syntax

#### Inline Interpolation — `${expr}`

Reuses the existing expression engine. Any valid workflow expression works:

```markdown
Revenue: ${output.metrics.revenue}
Full name: ${input.firstName + " " + input.lastName}
```

Values are stringified for insertion. `null`/`undefined` render as empty string.

#### Pipe Formatters — `${expr | formatter}`

Transform values into Markdown-friendly strings:

| Formatter | Input | Output |
|-----------|-------|--------|
| `bullets` | array | Bullet list (`- item`) |
| `numbered` | array | Numbered list (`1. item`) |
| `table` | array of objects | Markdown table |
| `json` | any | Pretty JSON in code fence |
| `code "lang"` | string | Fenced code block with language |
| `default "fallback"` | any | Fallback for null/undefined |
| `fixed N` | number | `toFixed(N)` |
| `upper` | string | UPPERCASE |
| `lower` | string | lowercase |
| `truncate N` | string | Truncated with `...` |
| `date "fmt"` | timestamp/string | Formatted date |

`date` format args: `iso` (default), `date`, `time`, `datetime`, `short`, `long`, `relative`.

Formatters are pure functions — no side effects.

#### Block Directives

Control flow within templates using `{{#...}}` syntax:

**Iteration** — `{{#each expr as binding}} ... {{/each}}`:

```markdown
{{#each output.items as item}}
- **${item.name}**: ${item.description}
{{/each}}
```

Evaluates the items expression (must be an array), then renders the body once per element with the binding variable added to scope.

**Conditionals** — `{{#if expr}} ... {{#else}} ... {{/if}}`:

```markdown
{{#if output.hasBlockers}}
Blockers:
{{#each output.blockers as b}}
> ${b}
{{/each}}
{{#else}}
No blockers.
{{/if}}
```

Blocks can be nested to arbitrary depth. Block binding variables become dynamic scope roots (e.g., `item` in `{{#each ... as item}}`).

#### Escape Hatch

Literal `${...}` that shouldn't be interpolated: prefix with backslash `\${this.is.literal}`.

#### HTML Output Format

Use `--format html` on the `render` command to produce a standalone HTML document instead of Markdown. The converter handles headings, lists, tables, code blocks, blockquotes, bold, italic, and inline code with clean default styling.

### Template Scope

| Scope | Description |
|-------|-------------|
| `input` | Original workflow input |
| `state` | Final state after execution |
| `output` | Workflow output |
| `context` | Run metadata (`runId`, `workflowName`, `startedAt`) |
| `env` | Environment variables |

### Persistence

Rendered documents are stored alongside standard run artifacts:

```
.glyphrail/runs/run_<id>/
  meta.json, input.json, state.latest.json, output.json, trace.jsonl  # standard
  rendered.md      # the rendered Markdown document
  source.gr.md     # copy of source for reproducibility
```

### Error Handling

| Code | Exit Code | When |
|------|-----------|------|
| `DOCUMENT_PARSE_ERROR` | 3 | Frontmatter splitting fails |
| `TEMPLATE_PARSE_ERROR` | 3 | Template syntax error |
| `TEMPLATE_RENDER_ERROR` | 5 | Expression evaluation fails during render |
| `TEMPLATE_VALIDATION_ERROR` | 3 | Template references invalid roots or formatters |

Template expression errors are collected as warnings rather than hard failures — the document renders with empty values where expressions fail.

### Document Validation

`gr document validate <file.gr.md>` validates both the workflow frontmatter and template body without executing. Checks:
- YAML structure and workflow schema validity
- Step references, tool names, expression syntax in frontmatter
- Template expression validity, formatter existence, block nesting

### Document Explain

`gr document explain <file.gr.md>` provides structural analysis of both workflow and template:
- Workflow metadata (name, version, steps, tools, policies)
- Template analysis (interpolations, formatters used, each/if blocks, nesting depth)
- Validation status

### Re-Render from Past Run

`gr render <file.gr.md> --from-run <run-id>` re-renders the current template body against a past run's persisted state, output, and input — without re-executing the workflow. This enables iterating on template wording and formatting without paying the execution cost each time.

### Watch Mode

`gr render <file.gr.md> --watch --output <file>` watches the `.gr.md` file for changes and automatically re-renders. It hashes frontmatter and body separately:
- **Body-only change**: re-renders from the cached run (skips execution)
- **Frontmatter change**: triggers full re-execution

Requires `--output` to write results to a file. Runs until interrupted (SIGINT/SIGTERM).

---

## 11. Persistence & Checkpointing

### Run Artifact Structure

```
.glyphrail/runs/run_<id>/
├── meta.json              # RunRecord: status, cursor, counters, errors
├── input.json             # Original workflow input (immutable)
├── state.latest.json      # Latest state snapshot
├── output.json            # Final output (written on completion)
├── trace.jsonl            # Append-only trace events (one JSON per line)
├── checkpoints/           # Per-step state snapshots
├── rendered.md            # Rendered document (for .gr.md runs only)
└── source.gr.md           # Source document copy (for .gr.md runs only)
    ├── <step-id>.json     # Checkpoint after step completion
    └── ...
```

### Run ID Format

```
run_<ISO-timestamp>_<8-random-chars>
```

Example: `run_2026-03-17T10-30-00.000Z_a1b2c3d4`

### Checkpoint Content

```typescript
{
  runId: string;
  checkpoint: number;              // Sequential checkpoint number
  ts: string;                      // ISO timestamp
  currentStepId?: string;
  cursor: ExecutionCursor;         // Position in step graph
  elapsedMs: number;
  visitedSteps: number;
  state: JsonObject;               // Full state snapshot
  context: JsonObject;
  system: JsonObject;
  counters: RunCounters;
  retryCounters: Record<string, number>;
}
```

### Resume Mechanism

1. Load persisted `meta.json` (validates run is `paused`)
2. Verify workflow file still exists and matches (name, version)
3. Restore runtime namespaces from persisted state
4. Reconstruct execution cursor from checkpoint
5. Continue step execution from cursor position
6. No replay of completed steps

---

## 12. Run Inspection & Debugging

### Trace Events

16 event types provide complete execution visibility:

| Category | Events |
|----------|--------|
| Run lifecycle | `run.started`, `run.completed`, `run.failed`, `run.paused` |
| Step lifecycle | `step.started`, `step.completed`, `step.failed`, `step.skipped` |
| Tool calls | `tool.called`, `tool.completed`, `tool.failed` |
| Agent calls | `agent.called`, `agent.completed`, `agent.failed` |
| Persistence | `checkpoint.saved` |

### Trace Event Structure

```typescript
{
  schemaVersion: string;
  ts: string;                    // ISO timestamp
  runId: string;
  event: TraceEventType;
  stepId?: string;
  kind?: WorkflowStepKind;
  status?: string;
  durationMs?: number;
  input?: JsonValue;
  output?: JsonValue;
  stateDiff?: JsonValue;         // State changes from this step
  meta?: JsonObject;             // Event-specific metadata
}
```

### Debugging Workflow

```bash
# 1. List all runs
gr runs list --json

# 2. Check run status and metadata
gr runs show <run-id> --json

# 3. View the final state
gr runs state <run-id> --json

# 4. View output
gr runs output <run-id> --json

# 5. View full trace
gr runs trace <run-id> --json

# 6. Filter trace to failures
gr runs trace <run-id> --event step.failed --json
gr runs trace <run-id> --event tool.failed --json

# 7. Inspect specific step
gr runs step <run-id> <step-id> --json

# 8. Get summary analysis
gr runs explain <run-id> --json
```

---

## 13. Error Handling & Policies

### Error Structure

```typescript
{
  code: string;          // Error category (e.g., "EXECUTION_FAILURE")
  message: string;       // Human-readable description
  stepId?: string;       // Step where error occurred
  runId?: string;        // Run context
  details?: unknown;     // Structured error data
  retryable?: boolean;   // Whether retry might succeed
}
```

### Exit Codes

| Code | Name | Description |
|------|------|-------------|
| 0 | `success` | Operation completed successfully |
| 1 | `genericFailure` | Unclassified error |
| 2 | `invalidCliUsage` | Invalid command syntax or arguments |
| 3 | `workflowValidationFailure` | Workflow YAML is invalid |
| 4 | `inputValidationFailure` | Input doesn't match inputSchema |
| 5 | `executionFailure` | Step execution failed |
| 6 | `paused` | Run was paused (checkpoint saved) |
| 7 | `cancelled` | Run was cancelled |
| 8 | `policyViolation` | Policy limit exceeded |
| 9 | `notFound` | Resource not found |
| 10 | `internalError` | Internal engine error |

### Per-Step Error Policies

```yaml
onError:
  strategy: retry          # retry, fail, continue, goto
  maxAttempts: 3           # For retry: max total attempts
  delayMs: 1000            # For retry: delay between attempts
  label: recovery-step     # For goto: target step ID
```

| Strategy | Behavior |
|----------|----------|
| `fail` | Immediately fail the run (default) |
| `retry` | Retry step up to `maxAttempts` times with optional delay |
| `continue` | Skip the failed step, continue to next |
| `goto` | Jump to the step specified by `label` |

### Policy Enforcement Limits

| Policy | Default | Description |
|--------|---------|-------------|
| `maxRunSteps` | 100 | Maximum total step executions per run |
| `maxRunDurationMs` | 300000 (5min) | Maximum wall-clock run duration |
| `maxAgentToolCalls` | 10 | Maximum tool calls per agent step |
| `allowExternalSideEffects` | false | Whether write/external tools are permitted |
| `allowTools` | all | Specific tools allowed (empty = all) |

---

## 14. Configuration System

### Config File

`glyphrail.config.json` — discovered by walking up from `--cwd` or `process.cwd()`.

### Full Schema

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

### Config Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `schemaVersion` | string | "0.1.0" | Config schema version |
| `workflowsDir` | string | "./workflows" | Directory for workflow files |
| `runsDir` | string | "./.glyphrail/runs" | Directory for run artifacts |
| `toolsEntry` | string | "./glyphrail.tools.ts" | Path to tool definitions file |
| `defaultOutputMode` | string | "pretty" | Default CLI output mode |
| `defaultCheckpointEveryStep` | boolean | true | Checkpoint after every step by default |
| `policies.maxRunSteps` | number | 100 | Max step executions per run |
| `policies.maxRunDurationMs` | number | 300000 | Max run duration in ms |
| `policies.allowExternalSideEffects` | boolean | false | Allow write/external tools |

### Config Resolution

1. Start from `--cwd` or `process.cwd()`
2. Walk up directories looking for `glyphrail.config.json`
3. If `--config` flag provided, use that path directly
4. Merge partial config with defaults (unspecified fields use defaults)
5. Cache resolved config for the CLI invocation

---

## 15. Schema System

Glyphrail maintains a catalog of JSON Schema definitions accessible via `gr schema`:

| Schema Name | Description |
|-------------|-------------|
| `workflow` | Full workflow document schema |
| `json-schema-subset` | Supported JSON Schema keywords |
| `config` | Configuration file schema |
| `tool` | Tool contract schema |
| `agent` | Agent adapter request/response |
| `run-record` | Run metadata schema |
| `trace-event` | Trace event schema |
| `error` | Error structure schema |
| `json-envelope` | CLI JSON output envelope |

### Supported JSON Schema Keywords

- `type`, `properties`, `items`, `required`
- `enum`, `const`, `default`
- `additionalProperties`
- `minItems`, `maxItems`, `minLength`, `maxLength`
- `minimum`, `maximum`
- `oneOf`, `anyOf`

### Not Supported

- `allOf`, `not`
- `pattern` (regex validation)
- `format` (date, email, etc.)
- `$ref`, `$defs` (limited)

---

## 16. Validation & Linting

### Workflow Validation (`workflow validate`)

Multi-pass validation:

1. **YAML Parse** — Load and parse YAML syntax
2. **Schema Validation** — Check against workflow JSON schema
3. **Normalization** — Coerce types, flatten step hierarchy
4. **Expression Parsing** — Parse all `${...}` expressions, check syntax
5. **Tool Reference Check** — Verify all referenced tools exist in registry
6. **Schema Definition Validation** — Validate inputSchema/outputSchema against supported subset
7. **Step ID Uniqueness** — Ensure all step IDs are unique

### Workflow Linting (`workflow lint`)

Additional warnings beyond schema validity:

- Unused state variables (set but never read)
- Unreachable steps (after unconditional return/fail)
- Missing descriptions on complex steps
- Risky patterns (unbounded loops without maxIterations)
- Undefined variable references
- Tool not found warnings

### Tool Validation (`tool validate`)

- Contract compliance (required fields, valid schemas)
- Name uniqueness across registry
- Schema validity for inputSchema/outputSchema
- Side effect classification consistency

---

## 17. Output Formats & JSON Contract

### JSON Envelope

All `--json` output follows a consistent envelope:

**Success:**
```json
{
  "ok": true,
  "command": "command-name",
  ...command-specific fields...
}
```

**Error:**
```json
{
  "ok": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message",
    "stepId": "optional-step-id",
    "runId": "optional-run-id",
    "details": {}
  }
}
```

### Output Modes

| Mode | Flag | Description |
|------|------|-------------|
| Pretty | (default) | Color-coded human-readable output |
| JSON | `--json` | Single JSON object per response |
| JSONL | (trace only) | One JSON object per line |

---

## 18. Public API (Programmatic)

Exported from `glyphrail` package for tool authors and integrations:

```typescript
// Tool authoring
import { defineTools, type Tool, type ToolContext, type ToolRegistry, type ToolResult } from "glyphrail";

// Built-in tools (for composition)
import { bash, fetch, fileRead, fileWrite, fileEdit } from "glyphrail";

// Agent adapter authoring
import type { AgentAdapter, StructuredAgentRequest, StructuredAgentResult } from "glyphrail";

// Core types
import type { GlyphrailError, JsonSchema, JsonValue } from "glyphrail";
import type { WorkflowDocument, WorkflowStep, WorkflowStepKind } from "glyphrail";
import type { GlyphrailConfig } from "glyphrail";

// Constants
import { EXIT_CODES, WORKFLOW_STEP_KINDS, DEFAULT_CONFIG } from "glyphrail";
import { SCHEMA_CATALOG, SCHEMA_DOCUMENTS } from "glyphrail";
import { VERSION, SCHEMA_VERSION } from "glyphrail";

// Document system (Glyphrail Documents — .gr.md)
import type { ParsedGrDocument, DocumentRenderScope, DocumentRenderResult, TemplateNode, TemplateIssue } from "glyphrail";
import { parseGrDocument } from "glyphrail";
import { parseTemplate, evaluateTemplate } from "glyphrail";
import { validateTemplate } from "glyphrail";
import { renderDocument, reRenderFromRun } from "glyphrail";
import { markdownToHtml } from "glyphrail";
```

---

## 19. Security & Sandboxing

### Path Sandboxing

Built-in file tools (`file-read`, `file-write`, `file-edit`) enforce path sandboxing:
- All paths resolved relative to project root
- Directory traversal (`../`) that escapes project root is blocked
- Violation throws `POLICY_VIOLATION` error

### Side Effect Policies

- Tools classified by side effect: `none`, `read`, `write`, `external`
- `allowExternalSideEffects: false` (default) blocks `write` and `external` tools
- Tool allowlist (`policies.allowTools`) restricts which tools can be invoked

### Execution Bounds

- `maxRunSteps` prevents runaway step execution
- `maxRunDurationMs` prevents indefinite runs
- `maxIterations` on while loops prevents infinite loops
- Per-step `timeoutMs` with AbortController cancellation
- `maxAgentToolCalls` bounds agent tool usage

### Input Validation

- Workflow input validated against `inputSchema` before execution
- Tool input validated against `inputSchema` before every invocation
- Agent output validated against `outputSchema` after every call

---

## 20. Extensibility

### Adding Custom Tools

1. Define in `glyphrail.tools.ts` using `defineTools()`
2. Tools auto-discovered by the registry
3. Reference in workflows via `kind: tool, tool: my-tool-name`

### Adding Agent Adapters

1. Implement `AgentAdapter` interface
2. Register in `BUILTIN_ADAPTERS` map in `src/agent/runtime.ts`
3. Reference in workflows via `provider: my-adapter`

### Adding CLI Commands

1. Create `src/cli/commands/my-command.ts` implementing `CommandDefinition`
2. Export and add to `COMMANDS` array in `src/cli/commands/index.ts`
3. Parser automatically routes via `path: ["my", "command"]`

### Workflow Template Customization

Templates in `templates/` directory are used by `init` and `workflow create`. They use `__placeholder__` syntax for variable substitution.

---

## 21. Limitations & Deferred Features

### Not Yet Implemented

| Feature | Status | Notes |
|---------|--------|-------|
| `parallel` step execution | DSL accepted, runtime rejects | Schema and validation exist |
| `agent.mode=tool-use` | AST exists, validation rejects | Clear error message guides to `structured` |
| Non-mock agent adapters | Interface ready, no implementations | Only mock adapter ships |
| Workflow imports/packaging | Not started | Mentioned in spec as non-MVP |
| `jsonl` output mode | Partially | Only used for trace event persistence |
| Document composition/imports | Not started | Template inheritance, document chains (Phase 4) |
| Interactive pause/resume | Not started | Pause modeled via metadata, no interactive protocol |

### Known Constraints

- Single-threaded execution (Bun event loop)
- Local file-based persistence only (no remote/distributed store)
- Expression language is minimal (no function calls, no advanced array ops)
- JSON Schema subset (no `allOf`, `not`, `pattern`, `format`)
- Agent system limited to mock adapter in current release
