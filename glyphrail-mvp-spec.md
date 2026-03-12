# Glyphrail MVP Specification

Version: 0.1.0-draft  
Target runtime: Bun 1.x  
Language: TypeScript 5.x  
Package target: `glyphrail`  
Status: Planning-ready

---

## 1. Executive summary

**Glyphrail** is a minimalist, AI-native workflow orchestration engine built for deterministic control and bounded agentic execution. It is designed to be consumed by both humans and AI agents. Agents must be able to **create, inspect, validate, modify, explain, execute, debug, and package workflows entirely through a first-class CLI**.

Glyphrail is intentionally small in architectural surface area and strict in runtime semantics:

- **YAML workflow DSL** for authoring
- **JSON runtime state** as the single source of truth
- **TypeScript tool registry** with typed contracts
- **Deterministic execution engine** with bounded AI steps
- **CLI-first product design** so agents can operate the whole system from terminal affordances
- **Bun-native implementation** with zero or near-zero dependencies

This document is the MVP blueprint and should be treated as the source planning spec for implementation.

---

## 2. Product goals

### 2.1 Primary goals

1. Build a **deterministic workflow engine** with a minimal but expressive DSL.
2. Make the system **AI-native** without making it AI-chaotic.
3. Expose every major capability through a **rich, scriptable CLI**.
4. Keep the implementation **dependency-light**, ideally dependency-free beyond Bun + TypeScript.
5. Make workflows inspectable, resumable, testable, and safe to automate.
6. Support a developer experience where AI agents can act as power users of the system.

### 2.2 Non-goals for MVP

1. No visual editor.
2. No distributed worker fabric.
3. No hosted service assumptions.
4. No plugin marketplace.
5. No multi-tenant auth system.
6. No full autonomous planner that rewrites workflow graphs at runtime.
7. No opaque agent loops without hard limits.

---

## 3. Design principles

### 3.1 Deterministic shell, probabilistic core

The engine owns control flow. Agent steps own bounded judgment.

### 3.2 CLI-first, not CLI-afterthought

Every feature added to the engine must have a coherent CLI representation. The CLI is not just for humans. It is a machine-operable contract for AI agents.

### 3.3 State is sacred

All meaningful workflow facts must live in the explicit runtime state object, not hidden in prompts, tool internals, or logs.

### 3.4 Small primitives, strong composition

Prefer a tiny set of orthogonal step kinds over feature sprawl.

### 3.5 Inspectability over magic

Every run should be explainable from:
- workflow definition
- initial input
- current state
- step trace
- tool results
- policy decisions

### 3.6 Hard bounds everywhere

Loops, retries, agent tool-use, budgets, and timeouts must always be bounded.

### 3.7 Bun-native ergonomics

Use Bun runtime capabilities where they simplify implementation and distribution.

---

## 4. Product identity

## 4.1 Recommended package name

**Package name:** `glyphrail`

### Name rationale

- **glyph** suggests symbolic instructions, compact semantics, machine-legible intent
- **rail** suggests execution rails, guardrails, deterministic pathing
- the combined name feels CLI-friendly, memorable, and aligned with a workflow engine that constrains intelligent behavior rather than replacing structure

### Naming guidance

Use:
- package: `glyphrail`
- CLI binary: `glyphrail`
- shorthand alias: `gr`
- repository suggestion: `glyphrail`

### Naming caveat

Availability must be rechecked immediately before publication, but at planning time the candidate appears promising enough to proceed as the working identity.

---

## 5. Users and operating modes

### 5.1 Primary user types

1. **Human developers** writing workflows and tools.
2. **AI coding agents** generating and editing workflows.
3. **AI operator agents** running, validating, and debugging workflows through CLI commands.
4. **CI systems** executing validation, tests, and non-interactive runs.

### 5.2 Modes of operation

1. **Authoring mode**
   - create workflow files
   - scaffold tools
   - inspect schemas
   - explain DSL

2. **Execution mode**
   - run workflows
   - resume workflows
   - stream traces
   - inspect current state

3. **Analysis mode**
   - validate definitions
   - lint semantics
   - diff workflow versions
   - explain execution paths

4. **Testing mode**
   - run fixtures
   - snapshot outputs
   - simulate tools
   - verify branches and retries

5. **Packaging mode**
   - package workflows and tools into portable bundles
   - lock manifests
   - export machine-readable metadata

---

## 6. Architecture overview

Glyphrail MVP has eight core subsystems.

