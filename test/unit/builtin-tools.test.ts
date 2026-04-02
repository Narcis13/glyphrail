import { expect, test } from "bun:test";

import { resolveSandboxedPath } from "../../src/tools/builtin-shared";
import { replaceExactText } from "../../src/tools/file-edit";
import { parseFetchResponseBody } from "../../src/tools/fetch";

test("resolveSandboxedPath keeps paths inside the project root and rejects escapes", () => {
  const projectRoot = "/tmp/glyphrail-project";

  expect(resolveSandboxedPath({ cwd: projectRoot, projectRoot }, "notes/demo.txt")).toBe(
    "/tmp/glyphrail-project/notes/demo.txt"
  );

  expect(() =>
    resolveSandboxedPath({ cwd: projectRoot, projectRoot }, "../outside.txt")
  ).toThrow("outside the project root");
});

test("replaceExactText supports first-match, occurrence-based, and replace-all edits", () => {
  expect(replaceExactText("alpha beta beta", "beta", "gamma")).toEqual({
    content: "alpha gamma beta",
    replacements: 1
  });

  expect(replaceExactText("alpha beta beta", "beta", "gamma", { occurrence: 2 })).toEqual({
    content: "alpha beta gamma",
    replacements: 1
  });

  expect(replaceExactText("alpha beta beta", "beta", "gamma", { replaceAll: true })).toEqual({
    content: "alpha gamma gamma",
    replacements: 2
  });
});

test("parseFetchResponseBody supports json, text, and base64 decoding", async () => {
  const jsonResponse = new Response(JSON.stringify({ ok: true }), {
    headers: {
      "content-type": "application/json"
    }
  });
  const textResponse = new Response("hello");
  const binaryResponse = new Response(Uint8Array.from([104, 105]));

  await expect(parseFetchResponseBody(jsonResponse, "json")).resolves.toEqual({ ok: true });
  await expect(parseFetchResponseBody(textResponse, "text")).resolves.toBe("hello");
  await expect(parseFetchResponseBody(binaryResponse, "base64")).resolves.toBe("aGk=");
});
