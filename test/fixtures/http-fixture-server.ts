import { createServer, type IncomingMessage } from "node:http";

const port = Number(Bun.argv[2] ?? "0");

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const bodyText = await readRequestBody(request);
  const contentType = request.headers["content-type"] ?? "";
  let body: unknown = bodyText;

  if (typeof contentType === "string" && contentType.includes("application/json") && bodyText.length > 0) {
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = bodyText;
    }
  }

  if (url.pathname === "/invalid-json") {
    response.writeHead(200, {
      "content-type": "application/json"
    });
    response.end("{invalid-json");
    return;
  }

  if (url.pathname === "/text") {
    response.writeHead(200, {
      "content-type": "text/plain"
    });
    response.end("glyphrail-fetch-text");
    return;
  }

  response.writeHead(200, {
    "content-type": "application/json"
  });
  response.end(JSON.stringify({
    method: request.method ?? "GET",
    query: Object.fromEntries(url.searchParams.entries()),
    body
  }));
});

server.listen(port, "127.0.0.1", () => {
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  console.log(`ready ${actualPort}`);
});

process.on("SIGTERM", () => {
  server.close(() => {
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  server.close(() => {
    process.exit(0);
  });
});

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    request.on("data", (chunk: Buffer | string) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
    });
    request.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", reject);
  });
}