### 6.1 Workflow loader

Responsibilities:
- load workflow YAML
- resolve local references/imports if supported in MVP
- parse into internal AST
- perform static schema validation

### 6.2 Expression engine

Responsibilities:
- resolve `${...}` expressions
- support state/input/env/context references
- support small boolean/arithmetic/string operators
- reject unsafe or unsupported expressions

### 6.3 State manager

Responsibilities:
- initialize runtime state
- enforce immutable read + explicit writes per step
- apply save/append/merge/set mutations
- snapshot state for checkpoints and debugging

### 6.4 Tool registry

Responsibilities:
- register TypeScript tools
- expose tool contracts to runtime and CLI
- validate tool inputs and outputs
- attach metadata like purity, side effects, tags, and timeouts

### 6.5 Agent runtime

Responsibilities:
- execute bounded agent steps
- assemble structured prompts
- validate structured outputs
- optionally support bounded tool-use mode

MVP note: agent runtime may ship with an interface and mock adapter first, while leaving external provider integration as a thin adapter layer.

### 6.6 Execution engine

Responsibilities:
- execute steps deterministically
- evaluate branches and loops
- track retries, budgets, and step results
- manage pause/resume semantics

### 6.7 Trace and storage layer

Responsibilities:
- write append-only event traces
- persist run metadata, outputs, and checkpoints
- support resume after interruption

### 6.8 CLI layer

Responsibilities:
- expose all core capabilities
- provide human-readable and machine-readable output modes
- support command composition for AI agents and CI

---

## 7. Implementation constraints

### 7.1 Language and runtime

- TypeScript only
- Bun runtime only for MVP execution and dev tooling
- Output should be directly runnable with Bun
- Target ESM-first module design

### 7.2 Dependency policy

Preferred: **zero runtime dependencies**

Acceptable minimal exceptions only if absolutely justified:
- one tiny YAML parser if Bun cannot satisfy authoring ergonomics reliably enough
- one tiny schema helper if implementing JSON schema validation by hand is too costly for MVP

However, the default implementation plan should assume:
- no commander/yargs/cac for CLI
- no heavy validation framework
- no large logging libraries
- no runtime framework

### 7.3 Bun-native capabilities to leverage

- `Bun.file()` and filesystem primitives
- `Bun.argv`
- `Bun.spawn`
- native test runner where useful
- fast startup and single-binary-ish distribution ergonomics

---

## 8. Filesystem and project layout

Suggested repo layout:

```text
/glyphrail
  /src
    /cli
      index.ts
      parser.ts
      formatter.ts
      commands/
    /core
      workflow-loader.ts
      ast.ts
      execution-engine.ts
      expression-engine.ts
      state-manager.ts
      errors.ts
      events.ts
      policies.ts
    /tools
      registry.ts
      contracts.ts
      builtins/
    /agent
      runtime.ts
      adapters/
      prompt-assembler.ts
      output-validator.ts
    /storage
      run-store.ts
      checkpoint-store.ts
      trace-store.ts
    /dsl
      workflow-schema.ts
      normalization.ts
      lint.ts
    /util
      json.ts
      yaml.ts
      fs.ts
      hash.ts
      time.ts
      tty.ts
  /examples
  /templates
  /docs
  /test
    /fixtures
    /integration
    /unit
  bunfig.toml
  package.json
  README.md
```

---

## 9. Workflow authoring format

## 9.1 Chosen DSL format

Use **YAML** for authoring.

Reasons:
- compact and human-readable
- well-suited for nested control flow
- multiline prompt blocks are ergonomic
- easy for AI agents to generate and modify
- serializes naturally into internal JSON structures

## 9.2 Runtime truth model

Even though workflows are authored in YAML:
- parsed internal representation is JSON-compatible
- runtime state is JSON
- traces are JSONL

## 9.3 File extensions

- workflow files: `.glyphrail.yaml` or `.gr.yaml`
- run input files: `.json`
- trace files: `.jsonl`
- checkpoint files: `.json`
- package lock/manifest: `.glyphrail.lock.json`

---

## 10. Workflow document shape

Top-level structure:

