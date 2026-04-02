import { stringifyJson } from "../../util/json";
import type { CommandDefinition } from "../types";
import { loadPersistedRun, readRunState } from "./run-shared";

export const runsStateCommand: CommandDefinition = {
  path: ["runs", "state"],
  summary: "Show the latest persisted state for a run.",
  description: "Read state.latest.json for a stored run.",
  usage: "glyphrail runs state <run-id> [--json]",
  examples: ["glyphrail runs state 20260313_abcdef12", "glyphrail runs state 20260313_abcdef12 --json"],
  async handler(context, args) {
    const { runId, paths } = await loadPersistedRun(context, args, "runs state");
    const state = await readRunState(paths);

    return {
      data: {
        command: "runs.state",
        runId,
        state
      },
      human: stringifyJson(state)
    };
  }
};
