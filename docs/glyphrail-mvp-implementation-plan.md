# Glyphrail MVP Implementation Plan

## Summary

Build Glyphrail as a Bun-native TypeScript CLI in vertical slices, with each slice ending in a demoable command set, stable persisted artifacts, and automated verification. For v0.1, scope is:

- `parallel` deferred until after the first MVP release
- agent support limited to a deterministic `mock` adapter
- schema validation limited to a documented minimal JSON Schema subset
- no workflow imports
- config stays JSON-only
- `workflow format` deferred unless it becomes trivial after normalization work

The implementation should follow the milestone shape in the spec, but tightened so each slice is independently verifiable and small enough to avoid context sprawl.

## Implementation Slices

### Slice 1: Project skeleton, command kernel, and core types

Goal: establish the repo structure, command dispatch model, shared contracts, and output/error conventions.

- Create the initial Bun package, `src/` layout, test layout, and `examples/`/`templates/`/`docs/` directories from the spec's recommended structure.
- Implement shared contracts first: workflow AST/types, run record types, trace event types, error shape, JSON output envelope, exit code map, config shape, tool and agent adapter interfaces.
- Build a tiny custom CLI parser and command registry with:
  - global flags parsing
  - subcommand dispatch
  - `--json` output support
  - uniform error handling and exit codes
  - generated help/version output
- Add minimal filesystem/config utilities:
  - config discovery/loading for `glyphrail.config.json`
  - path resolution from `--cwd`
  - safe JSON read/write helpers
  - run ID generator
- Implement Tier 1 non-execution commands that do not depend on the runtime:
  - `capabilities`
  - `schema`
  - `init`
  - `workflow create`
- `init` should generate:
  - `glyphrail.config.json`
  - `workflows/hello.gr.yaml`
  - `glyphrail.tools.ts`
  - `.glyphrail/runs/`
- Demo outcome:
  - a user can initialize a project and inspect machine-readable capabilities and schemas
- Verify with:
  - CLI contract tests for `init`, `capabilities`, `schema`
  - fixture asserting generated file shapes and JSON output contract

### Slice 2: Workflow loader, normalization, expressions, and static validation

Goal: make workflow files parseable, explainable, and statically safe before any execution exists.

- Implement YAML loading behind `src/util/yaml.ts`; keep the parser isolated so it can be swapped without touching the core.
- Build workflow normalization into a single internal JSON-compatible AST.
- Support the MVP top-level document shape and step kinds, even if execution support lands later.
- Implement handcrafted workflow validation for:
  - required top-level fields
  - duplicate IDs
  - unsupported step kinds
  - invalid step fields by kind
  - missing `maxIterations` on `while`
  - undeclared tools referenced by `tool` steps
  - invalid write directives (`save`, `append`, `merge`, `set`)
- Implement a small expression parser/evaluator for the allowed subset only:
  - namespace access
  - arithmetic/boolean operators
  - equality/null checks
  - parentheses
  - string concatenation
  - no functions, no eval
- Add authoring/inspection commands:
  - `workflow validate`
  - `workflow explain`
  - `workflow lint`
- `workflow explain --json` should surface:
  - metadata
  - step inventory
  - referenced tools
  - control-flow constructs
  - policies
  - potential risk points
- Demo outcome:
  - a workflow file can be created, validated, linted, and explained from the CLI
- Verify with:
  - unit tests for expression parsing/evaluation
  - unit tests for normalization and validation failures
  - CLI contract tests for `workflow validate` and `workflow explain`
  - fixtures for linear, conditional, and invalid workflows

### Slice 3: Deterministic execution core for non-agent workflows

Goal: run real workflows end-to-end with explicit state, traces, and persisted run artifacts.

- Implement runtime state initialization from workflow `state`, input, and system metadata.
- Use a simple internal runtime model with separate `input`, `state`, `context`, and `system` namespaces while preserving external DSL access as `state`.
- Implement explicit mutation operations:
  - `assign.set`
  - `save`
  - `append`
  - `merge`
- Implement deterministic execution engine for:
  - `assign`
  - `tool`
  - `if`
  - `for_each`
  - `while`
  - `return`
  - `fail`
  - `noop`
- Enforce:
  - step `when`
  - max run steps
  - max duration
  - bounded loop iterations
  - per-step timeout hooks
- Implement local persistence in `.glyphrail/runs/run_<id>/`:
  - `meta.json`
  - `input.json`
  - `state.latest.json`
  - `output.json`
  - `trace.jsonl`
- Implement append-only trace emission for the MVP event set and checkpoint-after-step persistence.
- Add execution and inspection commands:
  - `run`
  - `runs show`
  - `runs trace`
  - `runs state`
  - `runs output`
- Support `--input`, `--input-json`, `--set`, `--dry-run`, `--json`, and optional explicit output/trace file targets on `run`.
- Demo outcome:
  - the hello workflow and loop/branch fixtures can run from CLI and produce persisted artifacts plus explainable traces
- Verify with:
  - integration tests for linear, `if`, `for_each`, `while success`, `while max-iterations`, `fail`
  - fixture snapshots for output and trace JSONL
  - CLI contract tests for `run`, `runs show`, `runs trace`

