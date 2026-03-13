import { capabilitiesCommand } from "./capabilities";
import { initCommand } from "./init";
import { runCommand } from "./run";
import { runsOutputCommand } from "./runs-output";
import { runsShowCommand } from "./runs-show";
import { runsStateCommand } from "./runs-state";
import { runsTraceCommand } from "./runs-trace";
import { schemaCommand } from "./schema";
import { workflowCreateCommand } from "./workflow-create";
import { workflowExplainCommand } from "./workflow-explain";
import { workflowLintCommand } from "./workflow-lint";
import { workflowValidateCommand } from "./workflow-validate";

import type { CommandDefinition } from "../types";

export const COMMANDS: CommandDefinition[] = [
  capabilitiesCommand,
  schemaCommand,
  initCommand,
  runCommand,
  runsShowCommand,
  runsTraceCommand,
  runsStateCommand,
  runsOutputCommand,
  workflowCreateCommand,
  workflowValidateCommand,
  workflowExplainCommand,
  workflowLintCommand
];