```yaml
version: "1.0"
name: vendor-selection
description: Compare vendors and choose one

inputSchema:
  type: object
  properties:
    goal:
      type: string
  required: [goal]

outputSchema:
  type: object
  properties:
    selectedVendor:
      type: string

defaults:
  model: mock
  timeoutMs: 30000
  maxStepRetries: 1
  outputMode: structured

policies:
  allowTools: [searchWeb, fetchPage, summarize]
  maxRunSteps: 100
  maxRunDurationMs: 300000
  maxAgentToolCalls: 5

state:
  goal: null
  vendors: []
  shortlist: []
  selectedVendor: null
  flags:
    enoughEvidence: false
  attempts:
    search: 0

steps: []

output:
  selectedVendor: ${state.selectedVendor}
```

### 10.1 Required top-level fields

- `version`
- `name`
- `steps`

### 10.2 Recommended top-level fields

- `description`
- `inputSchema`
- `outputSchema`
- `defaults`
- `policies`
- `state`
- `output`

---

## 11. Step kinds

MVP step kinds:

1. `assign`
2. `tool`
3. `agent`
4. `if`
5. `for_each`
6. `while`
7. `parallel`
8. `return`
9. `fail`
10. `noop`

### 11.1 assign

Purpose: deterministic state mutation.

Example:

```yaml
- id: init
  kind: assign
  set:
    goal: ${input.goal}
    attempts.search: 0
```

### 11.2 tool

Purpose: call a registered tool.

Example:

```yaml
- id: search_vendors
  kind: tool
  tool: searchWeb
  input:
    query: ${state.goal}
  save: state.vendors
```

### 11.3 agent

Purpose: invoke a bounded AI step.

Example:

```yaml
- id: shortlist
  kind: agent
  objective: Select top 3 vendors
  instructions: |
    Return strict JSON only.
    Prefer recall over precision.
  input:
    goal: ${state.goal}
    vendors: ${state.vendors}
  outputSchema:
    type: object
    properties:
      shortlist:
        type: array
        items:
          type: string
    required: [shortlist]
  save: state.selection
```

### 11.4 if

Purpose: deterministic branching.

```yaml
- id: enough_check
  kind: if
  condition: ${state.flags.enoughEvidence == true}
  then: []
  else: []
```

### 11.5 for_each

Purpose: iterate over a list with bounded deterministic structure.

```yaml
- id: inspect_items
  kind: for_each
  items: ${state.shortlist}
  as: vendor
  steps: []
```

### 11.6 while

Purpose: bounded loop.

```yaml
- id: gather_more
  kind: while
  condition: ${state.flags.enoughEvidence == false}
  maxIterations: 3
  steps: []
```

### 11.7 parallel

Purpose: run independent branches concurrently.

```yaml
- id: fetch_profiles
  kind: parallel
  branches:
    - id: a
      steps: []
    - id: b
      steps: []
```

### 11.8 return

Purpose: terminate workflow successfully and optionally override output.

### 11.9 fail

Purpose: terminate workflow with structured error.

### 11.10 noop

Purpose: explicit placeholder for editing, stubbing, and diagnostics.

---

## 12. Step contract rules

Every step must have:
- `id`
- `kind`

Every step may have:
- `name`
- `description`
- `when`
- `timeoutMs`
- `onError`
- `meta`

### 12.1 `when`

Optional precondition. If false, step is skipped.

### 12.2 timeouts

Any executable step may define `timeoutMs`.

### 12.3 onError

Defines error strategy.

Example:

```yaml
onError:
  retry:
    maxAttempts: 2
    backoffMs: 250
  set:
    flags.searchFailed: true
  goto: fallback_search
```

MVP may implement a reduced form first:

```yaml
onError:
  strategy: retry | fail | continue | goto
  maxAttempts: 2
  goto: step_id
```

---

## 13. Expression system

## 13.1 Syntax

Use `${...}` interpolation.

Supported namespaces:
- `input`
- `state`
- `env`
- `context`
- `item` inside loops
- `branch` inside parallel branch contexts if needed

### 13.2 Supported operations

MVP should support only a small safe subset:
- property access
- array length
- equality and inequality
- boolean `&&`, `||`, `!`
- arithmetic `+ - * / %`
- string concatenation via `+`
- parentheses
- null checks

### 13.3 Explicitly unsupported in MVP

- arbitrary JS execution
- function calls from workflow expressions
- dynamic imports
- mutation inside expressions
- async behavior

### 13.4 Safety model

Expression evaluation must be implemented by a small parser/evaluator or a tightly constrained interpreter, not raw `eval` or `Function`.

---

## 14. State model

## 14.1 Runtime state object

State is a JSON-compatible object initialized from top-level `state` plus runtime metadata.