### Slice 4: Tool registry and direct tool ergonomics

Goal: make tools a first-class typed surface for both workflows and CLI users.

- Implement the tool contract, result contract, metadata, and registry loader from `glyphrail.tools.ts`.
- Restrict discovery to explicit exports from the configured tools entry file.
- Validate tool input and output against the same minimal schema subset used elsewhere.
- Enforce tool policy checks:
  - name allowlist from workflow policies
  - side-effect blocking from config/runtime policy
  - timeout override handling
- Add tooling commands:
  - `tool list`
  - `tool show`
  - `tool call`
  - `tool validate`
  - `tool scaffold`
- `tool scaffold` should emit a minimal typed tool template that matches the contract and test style already in the repo.
- Demo outcome:
  - tools can be listed, inspected, called directly, and invoked from workflows with validated I/O
- Verify with:
  - integration tests for tool success, tool runtime failure, and policy block
  - CLI contract tests for `tool list`, `tool show`, `tool call`
  - fixture workflow using at least one scaffolded local tool

### Slice 5: Agent structured mode and retry/error policies

Goal: add bounded AI-native behavior without giving up deterministic control flow.

- Implement agent step execution in `structured` mode only.
- Add the `AgentAdapter` interface and a built-in deterministic `mock` adapter with configurable canned responses for tests/fixtures.
- Implement prompt assembly from objective, instructions, and evaluated input.
- Validate structured agent output against the minimal schema subset.
- Support one optional repair attempt only if the raw output is parseable enough to justify repair; otherwise follow step error policy.
- Implement reduced-form `onError` handling for MVP:
  - `retry`
  - `fail`
  - `continue`
  - `goto`
- Track retry counters in persisted state/checkpoints so later resume remains consistent.
- Add `runs step` and `runs explain` if needed to keep failed agent steps inspectable without reading raw artifacts manually.
- Demo outcome:
  - a workflow with a mock `agent` step can run, succeed, fail validation, retry, and expose the full decision trail in traces
- Verify with:
  - integration tests for structured agent success
  - agent output validation failure
  - retry then success
  - `goto`/`continue` error policy behavior
  - trace assertions for `agent.called`, `agent.completed`, `agent.failed`

### Slice 6: Resume, check, and operator-grade inspection

Goal: make runs recoverable and the system operable by humans, CI, and AI agents.

- Implement checkpoint records after each completed step and on terminal run states.
- Implement `resume <run-id>` by restoring:
  - workflow identity
  - policies in effect
  - current state
  - step cursor
  - retry counters
  - loop counters
- Define interruption behavior narrowly for v0.1:
  - resumed runs restart from the next not-yet-completed step
  - partially executed steps are treated as failed/incomplete and are not replayed implicitly unless trace/checkpoint state clearly marks them completed
- Add:
  - `check` as a project-level aggregator over config, workflow validation/lint, and tools entry resolution
  - richer `capabilities` output based on actual registered features
  - `runs list` if needed for practical resume/discovery
- Demo outcome:
  - an interrupted run can be resumed deterministically and explained from stored artifacts
- Verify with:
  - integration test for pause/interruption + resume
  - project-level `check` contract test
  - fixture asserting restored counters/state after resume

## Public Interfaces and Contracts

These interfaces should be treated as stable within v0.1 and designed early to avoid churn:

- Workflow DSL top-level fields and all step shapes for the supported kinds
- Minimal schema subset used by:
  - `inputSchema`
  - `outputSchema`
  - tool input/output schemas
  - agent output schemas
- JSON CLI envelope:
  - success responses as single JSON objects
  - errors as `{ ok: false, error: { code, message, details? } }`
- Run artifact layout under `.glyphrail/runs/run_<id>/`
- Trace event envelope and event type names
- `glyphrail.tools.ts` registry entry contract
- `AgentAdapter` interface with only `mock` implemented in v0.1
- Exit code map from the spec

## Test Plan

Mandatory fixture set for v0.1:

- linear workflow
- conditional workflow
- `for_each` aggregation
- `while` success
- `while` max iterations failure
- tool error with retry
- agent structured success
- agent structured validation failure
- pause/interruption and resume

Testing structure:

- unit tests for expressions, schema validation, mutation semantics, and error shaping
- integration tests for end-to-end runs and persisted artifacts
- CLI contract tests for:
  - `workflow validate`
  - `workflow explain`
  - `run`
  - `runs show`
  - `runs trace`
  - `tool list`
  - `capabilities`
- snapshot tests for:
  - normalized workflow explain output
  - run output
  - trace JSONL for deterministic fixtures

## Assumptions and Defaults

- `parallel` is explicitly out of v0.1 and should not shape the initial runtime architecture beyond avoiding dead-end abstractions.
- Workflow imports are out of scope for v0.1.
- `workflow format`, `workflow diff`, packaging commands, and `doctor` stay out of the initial MVP slices.
- Config is JSON-only in v0.1.
- The schema engine supports only the subset needed by the spec examples and tests; unsupported schema keywords must fail clearly.
- A tiny YAML dependency is acceptable if Bun alone is insufficient, but it must be isolated in one utility module.
- The first release should favor explicit handwritten validators and serializers over generic frameworks to keep dependency surface and hidden behavior low.
