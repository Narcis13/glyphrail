import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { bash, defineTools, fetch, fileEdit, fileRead, fileWrite, type Tool } from "glyphrail";
import { formatHandle } from "./tools/format-handle";

const makeGreeting: Tool<{ name: string }, string> = {
  name: "makeGreeting",
  description: "Create a greeting.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string" }
    },
    required: ["name"],
    additionalProperties: false
  },
  outputSchema: {
    type: "string"
  },
  sideEffect: "none",
  async execute(input) {
    return {
      ok: true,
      output: `Hello, ${input.name}!`
    };
  }
};

const selectVendor: Tool<{ goal: string }, { vendor: string }> = {
  name: "selectVendor",
  description: "Pick a vendor.",
  inputSchema: {
    type: "object",
    properties: {
      goal: { type: "string" }
    },
    required: ["goal"],
    additionalProperties: false
  },
  outputSchema: {
    type: "object",
    properties: {
      vendor: { type: "string" }
    },
    required: ["vendor"],
    additionalProperties: false
  },
  sideEffect: "none",
  async execute() {
    return {
      ok: true,
      output: {
        vendor: "demo-vendor"
      }
    };
  }
};

const alwaysFails: Tool<{ reason?: string }, never> = {
  name: "alwaysFails",
  description: "Throw an error during execution.",
  inputSchema: {
    type: "object",
    properties: {
      reason: { type: "string" }
    },
    additionalProperties: false
  },
  sideEffect: "none",
  async execute(input) {
    throw new Error(input.reason ?? "boom");
  }
};

const failOnceGreeting: Tool<{ name: string; failMessage?: string }, string> = {
  name: "failOnceGreeting",
  description: "Fail once per run/step, then return a greeting on retry.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
      failMessage: { type: "string" }
    },
    required: ["name"],
    additionalProperties: false
  },
  outputSchema: {
    type: "string"
  },
  sideEffect: "none",
  tags: ["compute", "file"],
  async execute(input, context) {
    const markerPath = resolve(
      context.cwd,
      ".glyphrail/runtime",
      `fail-once-${context.runId ?? "manual"}-${context.stepId ?? "tool"}.marker`
    );

    try {
      await access(markerPath);
    } catch {
      await mkdir(dirname(markerPath), { recursive: true });
      await writeFile(markerPath, "failed-once\n", "utf8");
      throw new Error(input.failMessage ?? `Transient failure for ${input.name}`);
    }

    return {
      ok: true,
      output: `Hello, ${input.name}!`
    };
  }
};

const sendWebhook: Tool<{ url: string }, { queued: boolean }> = {
  name: "sendWebhook",
  description: "Simulate an external write operation.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string" }
    },
    required: ["url"],
    additionalProperties: false
  },
  outputSchema: {
    type: "object",
    properties: {
      queued: { type: "boolean" }
    },
    required: ["queued"],
    additionalProperties: false
  },
  sideEffect: "external",
  tags: ["http", "unsafe"],
  async execute() {
    return {
      ok: true,
      output: {
        queued: true
      }
    };
  }
};

const interruptOnce: Tool<Record<string, never>, { resumed: boolean }> = {
  name: "interruptOnce",
  description: "Exit the process the first time it runs, then succeed on resume.",
  inputSchema: {
    type: "object",
    additionalProperties: false
  },
  outputSchema: {
    type: "object",
    properties: {
      resumed: { type: "boolean" }
    },
    required: ["resumed"],
    additionalProperties: false
  },
  sideEffect: "none",
  tags: ["file", "unsafe"],
  async execute(_input, context) {
    const markerPath = resolve(context.cwd, ".glyphrail/runtime/interrupt-once.marker");

    try {
      await access(markerPath);
      return {
        ok: true,
        output: {
          resumed: true
        }
      };
    } catch {
      await mkdir(dirname(markerPath), { recursive: true });
      await writeFile(markerPath, "interrupted\n", "utf8");
      process.exit(86);
    }
  }
};

export default defineTools([
  makeGreeting,
  selectVendor,
  fileRead,
  fileWrite,
  fileEdit,
  bash,
  fetch,
  formatHandle,
  alwaysFails,
  failOnceGreeting,
  sendWebhook,
  interruptOnce
]);