Suggested internal structure:

```json
{
  "user": {
    "goal": "..."
  },
  "system": {
    "runId": "run_...",
    "workflowName": "...",
    "currentStepId": null,
    "startedAt": "...",
    "loopCounters": {},
    "retryCounters": {}
  },
  "data": {
    "goal": null,
    "vendors": []
  }
}
```

However, the external DSL should continue to expose a simple `state` namespace. Internal splitting is allowed if runtime ergonomics benefit.

## 14.2 Mutation modes

Supported writes:
- `save: state.path`
- `append: state.path`
- `merge: state.path`
- `set:` maps in assign steps

## 14.3 Mutation rules

- step writes must be explicit
- unknown writes should fail unless policy says otherwise
- append target must be array
- merge target must be object
- state must remain serializable

---

## 15. Tool system

## 15.1 Tool contract

Each tool is a TypeScript module exporting a well-defined contract.

```ts
export type Tool<Input = unknown, Output = unknown> = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  sideEffect: "none" | "read" | "write" | "external";
  timeoutMs?: number;
  execute: (input: Input, ctx: ToolContext) => Promise<ToolResult<Output>>;
};
```

## 15.2 Tool result contract

```ts
export type ToolResult<T> =
  | { ok: true; output: T; meta?: ToolMeta }
  | { ok: false; error: ToolError; meta?: ToolMeta };
```

## 15.3 Tool registration

MVP options:
1. code-based registration via a local entry module
2. folder-based discovery with explicit exports

Recommended MVP approach:
- workflow project contains `glyphrail.tools.ts`
- file exports a registry builder or array of tools

Example:

```ts
import { defineTools } from "glyphrail";
import { searchWeb } from "./tools/search-web";

export default defineTools([searchWeb]);
```

## 15.4 Tool categories

Built-in metadata tags:
- `io`
- `http`
- `file`
- `compute`
- `ai`
- `db`
- `unsafe`

## 15.5 Tool policies

Workflows may restrict allowed tools.

Global runtime policies may additionally block tools by:
- name
- tag
- side effect class
- path location

---

## 16. Agent system

## 16.1 Philosophy

Agent steps are first-class, but bounded.

The engine never gives an agent unlimited control over the run graph.

## 16.2 Agent step modes

MVP should support two modes:

1. `structured`
   - input goes in
   - structured JSON comes out
   - no tool-use inside the agent step

2. `tool-use`
   - agent can call from a bounded set of tools within this step
   - tool call count must be capped
   - final result must still validate against schema

## 16.3 Agent step shape

```yaml
- id: analyze
  kind: agent
  mode: structured
  provider: mock
  model: mock
  objective: Determine whether evidence is sufficient
  instructions: |
    Return strict JSON only.
    Be conservative.
  input:
    goal: ${state.goal}
    evidence: ${state.vendors}
  outputSchema:
    type: object
    properties:
      enoughEvidence:
        type: boolean
      reason:
        type: string
    required: [enoughEvidence, reason]
  save: state.flags
```

## 16.4 Agent adapters

MVP should define an adapter interface rather than hard-coding one provider.

```ts
export interface AgentAdapter {
  name: string;
  runStructured(request: StructuredAgentRequest): Promise<StructuredAgentResult>;
  runToolUse?(request: ToolUseAgentRequest): Promise<ToolUseAgentResult>;
}
```

## 16.5 Built-in adapter expectation

MVP should include:
- `mock` adapter for tests and local planning
- optional `stdio` adapter for shell-wrapped external AI provider integration later

The spec should not assume direct provider SDK dependencies in MVP.

---

## 17. Execution semantics

## 17.1 Run lifecycle

1. load workflow
2. validate workflow
3. validate input
4. initialize state
5. initialize run record
6. execute steps
7. materialize output
8. validate output if schema present
9. persist final trace and result

## 17.2 Step statuses

Each step execution instance may end in:
- `success`
- `failed`
- `retrying`
- `skipped`
- `paused`
- `cancelled`

## 17.3 Run statuses

A run may end in:
- `completed`
- `failed`
- `paused`
- `cancelled`
- `timed_out`

## 17.4 Branch and loop semantics

- `if` evaluates exactly once
- `for_each` snapshots items before iteration unless explicitly documented otherwise
- `while` requires `maxIterations`
- `parallel` branches execute concurrently and join at the end

## 17.5 Parallel behavior

