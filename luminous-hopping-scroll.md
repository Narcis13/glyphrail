# Glyphrail Documents: Living Markdown Powered by Deterministic Workflows

## Context

Glyphrail owns control flow, persistence, budgets, and safety. Tools own side effects. Agents own bounded judgment. But today, the output of all that orchestration is raw JSON — data without presentation. The user must write separate code to format, display, or share results.

**The insight**: What if the document IS the workflow? A single `.gr.md` file where the YAML frontmatter defines the computation and the Markdown body defines the presentation. Execute it, and the body fills itself in with real data. The document becomes a living artifact — version-controlled, reproducible, traceable, and beautiful.

This is **result-first authoring**: you start with the document you want to exist, and the workflow makes it real.

---

## The `.gr.md` Format

A `.gr.md` file has two parts, separated by standard YAML frontmatter delimiters:

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
  commits: null
  openIssues: null
  summary: null
steps:
  - id: gather-commits
    kind: tool
    tool: bash
    input:
      command: "git log --oneline --since='7 days ago' --author='${input.team}'"
    save: state.commits

  - id: count-issues
    kind: tool
    tool: bash
    input:
      command: "gh issue list --state open --json number,title"
    save: state.openIssues

  - id: synthesize
    kind: agent
    provider: claude-code
    model: sonnet
    objective: "Summarize this week's development activity for a status report"
    instructions: "Be concise. Highlight what shipped, what's in progress, and blockers."
    input:
      commits: ${state.commits}
      issues: ${state.openIssues}
    outputSchema:
      type: object
      properties:
        shipped: { type: array, items: { type: string } }
        inProgress: { type: array, items: { type: string } }
        blockers: { type: array, items: { type: string } }
      required: [shipped, inProgress, blockers]
    save: state.summary
output:
  commits: ${state.commits}
  summary: ${state.summary}
  issues: ${state.openIssues}
---

# Weekly Status: ${input.team}

## What Shipped

