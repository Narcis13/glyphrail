export type OutputMode = "pretty" | "json" | "jsonl";

export interface GlyphrailPoliciesConfig {
  maxRunSteps: number;
  maxRunDurationMs: number;
  allowExternalSideEffects: boolean;
}

export interface GlyphrailConfig {
  schemaVersion: string;
  workflowsDir: string;
  runsDir: string;
  toolsEntry: string;
  defaultOutputMode: OutputMode;
  defaultCheckpointEveryStep: boolean;
  policies: GlyphrailPoliciesConfig;
}

export const DEFAULT_CONFIG: GlyphrailConfig = {
  schemaVersion: "0.1.0",
  workflowsDir: "./workflows",
  runsDir: "./.glyphrail/runs",
  toolsEntry: "./glyphrail.tools.ts",
  defaultOutputMode: "pretty",
  defaultCheckpointEveryStep: true,
  policies: {
    maxRunSteps: 100,
    maxRunDurationMs: 300000,
    allowExternalSideEffects: false
  }
};