MVP should define deterministic merge semantics for parallel branches:
- each branch gets a forked branch-local state overlay
- branch outputs are merged only through explicit declared writes
- conflicting writes to same target path should fail unless merge strategy is provided

---

## 18. Error model

## 18.1 Error categories

1. workflow parse error
2. workflow validation error
3. input validation error
4. expression evaluation error
5. tool input validation error
6. tool runtime error
7. tool output validation error
8. agent output parse error
9. agent output validation error
10. policy violation
11. timeout
12. budget exhaustion
13. checkpoint/resume error

## 18.2 Error shape

```ts
export type GlyphrailError = {
  code: string;
  message: string;
  stepId?: string;
  runId?: string;
  details?: unknown;
  retryable?: boolean;
};
```

## 18.3 Parsing and validation policy

Agent and tool outputs should be validated strictly.

For agent output parse failures, MVP may support one optional repair attempt:
- original raw output logged
- repair request generated internally
- repaired output validated
- if still invalid, fail or retry according to step policy

---

## 19. Persistence and storage

## 19.1 Local storage model

MVP should use local filesystem storage.

Suggested structure:

```text
.glyphrail/
  runs/
    run_<id>/
      meta.json
      input.json
      state.latest.json
      output.json
      trace.jsonl
      checkpoints/
        checkpoint_<n>.json
```

## 19.2 Run identity

Each run gets a unique stable run ID.

Use a time-sortable ID if easy to implement without dependency, otherwise a timestamp + random suffix.

## 19.3 Checkpointing

Checkpoint on:
- run start
- before each step or after each step depending on final design
- run pause
- run completion

Recommended MVP strategy:
- checkpoint after each completed step

## 19.4 Resume semantics

Resume should restore:
- workflow identity and version
- current state
- step cursor
- retry counters
- loop counters
- policies in effect

---

## 20. Trace model

## 20.1 Trace format

Append-only JSON Lines.

Each event should include:

```json
{
  "ts": "2026-03-12T17:00:00.000Z",
  "runId": "run_x",
  "event": "step.completed",
  "stepId": "search_vendors",
  "kind": "tool",
  "status": "success",
  "durationMs": 42,
  "input": {},
  "output": {},
  "stateDiff": {},
  "meta": {}
}
```

## 20.2 Event types

MVP event types:
- `run.started`
- `run.completed`
- `run.failed`
- `run.paused`
- `step.started`
- `step.completed`
- `step.failed`
- `step.skipped`
- `tool.called`
- `tool.completed`
- `tool.failed`
- `agent.called`
- `agent.completed`
- `agent.failed`
- `checkpoint.saved`

## 20.3 Output modes

CLI should support:
- human pretty mode
- JSON mode
- JSONL stream mode for machine ingestion

---

## 21. CLI specification

The CLI is a first-class surface area, not a thin wrapper.

Binary:

```bash
glyphrail
```

Alias:

```bash
gr
```

## 21.1 CLI design principles

- every command must work non-interactively
- every command should support `--json` where sensible
- error output should be structured enough for agent parsing
- commands should be composable in scripts and CI
- output should be stable and documented

## 21.2 Global flags

- `--cwd <path>`
- `--config <path>`
- `--json`
- `--quiet`
- `--verbose`
- `--color <auto|always|never>`
- `--no-color`
- `--trace`
- `--profile`
- `--help`
- `--version`

## 21.3 Top-level commands

### Project and scaffolding
- `init`
- `new`
- `scaffold`
- `doctor`

### Workflow authoring and inspection
- `workflow create`
- `workflow show`
- `workflow explain`
- `workflow validate`
- `workflow lint`
- `workflow format`
- `workflow graph`
- `workflow diff`
- `workflow normalize`

### Tooling
- `tool list`
- `tool show <name>`
- `tool validate <name>`
- `tool scaffold <name>`
- `tool test <name>`
- `tool call <name>`

### Execution
- `run`
- `resume <run-id>`
- `replay <run-id>`
- `cancel <run-id>`
- `pause <run-id>`

### Run inspection
- `runs list`
- `runs show <run-id>`
- `runs state <run-id>`
- `runs output <run-id>`
- `runs trace <run-id>`
- `runs events <run-id>`
- `runs step <run-id> <step-id>`
- `runs explain <run-id>`

### Validation and testing
- `check`
- `test`
- `fixture run <name>`
- `fixture snapshot <name>`
- `fixture verify <name>`

