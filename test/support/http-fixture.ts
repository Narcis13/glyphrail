import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const serverEntry = join(repoRoot, "test/fixtures/http-fixture-server.ts");

export async function startHttpFixtureServer(): Promise<{
  baseUrl: string;
  stop: () => Promise<void>;
}> {
  const process = Bun.spawn(["bun", serverEntry, "0"], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe"
  });

  const port = await waitForReady(process.stdout);

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async stop() {
      process.kill();
      await process.exited;
    }
  };
}

async function waitForReady(stream: ReadableStream<Uint8Array>): Promise<number> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let buffer = "";

  const timeout = setTimeout(() => {
    reader.cancel().catch(() => undefined);
  }, 5000);

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const match = line.match(/^ready\s+(\d+)$/);
        if (match) {
          return Number(match[1]);
        }
      }
    }
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }

  throw new Error("HTTP fixture server did not report a ready port.");
}
