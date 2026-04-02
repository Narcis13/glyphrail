import type {
  AgentStep,
  AssignStep,
  BaseStep,
  FailStep,
  ForEachStep,
  IfStep,
  NoopStep,
  ParallelBranch,
  ParallelStep,
  ReturnStep,
  ToolStep,
  WhileStep,
  WorkflowDocument,
  WorkflowStep
} from "../core/ast";

export interface StepInventoryItem {
  path: string;
  depth: number;
  parentId?: string;
  step: WorkflowStep;
}

export function normalizeWorkflowDocument(raw: Record<string, unknown>): WorkflowDocument {
  return {
    version: String(raw.version),
    name: String(raw.name),
    description: asOptionalString(raw.description),
    inputSchema: asOptionalObject(raw.inputSchema),
    outputSchema: asOptionalObject(raw.outputSchema),
    defaults: asOptionalObject(raw.defaults),
    policies: asOptionalObject(raw.policies),
    state: asOptionalObject(raw.state),
    steps: normalizeStepArray((raw.steps as unknown[]) ?? []),
    output: raw.output as WorkflowDocument["output"]
  };
}

export function flattenWorkflowSteps(
  steps: WorkflowStep[],
  pathPrefix = "steps",
  depth = 0,
  parentId?: string
): StepInventoryItem[] {
  const inventory: StepInventoryItem[] = [];

  for (const [index, step] of steps.entries()) {
    const path = `${pathPrefix}[${index}]`;
    inventory.push({
      path,
      depth,
      parentId,
      step
    });

    if (step.kind === "if") {
      inventory.push(...flattenWorkflowSteps(step.then, `${path}.then`, depth + 1, step.id));
      if (step.else) {
        inventory.push(...flattenWorkflowSteps(step.else, `${path}.else`, depth + 1, step.id));
      }
      continue;
    }

    if (step.kind === "for_each" || step.kind === "while") {
      inventory.push(...flattenWorkflowSteps(step.steps, `${path}.steps`, depth + 1, step.id));
      continue;
    }

    if (step.kind === "parallel") {
      for (const [branchIndex, branch] of step.branches.entries()) {
        inventory.push(
          ...flattenWorkflowSteps(branch.steps, `${path}.branches[${branchIndex}].steps`, depth + 1, step.id)
        );
      }
    }
  }

  return inventory;
}

export function getStepWriteTargets(step: WorkflowStep): string[] {
  if (step.kind === "assign") {
    return Object.keys(step.set).map(normalizeStatePath);
  }

  if (step.kind === "tool" || step.kind === "agent") {
    return [step.save, step.append, step.merge]
      .filter((value): value is string => typeof value === "string")
      .map(normalizeStatePath);
  }

  return [];
}

export function normalizeStatePath(path: string): string {
  return path.startsWith("state.") ? path.slice("state.".length) : path;
}

function normalizeStepArray(rawSteps: unknown[]): WorkflowStep[] {
  return rawSteps.map((step) => normalizeStep(step as Record<string, unknown>));
}

function normalizeStep(raw: Record<string, unknown>): WorkflowStep {
  const common = normalizeCommonStep(raw);
  switch (raw.kind) {
    case "assign":
      return {
        ...common,
        kind: "assign",
        set: normalizeAssignSet(raw.set)
      } satisfies AssignStep;
    case "tool":
      return {
        ...common,
        kind: "tool",
        tool: String(raw.tool),
        input: asOptionalObject(raw.input),
        save: asOptionalString(raw.save),
        append: asOptionalString(raw.append),
        merge: asOptionalString(raw.merge)
      } satisfies ToolStep;
    case "agent":
      return {
        ...common,
        kind: "agent",
        mode: raw.mode as AgentStep["mode"],
        provider: asOptionalString(raw.provider),
        model: asOptionalString(raw.model),
        objective: String(raw.objective),
        instructions: asOptionalString(raw.instructions),
        input: asOptionalObject(raw.input),
        outputSchema: asOptionalObject(raw.outputSchema),
        save: asOptionalString(raw.save),
        append: asOptionalString(raw.append),
        merge: asOptionalString(raw.merge)
      } satisfies AgentStep;
    case "if":
      return {
        ...common,
        kind: "if",
        condition: String(raw.condition),
        then: normalizeStepArray((raw.then as unknown[]) ?? []),
        else: Array.isArray(raw.else) ? normalizeStepArray(raw.else as unknown[]) : undefined
      } satisfies IfStep;
    case "for_each":
      return {
        ...common,
        kind: "for_each",
        items: String(raw.items),
        as: String(raw.as),
        steps: normalizeStepArray((raw.steps as unknown[]) ?? [])
      } satisfies ForEachStep;
    case "while":
      return {
        ...common,
        kind: "while",
        condition: String(raw.condition),
        maxIterations: Number(raw.maxIterations),
        steps: normalizeStepArray((raw.steps as unknown[]) ?? [])
      } satisfies WhileStep;
    case "parallel":
      return {
        ...common,
        kind: "parallel",
        branches: ((raw.branches as Record<string, unknown>[]) ?? []).map((branch) =>
          normalizeParallelBranch(branch)
        )
      } satisfies ParallelStep;
    case "return":
      return {
        ...common,
        kind: "return",
        output: raw.output as ReturnStep["output"]
      } satisfies ReturnStep;
    case "fail":
      return {
        ...common,
        kind: "fail",
        message: asOptionalString(raw.message),
        error: asOptionalString(raw.error)
      } satisfies FailStep;
    default:
      return {
        ...common,
        kind: "noop"
      } satisfies NoopStep;
  }
}

function normalizeCommonStep(raw: Record<string, unknown>): BaseStep {
  return {
    id: String(raw.id),
    kind: String(raw.kind) as BaseStep["kind"],
    name: asOptionalString(raw.name),
    description: asOptionalString(raw.description),
    when: asOptionalString(raw.when),
    timeoutMs: typeof raw.timeoutMs === "number" ? raw.timeoutMs : undefined,
    onError: asOptionalObject(raw.onError),
    meta: asOptionalObject(raw.meta)
  };
}

function normalizeAssignSet(value: unknown): AssignStep["set"] {
  const objectValue = asOptionalObject(value) ?? {};
  const normalizedEntries = Object.entries(objectValue).map(([path, entryValue]) => [
    normalizeStatePath(path),
    entryValue as AssignStep["set"][string]
  ]);
  return Object.fromEntries(normalizedEntries);
}

function normalizeParallelBranch(raw: Record<string, unknown>): ParallelBranch {
  return {
    id: asOptionalString(raw.id),
    steps: normalizeStepArray((raw.steps as unknown[]) ?? [])
  };
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asOptionalObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}
