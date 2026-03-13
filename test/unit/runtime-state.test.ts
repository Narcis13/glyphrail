import { expect, test } from "bun:test";

import {
  appendStateValue,
  createRuntimeNamespaces,
  evaluateRuntimeValue,
  mergeStateValue,
  setStateValue
} from "../../src/core/runtime-state";
import type { WorkflowDocument } from "../../src/core/ast";

const workflow: WorkflowDocument = {
  version: "1.0",
  name: "runtime-state-test",
  state: {
    counter: 1,
    items: [],
    meta: {
      ok: false
    }
  },
  steps: []
};

test("runtime state applies set, append, and merge mutations deterministically", () => {
  const runtime = createRuntimeNamespaces(workflow, { name: "Ada" }, {
    runId: "run_test",
    workflowFile: "workflows/test.gr.yaml",
    startedAt: "2026-03-13T00:00:00.000Z"
  });

  setStateValue(runtime.state, "counter", 2);
  appendStateValue(runtime.state, "items", "a");
  appendStateValue(runtime.state, "items", "b");
  mergeStateValue(runtime.state, "meta", { ok: true, source: "test" });

  expect(runtime.state).toEqual({
    counter: 2,
    items: ["a", "b"],
    meta: {
      ok: true,
      source: "test"
    }
  });
});

test("runtime value evaluation resolves expressions recursively", () => {
  const runtime = createRuntimeNamespaces(workflow, { name: "Ada" }, {
    runId: "run_test",
    workflowFile: "workflows/test.gr.yaml",
    startedAt: "2026-03-13T00:00:00.000Z"
  });

  const value = evaluateRuntimeValue(
    {
      greeting: "${input.name}",
      nested: {
        count: "${state.counter + 1}"
      }
    },
    runtime,
    {}
  );

  expect(value).toEqual({
    greeting: "Ada",
    nested: {
      count: 2
    }
  });
});
