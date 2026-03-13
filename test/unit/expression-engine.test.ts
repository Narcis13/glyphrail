import { expect, test } from "bun:test";

import {
  collectExpressionReferences,
  evaluateExpression,
  parseExpression
} from "../../src/core/expression-engine";

test("expression engine evaluates arithmetic, boolean logic, and path access", () => {
  const result = evaluateExpression("${(state.count + 3) * 2 == 10 && !state.done}", {
    state: {
      count: 2,
      done: false
    }
  });

  expect(result).toBe(true);
});

test("expression engine supports string concatenation and array length", () => {
  const ast = parseExpression('${"Hello, " + state.name + " (" + state.items.length + ")"}');
  const result = evaluateExpression(ast, {
    state: {
      name: "Glyphrail",
      items: [1, 2, 3]
    }
  });

  expect(result).toBe("Hello, Glyphrail (3)");
  expect(collectExpressionReferences(ast).map((reference) => reference.path)).toEqual([
    "state.name",
    "state.items.length"
  ]);
});

test("expression engine rejects unsupported function calls", () => {
  expect(() => parseExpression("${state.name.toUpperCase()}")).toThrow();
});
