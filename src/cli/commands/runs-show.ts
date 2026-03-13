import type { CommandDefinition } from "../types";
import { loadPersistedRun } from "./run-shared";

export const runsShowCommand: CommandDefinition = {
  path: ["runs", "show"],
  summary: "Show persisted metadata for a workflow run.",
  description: "Read meta.json for a stored run and summarize workflow, status, counters, and artifact paths.",
  usage: "glyphrail runs show <run-id> [--json]",
  examples: ["glyphrail runs show 20260313_abcdef12", "glyphrail runs show run_20260313_abcdef12 --json"],
  async handler(context, args) {
    const { runId, meta } = await loadPersistedRun(context, args, "runs show");

    return {
      data: {
        command: "runs.show",
        runId,
        meta
      },
      human: [
        `Run: ${runId}`,
        `Status: ${meta.status}`,
        `Workflow: ${meta.workflow.name} (${meta.workflow.version})`,
        `Started: ${meta.startedAt}`,
        meta.completedAt ? `Completed: ${meta.completedAt}` : undefined,
        meta.currentStepId ? `Current step: ${meta.currentStepId}` : undefined,
        meta.counters
          ? `Counters: completed=${meta.counters.completedSteps}, failed=${meta.counters.failedSteps}, loops=${meta.counters.loopIterations}, checkpoints=${meta.counters.checkpoints}`
          : undefined,
        meta.artifactPaths ? `Artifacts: ${Object.values(meta.artifactPaths).join(", ")}` : undefined
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n")
    };
  }
};