### Packaging
- `pack`
- `unpack`
- `manifest`
- `lock`

### Agent-facing helpers
- `describe`
- `capabilities`
- `schema`
- `examples`
- `completions`

### Maintenance
- `clean`
- `gc`
- `config show`
- `config set`

---

## 22. CLI command details

## 22.1 `glyphrail init`

Purpose:
- initialize a project in the current directory
- create config, sample workflow, tools entrypoint, and storage dir

Example:

```bash
glyphrail init --name demo
```

Creates:
- `glyphrail.config.json`
- `workflows/hello.gr.yaml`
- `glyphrail.tools.ts`
- `.glyphrail/`

## 22.2 `glyphrail workflow create`

Purpose:
- create a new workflow from template

Example:

```bash
glyphrail workflow create research-loop --template basic
```

## 22.3 `glyphrail workflow validate`

Purpose:
- parse and validate workflow definition
- report static errors and warnings

Example:

```bash
glyphrail workflow validate workflows/research.gr.yaml
```

## 22.4 `glyphrail workflow explain`

Purpose:
- explain workflow structure in human or JSON form
- useful for AI agents to inspect what a workflow does

Example:

```bash
glyphrail workflow explain workflows/research.gr.yaml --json
```

Possible output fields:
- top-level metadata
- step inventory
- branches
- loops
- tools referenced
- policies
- risky points

## 22.5 `glyphrail workflow graph`

Purpose:
- print a textual graph or Mermaid-style graph of workflow control flow

Output modes:
- `text`
- `mermaid`
- `json`

## 22.6 `glyphrail run`

Purpose:
- execute a workflow with input

Examples:

```bash
glyphrail run workflows/research.gr.yaml --input input.json
glyphrail run workflows/research.gr.yaml --input-json '{"goal":"find vendors"}'
glyphrail run workflows/research.gr.yaml --resume-latest
```

Flags:
- `--input <file>`
- `--input-json <json>`
- `--set <path=value>` repeatable
- `--dry-run`
- `--max-steps <n>`
- `--max-duration-ms <n>`
- `--checkpoint-every-step`
- `--output <file>`
- `--trace-out <file>`
- `--json`

## 22.7 `glyphrail resume`

Purpose:
- resume a paused or interrupted run

## 22.8 `glyphrail replay`

Purpose:
- rerun from original input, optionally with a newer workflow revision or mocked side effects

## 22.9 `glyphrail runs trace`

Purpose:
- inspect trace stream

Flags:
- `--follow`
- `--json`
- `--event <type>`
- `--step <step-id>`

## 22.10 `glyphrail tool call`

Purpose:
- call a single tool directly for development and agent inspection

Example:

```bash
glyphrail tool call searchWeb --input-json '{"query":"hello"}'
```

## 22.11 `glyphrail schema`

Purpose:
- print machine-readable schemas used by workflow DSL, tool contracts, run records, and trace events

## 22.12 `glyphrail capabilities`

Purpose:
- emit a machine-readable capability document so AI agents can discover what this installation can do

Possible fields:
- version
- enabled features
- supported step kinds
- registered tools
- output modes
- adapter support
- policy limits

This command is crucial for agent interoperability.

---

## 23. CLI output contract

## 23.1 Human mode

Readable, compact, color-aware where terminal supports it.

## 23.2 JSON mode

All major commands should support `--json` and output a single valid JSON object to stdout.

## 23.3 Error contract

In `--json` mode, errors should look like:

```json
{
  "ok": false,
  "error": {
    "code": "WORKFLOW_VALIDATION_ERROR",
    "message": "Unknown step kind: foo",
    "details": {
      "file": "workflows/x.gr.yaml",
      "path": "steps[2].kind"
    }
  }
}
```

Exit codes should still be meaningful.

---

## 24. Exit codes

Suggested exit codes:

- `0` success
- `1` generic failure
- `2` invalid CLI usage
- `3` workflow parse/validation failure
- `4` input validation failure
- `5` execution failure
- `6` paused
- `7` cancelled
- `8` policy violation
- `9` not found
- `10` internal error

---

## 25. Config file

Use `glyphrail.config.json` for MVP.

Example:

