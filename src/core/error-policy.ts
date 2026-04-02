import type { WorkflowDefaults } from "./ast";

export const ON_ERROR_STRATEGIES = ["retry", "fail", "continue", "goto"] as const;

export type OnErrorStrategy = (typeof ON_ERROR_STRATEGIES)[number];

export interface ResolvedOnErrorPolicy {
  strategy: OnErrorStrategy;
  maxAttempts?: number;
  goto?: string;
}

export function resolveOnErrorPolicy(
  value: Record<string, unknown> | undefined,
  defaults?: WorkflowDefaults
): ResolvedOnErrorPolicy {
  const retryConfig = isPlainObject(value?.retry) ? value.retry : undefined;
  const declaredStrategy = isOnErrorStrategy(value?.strategy) ? value.strategy : undefined;
  const strategy =
    declaredStrategy ??
    (retryConfig ? "retry" : typeof value?.goto === "string" ? "goto" : "fail");

  if (strategy === "retry") {
    return {
      strategy,
      maxAttempts:
        readPositiveInteger(value?.maxAttempts) ??
        readPositiveInteger(retryConfig?.maxAttempts) ??
        defaultMaxAttempts(defaults)
    };
  }

  if (strategy === "goto") {
    return {
      strategy,
      goto: typeof value?.goto === "string" ? value.goto : undefined
    };
  }

  return {
    strategy
  };
}

export function isOnErrorStrategy(value: unknown): value is OnErrorStrategy {
  return typeof value === "string" && (ON_ERROR_STRATEGIES as readonly string[]).includes(value);
}

function defaultMaxAttempts(defaults: WorkflowDefaults | undefined): number {
  if (!Number.isInteger(defaults?.maxStepRetries) || (defaults?.maxStepRetries ?? 0) < 0) {
    return 2;
  }

  return (defaults?.maxStepRetries ?? 0) + 1;
}

function readPositiveInteger(value: unknown): number | undefined {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    return undefined;
  }

  return value as number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
