# Repository Guidelines

## Project Structure & Module Organization
`src/` contains the Bun-native TypeScript implementation. Use `src/cli/` for command parsing and output contracts, `src/core/` for execution/runtime logic, `src/dsl/` for workflow normalization and validation, and `src/tools/` / `src/agent/` for tool and agent integration points. Tests live in `test/unit/` and `test/integration/`, with reusable fixtures under `test/fixtures/`. Templates for generated projects are in `templates/`, and `playground/mvp/` is the manual smoke-test workspace.

## Build, Test, and Development Commands
There is no separate build step; Bun executes TypeScript directly.

- `bun run src/cli/index.ts --help` shows the CLI surface from source.
- `bun test` runs the full unit and integration suite.
- `bun test test/integration/run-commands.test.ts` runs a focused test file while iterating.
- `bun run src/cli/index.ts --cwd playground/mvp check --json` validates the sample project end to end.
- `./playground/mvp/smoke.sh` runs the repository’s manual CLI smoke pass.

## Coding Style & Naming Conventions
Match the existing TypeScript style: ESM imports, 2-space indentation, double quotes, and no semicolons. Prefer explicit named exports for command/runtime modules. Keep files and workflow names kebab-case, for example `workflow-validate.ts` and `agent-success.gr.yaml`. Use `.test.ts` suffixes for tests and keep helper data in `test/fixtures/` rather than inline when it grows.

## Testing Guidelines
Tests use Bun’s built-in runner (`bun:test`). Add unit tests for isolated logic in `test/unit/` and integration coverage for CLI or persistence changes in `test/integration/`. No numeric coverage gate is configured, so preserve or improve surrounding coverage when changing runtime, workflow, or JSON contract behavior. Prefer assertions on stable JSON envelopes and persisted artifacts, not only human-readable output.

## Commit & Pull Request Guidelines
Recent history uses short one-line commits (`mvp`, `up`, `Last slice`), but new commits should be clearer and imperative, for example `core: persist retry counters on resume`. Keep each commit focused. PRs should summarize behavior changes, list verification commands run, and include sample CLI JSON output when command contracts change.

## Configuration & Artifacts
Project configuration centers on `glyphrail.config.json`, `glyphrail.tools.ts`, and `workflows/`. Runtime artifacts are written to `.glyphrail/`; that directory is ignored and should not be committed. Keep reproducible examples in `examples/` or `playground/mvp/` instead of checking in generated run state.
