# Glyphrail

Glyphrail is a Bun-native, CLI-first workflow engine for deterministic orchestration and bounded agent execution.

This repository currently implements the v0.1.0 MVP through Slice 6:

- workflow authoring, validation, linting, and explanation
- typed local tool registries
- deterministic workflow execution with persisted state and trace artifacts
- structured agent steps through a built-in `mock` adapter
- retries, `continue`, and `goto` error policies
- run inspection, checkpointing, and resume
- project-wide checks and capability discovery

The important architectural idea is simple:

- the engine owns control flow, persistence, budgets, and safety
- tools own typed side effects
- agent steps own bounded judgment inside a deterministic shell
- the CLI is a machine-operable contract, not just a human UX

## What This Codebase Actually Is

Glyphrail is not a chat agent framework and it is not an open-ended autonomous loop runner.

It is a local workflow runtime with:

- a YAML workflow DSL
- a JSON runtime state model
- a TypeScript tool registry
- a deterministic execution engine
- a structured agent interface
- persisted run artifacts you can inspect and resume

The repo is designed for two kinds of "agentic" use:

1. An external operator agent uses the CLI to create, validate, execute, inspect, and resume workflows.
2. A workflow can contain `agent` steps, but those steps run under explicit schemas, retry rules, timeouts, and persisted traces.

That separation is the core design constraint throughout the implementation.

## Current MVP Shape

Implemented now:

- `assign`, `tool`, `agent`, `if`, `for_each`, `while`, `return`, `fail`, `noop`
- YAML loading with workflow normalization and validation
- expression parsing over explicit namespaces
- tool input/output validation with a minimal JSON Schema subset
- structured agent execution with prompt assembly, optional output repair, and schema validation
- persisted runs under `.glyphrail/runs/run_<id>/`
- `run`, `resume`, `runs *`, `tool *`, `workflow *`, `check`, `capabilities`, `schema`, `init`

Intentionally deferred or partial:

- `parallel` exists in the DSL and explanation/lint inventory, but execution is not implemented yet
- `agent.mode=tool-use` is rejected in the current MVP slice
- only the built-in `mock` agent adapter is available
- workflow imports and packaging are not implemented
- config exposes `defaultOutputMode` and the capability document lists `jsonl`, but the current CLI surface practically uses human output and `--json`
- trace event type catalogs include `run.paused`, but the current runtime models pause through persisted metadata and checkpoints rather than emitting a dedicated `run.paused` event

## Why The CLI Matters

Glyphrail is intentionally CLI-first because the CLI is the contract an external AI agent can automate.

A human or agent can:

- discover capabilities with `capabilities --json`
- inspect schemas with `schema --json`
- validate a workflow before execution
- run a workflow and receive a stable JSON envelope
- inspect the exact persisted state, output, and trace after the run
- resume a paused run by ID without rebuilding hidden context

That is the "agentic workflow" at the product level: the whole system is shaped so another agent can operate it through explicit terminal primitives.

## Architecture Overview

The repo is organized around a small set of core subsystems:

| Area | Purpose |
| --- | --- |
| `src/cli` | command registry, parser, help formatting, and JSON envelopes |
| `src/core` | execution engine, errors, trace types, runtime state, schema validation, run storage |
| `src/dsl` | workflow normalization, schema, and static validation/linting |
| `src/tools` | tool contracts, registry loading, direct invocation, and policy enforcement |
| `src/agent` | agent adapter contracts, prompt building, mock adapter, and structured output repair |
| `src/config` | project config discovery and defaults |
| `templates` | `init`, workflow, and tool scaffolding templates |
| `playground/mvp` | self-contained manual verification project |
| `test` | integration and unit coverage for CLI, runtime, validation, tools, and resume |

Execution flows roughly like this:

1. CLI resolves `--cwd`, config, and command arguments.
2. Workflow YAML is loaded and normalized into the internal AST.
3. Validation checks step shapes, expressions, write targets, and declared tools.
4. Runtime state is created from `input`, top-level `state`, and system/context metadata.
5. The execution engine walks steps deterministically and persists progress after each completed step.
6. Tool and agent steps validate their inputs and outputs against the same schema subset.
7. Run artifacts are written to disk so later commands can inspect or resume the run.

