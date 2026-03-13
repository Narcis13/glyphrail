import { listRunRecords } from "../../core/run-store";
import type { CommandDefinition } from "../types";

export const runsListCommand: CommandDefinition = {
  path: ["runs", "list"],
  summary: "List persisted workflow runs for the current project.",
  description: "Enumerate stored run metadata to support operator inspection and resume discovery.",
  usage: "glyphrail runs list [--json]",
  examples: ["glyphrail runs list", "glyphrail runs list --json"],
  async handler(context) {
    const project = await context.getProjectConfig();
    const runs = await listRunRecords(project);

    return {
      data: {
        command: "runs.list",
        count: runs.length,
        runs: runs.map((run) => ({
          runId: run.runId,
          status: run.status,
          workflow: run.workflow,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          currentStepId: run.currentStepId,
          resumable: run.status === "paused"
        }))
      },
      human:
        runs.length === 0
          ? "No persisted runs were found."
          : runs
              .map((run) =>
                [
                  run.runId,
                  run.status,
                  run.workflow.name,
                  run.currentStepId ? `next=${run.currentStepId}` : undefined
                ]
                  .filter((part): part is string => Boolean(part))
                  .join(" ")
              )
              .join("\n")
    };
  }
};
