import type { WorkflowStep, WorkflowDocument } from "../core/ast";
import {
  collectExpressionReferences,
  evaluateExpressionNode,
  isExpressionInterpolation,
  parseExpression,
  type ExpressionNode,
  type ExpressionReference
} from "../core/expression-engine";
import { isOnErrorStrategy, resolveOnErrorPolicy } from "../core/error-policy";
import { validateSchemaDefinition } from "../core/schema-validator";
import { flattenWorkflowSteps, getStepWriteTargets, normalizeStatePath, normalizeWorkflowDocument, type StepInventoryItem } from "./normalization";
import { discoverDeclaredTools } from "../tools/registry";

export interface WorkflowIssue {
  code: string;
  message: string;
  path: string;
  stepId?: string;
  severity: "error" | "warning";
}

export interface ParsedWorkflowExpression {
  path: string;
  expression: string;
  ast: ExpressionNode;
  references: ExpressionReference[];
}

export interface WorkflowValidationResult {
  workflow?: WorkflowDocument;
  inventory: StepInventoryItem[];
  referencedTools: string[];
  declaredTools: string[];
  expressions: ParsedWorkflowExpression[];
  errors: WorkflowIssue[];
}

export interface WorkflowLintResult {
  warnings: WorkflowIssue[];
}

export interface ValidateWorkflowOptions {
  toolsEntryPath: string;
}

type MutableIssueState = {
  errors: WorkflowIssue[];
  expressions: ParsedWorkflowExpression[];
};

const COMMON_STEP_FIELDS = new Set([
  "id",
  "kind",
  "name",
  "description",
  "when",
  "timeoutMs",
  "onError",
  "meta"
]);

const TOP_LEVEL_FIELDS = new Set([
  "version",
  "name",
  "description",
  "inputSchema",
  "outputSchema",
  "defaults",
  "policies",
  "state",
  "steps",
  "output"
]);

const DEFAULT_FIELDS = new Set(["model", "timeoutMs", "maxStepRetries", "outputMode"]);
const POLICY_FIELDS = new Set(["allowTools", "maxRunSteps", "maxRunDurationMs", "maxAgentToolCalls"]);

const STEP_FIELD_MAP: Record<string, Set<string>> = {
  assign: new Set([...COMMON_STEP_FIELDS, "set"]),
  tool: new Set([...COMMON_STEP_FIELDS, "tool", "input", "save", "append", "merge"]),
  agent: new Set([
    ...COMMON_STEP_FIELDS,
    "mode",
    "provider",
    "model",
    "objective",
    "instructions",
    "input",
    "outputSchema",
    "save",
    "append",
    "merge"
  ]),
  if: new Set([...COMMON_STEP_FIELDS, "condition", "then", "else"]),
  for_each: new Set([...COMMON_STEP_FIELDS, "items", "as", "steps"]),
  while: new Set([...COMMON_STEP_FIELDS, "condition", "maxIterations", "steps"]),
  parallel: new Set([...COMMON_STEP_FIELDS, "branches"]),
  return: new Set([...COMMON_STEP_FIELDS, "output"]),
  fail: new Set([...COMMON_STEP_FIELDS, "message", "error"]),
  noop: new Set([...COMMON_STEP_FIELDS])
};