## Quickest Way To Try It

The fastest path is the included MVP playground.

From the repository root:

```bash
bun run src/cli/index.ts --cwd playground/mvp capabilities --json
bun run src/cli/index.ts --cwd playground/mvp check --json
bun run src/cli/index.ts --cwd playground/mvp run workflows/linear.gr.yaml --input inputs/linear.ada.json --json
```

For a full manual smoke pass:

```bash
./playground/mvp/smoke.sh
```

If you want shorter commands while working from source:

```bash
gr() {
  bun run src/cli/index.ts --cwd playground/mvp "$@"
}
```

Then:

```bash
gr capabilities --json
gr workflow explain workflows/agent-success.gr.yaml --json
gr run workflows/agent-success.gr.yaml --json
```

## Prerequisites

- Bun `>= 1.3.0`
- TypeScript source is executed directly through Bun
- There are currently no runtime dependencies declared in `package.json`

Useful commands from the repo root:

```bash
bun test
bun run src/cli/index.ts --help
bun run src/cli/index.ts capabilities --json
```

## Getting Started In A Fresh Project

If Glyphrail is installed or linked so `glyphrail` or `gr` is on your path:

```bash
glyphrail init
glyphrail check --json
glyphrail run workflows/hello.gr.yaml --input-json '{"name":"Ada"}' --json
```

`init` creates:

- `glyphrail.config.json`
- `workflows/hello.gr.yaml`
- `glyphrail.tools.ts`
- `.glyphrail/runs/`

The generated hello workflow is intentionally small:

```yaml
version: "1.0"
name: hello-world
description: Sample workflow generated by glyphrail init

inputSchema:
  type: object
  properties:
    name:
      type: string
  required: [name]

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

The generated tools entry exports a typed local registry:

```ts
import type { Tool } from "glyphrail";

const makeGreeting: Tool<{ name: string }, string> = {
  name: "makeGreeting",
  description: "Create a friendly greeting for the provided name.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string" }
    },
    required: ["name"],
    additionalProperties: false
  },
  outputSchema: {
    type: "string"
  },
  sideEffect: "none",
  async execute(input) {
    return {
      ok: true,
      output: `Hello, ${input.name}!`
    };
  }
};

