import { capabilitiesCommand } from "./capabilities";
import { initCommand } from "./init";
import { schemaCommand } from "./schema";
import { workflowCreateCommand } from "./workflow-create";

import type { CommandDefinition } from "../types";

export const COMMANDS: CommandDefinition[] = [
  capabilitiesCommand,
  schemaCommand,
  initCommand,
  workflowCreateCommand
];
