import { expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeWorkflowDocument } from "../../src/dsl/normalization";
import { validateWorkflowDocument } from "../../src/dsl/validation";
import { readYamlFile } from "../../src/util/yaml";
import { discoverDeclaredTools } from "../../src/tools/registry";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const fixtureProjectRoot = join(repoRoot, "test/fixtures/workflow-project");

test("tool discovery finds inline tool declarations in glyphrail.tools.ts", async () => {
  const preview = await discoverDeclaredTools(join(fixtureProjectRoot, "glyphrail.tools.ts"));

  expect(preview.toolNames).toEqual([
    "alwaysFails",
    "formatHandle",
    "interruptOnce",
    "makeGreeting",
    "selectVendor",
    "sendWebhook"
  ]);
  expect(preview.unresolvedIdentifiers).toEqual([]);
});

test("validation reports missing maxIterations, duplicate ids, and undeclared tool errors", async () => {
  const rawWorkflow = await readYamlFile<unknown>(join(fixtureProjectRoot, "workflows/invalid.gr.yaml"));
  const result = await validateWorkflowDocument(rawWorkflow, {
    toolsEntryPath: join(fixtureProjectRoot, "glyphrail.tools.ts")
  });

  expect(result.workflow).toBeUndefined();
  expect(result.errors.map((error) => error.code)).toContain("MISSING_MAX_ITERATIONS");
  expect(result.errors.map((error) => error.code)).toContain("INVALID_WRITE_DIRECTIVE");
});

test("validation rejects unsupported agent modes and invalid reduced onError policies", async () => {
  const result = await validateWorkflowDocument(
    {
      version: "1.0",
      name: "invalid-agent-policy",
      steps: [
        {
          id: "analyze",
          kind: "agent",
          mode: "tool-use",
          objective: "demo",
          onError: {
            strategy: "goto",
            goto: "missing_step",
            set: {
              ignored: true
            }
          }
        }
      ]
    },
    {
      toolsEntryPath: join(fixtureProjectRoot, "glyphrail.tools.ts")
    }
  );

  expect(result.errors.map((error) => error.code)).toContain("UNSUPPORTED_AGENT_MODE");
  expect(result.errors.map((error) => error.code)).toContain("INVALID_FIELD");
});

test("normalization keeps a single JSON-compatible workflow shape", async () => {
  const rawWorkflow = await readYamlFile<Record<string, unknown>>(
    join(fixtureProjectRoot, "workflows/linear.gr.yaml")
  );
  const normalized = normalizeWorkflowDocument(rawWorkflow);

  expect(normalized.name).toBe("linear-demo");
  expect(normalized.steps[0].kind).toBe("assign");
  expect(normalized.steps[0].kind === "assign" ? normalized.steps[0].set.name : undefined).toBe(
    "${input.name}"
  );
});