export default [
  makeGreeting
];
```

The registry file no longer needs a runtime import from `glyphrail`, so a globally installed CLI can run an initialized project without adding a local package dependency first.

If you want editor autocomplete and type-checking for custom tool modules that use `import type { Tool } from "glyphrail"`, install `glyphrail` in the project as a dev dependency as well.

## Recommended Operator Workflow For An External Agent

If you are building another AI system on top of Glyphrail, this is the CLI sequence that matches the current codebase best.

### 1. Discover the installation contract

```bash
glyphrail capabilities --json
glyphrail schema workflow --json
glyphrail schema tool --json
```

Why this matters:

- `capabilities` is the machine-readable entrypoint for available commands, step kinds, trace event types, agent adapters, and exit codes
- `schema` exposes the static contract documents the implementation is centered around

### 2. Check project health

```bash
glyphrail check --json
glyphrail tool list --json
```

`check` aggregates:

- workflow discovery under the configured workflows directory
- validation and lint warnings for each workflow
- tool registry resolution and contract issues

### 3. Inspect before executing

```bash
glyphrail workflow validate workflows/my-flow.gr.yaml --json
glyphrail workflow explain workflows/my-flow.gr.yaml --json
glyphrail workflow lint workflows/my-flow.gr.yaml --json
```

`workflow explain --json` is especially useful for agents because it exposes:

- metadata
- flattened step inventory
- referenced tools
- control-flow constructs
- policies
- risk points from lint warnings

### 4. Dry-run the execution plan

```bash
glyphrail run workflows/my-flow.gr.yaml --dry-run --input-json '{"name":"Ada"}' --json
```

This validates workflow and input and returns:

- workflow identity
- effective policies
- referenced tools
- effective input after `--set` overrides

### 5. Execute with stable JSON output

```bash
glyphrail run workflows/my-flow.gr.yaml --input-json '{"name":"Ada"}' --json
```

Success envelope shape:

```json
{
  "ok": true,
  "command": "run",
  "runId": "20260316035745113_4d6cdfb0",
  "status": "completed",
  "output": {}
}
```

Failure envelope shape:

```json
{
  "ok": false,
  "error": {
    "code": "AGENT_OUTPUT_VALIDATION_ERROR",
    "message": "Agent step 'analyze' output failed schema validation.",
    "runId": "20260316040000000_deadbeef",
    "stepId": "analyze",
    "details": {}
  }
}
```

### 6. Inspect the run instead of guessing

```bash
glyphrail runs show <run-id> --json
glyphrail runs state <run-id> --json
glyphrail runs output <run-id> --json
glyphrail runs trace <run-id> --json
glyphrail runs explain <run-id> --json
glyphrail runs step <run-id> <step-id> --json
```

This is the intended debugging loop for both humans and agents.

### 7. Resume if the run is paused

```bash
glyphrail runs list --json
glyphrail resume <run-id> --json
```

The runtime resumes from persisted state plus execution cursor, not from prompt history or hidden in-memory context.

## Workflow DSL

Glyphrail workflows are YAML documents with a strict top-level shape.

Top-level fields recognized by the validator:

- `version`
- `name`
- `description`
- `inputSchema`
- `outputSchema`
- `defaults`
- `policies`
- `state`
- `steps`
- `output`

### State Model

At runtime, values live in explicit namespaces:

- `input`: the initial JSON input
- `state`: mutable workflow state
- `context`: step/runtime context such as current step and loop info
- `system`: run metadata such as run ID, workflow file, and start time

Expressions can reference:

- `input`
- `state`
- `env`
- `context`
- `item`
- `branch`

Example:

```yaml
condition: ${state.count != 3}
```

Supported expression features:

- references like `${state.foo}`
- literals: strings, numbers, booleans, `null`
- operators: `==`, `!=`, `&&`, `||`, `+`, `-`, `*`, `/`, `%`, unary `!` and `-`
- parentheses

Not supported in the current parser:

- function calls
- arbitrary JS
- array indexing syntax

### Step Kinds

| Kind | Status | What it does |
| --- | --- | --- |
| `assign` | implemented | writes literal or expression-evaluated values into workflow state |
| `tool` | implemented | invokes a registered TypeScript tool with validated input and optional state write-back |
| `agent` | implemented in `structured` mode only | calls a bounded agent adapter and validates the structured output |
| `if` | implemented | executes `then` or `else` deterministically |
| `for_each` | implemented | iterates over an evaluated array and exposes `item` |
| `while` | implemented | loops while a condition remains truthy, bounded by `maxIterations` |
| `parallel` | declared but not executable | validation/explanation exist, runtime rejects execution |
| `return` | implemented | returns explicit output or materialized workflow output |
| `fail` | implemented | raises a workflow error immediately |
| `noop` | implemented | intentionally does nothing |

### Write Directives

`tool` and `agent` steps can use one write directive:

- `save: state.path`
- `append: state.arrayPath`
- `merge: state.objectPath`

`assign` uses `set`.

Rules enforced by validation:

- only one of `save`, `append`, or `merge`
- the path must target `state.*`
- `append` requires an array target
- `merge` requires an object target

### Control Flow

Implemented control flow:

- `when` guards on any step
- `if`
- `for_each`
- `while`
- `goto` through `onError`

`while` is always bounded by `maxIterations`.

Example:

```yaml
- id: count_up
  kind: while
  condition: ${state.count != 3}
  maxIterations: 5
  steps:
    - id: increment
      kind: assign
      set:
        count: ${state.count + 1}
