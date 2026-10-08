import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mcpMethodAllowed, readLimitedBody, safeRequestTarget, sendHttpError, trustedLocalHost, writeWebResponse } from "./web-boundary.mjs";

const FORWARDED_HEADERS = ["accept", "content-type", "last-event-id", "mcp-protocol-version", "mcp-session-id"];

export async function startMcpGateway({ host = "127.0.0.1", port = 3001, upstream = "http://localhost:3000/mcp", silent = false } = {}) {
  const server = createServer((request, response) => {
    void (async () => {
      if (!trustedLocalHost(request.headers.host, server.address().port)) { request.resume(); sendHttpError(response, 403, "Untrusted Host"); return; }
      if (!safeRequestTarget(request.url) || request.url.split("?")[0] !== "/mcp") { request.resume(); sendHttpError(response, 404, "Only /mcp is available."); return; }
      const method = request.method || "GET";
      if (!mcpMethodAllowed(method)) { request.resume(); sendHttpError(response, 405, "Method not allowed", { allow: "GET, POST, DELETE, OPTIONS" }); return; }
      const headers = new Headers();
      for (const name of FORWARDED_HEADERS) if (typeof request.headers[name] === "string") headers.set(name, request.headers[name]);
      const body = method === "GET" ? undefined : await readLimitedBody(request);
      const controller = new AbortController();
      const onClose = () => { if (!response.writableFinished) controller.abort(); };
      response.once("close", onClose);
      try { await writeWebResponse(await fetch(upstream, { method, headers, body, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) }), response, method); }
      finally { response.removeListener("close", onClose); }
    })().catch(error => {
      if (response.headersSent) response.destroy();
      else sendHttpError(response, error.status || 502, error.status === 413 ? "Request body too large" : "MCP upstream unavailable");
    });
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  await new Promise((resolvePromise, rejectPromise) => { server.once("error", rejectPromise); server.listen(port, host, resolvePromise); });
  if (!silent) console.log(`MCP-only gateway listening on http://${host}:${server.address().port}/mcp`);
  return { server, port: server.address().port };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await startMcpGateway(); }
  catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
}
