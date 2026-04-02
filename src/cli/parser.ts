import { createFailure, EXIT_CODES } from "../core/errors";
import type { CommandDefinition, CommandOption, GlobalOptions, ParsedArgv, ParsedCommandArgs } from "./types";

const GLOBAL_STRING_OPTIONS = new Set(["cwd", "config", "color"]);
const GLOBAL_BOOLEAN_OPTIONS = new Set([
  "json",
  "quiet",
  "verbose",
  "trace",
  "profile",
  "help",
  "version",
  "no-color"
]);

export function parseArgv(argv: string[], commands: CommandDefinition[]): ParsedArgv {
  const { globalOptions, remainingTokens } = extractGlobalOptions(argv);
  const command = matchCommand(remainingTokens, commands);

  if (!command) {
    if (remainingTokens.length === 0) {
      return {
        globalOptions,
        commandArgs: { flags: {}, positionals: [] }
      };
    }

    throw createFailure(
      "CLI_USAGE_ERROR",
      `Unknown command: ${remainingTokens.slice(0, 2).join(" ")}`.trim(),
      EXIT_CODES.invalidCliUsage
    );
  }

  const commandArgs = parseCommandArgs(remainingTokens.slice(command.path.length), command.options ?? []);

  return {
    globalOptions,
    command,
    commandArgs
  };
}

function extractGlobalOptions(argv: string[]): {
  globalOptions: GlobalOptions;
  remainingTokens: string[];
} {
  const globalOptions: GlobalOptions = {
    json: false,
    quiet: false,
    verbose: false,
    color: "auto",
    trace: false,
    profile: false,
    help: false,
    version: false
  };
  const remainingTokens: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      remainingTokens.push(token);
      continue;
    }

    const { name, inlineValue } = splitOptionToken(token);

    if (GLOBAL_BOOLEAN_OPTIONS.has(name)) {
      if (name === "no-color") {
        globalOptions.color = "never";
      } else {
        globalOptions[nameToGlobalKey(name)] = true;
      }
      continue;
    }

    if (GLOBAL_STRING_OPTIONS.has(name)) {
      const value = inlineValue ?? argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw createFailure(
          "CLI_USAGE_ERROR",
          `Missing value for --${name}`,
          EXIT_CODES.invalidCliUsage
        );
      }

      index += inlineValue ? 0 : 1;

      if (name === "color") {
        if (value !== "auto" && value !== "always" && value !== "never") {
          throw createFailure(
            "CLI_USAGE_ERROR",
            `Invalid value for --color: ${value}`,
            EXIT_CODES.invalidCliUsage
          );
        }
        globalOptions.color = value;
      } else if (name === "cwd") {
        globalOptions.cwd = value;
      } else if (name === "config") {
        globalOptions.config = value;
      }

      continue;
    }

    remainingTokens.push(token);
  }

  return { globalOptions, remainingTokens };
}

function matchCommand(tokens: string[], commands: CommandDefinition[]): CommandDefinition | undefined {
  const sortedCommands = [...commands].sort((left, right) => right.path.length - left.path.length);

  return sortedCommands.find((command) =>
    command.path.every((segment, index) => tokens[index] === segment)
  );
}

export function parseCommandArgs(tokens: string[], options: CommandOption[]): ParsedCommandArgs {
  const parsed: ParsedCommandArgs = {
    flags: {},
    positionals: []
  };
  const optionMap = new Map<string, CommandOption>(options.map((option) => [option.name, option]));

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (!token.startsWith("--")) {
      parsed.positionals.push(token);
      continue;
    }

    const { name, inlineValue } = splitOptionToken(token);

    if (name === "help") {
      parsed.flags.help = true;
      continue;
    }

    const option = optionMap.get(name);
    if (!option) {
      throw createFailure(
        "CLI_USAGE_ERROR",
        `Unknown option: --${name}`,
        EXIT_CODES.invalidCliUsage
      );
    }

    if (option.type === "boolean") {
      parsed.flags[option.name] = inlineValue ? inlineValue !== "false" : true;
      continue;
    }

    const value = inlineValue ?? tokens[index + 1];
    if (!value || value.startsWith("--")) {
      throw createFailure(
        "CLI_USAGE_ERROR",
        `Missing value for --${name}`,
        EXIT_CODES.invalidCliUsage
      );
    }

    index += inlineValue ? 0 : 1;

    if (option.multiple) {
      const currentValues = (parsed.flags[option.name] as string[] | undefined) ?? [];
      parsed.flags[option.name] = [...currentValues, value];
    } else {
      parsed.flags[option.name] = value;
    }
  }

  return parsed;
}

function splitOptionToken(token: string): { name: string; inlineValue?: string } {
  const [rawName, inlineValue] = token.slice(2).split("=", 2);
  return {
    name: rawName,
    inlineValue
  };
}

function nameToGlobalKey(name: string): keyof GlobalOptions {
  if (name === "json") {
    return "json";
  }
  if (name === "quiet") {
    return "quiet";
  }
  if (name === "verbose") {
    return "verbose";
  }
  if (name === "trace") {
    return "trace";
  }
  if (name === "profile") {
    return "profile";
  }
  if (name === "help") {
    return "help";
  }
  return "version";
}