```

### Error Policies

Supported `onError.strategy` values:

- `retry`
- `fail`
- `continue`
- `goto`

Retries are persisted in run metadata so inspection and resume stay consistent.

## Tool Registry And Tool Execution

The tool registry is a default-exported `Tool[]` array from the configured `glyphrail.tools.ts` file.

Tool contract fields:

- `name`
- `description`
- `inputSchema`
- `outputSchema` (optional)
- `sideEffect`: `none`, `read`, `write`, or `external`
- `timeoutMs` (optional)
- `tags` (optional)
- `execute(input, ctx)`

Direct tool commands:

```bash
glyphrail tool list --json
glyphrail tool show makeGreeting --json
glyphrail tool validate --json
glyphrail tool call makeGreeting --input-json '{"name":"Ada"}' --json
glyphrail tool scaffold format-handle --json
```

Policy behavior that matters operationally:

- workflow `policies.allowTools` can restrict which tools a workflow may call
- project config `policies.allowExternalSideEffects` defaults to `false`
- tools with `sideEffect: "write"` or `sideEffect: "external"` are blocked when external side effects are disabled

Example failure:

```bash
bun run src/cli/index.ts --cwd playground/mvp tool call sendWebhook --input-json '{"url":"https://example.com"}' --json
```

Returns:

```json
{
  "ok": false,
  "error": {
    "code": "POLICY_VIOLATION",
    "message": "Tool 'sendWebhook' is blocked because external side effects are disabled."
  }
}
```

## Agent Execution, In Detail

This is the most important runtime behavior to understand.

Glyphrail does not let an agent own the workflow.
The engine still controls:

- when the step runs
- how many times it may retry
- what schema the output must satisfy
- how long it may run
- where the result is written in state
- how the failure is recorded and resumed

### What An `agent` Step Looks Like

The main working example is `playground/mvp/workflows/agent-success.gr.yaml`:

~~~yaml
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
    vendors:
      - alpha
      - beta
  outputSchema:
    type: object
    properties:
      enoughEvidence:
        type: boolean
      reason:
        type: string
    required: [enoughEvidence, reason]
    additionalProperties: false
  save: state.decision
  meta:
    mockResponse:
      rawOutput: |
        ```json
        {"enoughEvidence":true,"reason":"Two vendors are enough for the demo."}
        ```
~~~

### What The Runtime Does

For each `agent` step, the engine performs this sequence:

1. Evaluate `when` if present.
2. Resolve `input` expressions against runtime namespaces.
3. Build a structured prompt from:
   - `objective`
   - `instructions`
   - rendered input JSON
4. Resolve the adapter:
   - currently only `provider: mock` exists
5. Call `runStructured(...)` on the adapter with:
   - run ID
   - step ID
   - provider/model
   - prompt
   - attempt number
   - input
   - output schema
   - timeout
   - `meta`
6. If the adapter returns raw output that is not yet valid structured JSON, attempt one repair pass.
7. Validate the resulting structured output against `outputSchema`.
8. Apply `save`, `append`, or `merge` if the step succeeds.
9. Emit trace events and persist checkpoints and metadata.

### Prompt Construction

The prompt builder is intentionally minimal and explicit.
It produces a string with three sections:

- `Objective:`
- `Instructions:` if provided
- `Input JSON:`

The `agent.called` trace event records the generated prompt, which means you can audit what the agent actually saw.

Example trace payload from the current implementation:

```json
{
  "event": "agent.called",
  "meta": {
    "provider": "mock",
    "model": "mock",
    "mode": "structured",
    "attempt": 1,
    "prompt": "Objective:\nDetermine whether evidence is sufficient\n\nInstructions:\nReturn strict JSON only.\nBe conservative.\n\nInput JSON:\n{\n  \"goal\": \"select vendor\",\n  \"vendors\": [\n    \"alpha\",\n    \"beta\"\n  ]\n}"
  }
}
```

### Structured Output Repair

The repair path is deliberately narrow.
If the adapter returns raw text, Glyphrail will try a few safe candidates:

- the trimmed raw output
- content inside fenced code blocks
- the largest JSON object or array fragment it can extract

If one candidate parses as JSON, that repaired value is validated against `outputSchema`.

This is useful for cases like fenced JSON responses:

~~~text
```json
{"enoughEvidence":true,"reason":"Two vendors are enough for the demo."}
```
~~~

The repair attempt is recorded in trace metadata:

- `repairAttempted`
- `repairSucceeded`
- `repairCandidate`

### Failure Handling For Agent Steps

An `agent` step can fail in several ways:

- adapter missing or unsupported provider
- adapter returned an error
- raw output could not be parsed
- parsed output did not satisfy `outputSchema`
- the step timed out

Those failures then flow through normal step error policy resolution:

- `retry`
- `continue`
- `goto`
- `fail`

The engine, not the adapter, owns retry bookkeeping.

That means:

- retry counters are persisted
- traces show attempts and retries
- `runs explain` and `runs step` can reconstruct what happened later

### Mock Adapter Model

The built-in `mock` adapter exists so workflows and tests stay deterministic.

It looks for:

- `meta.mockResponse`
- or `meta.mockResponses`

Useful patterns:

- force a success with `output`
- force parse/repair behavior with `rawOutput`
- force a failure with `error`
- script retry scenarios with `mockResponses`

Example retry fixture:

```yaml
meta:
  mockResponses:
    - output:
        choice: 42
    - output:
        choice: vendor-a
