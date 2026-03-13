import { capabilitiesCommand } from "./capabilities";
import { checkCommand } from "./check";
import { initCommand } from "./init";
import { runCommand } from "./run";
import { resumeCommand } from "./resume";
import { toolCallCommand } from "./tool-call";
import { toolListCommand } from "./tool-list";
import { toolScaffoldCommand } from "./tool-scaffold";
import { toolShowCommand } from "./tool-show";
import { toolValidateCommand } from "./tool-validate";
import { runsOutputCommand } from "./runs-output";
import { runsExplainCommand } from "./runs-explain";
import { runsListCommand } from "./runs-list";
import { runsShowCommand } from "./runs-show";
import { runsStepCommand } from "./runs-step";
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
  checkCommand,
  schemaCommand,
  initCommand,
  toolListCommand,
  toolShowCommand,
  toolCallCommand,
  toolValidateCommand,
  toolScaffoldCommand,
  runCommand,
  resumeCommand,
  runsExplainCommand,
  runsListCommand,
  runsShowCommand,
  runsStepCommand,
  runsTraceCommand,
  runsStateCommand,
  runsOutputCommand,
  workflowCreateCommand,
  workflowValidateCommand,
  workflowExplainCommand,
  workflowLintCommand
];
