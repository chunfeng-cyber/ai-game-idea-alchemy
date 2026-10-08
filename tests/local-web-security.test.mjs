import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { request, createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startLocalWeb } from "../worker/local-web.mjs";
import { startMcpGateway } from "../worker/mcp-gateway.mjs";
import { MAX_MCP_BODY_BYTES } from "../worker/web-boundary.mjs";

function call(port, path = "/", { method = "GET", headers = {}, body, chunked = false } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const req = request({ hostname: "127.0.0.1", port, path, method, headers }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.once("error", rejectPromise);
      response.once("end", () => resolvePromise({ status: response.statusCode, headers: response.headers, bytes: Buffer.concat(chunks) }));
    });
    req.once("error", rejectPromise);
    if (chunked && body) { for (let offset = 0; offset < body.length; offset += 4096) req.write(body.subarray(offset, offset + 4096)); req.end(); }
    else req.end(body);
  });
}
async function close(server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }

test("Node web serves only safe public root assets and rejects hostile hosts, paths and methods", { timeout: 15000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), "alchemy-public-boundary-"));
  const publicDirectory = join(directory, "public");
  await mkdir(publicDirectory);
  await writeFile(join(publicDirectory, "allowed.css"), "body{color:red}");
  await writeFile(join(publicDirectory, "private.json"), "private-runtime");
  await writeFile(join(directory, "outside.css"), "private-outside");
  const { server, port } = await startLocalWeb({ host: "127.0.0.1", port: 0, publicDirectory, generatedDir: join(directory, "generated"), silent: true });
  t.after(async () => { await close(server); assert.ok(directory.startsWith(join(tmpdir(), "alchemy-public-boundary-"))); await rm(directory, { recursive: true, force: true }); });
  const response = await call(port, "/allowed.css");
  assert.equal(response.status, 200);
  assert.match(response.headers["content-type"], /^text\/css/);
  assert.equal(response.bytes.toString(), "body{color:red}");
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  const home = await call(port, "/");
  assert.equal(home.headers["content-security-policy"], "frame-ancestors 'self'");
  assert.equal(home.headers["x-frame-options"], "SAMEORIGIN");
  assert.equal((await call(port, "/allowed.css")).headers["x-frame-options"], "SAMEORIGIN");
  const head = await call(port, "/allowed.css", { method: "HEAD" });
  assert.equal(head.status, 200); assert.equal(head.bytes.length, 0); assert.equal(head.headers["content-length"], response.headers["content-length"]);
  for (const path of ["/alchemy", "/alchemy/"]) assert.equal((await call(port, path)).status, 200);
  for (const path of ["/.env.local", "/private.json", "/../outside.css", "/%2e%2e/outside.css", "/%2e%2e%5coutside.css", "/%2Foutside.css", "/%00.css", "/%ZZ.css", "//evil.example/allowed.css", "/nested/allowed.css", "/.alchemy-runtime/provider-settings.json"]) {
    assert.equal((await call(port, path)).status, 404, path);
  }
  assert.equal((await call(port, "/", { headers: { host: `evil.example:${port}` } })).status, 403);
  assert.equal((await call(port, "/", { headers: { host: `localhost:${port + 1}` } })).status, 403);
  assert.equal((await call(port, "/allowed.css", { method: "POST" })).status, 405);
  await t.test("symlinks cannot expose files outside the static directory", async child => {
    try { await symlink(join(directory, "outside.css"), join(publicDirectory, "outside.css")); }
    catch (error) { if (["EPERM", "EACCES", "ENOSYS"].includes(error.code)) { child.skip("OS does not permit symlink creation"); return; } throw error; }
    assert.equal((await call(port, "/outside.css")).status, 404);
  });
});

test("Node web rejects both announced and chunked oversized MCP requests before tool handling", { timeout: 15000 }, async t => {
  const { server, port } = await startLocalWeb({ host: "127.0.0.1", port: 0, silent: true });
  t.after(() => close(server));
  const oversized = Buffer.alloc(MAX_MCP_BODY_BYTES + 1, 32);
  assert.equal((await call(port, "/mcp", { method: "POST", headers: { "content-length": String(oversized.length) }, body: oversized })).status, 413);
  assert.equal((await call(port, "/mcp", { method: "POST", body: oversized, chunked: true })).status, 413);
  const valid = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }));
  const tools = await call(port, "/mcp", { method: "POST", headers: { accept: "application/json, text/event-stream", "content-type": "application/json" }, body: valid });
  assert.equal(tools.status, 200);
  assert.equal(JSON.parse(tools.bytes).result.tools.length, 2);
});

test("MCP gateway forwards only its endpoint and bounds request streams", { timeout: 15000 }, async t => {
  let upstreamCalls = 0;
  const upstream = createServer((req, res) => { upstreamCalls++; req.resume(); req.once("end", () => { res.writeHead(200, { "content-type": "application/json", "mcp-protocol-version": "2025-11-25" }); res.write('{"gateway":'); res.end('true}'); }); });
  await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
  const { server, port } = await startMcpGateway({ port: 0, upstream: `http://127.0.0.1:${upstream.address().port}/mcp`, silent: true });
  t.after(async () => { await close(server); await close(upstream); });
  assert.equal((await call(port, "/")).status, 404);
  assert.equal((await call(port, "/mcp", { method: "PUT" })).status, 405);
  assert.equal((await call(port, "/mcp", { headers: { host: `evil.example:${port}` } })).status, 403);
  const oversized = Buffer.alloc(MAX_MCP_BODY_BYTES + 1, 32);
  assert.equal((await call(port, "/mcp", { method: "POST", headers: { "content-length": String(oversized.length) }, body: oversized })).status, 413);
  assert.equal((await call(port, "/mcp", { method: "POST", body: oversized, chunked: true })).status, 413);
  assert.equal(upstreamCalls, 0, "rejected requests never reach the upstream");
  const response = await call(port, "/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(response.status, 200); assert.deepEqual(JSON.parse(response.bytes), { gateway: true });
  assert.equal(response.headers["mcp-protocol-version"], "2025-11-25");
  assert.equal(upstreamCalls, 1);
});
