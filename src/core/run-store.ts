import { appendFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import type { ResolvedProjectConfig } from "../config";
import { relativePath, readTextFile, writeTextFile } from "../util/fs";
import { readJsonFile, writeJsonFile } from "../util/json";
import type { TraceEvent } from "./events";
import type { JsonObject, JsonValue } from "./json-schema";
import type { RunArtifactPaths, RunRecord } from "./run-record";

export interface RunPaths extends RunArtifactPaths {
  runDir: string;
}

export interface RunCheckpoint {
  runId: string;
  checkpoint: number;
  ts: string;
  currentStepId?: string;
  state: JsonObject;
  context: JsonObject;
  system: JsonObject;
  counters: RunRecord["counters"];
}

export function getRunPaths(project: ResolvedProjectConfig, runId: string): RunPaths {
  const normalizedRunId = normalizeRunId(runId);
  const runDir = resolve(project.projectRoot, project.config.runsDir, `run_${normalizedRunId}`);

  return {
    runDir,
    meta: resolve(runDir, "meta.json"),
    input: resolve(runDir, "input.json"),
    state: resolve(runDir, "state.latest.json"),
    output: resolve(runDir, "output.json"),
    trace: resolve(runDir, "trace.jsonl"),
    checkpointsDir: resolve(runDir, "checkpoints")
  };
}

export async function initializeRunArtifacts(
  paths: RunPaths,
  input: JsonValue,
  state: JsonObject
): Promise<void> {
  await mkdir(paths.checkpointsDir, { recursive: true });
  await writeJsonFile(paths.input, input);
  await writeJsonFile(paths.state, state);
  await writeTextFile(paths.trace, "");
}

export async function writeRunMeta(paths: RunPaths, meta: RunRecord): Promise<void> {
  await writeJsonFile(paths.meta, meta);
}

export async function writeRunState(paths: RunPaths, state: JsonObject): Promise<void> {
  await writeJsonFile(paths.state, state);
}

export async function writeRunOutput(paths: RunPaths, output: JsonValue): Promise<void> {
  await writeJsonFile(paths.output, output);
}

export async function appendTraceEvent(paths: RunPaths, event: TraceEvent): Promise<void> {
  await appendFile(paths.trace, `${JSON.stringify(event)}\n`, "utf8");
}

export async function saveCheckpoint(paths: RunPaths, snapshot: RunCheckpoint): Promise<string> {
  const filePath = resolve(paths.checkpointsDir, `checkpoint_${String(snapshot.checkpoint).padStart(4, "0")}.json`);
  await writeJsonFile(filePath, snapshot);
  return filePath;
}

export async function readRunMeta(paths: RunPaths): Promise<RunRecord> {
  return readJsonFile<RunRecord>(paths.meta, "NOT_FOUND");
}

export async function readRunState(paths: RunPaths): Promise<JsonObject> {
  return readJsonFile<JsonObject>(paths.state, "NOT_FOUND");
}

export async function readRunOutput(paths: RunPaths): Promise<JsonValue | undefined> {
  try {
    return await readJsonFile<JsonValue>(paths.output, "NOT_FOUND");
  } catch {
    return undefined;
  }
}

export async function readRunTrace(paths: RunPaths): Promise<TraceEvent[]> {
  const content = await readTextFile(paths.trace);
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TraceEvent);
}

export function toArtifactPaths(paths: RunPaths, project: ResolvedProjectConfig): RunArtifactPaths {
  return {
    meta: relativePath(project.projectRoot, paths.meta),
    input: relativePath(project.projectRoot, paths.input),
    state: relativePath(project.projectRoot, paths.state),
    output: relativePath(project.projectRoot, paths.output),
    trace: relativePath(project.projectRoot, paths.trace),
    checkpointsDir: relativePath(project.projectRoot, paths.checkpointsDir)
  };
}

export function normalizeRunId(runId: string): string {
  return runId.startsWith("run_") ? runId.slice("run_".length) : runId;
}