export async function validateWorkflowDocument(
  raw: unknown,
  options: ValidateWorkflowOptions
): Promise<WorkflowValidationResult> {
  const issueState: MutableIssueState = {
    errors: [],
    expressions: []
  };

  if (!isPlainObject(raw)) {
    issueState.errors.push(makeIssue("INVALID_DOCUMENT", "Workflow must be a YAML object.", "", "error"));
    return {
      inventory: [],
      referencedTools: [],
      declaredTools: [],
      expressions: [],
      errors: issueState.errors
    };
  }

  validateTopLevel(raw, issueState);
  validateStepArray(raw.steps, "steps", issueState);
  validateTopLevelExpressions(raw, issueState);

  if (issueState.errors.length > 0) {
    return {
      inventory: [],
      referencedTools: [],
      declaredTools: [],
      expressions: issueState.expressions,
      errors: issueState.errors
    };
  }

  const workflow = normalizeWorkflowDocument(raw);
  const inventory = flattenWorkflowSteps(workflow.steps);
  const referencedTools = inventory
    .filter((item) => item.step.kind === "tool")
    .map((item) => item.step.tool)
    .sort();
  const declaredToolsPreview = await discoverDeclaredTools(options.toolsEntryPath);

  validateDuplicateStepIds(inventory, issueState);
  validateDeclaredTools(referencedTools, declaredToolsPreview.toolNames, issueState);
  validateOnErrorGotoTargets(workflow, inventory, issueState);

  if (issueState.errors.length > 0) {
    return {
      workflow,
      inventory,
      referencedTools,
      declaredTools: declaredToolsPreview.toolNames,
      expressions: issueState.expressions,
      errors: issueState.errors
    };
  }

  return {
    workflow,
    inventory,
    referencedTools,
    declaredTools: declaredToolsPreview.toolNames,
    expressions: issueState.expressions,
    errors: issueState.errors
  };
}

export function lintWorkflow(validation: WorkflowValidationResult): WorkflowLintResult {
  if (!validation.workflow) {
    return { warnings: [] };
  }

  const warnings: WorkflowIssue[] = [];
  const declaredStatePaths = buildDeclaredStatePaths(validation.workflow);
  const knownStatePaths = buildKnownStatePaths(validation.workflow, validation.inventory);

  for (const item of validation.inventory) {
    const step = item.step;

    if (step.kind === "agent" && !step.outputSchema) {
      warnings.push(
        makeIssue(
          "AGENT_OUTPUT_SCHEMA_MISSING",
          "Agent steps should define outputSchema for deterministic validation.",
          `${item.path}.outputSchema`,
          "warning",
          step.id
        )
      );
    }

    for (const target of getStepWriteTargets(step)) {
      if (!declaredStatePaths.has(target)) {
        warnings.push(
          makeIssue(
            "OUTPUT_PATH_MISSING",
            `Write target '${target}' is not declared in top-level state.`,
            item.path,
            "warning",
            step.id
          )
        );
      }
    }

    if (step.kind === "if" || step.kind === "while") {
      const expressionPath = step.kind === "if" ? `${item.path}.condition` : `${item.path}.condition`;
      const expressionRecord = validation.expressions.find((entry) => entry.path === expressionPath);
      if (expressionRecord && expressionRecord.references.length === 0) {
        try {
          const result = evaluateExpressionNode(expressionRecord.ast, {});
          if (typeof result === "boolean") {
            warnings.push(
              makeIssue(
                "CONSTANT_CONDITION",
                `Condition is constant ${String(result)} and may make control flow unreachable.`,
                expressionRecord.path,
                "warning",
                step.id
              )
            );
          }
        } catch {
          // Ignore evaluation failures for linting; syntax was already validated.
        }
      }
    }

    if (step.kind === "parallel") {
      const branchWrites = step.branches.map((branch) =>
        flattenWorkflowSteps(branch.steps).flatMap((branchItem) => getStepWriteTargets(branchItem.step))
      );
      const conflictingPaths = findConflictingPaths(branchWrites);
      for (const path of conflictingPaths) {
        warnings.push(
          makeIssue(
            "PARALLEL_CONFLICTING_WRITES",
            `Parallel branches may write conflicting state path '${path}'.`,
            item.path,
            "warning",
            step.id
          )
        );
      }
    }
  }

  if (validation.workflow.output) {
    const outputExpressions = validation.expressions.filter((entry) => entry.path.startsWith("output"));
    for (const expression of outputExpressions) {
      for (const reference of expression.references) {
        if (reference.root === "state") {
          const statePath = reference.segments.slice(1).join(".");
          if (statePath && !knownStatePaths.has(statePath)) {
            warnings.push(
              makeIssue(
                "OUTPUT_PATH_MISSING",
                `Output references state path '${statePath}' that is not declared or written.`,
                expression.path,
                "warning"
              )
            );
          }
        }
      }
    }
  }

  return {
    warnings: dedupeIssues(warnings)
  };
}

