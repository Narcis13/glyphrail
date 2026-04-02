import type { GlyphrailFailure } from "../core/errors";
import { stringifyJson } from "../util/json";
import { VERSION } from "../version";
import type { CommandDefinition } from "./types";

const GLOBAL_OPTIONS = [
  "--cwd <path>",
  "--config <path>",
  "--json",
  "--quiet",
  "--verbose",
  "--color <auto|always|never>",
  "--no-color",
  "--trace",
  "--profile",
  "--help",
  "--version"
];

export function formatJsonSuccess(payload: Record<string, unknown>): string {
  return `${stringifyJson({ ok: true, ...payload })}\n`;
}

export function formatJsonError(error: GlyphrailFailure): string {
  return `${stringifyJson({ ok: false, error: error.glyphrailError })}\n`;
}

export function renderRootHelp(commands: CommandDefinition[]): string {
  const commandLines = [...commands]
    .sort((left, right) => left.path.join(" ").localeCompare(right.path.join(" ")))
    .map((command) => `  ${command.path.join(" ").padEnd(18)} ${command.summary}`);

  const globalOptionLines = GLOBAL_OPTIONS.map((option) => `  ${option}`);

  return [
    `glyphrail ${VERSION}`,
    "",
    "Usage:",
    "  glyphrail <command> [options]",
    "",
    "Commands:",
    ...commandLines,
    "",
    "Global options:",
    ...globalOptionLines
  ].join("\n");
}

export function renderCommandHelp(command: CommandDefinition): string {
  const optionLines = (command.options ?? []).map((option) => {
    const suffix = option.type === "string" ? ` <${option.valueLabel ?? "value"}>` : "";
    return `  --${option.name}${suffix}`.padEnd(24) + option.description;
  });

  const helpLines = [
    `glyphrail ${command.path.join(" ")}`,
    "",
    command.description ?? command.summary,
    "",
    "Usage:",
    `  ${command.usage}`
  ];

  if (optionLines.length > 0) {
    helpLines.push("", "Options:", ...optionLines);
  }

  helpLines.push("", "Built-in options:", "  --help".padEnd(24) + "Show this command help.");

  if (command.examples && command.examples.length > 0) {
    helpLines.push("", "Examples:", ...command.examples.map((example) => `  ${example}`));
  }

  return helpLines.join("\n");
}

export function renderHumanError(error: GlyphrailFailure): string {
  const details =
    error.glyphrailError.details === undefined
      ? ""
      : `\nDetails: ${stringifyJson(error.glyphrailError.details)}`;

  return `${error.glyphrailError.code}: ${error.glyphrailError.message}${details}\n`;
}
