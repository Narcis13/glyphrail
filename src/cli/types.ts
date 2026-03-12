import type { ResolvedProjectConfig } from "../config";

export interface JsonSuccessEnvelope {
  ok: true;
  [key: string]: unknown;
}

export interface CommandResult {
  data: Record<string, unknown>;
  human?: string;
}

export interface CommandOption {
  name: string;
  type: "boolean" | "string";
  description: string;
  multiple?: boolean;
  valueLabel?: string;
}

export interface ParsedCommandArgs {
  flags: Record<string, unknown>;
  positionals: string[];
}

export interface GlobalOptions {
  cwd?: string;
  config?: string;
  json: boolean;
  quiet: boolean;
  verbose: boolean;
  color: "auto" | "always" | "never";
  trace: boolean;
  profile: boolean;
  help: boolean;
  version: boolean;
}

export interface CommandContext {
  cwd: string;
  json: boolean;
  quiet: boolean;
  verbose: boolean;
  color: "auto" | "always" | "never";
  trace: boolean;
  profile: boolean;
  configPath?: string;
  availableCommands: string[];
  getProjectConfig: () => Promise<ResolvedProjectConfig>;
}

export interface CommandDefinition {
  path: string[];
  summary: string;
  description?: string;
  usage: string;
  options?: CommandOption[];
  examples?: string[];
  handler: (context: CommandContext, args: ParsedCommandArgs) => Promise<CommandResult>;
}

export interface ParsedArgv {
  globalOptions: GlobalOptions;
  command?: CommandDefinition;
  commandArgs: ParsedCommandArgs;
}