function validateTopLevel(raw: Record<string, unknown>, state: MutableIssueState): void {
  const invalidFields = Object.keys(raw).filter((key) => !TOP_LEVEL_FIELDS.has(key));
  for (const field of invalidFields) {
    state.errors.push(
      makeIssue(
        "INVALID_TOP_LEVEL_FIELD",
        `Field '${field}' is not allowed at the top level of a workflow document.`,
        field,
        "error"
      )
    );
  }

  validateRequiredString(raw.version, "version", state);
  validateRequiredString(raw.name, "name", state);

  if (!Array.isArray(raw.steps)) {
    state.errors.push(makeIssue("INVALID_STEPS", "Workflow 'steps' must be an array.", "steps", "error"));
  }

  validateOptionalSchemaObject(raw.inputSchema, "inputSchema", state);
  validateOptionalSchemaObject(raw.outputSchema, "outputSchema", state);
  validateDefaults(raw.defaults, "defaults", state);
  validatePolicies(raw.policies, "policies", state);
  validateOptionalObject(raw.state, "state", state);
}

function validateTopLevelExpressions(raw: Record<string, unknown>, state: MutableIssueState): void {
  collectExpressionsInValue(raw.output, "output", state);
}

function validateStepArray(value: unknown, path: string, state: MutableIssueState): void {
  if (!Array.isArray(value)) {
    state.errors.push(makeIssue("INVALID_STEPS", `Expected array at ${path}.`, path, "error"));
    return;
  }

  for (const [index, step] of value.entries()) {
    validateStep(step, `${path}[${index}]`, state);
  }
}

function validateStep(value: unknown, path: string, state: MutableIssueState): void {
  if (!isPlainObject(value)) {
    state.errors.push(makeIssue("INVALID_STEP", "Each step must be an object.", path, "error"));
    return;
  }

  const stepId = typeof value.id === "string" ? value.id : undefined;
  validateRequiredString(value.id, `${path}.id`, state, stepId);
  validateRequiredString(value.kind, `${path}.kind`, state, stepId);

  if (typeof value.kind !== "string") {
    return;
  }

  const allowedFields = STEP_FIELD_MAP[value.kind];
  if (!allowedFields) {
    state.errors.push(
      makeIssue(
        "UNSUPPORTED_STEP_KIND",
        `Unsupported step kind '${value.kind}'.`,
        `${path}.kind`,
        "error",
        stepId
      )
    );
    return;
  }

  const invalidFields = Object.keys(value).filter((key) => !allowedFields.has(key));
  for (const field of invalidFields) {
    state.errors.push(
      makeIssue(
        "INVALID_STEP_FIELD",
        `Field '${field}' is not allowed on step kind '${value.kind}'.`,
        `${path}.${field}`,
        "error",
        stepId
      )
    );
  }

  validateOptionalString(value.name, `${path}.name`, state, stepId);
  validateOptionalString(value.description, `${path}.description`, state, stepId);
  validateOptionalNumber(value.timeoutMs, `${path}.timeoutMs`, state, stepId);
  if (value.onError !== undefined) {
    validateOnErrorPolicy(value.onError, `${path}.onError`, state, stepId);
  }
  validateOptionalObject(value.meta, `${path}.meta`, state, stepId);

  if (value.when !== undefined) {
    validateRequiredExpression(value.when, `${path}.when`, state, stepId);
  }

  switch (value.kind) {
    case "assign":
      validateAssignStep(value, path, state, stepId);
      return;
    case "tool":
      validateToolStep(value, path, state, stepId);
      return;
    case "agent":
      validateAgentStep(value, path, state, stepId);
      return;
    case "if":
      validateIfStep(value, path, state, stepId);
      return;
    case "for_each":
      validateForEachStep(value, path, state, stepId);
      return;
    case "while":
      validateWhileStep(value, path, state, stepId);
      return;
    case "parallel":
      validateParallelStep(value, path, state, stepId);
      return;
    case "return":
      collectExpressionsInValue(value.output, `${path}.output`, state);
      return;
    case "fail":
      validateOptionalString(value.message, `${path}.message`, state, stepId);
      validateOptionalString(value.error, `${path}.error`, state, stepId);
      return;
    case "noop":
      return;
  }
}

