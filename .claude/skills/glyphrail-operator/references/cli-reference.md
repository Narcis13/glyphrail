# Glyphrail CLI Reference

## Command Quick Reference

All commands accept `--json` for machine-parseable output and `--help` for usage info.

### Global Flags

```
--cwd <path>           Working directory
--config <path>        Config file path
--json                 JSON output envelope
--quiet                Suppress human output
--verbose              Verbose logging
--color auto|always|never
--no-color             Shorthand for --color never
--trace                Trace-level logging
--profile              Profiling mode
--help / --version
```

### Discovery

```bash
gr capabilities --json              # Full capability document
gr schema --json                    # List all schemas
gr schema workflow --json           # Export specific schema
gr check --json                     # Validate entire project
```

### Project Setup

```bash
gr init [--cwd <path>]              # Scaffold project
```

### Workflow Operations

```bash
gr workflow create <name>                          # Create from template
gr workflow validate <file> --json                 # Validate YAML
gr workflow lint <file> --json                     # Lint warnings
gr workflow explain <file>                         # Explain structure
```

### Tool Operations

```bash
gr tool list --json                                # List all tools
gr tool show <name> --json                         # Show tool contract
gr tool call <name> --input '<json>' --json        # Invoke tool
gr tool validate --json                            # Validate registry
gr tool scaffold                                   # Generate template
```

### Execution

```bash
gr run <file> --json                               # Execute workflow
gr run <file> --input '<json>' --json              # With input
gr run <file> --input-file <path> --json           # Input from file
gr run <file> --dry-run --json                     # Validate without executing
gr run <file> --no-checkpoint --json               # Skip checkpointing
gr resume <run-id> --json                          # Resume paused run
```

### Document Operations

```bash
gr document validate <file.gr.md> --json           # Validate workflow + template
gr document explain <file.gr.md> --json            # Explain structure
```

### Document Rendering

```bash
gr render <file.gr.md> --json                      # Render document
gr render <file.gr.md> --input-json '<json>' --json  # With input
gr render <file.gr.md> --output out.md --json      # Write to file
gr render <file.gr.md> --dry-run --json            # Validate only
gr render <file.gr.md> --no-checkpoint --json      # Skip checkpointing
gr render <file.gr.md> --from-run <id> --json      # Re-render from past run
gr render <file.gr.md> --from-run <id> --output out.md  # Re-render to file
gr render <file.gr.md> --format html --output out.html  # HTML output
gr render <file.gr.md> --watch --output out.md     # Watch and auto re-render
```

### Run Inspection

```bash
gr runs list --json                                # List all runs
gr runs show <run-id> --json                       # Run metadata
gr runs state <run-id> --json                      # Final state
gr runs output <run-id> --json                     # Final output
gr runs step <run-id> <step-id> --json             # Step details
gr runs trace <run-id> --json                      # All trace events
gr runs trace <run-id> --event step.failed --json  # Filtered trace
gr runs explain <run-id> --json                    # Summary analysis
```

## JSON Output Envelope

Success: `{"ok": true, "command": "...", ...data...}`
Error: `{"ok": false, "error": {"code": "...", "message": "...", "details": ...}}`

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

## Trace Event Types

`run.started`, `run.completed`, `run.failed`, `run.paused`, `step.started`, `step.completed`, `step.failed`, `step.skipped`, `tool.called`, `tool.completed`, `tool.failed`, `agent.called`, `agent.completed`, `agent.failed`, `checkpoint.saved`
