# Glyphrail MVP Playground

`playground/mvp` is a self-contained project for manual MVP verification. It maps to the v0.1 test plan and keeps intentionally invalid workflows outside the configured `workflows/` directory, so `glyphrail check` stays green while you can still exercise validation and lint failures on demand.

## Quick start

Run everything from the repository root.

```bash
bun run src/cli/index.ts --cwd playground/mvp capabilities --json
```

If you want a full smoke pass, use:

```bash
./playground/mvp/smoke.sh
```

If you prefer shorter commands in a shell session:

```bash
gr() {
  bun run src/cli/index.ts --cwd playground/mvp "$@"
}
```

## Playground layout

- `playground/mvp/workflows/`: valid workflows used by `check` and end-to-end runs
- `playground/mvp/diagnostics/`: intentionally non-green workflows for validate/lint testing
- `playground/mvp/inputs/`: sample JSON inputs
- `playground/mvp/glyphrail.tools.ts`: local registry used by the workflows

## Core CLI checks

These cover the CLI contract commands from the MVP plan.

```bash
gr capabilities --json
gr check --json
gr tool list --json
gr tool show makeGreeting --json
gr tool call makeGreeting --input-json '{"name":"Ada"}' --json
gr workflow validate workflows/linear.gr.yaml --json
gr workflow explain workflows/conditional.gr.yaml --json
gr workflow lint diagnostics/lint.gr.yaml --json
gr workflow validate diagnostics/invalid.gr.yaml --json
```

What to expect:

- `capabilities` reports Slice 6 features including tools, trace, resume, and the `mock` agent adapter
- `check` succeeds because the configured `workflows/` folder contains only valid workflows
- `tool call makeGreeting` returns `"Hello, Ada!"`
- `workflow explain` for `conditional.gr.yaml` reports one conditional and the `selectVendor` tool
- `workflow lint diagnostics/lint.gr.yaml` succeeds with warnings, including `AGENT_OUTPUT_SCHEMA_MISSING`, `CONSTANT_CONDITION`, and `OUTPUT_PATH_MISSING`
- `workflow validate diagnostics/invalid.gr.yaml` fails with exit code `3` and validation errors including `MISSING_MAX_ITERATIONS`

## Mandatory fixture matrix

Each workflow below maps directly to the MVP implementation plan.

| Scenario | Command | Expected result |
| --- | --- | --- |
| linear workflow | `gr run workflows/linear.gr.yaml --input inputs/linear.ada.json --json` | exit `0`, output `{"greeting":"Hello, Ada!"}` |
| conditional workflow | `gr run workflows/conditional.gr.yaml --json` | exit `0`, `enough=true`, vendor is `demo-vendor` |
| `for_each` aggregation | `gr run workflows/foreach.gr.yaml --json` | exit `0`, greetings array contains `Hello, Ada!` and `Hello, Grace!` |
| `while` success | `gr run workflows/while-success.gr.yaml --json` | exit `0`, output `{"count":3}` |
| `while` max iterations failure | `gr run workflows/while-max-iterations.gr.yaml --json` | exit `5`, error code `BUDGET_EXHAUSTION` |
| tool error with retry | `gr run workflows/tool-retry.gr.yaml --json` | exit `0`, output `{"greeting":"Hello, Ada!"}`, `counters.retries=1` |
| agent structured success | `gr run workflows/agent-success.gr.yaml --json` | exit `0`, structured decision saved to output |
| agent structured validation failure | `gr run workflows/agent-validation-failure.gr.yaml --json` | exit `5`, error code `AGENT_OUTPUT_VALIDATION_ERROR` |
| pause/interruption and resume | see the next section | first command exits `86`, then `resume` completes with `count=3` |

## Pause and resume walkthrough

Start the interrupted run:

```bash
gr run workflows/resume-loop.gr.yaml --json
```

Expected behavior:

- the process exits with code `86`
- stdout is empty
- a paused run is persisted under `playground/mvp/.glyphrail/runs/`

Find the paused run and inspect it:

```bash
gr runs list --json
gr runs show <run-id> --json
gr runs state <run-id> --json
```

The paused run should show:

- `status = "paused"`
- `currentStepId = "maybe_interrupt"`
- `counters.loopIterations = 2`
- persisted state with `count = 2`

Resume it:

```bash
gr resume <run-id> --json
gr runs explain <run-id> --json
gr runs trace <run-id> --json
```

Expected resumed output:

```json
{
  "count": 3,
  "resumeSignal": {
    "resumed": true
  }
}
```

## Artifact inspection

Every run writes artifacts under:

```text
playground/mvp/.glyphrail/runs/run_<id>/
```

The most useful files during manual verification are:

- `meta.json`: run status, counters, retry counters, cursor, workflow identity
- `state.latest.json`: latest persisted workflow state
- `output.json`: final workflow output for completed runs
- `trace.jsonl`: append-only event trace

Useful follow-up commands:

```bash
gr runs output <run-id> --json
gr runs trace <run-id> --event tool.completed --json
gr runs step <run-id> analyze --json
gr runs explain <run-id> --json
```

## Resetting the playground

To start from a clean state:

```bash
rm -rf playground/mvp/.glyphrail
mkdir -p playground/mvp/.glyphrail/runs
```

`smoke.sh` does this automatically before it runs.
