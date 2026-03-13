import { stringifyJson } from "../../util/json";
import type { CommandDefinition } from "../types";
import { loadPersistedRun, readRunOutput } from "./run-shared";

export const runsOutputCommand: CommandDefinition = {
  path: ["runs", "output"],
  summary: "Show the persisted output for a run.",
  description: "Read output.json for a stored run. If no output file exists, fall back to meta.output.",
  usage: "glyphrail runs output <run-id> [--json]",
  examples: ["glyphrail runs output 20260313_abcdef12", "glyphrail runs output 20260313_abcdef12 --json"],
  async handler(context, args) {
    const { runId, paths, meta } = await loadPersistedRun(context, args, "runs output");
    const output = (await readRunOutput(paths)) ?? meta.output ?? null;

    return {
      data: {
        command: "runs.output",
        runId,
        output
      },
      human: stringifyJson(output)
    };
  }
};
