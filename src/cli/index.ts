import { resolve } from "node:path";

import { loadProjectConfig } from "../config";
import { EXIT_CODES, normalizeError } from "../core/errors";
import { VERSION } from "../version";
import { COMMANDS } from "./commands";
import { formatJsonError, formatJsonSuccess, renderCommandHelp, renderHumanError, renderRootHelp } from "./formatter";
import { parseArgv } from "./parser";
import type { CommandContext } from "./types";

export async function runCli(argv = Bun.argv.slice(2)): Promise<number> {
  let jsonMode = false;

  try {
    const parsed = parseArgv(argv, COMMANDS);
    jsonMode = parsed.globalOptions.json;

    if (parsed.globalOptions.version) {
      writeStdout(
        jsonMode
          ? formatJsonSuccess({ name: "glyphrail", version: VERSION })
          : `${VERSION}\n`
      );
      return EXIT_CODES.success;
    }

    if (!parsed.command) {
      writeStdout(`${renderRootHelp(COMMANDS)}\n`);
      return EXIT_CODES.success;
    }

    if (parsed.globalOptions.help || parsed.commandArgs.flags.help === true) {
      writeStdout(`${renderCommandHelp(parsed.command)}\n`);
      return EXIT_CODES.success;
    }

    const cwd = resolve(parsed.globalOptions.cwd ?? process.cwd());
    let projectConfigPromise: ReturnType<typeof loadProjectConfig> | undefined;

    const context: CommandContext = {
      cwd,
      json: parsed.globalOptions.json,
      quiet: parsed.globalOptions.quiet,
      verbose: parsed.globalOptions.verbose,
      color: parsed.globalOptions.color,
      trace: parsed.globalOptions.trace,
      profile: parsed.globalOptions.profile,
      configPath: parsed.globalOptions.config,
      availableCommands: COMMANDS.map((command) => command.path.join(" ")),
      getProjectConfig: () => {
        if (!projectConfigPromise) {
          projectConfigPromise = loadProjectConfig({
            cwd,
            configPath: parsed.globalOptions.config
          });
        }

        return projectConfigPromise;
      }
    };

    const result = await parsed.command.handler(context, parsed.commandArgs);
    if (context.json) {
      writeStdout(formatJsonSuccess(result.data));
    } else if (!context.quiet && result.human) {
      writeStdout(`${result.human}\n`);
    }

    return EXIT_CODES.success;
  } catch (error) {
    const normalizedError = normalizeError(error);
    if (jsonMode) {
      writeStdout(formatJsonError(normalizedError));
    } else {
      writeStderr(renderHumanError(normalizedError));
    }
    return normalizedError.exitCode;
  }
}

function writeStdout(message: string): void {
  process.stdout.write(message);
}

function writeStderr(message: string): void {
  process.stderr.write(message);
}

if (import.meta.main) {
  const exitCode = await runCli(Bun.argv.slice(2));
  process.exit(exitCode);
}