function validateAssignStep(
  value: Record<string, unknown>,
  path: string,
  state: MutableIssueState,
  stepId?: string
): void {
  if (!isPlainObject(value.set)) {
    state.errors.push(
      makeIssue("INVALID_WRITE_DIRECTIVE", "assign.set must be an object.", `${path}.set`, "error", stepId)
    );
    return;
  }

  for (const [setPath, setValue] of Object.entries(value.set)) {
    validateAssignSetPath(setPath, `${path}.set.${setPath}`, state, stepId);
    collectExpressionsInValue(setValue, `${path}.set.${setPath}`, state);
  }
}

function validateToolStep(
  value: Record<string, unknown>,
  path: string,
  state: MutableIssueState,
  stepId?: string
): void {
  validateRequiredString(value.tool, `${path}.tool`, state, stepId);
  validateOptionalObject(value.input, `${path}.input`, state, stepId);
  if (isPlainObject(value.input)) {
    collectExpressionsInValue(value.input, `${path}.input`, state);
  }
  validateWriteDirectives(value, path, state, stepId);
}

function validateAgentStep(
  value: Record<string, unknown>,
  path: string,
  state: MutableIssueState,
  stepId?: string
): void {
  validateOptionalString(value.mode, `${path}.mode`, state, stepId);
  if (typeof value.mode === "string" && value.mode !== "structured" && value.mode !== "tool-use") {
    state.errors.push(
      makeIssue(
        "INVALID_FIELD",
        "agent.mode must be 'structured' or 'tool-use'.",
        `${path}.mode`,
        "error",
        stepId
      )
    );
  }
  if (value.mode === "tool-use") {
    state.errors.push(
      makeIssue(
        "UNSUPPORTED_AGENT_MODE",
        "agent.mode=tool-use is not supported in the current MVP slice.",
        `${path}.mode`,
        "error",
        stepId
      )
    );
  }
  validateOptionalString(value.provider, `${path}.provider`, state, stepId);
  validateOptionalString(value.model, `${path}.model`, state, stepId);
  validateRequiredString(value.objective, `${path}.objective`, state, stepId);
  validateOptionalString(value.instructions, `${path}.instructions`, state, stepId);
  validateOptionalObject(value.input, `${path}.input`, state, stepId);
  if (isPlainObject(value.input)) {
    collectExpressionsInValue(value.input, `${path}.input`, state);
  }
  validateOptionalSchemaObject(value.outputSchema, `${path}.outputSchema`, state, stepId);
  validateWriteDirectives(value, path, state, stepId);
}

function validateIfStep(
  value: Record<string, unknown>,
  path: string,
  state: MutableIssueState,
  stepId?: string
): void {
  validateRequiredExpression(value.condition, `${path}.condition`, state, stepId);
  validateStepArray(value.then, `${path}.then`, state);
  if (value.else !== undefined) {
    validateStepArray(value.else, `${path}.else`, state);
  }
}

function validateForEachStep(
  value: Record<string, unknown>,
  path: string,
  state: MutableIssueState,
  stepId?: string
): void {
  validateRequiredExpression(value.items, `${path}.items`, state, stepId);
  validateRequiredString(value.as, `${path}.as`, state, stepId);
  validateStepArray(value.steps, `${path}.steps`, state);
}

