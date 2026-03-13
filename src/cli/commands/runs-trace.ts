import type { TraceEvent } from "../../core/events";
import type { CommandDefinition } from "../types";
import { loadPersistedRun, readRunTrace } from "./run-shared";

export const runsTraceCommand: CommandDefinition = {
  path: ["runs", "trace"],
  summary: "Inspect the append-only trace for a run.",
  description: "Read trace.jsonl for a stored run and optionally filter by event type or step ID.",
  usage: "glyphrail runs trace <run-id> [--event <type>] [--step <step-id>] [--follow] [--json]",
  options: [
    {
      name: "event",
      type: "string",
      multiple: true,
      description: "Filter the trace to specific event types.",
      valueLabel: "type"
    },
    {
      name: "step",
      type: "string",
      description: "Filter the trace to a single step ID.",
      valueLabel: "step-id"
    },
    {
      name: "follow",
      type: "boolean",
      description: "Reserved for future streaming; Slice 3 reads the current trace file once."
    }
  ],
  examples: [
    "glyphrail runs trace 20260313_abcdef12",
    "glyphrail runs trace 20260313_abcdef12 --event step.failed --json"
  ],
  async handler(context, args) {
    const { runId, paths } = await loadPersistedRun(context, args, "runs trace");
    const events = await readRunTrace(paths);
    const filteredEvents = filterTraceEvents(
      events,
      (args.flags.event as string[] | undefined) ?? [],
      args.flags.step as string | undefined
    );

    return {
      data: {
        command: "runs.trace",
        runId,
        eventCount: filteredEvents.length,
        events: filteredEvents
      },
      human:
        filteredEvents.length === 0
          ? `No trace events matched for run ${runId}.`
          : filteredEvents.map(formatTraceEvent).join("\n")
    };
  }
};

function filterTraceEvents(
  events: TraceEvent[],
  eventFilters: string[],
  stepFilter?: string
): TraceEvent[] {
  const eventFilterSet = new Set(eventFilters);

  return events.filter((event) => {
    if (eventFilterSet.size > 0 && !eventFilterSet.has(event.event)) {
      return false;
    }

    if (stepFilter && event.stepId !== stepFilter) {
      return false;
    }

    return true;
  });
}

function formatTraceEvent(event: TraceEvent): string {
  const parts = [
    event.ts,
    event.event,
    event.stepId ? `[${event.stepId}]` : undefined,
    event.status ? `status=${event.status}` : undefined,
    event.durationMs !== undefined ? `durationMs=${event.durationMs}` : undefined
  ];

  return parts.filter((part): part is string => Boolean(part)).join(" ");
}