```

On the first attempt the schema fails, the step retries, and the second response succeeds.

### What Is Not Implemented For Agents Yet

- no live provider adapters beyond `mock`
- no `tool-use` mode execution
- no planner that rewrites workflow structure
- no freeform text-output mode for runtime agent steps

This is deliberate. The implementation is aiming for inspectable and bounded behavior first.

## Run Lifecycle And Persistence

Every run gets a durable directory:

```text
.glyphrail/runs/run_<id>/
```

Artifacts:

- `meta.json`: run status, workflow identity, policies, counters, retry counters, cursor
- `input.json`: original run input
- `state.latest.json`: latest persisted workflow state
- `output.json`: final output when the run completed
- `trace.jsonl`: append-only execution trace
- `checkpoints/`: optional checkpoint snapshots after each completed step

The default config sets:

- `defaultCheckpointEveryStep = true`

So the current runtime normally persists a checkpoint after every completed step.

### Runtime Counters

The engine tracks and persists:

- `completedSteps`
- `failedSteps`
- `retries`
- `loopIterations`
- `checkpoints`

### Budgets And Timeouts

The engine enforces:

- max run steps
- max run duration
- per-step timeout
- bounded `while` loops via `maxIterations`

Effective values come from:

1. command-line overrides
2. workflow policies/defaults
3. project config defaults

### Materialized Output

Workflow output is chosen in this order:

1. explicit `return` step output
2. top-level workflow `output`
3. full current workflow state snapshot

If `outputSchema` is defined at the workflow level, the final output is validated before the run is marked completed.

## Resume Semantics

Resume is one of the stronger parts of the current implementation.

The engine persists:

- workflow identity
- policies
- execution cursor
- counters
- retry counters
- latest state

`resume <run-id>` validates that:

- the run is marked `paused`
- the workflow file still exists
- the workflow still validates
- the workflow name and version still match what the run started with
- a cursor is present

Then it reconstructs runtime namespaces and continues from the persisted cursor.

### Important Nuance

The included resume demo is driven by an external interruption pattern, not by a dedicated pause step.

`playground/mvp/workflows/resume-loop.gr.yaml` uses a tool called `interruptOnce` that exits the process with code `86` the first time it runs. Because Glyphrail persists state and metadata after completed steps, the run can still be resumed deterministically from the last safe cursor.

That means the current MVP supports resume very well, but "pause" is best thought of as:

- an interrupted process with persisted artifacts
- not a first-class interactive pause/resume protocol yet

### Resume Walkthrough

Start the interrupted run:

```bash
gr run workflows/resume-loop.gr.yaml --json
```

Expected result:

- process exits with code `86`
- a paused run is still listed in `.glyphrail/runs/`

Inspect and resume:

```bash
gr runs list --json
gr runs show <run-id> --json
gr runs state <run-id> --json
gr resume <run-id> --json
```

In the current fixture, the paused metadata should show:

- `status = "paused"`
- `currentStepId = "maybe_interrupt"`
- `counters.loopIterations = 2`
- state `count = 2`

After resume, the same run ID completes with:

```json
{
  "count": 3,
  "resumeSignal": {
    "resumed": true
  }
}
```

## Inspection And Debugging Commands

### Workflow inspection

```bash
glyphrail workflow validate workflows/linear.gr.yaml --json
glyphrail workflow explain workflows/conditional.gr.yaml --json
glyphrail workflow lint workflows/lint.gr.yaml --json
```

### Run inspection

```bash
glyphrail runs list --json
glyphrail runs show <run-id> --json
glyphrail runs state <run-id> --json
glyphrail runs output <run-id> --json
glyphrail runs trace <run-id> --json
glyphrail runs trace <run-id> --event tool.completed --json
glyphrail runs step <run-id> analyze --json
glyphrail runs explain <run-id> --json
```

`runs explain` is especially useful after agent or retry scenarios because it summarizes:

- attempts
- retries
- tool calls
- agent calls
- terminal status
- last recorded error

## Project Config

Default `glyphrail.config.json`:

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

Config discovery walks upward from `--cwd` until it finds `glyphrail.config.json`.

## JSON Schema Support

Glyphrail validates tool contracts, workflow input/output, and agent output using a documented minimal JSON Schema subset.

Supported keys include:

- `type`
- `properties`
- `items`
- `required`
- `enum`
- `const`
- `default`
- `additionalProperties`
- `minItems`
- `maxItems`
- `minLength`
- `maxLength`
- `minimum`
- `maximum`
- `oneOf`
- `anyOf`

If you need the exact contract:

```bash
glyphrail schema json-schema-subset --json
```

## Command Surface

Bootstrap and discovery:

- `capabilities`
- `schema`
- `init`
- `check`

Workflow authoring:

- `workflow create`
- `workflow validate`
- `workflow explain`
- `workflow lint`

Tools:

- `tool list`
- `tool show`
- `tool call`
- `tool validate`
- `tool scaffold`

Execution and inspection:

- `run`
- `resume`
- `runs list`
- `runs show`
- `runs state`
- `runs output`
- `runs trace`
- `runs step`
- `runs explain`

Global flags:

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

## Playground Coverage

The MVP playground under `playground/mvp` covers the implemented execution matrix:

- linear workflow
- deterministic branching
- `for_each`
- successful `while`
- `while` budget exhaustion
- tool retry
- structured agent success with repair
- structured agent validation failure
- interruption plus resume

Manual guide:

- `docs/mvp-playground.md`

## Development

Useful commands:

```bash
bun test
bun run src/cli/index.ts --help
bun run src/cli/index.ts capabilities --json
```

Tests currently cover:

- CLI contract behavior
- workflow validation and explanation
- tool listing, calling, policy enforcement, and scaffolding
- deterministic execution for linear, branch, loop, fail, retry, and agent scenarios
- resume after interruption

## Repository Map

Key files worth reading first:

- `src/core/execution-engine.ts`: runtime heart of workflow execution
- `src/dsl/validation.ts`: workflow validation and linting logic
- `src/tools/runtime.ts`: tool invocation and policy enforcement
- `src/agent/runtime.ts`: prompt building and structured output repair
- `src/agent/mock-adapter.ts`: deterministic adapter used by fixtures and tests
- `src/cli/commands/run.ts`: execution command
- `src/cli/commands/resume.ts`: resume command
- `playground/mvp/workflows/agent-success.gr.yaml`: clean agent-step example
- `playground/mvp/workflows/resume-loop.gr.yaml`: resume example
- `playground/mvp/glyphrail.tools.ts`: representative local tool registry

## Summary

Glyphrail is already a coherent local runtime for deterministic, inspectable workflow execution with bounded structured agent steps. The strongest parts of the current codebase are:

- clear separation between deterministic orchestration and bounded agent behavior
- strong CLI coverage for authoring, execution, and inspection
- persisted run artifacts that make debugging and resume practical
- deterministic testing through the mock adapter and fixture workflows

The main boundaries to keep in mind are also clear:

- `parallel` and agent tool-use are not live yet
- real provider adapters are not implemented yet
- the runtime favors explicitness over convenience

If you approach it with that mental model, the current codebase is already usable as a small, local, AI-operable workflow engine.