function validateWhileStep(
  value: Record<string, unknown>,
  path: string,
  state: MutableIssueState,
  stepId?: string
): void {
  validateRequiredExpression(value.condition, `${path}.condition`, state, stepId);
  if (typeof value.maxIterations !== "number") {
    state.errors.push(
      makeIssue(
        "MISSING_MAX_ITERATIONS",
        "while steps require numeric maxIterations.",
        `${path}.maxIterations`,
        "error",
        stepId
      )
    );
  }
  validateStepArray(value.steps, `${path}.steps`, state);
}

function validateParallelStep(
  value: Record<string, unknown>,
  path: string,
  state: MutableIssueState,
  stepId?: string
): void {
  if (!Array.isArray(value.branches)) {
    state.errors.push(
      makeIssue(
        "INVALID_BRANCHES",
        "parallel.branches must be an array.",
        `${path}.branches`,
        "error",
        stepId
      )
    );
    return;
  }

  for (const [index, branch] of value.branches.entries()) {
    const branchPath = `${path}.branches[${index}]`;
    if (!isPlainObject(branch)) {
      state.errors.push(makeIssue("INVALID_BRANCH", "Parallel branch must be an object.", branchPath, "error", stepId));
      continue;
    }
    validateOptionalString(branch.id, `${branchPath}.id`, state, stepId);
    validateStepArray(branch.steps, `${branchPath}.steps`, state);
  }
}

function validateWriteDirectives(
  value: Record<string, unknown>,
  path: string,
  state: MutableIssueState,
  stepId?: string
): void {
  const writeDirectives = [
    { key: "save", value: value.save },
    { key: "append", value: value.append },
    { key: "merge", value: value.merge }
  ].filter((entry) => entry.value !== undefined);

  if (writeDirectives.length > 1) {
    state.errors.push(
      makeIssue(
        "INVALID_WRITE_DIRECTIVE",
        "A step may declare only one of save, append, or merge.",
        path,
        "error",
        stepId
      )
    );
  }

  for (const directive of writeDirectives) {
    if (typeof directive.value !== "string" || !directive.value.startsWith("state.")) {
      state.errors.push(
        makeIssue(
          "INVALID_WRITE_DIRECTIVE",
          `${directive.key} must target a state.* path.`,
          `${path}.${directive.key}`,
          "error",
          stepId
        )
      );
    }
  }
}

function validateOnErrorPolicy(
  value: unknown,
  path: string,
  state: MutableIssueState,
  stepId?: string
): void {
  if (!isPlainObject(value)) {
    state.errors.push(makeIssue("INVALID_FIELD", `Expected object at ${path}.`, path, "error", stepId));
    return;
  }

  const supportedFields = new Set(["strategy", "maxAttempts", "goto", "retry"]);
  for (const field of Object.keys(value)) {
    if (!supportedFields.has(field)) {
      state.errors.push(
        makeIssue(
          "INVALID_FIELD",
          `Unsupported onError field '${field}' in reduced MVP policy shape.`,
          `${path}.${field}`,
          "error",
          stepId
        )
      );
    }
  }

  if (value.strategy !== undefined && !isOnErrorStrategy(value.strategy)) {
    state.errors.push(
      makeIssue(
        "INVALID_FIELD",
        "onError.strategy must be one of retry, fail, continue, or goto.",
        `${path}.strategy`,
        "error",
        stepId
      )
    );
  }

  if (value.maxAttempts !== undefined && (!Number.isInteger(value.maxAttempts) || value.maxAttempts <= 0)) {
    state.errors.push(
      makeIssue(
        "INVALID_FIELD",
        "onError.maxAttempts must be a positive integer.",
        `${path}.maxAttempts`,
        "error",
        stepId
      )
    );
  }

  if (value.goto !== undefined && (typeof value.goto !== "string" || value.goto.trim().length === 0)) {
    state.errors.push(
      makeIssue(
        "INVALID_FIELD",
        "onError.goto must be a non-empty step ID.",
        `${path}.goto`,
        "error",
        stepId
      )
    );
  }

  if (value.retry !== undefined) {
    if (!isPlainObject(value.retry)) {
      state.errors.push(
        makeIssue(
          "INVALID_FIELD",
          "onError.retry must be an object when provided.",
          `${path}.retry`,
          "error",
          stepId
        )
      );
    } else if (
      value.retry.maxAttempts !== undefined &&
      (!Number.isInteger(value.retry.maxAttempts) || value.retry.maxAttempts <= 0)
    ) {
      state.errors.push(
        makeIssue(
          "INVALID_FIELD",
          "onError.retry.maxAttempts must be a positive integer.",
          `${path}.retry.maxAttempts`,
          "error",
          stepId
        )
      );
    }
  }

  const policy = resolveOnErrorPolicy(value);
  if (policy.strategy === "goto" && !policy.goto) {
    state.errors.push(
      makeIssue(
        "INVALID_FIELD",
        "onError.strategy=goto requires onError.goto.",
        `${path}.goto`,
        "error",
        stepId
      )
    );
  }
}

