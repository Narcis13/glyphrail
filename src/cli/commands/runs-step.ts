import { stringifyJson } from "../../util/json";
import { createFailure, EXIT_CODES } from "../../core/errors";
import type { TraceEvent } from "../../core/events";
import type { CommandDefinition } from "../types";
import { loadPersistedRunById, readRunTrace } from "./run-shared";

export const runsStepCommand: CommandDefinition = {
  path: ["runs", "step"],
  summary: "Inspect trace events for a single persisted step.",
  description: "Filter a run trace to one step ID and summarize attempts, status, agent/tool calls, and the last event.",
  usage: "glyphrail runs step <run-id> <step-id> [--json]",
  examples: [
    "glyphrail runs step 20260313_abcdef12 shortlist",
    "glyphrail runs step run_20260313_abcdef12 shortlist --json"
  ],
  async handler(context, args) {
    if (args.positionals.length !== 2) {
      throw createFailure(
        "CLI_USAGE_ERROR",
        "runs step requires exactly a run ID and step ID.",
        EXIT_CODES.invalidCliUsage
      );
    }

    const [rawRunId, stepId] = args.positionals;
    const { runId, meta, paths } = await loadPersistedRunById(context, rawRunId);
    const events = await readRunTrace(paths);
    const stepEvents = events.filter((event) => event.stepId === stepId);

    if (stepEvents.length === 0) {
      throw createFailure(
        "NOT_FOUND",
        `Step '${stepId}' was not found in run '${runId}'.`,
        EXIT_CODES.notFound
      );
    }

    const summary = summarizeStepEvents(stepEvents, meta.retryCounters?.[stepId] ?? 0);

    return {
      data: {
        command: "runs.step",
        runId,
        stepId,
        workflow: meta.workflow,
        summary,
        events: stepEvents
      },
      human: [
        `Run: ${runId}`,
        `Step: ${stepId}`,
        `Kind: ${summary.kind ?? "unknown"}`,
        `Status: ${summary.status ?? "unknown"}`,
        `Attempts: ${summary.attempts}`,
        `Retries: ${summary.retries}`,
        `Last event: ${summary.lastEvent?.event ?? "unknown"}${summary.lastEvent?.ts ? ` @ ${summary.lastEvent.ts}` : ""}`,
        `Calls: tools=${summary.toolCalls}, agents=${summary.agentCalls}`,
        summary.lastError ? `Error: ${summary.lastError.code} ${summary.lastError.message}` : undefined,
        "",
        stringifyJson(stepEvents)
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n")
    };
  }
};

function summarizeStepEvents(events: TraceEvent[], retries: number) {
  const stepEvents = events.filter((event) => event.event.startsWith("step."));
  const terminalEvent = [...stepEvents]
    .reverse()
    .find((event) => event.event === "step.completed" || event.event === "step.failed" || event.event === "step.skipped");
  const lastAgentFailure = [...events]
    .reverse()
    .find((event) => event.event === "agent.failed");
  const lastStepFailure = [...events]
    .reverse()
    .find((event) => event.event === "step.failed");

  return {
    kind: events.find((event) => event.kind)?.kind,
    status: terminalEvent?.status ?? stepEvents.at(-1)?.status ?? null,
    attempts: stepEvents.filter((event) => event.event === "step.started").length,
    retries,
    toolCalls: events.filter((event) => event.event === "tool.called").length,
    agentCalls: events.filter((event) => event.event === "agent.called").length,
    lastEvent: events.at(-1) ?? null,
    lastError: extractError(lastAgentFailure ?? lastStepFailure)
  };
}

function extractError(event: TraceEvent | undefined): { code: string; message: string } | null {
  const error = event?.meta?.error;
  if (!error || typeof error !== "object" || Array.isArray(error)) {
    return null;
  }

  const candidate = error as Record<string, unknown>;
  if (typeof candidate.code !== "string" || typeof candidate.message !== "string") {
    return null;
  }

  return {
    code: candidate.code,
    message: candidate.message
  };
}