{{#each output.summary.shipped as item}}
- ${item}
{{/each}}

## In Progress

{{#each output.summary.inProgress as item}}
- ${item}
{{/each}}

## Open Issues

{{#if output.issues}}
| # | Title |
|---|-------|
{{#each output.issues as issue}}
| ${issue.number} | ${issue.title} |
{{/each}}
{{#else}}
_No open issues._
{{/if}}

## Blockers

{{#if output.summary.blockers}}
{{#each output.summary.blockers as blocker}}
> ${blocker}
{{/each}}
{{#else}}
No blockers this week.
{{/if}}

---
*Generated on ${context.startedAt} | Run ${context.runId}*
```

**Rules**:
1. The frontmatter MUST be a complete, valid Glyphrail workflow (version, name, steps — all existing DSL rules apply)
2. The body is Markdown with embedded expressions and block directives
3. The body's scope includes: `input`, `state` (final), `output`, `context`, `env`
4. Empty body is valid — equivalent to a regular `.gr.yaml` workflow
5. The source `.gr.md` is never mutated; rendered output is a separate artifact

---

## Template Syntax

### Inline Interpolation — `${expr}`

Reuses the existing Glyphrail expression engine exactly. Any valid workflow expression works:

```markdown
Revenue: ${output.metrics.revenue}
Full name: ${input.firstName + " " + input.lastName}
Status: ${state.passed == true && "PASS" || "FAIL"}
```

Values are stringified for insertion into text. `null`/`undefined` render as empty string.

### Block Directives — `{{#...}}` / `{{/...}}`

Block constructs use `{{#directive}}` / `{{/directive}}` delimiters, visually distinct from `${...}` inline expressions. Each directive occupies its own line.

**Iteration:**
```markdown
{{#each output.items as item}}
- **${item.name}**: ${item.description}
{{/each}}
```

The `each` directive evaluates the expression, iterates, and binds each element to the named variable. The binding becomes a root scope (like `item` in `for_each` steps), accessible inside the block body.

**Conditionals:**
```markdown
{{#if output.hasWarnings}}
> There are ${output.warningCount} warnings to address.
{{#else}}
All clear.
{{/if}}
```

The `if` directive evaluates the expression for truthiness. `{{#else}}` is optional.

**Nesting** is fully supported:
```markdown
{{#each output.sections as section}}
## ${section.title}

{{#if section.items}}
{{#each section.items as item}}
- ${item}
{{/each}}
{{#else}}
_No items in this section._
{{/if}}

{{/each}}
```

### Formatters (Pipes) — `${expr | formatter}`

Pipes transform values into Markdown-friendly strings:

```markdown
${output.data | table}          <!-- array of objects -> Markdown table -->
${output.items | bullets}       <!-- array -> bullet list -->
${output.items | numbered}      <!-- array -> numbered list -->
${output.raw | json}            <!-- any -> pretty JSON in code fence -->
${output.snippet | code "sql"}  <!-- string -> fenced code block with lang -->
${output.score | fixed 2}       <!-- number -> toFixed(2) -->
${output.name | upper}          <!-- string -> UPPERCASE -->
${output.name | lower}          <!-- string -> lowercase -->
${output.text | truncate 200}   <!-- string -> truncated with ... -->
${output.maybeNull | default "N/A"}  <!-- fallback for null/undefined -->
```

Formatters are evaluated **after** the expression, **before** stringification. They are pure functions — no side effects.

### Escape Hatch

Literal `${...}` that shouldn't be interpolated: prefix with backslash `\${this.is.literal}`.

---

## Architecture

### New Module: `src/document/`

```
src/document/
  contracts.ts         Types: ParsedGrDocument, DocumentRenderScope, RenderResult, TemplateNode AST
  parser.ts            Split .gr.md -> { frontmatterYAML, templateBody }
  template-engine.ts   Parse body -> TemplateNode[], evaluate AST against scope
  formatters.ts        Built-in pipe formatters registry (table, bullets, json, code, etc.)
  renderer.ts          Orchestrate: parse -> execute workflow -> render template -> persist
  validation.ts        Validate template expressions, directive nesting, formatter names
```

### Data Flow

```
.gr.md file
    |
    v
parser.ts -----> splitFrontmatter() -----> { frontmatterRaw, templateBody }
    |                                            |
    |  YAML parse + existing DSL validation      |  template-engine.ts: parseTemplate()
    v                                            v
WorkflowDocument                          TemplateNode[] (AST)
    |                                            |
    v                                            |
execution-engine.ts: executeWorkflow()           |
    |                                            |
    v                                            |
ExecuteWorkflowResult { state, output }          |
    |                                            |
    +--- buildRenderScope() --->  scope ---------+
                                                 |
                                                 v
                                 evaluateTemplate(nodes, scope, formatters)
                                                 |
                                                 v
                                          rendered Markdown string
                                                 |
                                                 v
                                         persist + output
```

### Template AST

```typescript
type TemplateNode = TextNode | InterpolationNode | EachBlockNode | IfBlockNode

interface TextNode        { type: "text";          value: string;  line: number }
interface InterpolationNode { type: "interpolation"; expression: string; formatter?: string; formatterArgs?: string[]; line: number }
interface EachBlockNode   { type: "each";  itemsExpression: string; binding: string; body: TemplateNode[]; line: number }
interface IfBlockNode     { type: "if";    condition: string; thenBody: TemplateNode[]; elseBody?: TemplateNode[]; line: number }
```

### Key Types

```typescript
interface ParsedGrDocument {
  frontmatterRaw: string
  workflow: WorkflowDocument
  templateBody: string
  filePath: string
}

interface DocumentRenderScope {
  input: JsonValue
  state: Record<string, unknown>     // final state after execution
  output: Record<string, unknown>    // workflow output
  context: Record<string, unknown>   // runId, workflow name, startedAt
  env: Record<string, string | undefined>
}

interface DocumentRenderResult {
  runId: string
  status: RunStatus
  rendered: string                   // the final Markdown
  output: JsonValue                  // workflow output (raw)
  artifacts: RunArtifactPaths
  templateWarnings: TemplateIssue[]
}
```

---

## Expression Engine Changes

Three minimal, backwards-compatible changes to `src/core/expression-engine.ts`:

**1. Add `output` to `SUPPORTED_ROOTS`** (line 63):
```typescript
const SUPPORTED_ROOTS = new Set(["input", "state", "env", "context", "item", "branch", "output"])
```

**2. Add `output` to `ExpressionScope`** (line 54-61):
```typescript
export interface ExpressionScope {
  input?: Record<string, unknown>
  state?: Record<string, unknown>
  env?: Record<string, unknown>
  context?: Record<string, unknown>
  item?: Record<string, unknown> | unknown
  branch?: Record<string, unknown>
  output?: Record<string, unknown> | unknown   // new
  [key: string]: unknown                        // dynamic roots for each bindings
}
```

**3. Make `resolveReference` accept dynamic scope keys** (line 158-176):
```typescript
function resolveReference(segments: string[], scope: ExpressionScope): unknown {
  const [root, ...rest] = segments
  if (!root || (!SUPPORTED_ROOTS.has(root) && !(root in scope))) {
    throw createFailure(...)
  }
  let current: unknown = (scope as Record<string, unknown>)[root]
  // ... rest unchanged
}
```

This lets `{{#each output.items as highlight}}` inject `highlight` as a dynamic scope root, so `${highlight.title}` resolves naturally. No existing workflow code provides extra scope keys, so nothing breaks.

---

## CLI Commands

### `gr render <file.gr.md>`

Primary command. Executes the workflow and renders the template.

```
gr render <file.gr.md>
    [--input <file>]              # Input from JSON/YAML file
    [--input-json <json>]         # Input as inline JSON
    [--output <file>]             # Write rendered Markdown to file
    [--format markdown|html]      # Output format (default: markdown)
    [--from-run <run-id>]         # Re-render from past run (skip execution)
    [--dry-run]                   # Validate only, no execution
    [--no-checkpoint]             # Skip checkpointing
    [--json]                      # Machine-parseable JSON envelope output
    [--quiet]                     # Suppress non-essential output
```

File: `src/cli/commands/render.ts`, following the `CommandDefinition` pattern.

JSON output envelope:
```json
{
  "ok": true,
  "command": "render",
  "runId": "run_abc123",
  "status": "completed",
  "outputFile": "report.md",
  "rendered": "# Weekly Status...",
  "artifacts": { "meta": "...", "state": "...", "rendered": "..." },
  "templateWarnings": []
}
```

### `gr document validate <file.gr.md>`

Validates both the workflow frontmatter and the template body without executing.

```
gr document validate <file.gr.md> [--json]
```

Checks: YAML structure, workflow validity, template syntax, expression validity, formatter existence, directive nesting.

File: `src/cli/commands/document-validate.ts`.

---

## Persistence

Rendered documents are stored alongside standard run artifacts:

```
.glyphrail/runs/run_<id>/
  meta.json              # standard (extended with document metadata)
  input.json             # standard
  state.latest.json      # standard
  output.json            # standard
  trace.jsonl            # standard
  checkpoints/           # standard
  rendered.md            # NEW - the rendered document
  source.gr.md           # NEW - copy of source for reproducibility
```

The `RunRecord` in `src/core/run-record.ts` gains an optional `document` field:
```typescript
document?: { sourceFile: string; format: "markdown" | "html" }
```

This means `gr runs show <id>` reveals it was a document render, and `gr runs output <id>` could show the rendered Markdown.

---

## What This Unlocks

### 1. AI-Authored Reports
A workflow gathers data (APIs, databases, git history), an agent step synthesizes it, and the template presents it as a polished report. The AI writes prose within a deterministic, auditable shell.

### 2. Self-Updating Documentation
READMEs, changelogs, API docs that pull from live sources. Run on commit or on schedule. Always current, always traceable.

### 3. Executable Runbooks
Ops playbooks where remediation steps are real tool calls. Run the document during an incident — it executes the checks and fills in the findings.

### 4. Data Pipeline -> Presentation
Fetch, transform, analyze, and present — all in one file. No separate formatting script. The pipeline and its output template are versioned together.

### 5. Proposal / Report Generation
Parameterized templates: feed in client name, budget, requirements. The workflow runs analysis agents. The template assembles a formatted proposal. Every generated proposal has a run ID for audit.

### 6. Literate Workflows
Explain what you're doing in prose. The frontmatter defines it. The body shows the results. Anyone reading the `.gr.md` understands both the "how" and the "what".

### 7. Composable Document Chains
One document's output becomes another's input. Weekly reports aggregate into monthly reports. Test results feed into release notes.

---

## The Obsidian Angle

The `.gr.md` format is deliberately designed to be valid Markdown with standard YAML frontmatter:

- **Obsidian already renders YAML frontmatter** as a collapsed properties block
- **The template syntax** (`${...}`, `{{#...}}`) appears as inert text in raw view
- **Wikilinks** (`[[other-document.gr.md]]`) could reference other executable documents
- **Graph view** would visualize relationships between executable documents

A future Obsidian plugin could:
- Add a "Run" button to `.gr.md` files
- Show rendered vs. source toggle (like Obsidian's reading/editing mode)
- Display run history in the sidebar
- Auto-render on open with cached results
- Surface workflow status as note metadata

The CLI (`gr render`) is the foundation. The Obsidian plugin is the dream interface. The format is designed so both can coexist — the same file works in the terminal and in the knowledge base.

---

## Implementation Plan

### Phase 1: MVP (Inline Interpolation + Render Command)

| # | File | What |
|---|------|------|
| 1 | `src/core/expression-engine.ts` | Add `output` root, index signature, dynamic scope resolution (~10 lines changed) |
| 2 | `src/document/contracts.ts` | All type definitions |
| 3 | `src/document/parser.ts` | `splitFrontmatter()`, `parseGrDocument()` |
| 4 | `src/document/formatters.ts` | Registry + built-ins: `bullets`, `numbered`, `table`, `json`, `code`, `default` |
| 5 | `src/document/template-engine.ts` | Parse `${...}` interpolation + pipes (no blocks yet), evaluate against scope |
| 6 | `src/document/renderer.ts` | Orchestrate: parse -> execute -> render -> persist |
| 7 | `src/cli/commands/render.ts` | `gr render` command following CommandDefinition pattern |
| 8 | `src/core/run-record.ts` | Add optional `document` field to RunRecord |
| 9 | `src/core/run-store.ts` | Add `rendered.md` and `source.gr.md` persistence |
| 10 | `src/cli/commands/index.ts` | Register render command |
| 11 | `src/index.ts` | Export document types and functions |
| 12 | `test/unit/document-parser.test.ts` | Frontmatter splitting edge cases |
| 13 | `test/unit/template-engine.test.ts` | Interpolation, pipes, escaping |
| 14 | `test/unit/formatters.test.ts` | Each built-in formatter |
| 15 | `test/integration/render-command.test.ts` | End-to-end gr render |
| 16 | `playground/mvp/documents/hello.gr.md` | Sample document for smoke testing |

### Phase 2: Block Directives

| # | File | What |
|---|------|------|
| 1 | `src/document/template-engine.ts` | Add `{{#each}}`, `{{#if}}`, `{{#else}}`, `{{/...}}` parsing + evaluation |
| 2 | `src/document/validation.ts` | Template validation (nesting, expression roots, formatter names) |
| 3 | `src/cli/commands/document-validate.ts` | `gr document validate` command |
| 4 | Tests for blocks, nesting, validation | |
| 5 | `playground/mvp/documents/report.gr.md` | Richer sample with blocks |

### Phase 3: Advanced Features ✅

- ✅ `--from-run <id>` — re-render template against past run results (iterate on template without re-executing)
- ✅ `--watch` — file watcher with smart re-render (hash frontmatter vs body separately; body-only changes skip execution)
- ✅ HTML output format (`--format html`)
- ✅ Additional formatters: `date`, `truncate`, `fixed`, `upper`, `lower`
- ✅ `gr document explain <file.gr.md>` — explain both workflow and template structure


### Phase 4: Ecosystem

- Obsidian plugin prototype
- Document composition / imports
- Template inheritance (`extends: base-report.gr.md`)
- Custom formatter registration via config

---

## Reuse Strategy

| What | Reused From | How |
|------|-------------|-----|
| Expression evaluation | `src/core/expression-engine.ts` | Direct call to `evaluateExpression()` for all `${...}` |
| Workflow validation | `src/dsl/validation.ts` | Validate frontmatter via `validateWorkflowDocument()` |
| YAML parsing | `src/util/yaml.ts` | Parse frontmatter via `parseYaml()` |
| Workflow execution | `src/core/execution-engine.ts` | Run workflow via `executeWorkflow()` |
| Input resolution | `src/cli/commands/run-shared.ts` | Reuse `resolveRunInput()` for --input flags |
| Run persistence | `src/core/run-store.ts` | Store artifacts via existing functions + new rendered.md |
| CLI patterns | `src/cli/types.ts` | Follow `CommandDefinition` interface exactly |
| Config discovery | `src/config/index.ts` | Reuse `loadProjectConfig()` |

Zero new dependencies. Pure TypeScript built on existing engine internals.

---

## Verification Plan

### Unit Tests
- **Parser**: empty body, no frontmatter (error), malformed delimiters, frontmatter-only, unicode content
- **Template engine**: simple interpolation, multiple expressions per line, nested object access, pipe formatters, escaped expressions, each blocks, if/else blocks, nested blocks, unterminated blocks (error)
- **Formatters**: each built-in with edge cases (empty arrays, null values, nested objects for table)
- **Validation**: invalid expressions, unknown formatters, mismatched block closers

### Integration Tests
- `gr render simple.gr.md --input-json '{"name":"world"}'` produces expected Markdown
- `gr render report.gr.md --json` returns valid JSON envelope with rendered field
- `gr render report.gr.md --output out.md` writes file
- `gr render invalid.gr.md` exits with validation error code
- `gr document validate report.gr.md --json` validates without executing
- Run artifacts include `rendered.md` and `source.gr.md`
- `gr runs show <id>` shows document metadata

### Smoke Test
- Add `playground/mvp/documents/` with sample `.gr.md` files
- Add smoke script similar to `playground/mvp/smoke.sh`

---

## Error Handling

New error codes in `src/core/errors.ts`:

| Code | Exit Code | When |
|------|-----------|------|
| `DOCUMENT_PARSE_ERROR` | 3 (workflowValidationFailure) | Frontmatter splitting fails |
| `TEMPLATE_PARSE_ERROR` | 3 | Template syntax error (unterminated block, bad directive) |
| `TEMPLATE_RENDER_ERROR` | 5 (executionFailure) | Expression evaluation fails during render |
| `TEMPLATE_VALIDATION_ERROR` | 3 | Template references invalid roots or formatters |

All template errors include line number and column for precise diagnostics.

---

## Why This Matters

Most workflow engines produce data. Glyphrail Documents produce **artifacts** — things humans read, share, and act on. The workflow and its presentation are a single, atomic, version-controlled unit. Every rendered document has a run ID. You can trace every sentence back to the step that produced it.

This is the missing link between "AI can do computation" and "AI can produce deliverables."