function validateDefaults(
  value: unknown,
  path: string,
  state: MutableIssueState
): void {
  if (value === undefined) {
    return;
  }

  if (!isPlainObject(value)) {
    state.errors.push(makeIssue("INVALID_FIELD", `Expected object at ${path}.`, path, "error"));
    return;
  }

  for (const field of Object.keys(value)) {
    if (!DEFAULT_FIELDS.has(field)) {
      state.errors.push(
        makeIssue(
          "INVALID_FIELD",
          `Unsupported defaults field '${field}'.`,
          `${path}.${field}`,
          "error"
        )
      );
    }
  }

  validateOptionalString(value.model, `${path}.model`, state);
  validateOptionalNonNegativeInteger(value.timeoutMs, `${path}.timeoutMs`, state);
  validateOptionalNonNegativeInteger(value.maxStepRetries, `${path}.maxStepRetries`, state);

  if (
    value.outputMode !== undefined &&
    value.outputMode !== "structured" &&
    value.outputMode !== "text" &&
    value.outputMode !== "json"
  ) {
    state.errors.push(
      makeIssue(
        "INVALID_FIELD",
        "defaults.outputMode must be one of structured, text, or json.",
        `${path}.outputMode`,
        "error"
      )
    );
  }
}

function validatePolicies(
  value: unknown,
  path: string,
  state: MutableIssueState
): void {
  if (value === undefined) {
    return;
  }

  if (!isPlainObject(value)) {
    state.errors.push(makeIssue("INVALID_FIELD", `Expected object at ${path}.`, path, "error"));
    return;
  }

  for (const field of Object.keys(value)) {
    if (!POLICY_FIELDS.has(field)) {
      state.errors.push(
        makeIssue(
          "INVALID_FIELD",
          `Unsupported policies field '${field}'.`,
          `${path}.${field}`,
          "error"
        )
      );
    }
  }

  if (value.allowTools !== undefined) {
    if (!Array.isArray(value.allowTools)) {
      state.errors.push(
        makeIssue("INVALID_FIELD", "policies.allowTools must be an array.", `${path}.allowTools`, "error")
      );
    } else {
      for (const [index, entry] of value.allowTools.entries()) {
        if (typeof entry !== "string" || entry.trim().length === 0) {
          state.errors.push(
            makeIssue(
              "INVALID_FIELD",
              "policies.allowTools entries must be non-empty strings.",
              `${path}.allowTools[${index}]`,
              "error"
            )
          );
        }
      }
    }
  }

  validateOptionalPositiveInteger(value.maxRunSteps, `${path}.maxRunSteps`, state);
  validateOptionalPositiveInteger(value.maxRunDurationMs, `${path}.maxRunDurationMs`, state);
  validateOptionalPositiveInteger(value.maxAgentToolCalls, `${path}.maxAgentToolCalls`, state);
}