```json
{
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

MVP may later support `glyphrail.config.toml`, but JSON keeps bootstrapping simple and dependency-light.

---

## 26. Packaging model

## 26.1 Goals

Allow workflows and their metadata to be bundled into portable artifacts for humans, CI, and AI agents.

## 26.2 MVP package contents

A package may include:
- workflow files
- config snapshot
- manifest
- lock file
- optional example inputs
- optional tool contract metadata

## 26.3 Commands

- `glyphrail pack`
- `glyphrail unpack`
- `glyphrail manifest`
- `glyphrail lock`

## 26.4 Manifest shape

```json
{
  "name": "demo",
  "version": "0.1.0",
  "workflows": ["workflows/research.gr.yaml"],
  "toolsEntry": "glyphrail.tools.ts",
  "glyphrailVersion": "0.1.0"
}
```

---

## 27. AI-agent interoperability requirements

This section is critical.

Glyphrail must be operable by AI agents without hidden context.

### 27.1 Required agent affordances

1. Machine-readable CLI output.
2. Stable command naming.
3. Deterministic file locations by convention.
4. `capabilities` command.
5. `workflow explain` and `runs explain` commands.
6. `schema` command for DSL and runtime contracts.
7. `tool show` and `tool list` commands with schemas.
8. Clear exit codes.
9. Dry-run mode.
10. Lint and validation commands.

### 27.2 Recommended agent skill workflow

An AI agent should be able to do the following entirely through CLI:

1. initialize a project
2. scaffold a workflow
3. inspect supported step kinds
4. scaffold tools
5. validate workflow
6. run with input fixture
7. inspect trace and state
8. patch workflow
9. rerun
10. package result

---

## 28. Security and safety model

## 28.1 Threat model for MVP

The main risks are:
- unsafe tool execution
- accidental external side effects
- prompt leakage of secrets
- path traversal or arbitrary filesystem abuse
- unbounded loops or budget exhaustion

## 28.2 Safety controls

MVP must include:
- allowlist-based tool execution
- optional block on external side-effect tools
- bounded loops and retries
- timeout enforcement
- local-path safety checks
- hidden system-only metadata not exposed to agent inputs unless deliberate

## 28.3 Secret handling

- secrets should come from env or runtime context
- secrets must never be logged in clear text in traces
- prompts assembled for agent steps should be redactable

---

## 29. Performance and resource constraints

### 29.1 MVP expectations

- startup should feel instant in Bun for common commands
- validation should be fast enough for editor and CI usage
- run storage should avoid heavyweight databases

### 29.2 Budget controls

Policies should support:
- max run steps
- max loop iterations
- max retries per step
- max total duration
- max agent tool calls per step

Optional later:
- token/cost budgets

---

## 30. Testing strategy

## 30.1 Test layers

1. unit tests
   - expression parsing
   - workflow validation
   - state writes
   - error handling

2. integration tests
   - end-to-end workflow runs
   - resume behavior
   - trace generation
   - CLI output contracts

3. fixture tests
   - golden workflows
   - deterministic mocked agent outputs
   - snapshot outputs and traces

## 30.2 Mandatory MVP test fixtures

At minimum ship fixtures for:
- linear workflow
- conditional workflow
- while loop with success
- while loop hitting max iterations
- for_each aggregation
- parallel branch merge
- tool error with retry
- agent structured output validation failure
- pause/resume scenario

## 30.3 CLI contract tests

Commands that must have output contract tests:
- `workflow validate`
- `workflow explain`
- `run`
- `runs show`
- `runs trace`
- `tool list`
- `capabilities`

---

## 31. Linting and static analysis

MVP should include a basic linter with rules like:
- duplicate step IDs
- unreachable branches where detectable
- missing `maxIterations` on while
- undeclared tools
- impossible write modes
- output path references that do not exist
- agent step without output schema warning
- parallel conflicting writes warning

CLI:

```bash
glyphrail workflow lint workflows/demo.gr.yaml
```

---

## 32. MVP command priority list

If implementation must be staged, prioritize commands in this order.

### Tier 1
- `init`
- `workflow create`
- `workflow validate`
- `workflow explain`
- `run`
- `runs show`
- `runs trace`
- `tool list`
- `tool show`
- `capabilities`

### Tier 2
- `resume`
- `replay`
- `workflow lint`
- `tool scaffold`
- `tool call`
- `schema`
- `check`
- `test`

### Tier 3
- `workflow graph`
- `workflow diff`
- `pack`
- `unpack`
- `manifest`
- `lock`
- `doctor`

---

## 33. MVP milestones

## Milestone A: core DSL and validation

Deliver:
- workflow parser
- AST normalization
- schema validation
- basic CLI skeleton
- `workflow validate`
- `workflow explain`

## Milestone B: deterministic engine

Deliver:
- state manager
- assign/tool/if/for_each/while/return/fail
- trace store
- run store
- `run`
- `runs show`
- `runs trace`

## Milestone C: tool system and agent structured mode

Deliver:
- tool registry
- tool contract validation
- mock agent adapter
- agent structured steps
- retry policies
- `tool list`
- `tool show`
- `tool call`

## Milestone D: resumability and linting

Deliver:
- checkpoints
- `resume`
- linter
- `check`
- `capabilities`
- better JSON output contracts

## Milestone E: parallel, packaging, polish

Deliver:
- `parallel`
- package manifest/lock
- `pack`
- `unpack`
- `workflow graph`
- `doctor`

---

## 34. Acceptance criteria for MVP

Glyphrail MVP is acceptable when all of the following are true:

1. A user can initialize a project and scaffold a workflow from CLI.
2. A workflow can be statically validated from CLI.
3. A workflow using `assign`, `tool`, `if`, `for_each`, `while`, `return`, and `fail` can run end-to-end.
4. A structured `agent` step can execute through a mock adapter and validate against output schema.
5. The system persists run artifacts locally and can resume an interrupted run.
6. The CLI exposes machine-readable output for major commands.
7. A tool can be listed, inspected, and invoked directly from CLI.
8. Traces are written in JSONL and are sufficient to explain a failed run.
9. The implementation remains Bun-native and dependency-light.
10. An AI coding agent can discover capabilities and operate the system without hidden product knowledge.

---

## 35. Recommended implementation notes

### 35.1 CLI parser

Implement a small custom parser rather than pulling in a large framework.

Suggested model:
- tokenized argv reader
- command registry tree
- command handler functions
- auto-generated help from command metadata

### 35.2 YAML handling

If Bun-native parsing is not enough, isolate YAML parsing behind `src/util/yaml.ts` so a dependency can be swapped later without contaminating the core.

### 35.3 Validation

Start with handcrafted validators for the workflow DSL if necessary. JSON Schema export can be generated from internal TypeScript definitions later.

### 35.4 Logging

Write your own tiny formatter utilities. Avoid heavy logging stacks.

### 35.5 Data model discipline

All persisted artifacts should be versioned with a `schemaVersion` or `formatVersion` field where applicable.

---

## 36. Example minimal workflow

```yaml
version: "1.0"
name: hello-world

