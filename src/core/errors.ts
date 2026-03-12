export const EXIT_CODES = {
  success: 0,
  genericFailure: 1,
  invalidCliUsage: 2,
  workflowValidationFailure: 3,
  inputValidationFailure: 4,
  executionFailure: 5,
  paused: 6,
  cancelled: 7,
  policyViolation: 8,
  notFound: 9,
  internalError: 10
} as const;

export type GlyphrailError = {
  code: string;
  message: string;
  stepId?: string;
  runId?: string;
  details?: unknown;
  retryable?: boolean;
};

export class GlyphrailFailure extends Error {
  readonly glyphrailError: GlyphrailError;
  readonly exitCode: number;

  constructor(glyphrailError: GlyphrailError, exitCode: number) {
    super(glyphrailError.message);
    this.name = "GlyphrailFailure";
    this.glyphrailError = glyphrailError;
    this.exitCode = exitCode;
  }
}

export function createFailure(
  code: string,
  message: string,
  exitCode: number,
  details?: unknown
): GlyphrailFailure {
  return new GlyphrailFailure(
    {
      code,
      message,
      details
    },
    exitCode
  );
}

export function normalizeError(error: unknown): GlyphrailFailure {
  if (error instanceof GlyphrailFailure) {
    return error;
  }

  if (error instanceof Error) {
    return createFailure("INTERNAL_ERROR", error.message, EXIT_CODES.internalError);
  }

  return createFailure("INTERNAL_ERROR", "Unknown internal error", EXIT_CODES.internalError, error);
}

export function exitCodeForErrorCode(code: string): number {
  if (code === "CLI_USAGE_ERROR") {
    return EXIT_CODES.invalidCliUsage;
  }

  if (code === "WORKFLOW_PARSE_ERROR" || code === "WORKFLOW_VALIDATION_ERROR") {
    return EXIT_CODES.workflowValidationFailure;
  }

  if (code === "INPUT_VALIDATION_ERROR") {
    return EXIT_CODES.inputValidationFailure;
  }

  if (
    code === "EXPRESSION_EVALUATION_ERROR" ||
    code === "TOOL_INPUT_VALIDATION_ERROR" ||
    code === "TOOL_RUNTIME_ERROR" ||
    code === "TOOL_OUTPUT_VALIDATION_ERROR" ||
    code === "AGENT_OUTPUT_PARSE_ERROR" ||
    code === "AGENT_OUTPUT_VALIDATION_ERROR" ||
    code === "TIMEOUT" ||
    code === "BUDGET_EXHAUSTION" ||
    code === "CHECKPOINT_RESUME_ERROR"
  ) {
    return EXIT_CODES.executionFailure;
  }

  if (code === "POLICY_VIOLATION") {
    return EXIT_CODES.policyViolation;
  }

  if (code === "NOT_FOUND") {
    return EXIT_CODES.notFound;
  }

  if (code === "INTERNAL_ERROR") {
    return EXIT_CODES.internalError;
  }

  return EXIT_CODES.genericFailure;
}