function validateAssignSetPath(
  setPath: string,
  path: string,
  state: MutableIssueState,
  stepId?: string
): void {
  if (setPath.trim().length === 0) {
    state.errors.push(makeIssue("INVALID_WRITE_DIRECTIVE", "assign.set keys must be non-empty.", path, "error", stepId));
    return;
  }

  const root = normalizeStatePath(setPath).split(".")[0];
  if (["input", "env", "context", "item", "branch"].includes(root)) {
    state.errors.push(
      makeIssue(
        "INVALID_WRITE_DIRECTIVE",
        `assign.set path '${setPath}' cannot target reserved namespace '${root}'.`,
        path,
        "error",
        stepId
      )
    );
  }
}

function validateDuplicateStepIds(inventory: StepInventoryItem[], state: MutableIssueState): void {
  const seenIds = new Map<string, string>();

  for (const item of inventory) {
    const existingPath = seenIds.get(item.step.id);
    if (existingPath) {
      state.errors.push(
        makeIssue(
          "DUPLICATE_STEP_ID",
          `Duplicate step id '${item.step.id}' also appears at ${existingPath}.`,
          item.path,
          "error",
          item.step.id
        )
      );
      continue;
    }
    seenIds.set(item.step.id, item.path);
  }
}

function validateDeclaredTools(
  referencedTools: string[],
  declaredTools: string[],
  state: MutableIssueState
): void {
  const declaredToolSet = new Set(declaredTools);

  for (const toolName of referencedTools) {
    if (!declaredToolSet.has(toolName)) {
      state.errors.push(
        makeIssue(
          "UNDECLARED_TOOL",
          `Tool '${toolName}' is referenced by the workflow but not declared in the tools entry.`,
          "steps",
          "error"
        )
      );
    }
  }
}

function validateOnErrorGotoTargets(
  workflow: WorkflowDocument,
  inventory: StepInventoryItem[],
  state: MutableIssueState
): void {
  const knownStepIds = new Set(inventory.map((item) => item.step.id));

  for (const item of inventory) {
    if (!item.step.onError) {
      continue;
    }

    const policy = resolveOnErrorPolicy(item.step.onError, workflow.defaults);
    if (policy.strategy === "goto" && policy.goto && !knownStepIds.has(policy.goto)) {
      state.errors.push(
        makeIssue(
          "INVALID_FIELD",
          `onError.goto target '${policy.goto}' does not exist in this workflow.`,
          `${item.path}.onError.goto`,
          "error",
          item.step.id
        )
      );
    }
  }
}

function collectExpressionsInValue(value: unknown, path: string, state: MutableIssueState): void {
  if (typeof value === "string") {
    if (!isExpressionInterpolation(value)) {
      return;
    }

    try {
      const ast = parseExpression(value);
      state.expressions.push({
        path,
        expression: value,
        ast,
        references: collectExpressionReferences(ast)
      });
    } catch (error) {
      state.errors.push(
        makeIssue(
          "INVALID_EXPRESSION",
          error instanceof Error ? error.message : "Invalid expression.",
          path,
          "error"
        )
      );
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      collectExpressionsInValue(item, `${path}[${index}]`, state);
    }
    return;
  }

  if (isPlainObject(value)) {
    for (const [key, childValue] of Object.entries(value)) {
      collectExpressionsInValue(childValue, `${path}.${key}`, state);
    }
  }
}

function validateRequiredExpression(
  value: unknown,
  path: string,
  state: MutableIssueState,
  stepId?: string
): void {
  if (typeof value !== "string" || !isExpressionInterpolation(value)) {
    state.errors.push(
      makeIssue("INVALID_EXPRESSION", "Expected a ${...} expression.", path, "error", stepId)
    );
    return;
  }

  collectExpressionsInValue(value, path, state);
}

function validateRequiredString(
  value: unknown,
  path: string,
  state: MutableIssueState,
  stepId?: string
): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    state.errors.push(makeIssue("INVALID_FIELD", `Expected a non-empty string at ${path}.`, path, "error", stepId));
  }
}