defaults:
  timeoutMs: 10000

state:
  name: null
  greeting: null

steps:
  - id: init
    kind: assign
    set:
      name: ${input.name}

  - id: greet
    kind: tool
    tool: makeGreeting
    input:
      name: ${state.name}
    save: state.greeting

  - id: done
    kind: return
    output:
      greeting: ${state.greeting}
```

---

## 37. Example capabilities output

```json
{
  "ok": true,
  "name": "glyphrail",
  "version": "0.1.0",
  "runtime": "bun",
  "stepKinds": [
    "assign",
    "tool",
    "agent",
    "if",
    "for_each",
    "while",
    "parallel",
    "return",
    "fail",
    "noop"
  ],
  "features": {
    "resume": true,
    "trace": true,
    "structuredAgent": true,
    "toolUseAgent": false,
    "packaging": false
  },
  "outputModes": ["pretty", "json", "jsonl"],
  "policies": {
    "maxRunSteps": 100
  }
}
```

---

## 38. Open questions to resolve during planning

1. Will MVP include `parallel`, or should it be deferred to post-MVP?
2. Will agent provider integration be mock-only in MVP, or include a shell/stdin adapter?
3. How strict should output schema support be in v0.1: full JSON Schema subset or minimal internal schema DSL?
4. Should workflow imports be included in MVP or delayed?
5. Should `glyphrail config` remain JSON-only at MVP, or support TOML as well?
6. Should `workflow format` be part of MVP if custom YAML formatting is expensive?
7. What is the exact merge policy for parallel branch writes?

These are planning questions, not blockers for starting implementation.

---

## 39. Final recommendation

Build Glyphrail as a **CLI-first deterministic workflow engine with bounded AI execution**, optimized for Bun and disciplined by explicit state, typed tools, strict validation, and transparent traces.

The CLI is not garnish. It is the nervous system.

If this product is successful, human developers will enjoy it. But more importantly, AI agents will be able to operate it with confidence instead of improvising in the dark.

