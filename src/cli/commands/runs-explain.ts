import type { TraceEvent } from "../../core/events";
import type { CommandDefinition } from "../types";
import { loadPersistedRun, readRunTrace } from "./run-shared";

interface StepExplanation {
  stepId: string;
  kind?: string;
  attempts: number;
  retries: number;
  status?: string;
  lastEvent?: string;
  toolCalls: number;
  agentCalls: number;
  lastError?: {
    code: string;
    message: string;
  };
}

export const runsExplainCommand: CommandDefinition = {
  path: ["runs", "explain"],
  summary: "Summarize a persisted run from its trace and metadata.",
  description: "Explain how a run progressed step by step, including retries, agent/tool calls, and the terminal failure if present.",
  usage: "glyphrail runs explain <run-id> [--json]",
  examples: ["glyphrail runs explain 20260313_abcdef12", "glyphrail runs explain run_20260313_abcdef12 --json"],
  async handler(context, args) {
    const { runId, meta, paths } = await loadPersistedRun(context, args, "runs explain");
    const events = await readRunTrace(paths);
    const steps = summarizeTrace(events, meta.retryCounters ?? {});
    const runFailure = [...events]
      .reverse()
      .find((event) => event.event === "run.failed");

    return {
      data: {
        command: "runs.explain",
        runId,
        workflow: meta.workflow,
        status: meta.status,
        counters: meta.counters,
        retryCounters: meta.retryCounters ?? {},
        failure: extractError(runFailure),
        steps
      },
      human: [
        `Run: ${runId}`,
        `Workflow: ${meta.workflow.name} (${meta.workflow.version})`,
        `Status: ${meta.status}`,
        meta.counters
          ? `Counters: completed=${meta.counters.completedSteps}, failed=${meta.counters.failedSteps}, retries=${meta.counters.retries}, loops=${meta.counters.loopIterations}`
          : undefined,
        runFailure ? formatRunFailure(runFailure) : undefined,
        "",
        ...steps.map((step) => formatStepExplanation(step))
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n")
    };
  }
};

function summarizeTrace(
  events: TraceEvent[],
  retryCounters: Record<string, number>
): StepExplanation[] {
  const steps = new Map<string, StepExplanation>();

  for (const event of events) {
    if (!event.stepId) {
      continue;
    }

    const entry = steps.get(event.stepId) ?? {
      stepId: event.stepId,
      kind: event.kind,
      attempts: 0,
      retries: retryCounters[event.stepId] ?? 0,
      toolCalls: 0,
      agentCalls: 0
    };

    if (!entry.kind && event.kind) {
      entry.kind = event.kind;
    }

    if (event.event === "step.started") {
      entry.attempts += 1;
    }

    if (event.event === "tool.called") {
      entry.toolCalls += 1;
    }

    if (event.event === "agent.called") {
      entry.agentCalls += 1;
    }

    if (event.event === "step.completed" || event.event === "step.failed" || event.event === "step.skipped") {
      entry.status = event.status;
      entry.lastEvent = event.event;
      const error = extractError(event);
      if (error) {
        entry.lastError = error;
      }
    }

    if (event.event === "agent.failed") {
      const error = extractError(event);
      if (error) {
        entry.lastError = error;
      }
      entry.lastEvent = event.event;
    }

    steps.set(event.stepId, entry);
  }

  return [...steps.values()];
}

function formatRunFailure(event: TraceEvent): string | undefined {
  const error = extractError(event);
  if (!error) {
    return undefined;
  }

  return `Failure: ${error.code} ${error.message}`;
}

function formatStepExplanation(step: StepExplanation): string {
  const parts = [
    `${step.stepId}`,
    step.kind ? `kind=${step.kind}` : undefined,
    step.status ? `status=${step.status}` : undefined,
    `attempts=${step.attempts}`,
    `retries=${step.retries}`,
    `tools=${step.toolCalls}`,
    `agents=${step.agentCalls}`,
    step.lastEvent ? `last=${step.lastEvent}` : undefined,
    step.lastError ? `error=${step.lastError.code}` : undefined
  ];

  return parts.filter((part): part is string => Boolean(part)).join(" ");
}

function extractError(event: TraceEvent | undefined): { code: string; message: string } | undefined {
  const error = event?.meta?.error;
  if (!error || typeof error !== "object" || Array.isArray(error)) {
    return undefined;
  }

  const candidate = error as Record<string, unknown>;
  if (typeof candidate.code !== "string" || typeof candidate.message !== "string") {
    return undefined;
  }

  return {
    code: candidate.code,
    message: candidate.message
  };
}