function validateOptionalString(
  value: unknown,
  path: string,
  state: MutableIssueState,
  stepId?: string
): void {
  if (value !== undefined && typeof value !== "string") {
    state.errors.push(makeIssue("INVALID_FIELD", `Expected string at ${path}.`, path, "error", stepId));
  }
}

function validateOptionalNumber(
  value: unknown,
  path: string,
  state: MutableIssueState,
  stepId?: string
): void {
  if (value !== undefined && typeof value !== "number") {
    state.errors.push(makeIssue("INVALID_FIELD", `Expected number at ${path}.`, path, "error", stepId));
  }
}

function validateOptionalNonNegativeInteger(
  value: unknown,
  path: string,
  state: MutableIssueState,
  stepId?: string
): void {
  if (value !== undefined && (!Number.isInteger(value) || (value as number) < 0)) {
    state.errors.push(
      makeIssue("INVALID_FIELD", `Expected a non-negative integer at ${path}.`, path, "error", stepId)
    );
  }
}

function validateOptionalPositiveInteger(
  value: unknown,
  path: string,
  state: MutableIssueState,
  stepId?: string
): void {
  if (value !== undefined && (!Number.isInteger(value) || (value as number) <= 0)) {
    state.errors.push(
      makeIssue("INVALID_FIELD", `Expected a positive integer at ${path}.`, path, "error", stepId)
    );
  }
}

function validateOptionalObject(
  value: unknown,
  path: string,
  state: MutableIssueState,
  stepId?: string
): void {
  if (value !== undefined && !isPlainObject(value)) {
    state.errors.push(makeIssue("INVALID_FIELD", `Expected object at ${path}.`, path, "error", stepId));
  }
}

function validateOptionalSchemaObject(
  value: unknown,
  path: string,
  state: MutableIssueState,
  stepId?: string
): void {
  if (value === undefined) {
    return;
  }

  if (!isPlainObject(value)) {
    state.errors.push(makeIssue("INVALID_FIELD", `Expected object at ${path}.`, path, "error", stepId));
    return;
  }

  for (const issue of validateSchemaDefinition(value)) {
    state.errors.push(
      makeIssue(
        "INVALID_SCHEMA",
        issue.message,
        issue.path === "$" ? path : `${path}${issue.path.slice(1)}`,
        "error",
        stepId
      )
    );
  }
}

function buildDeclaredStatePaths(workflow: WorkflowDocument): Set<string> {
  const declaredStatePaths = new Set<string>();
  collectStatePaths(workflow.state ?? {}, "", declaredStatePaths);
  return declaredStatePaths;
}

function buildKnownStatePaths(workflow: WorkflowDocument, inventory: StepInventoryItem[]): Set<string> {
  const knownStatePaths = buildDeclaredStatePaths(workflow);

  for (const item of inventory) {
    for (const writeTarget of getStepWriteTargets(item.step)) {
      knownStatePaths.add(writeTarget);
    }
  }

  return knownStatePaths;
}

function collectStatePaths(
  value: Record<string, unknown>,
  prefix: string,
  output: Set<string>
): void {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    output.add(path);
    if (isPlainObject(child)) {
      collectStatePaths(child, path, output);
    }
  }
}

function findConflictingPaths(branchWrites: string[][]): string[] {
  const counts = new Map<string, number>();

  for (const branch of branchWrites) {
    const seenInBranch = new Set(branch);
    for (const path of seenInBranch) {
      counts.set(path, (counts.get(path) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([path]) => path)
    .sort();
}

function dedupeIssues(issues: WorkflowIssue[]): WorkflowIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}:${issue.path}:${issue.message}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function makeIssue(
  code: string,
  message: string,
  path: string,
  severity: "error" | "warning",
  stepId?: string
): WorkflowIssue {
  return {
    code,
    message,
    path,
    stepId,
    severity
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
