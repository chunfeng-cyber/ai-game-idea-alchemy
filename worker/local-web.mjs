import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { serveGeneratedFile } from "./generated-files.mjs";
import { assertFixedPorts, assertPortAvailable, WEB_PORT } from "./local-launcher.mjs";
import { buildProject } from "./build.mjs";
import { safeRequestTarget, trustedLocalHost, readLimitedBody, sendHttpError, writeWebResponse } from "./web-boundary.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function startLocalWeb({ port = WEB_PORT, host = "localhost", outDir = resolve(ROOT, "dist"), publicDirectory, generatedDir = resolve(process.env.ALCHEMY_GENERATED_DIR || resolve(ROOT, "public", "generated")), silent = false } = {}) {
  const handler = (await import(pathToFileURL(resolve(outDir, "server", "index.js")).href)).default;
  const server = createServer((request, response) => {
    void (async () => {
      const boundPort = server.address().port;
      if (!trustedLocalHost(request.headers.host, boundPort)) { request.resume(); sendHttpError(response, 403, "Untrusted Host"); return; }
      if (!safeRequestTarget(request.url)) { request.resume(); sendHttpError(response, 404, "Not found"); return; }
      if (await serveGeneratedFile(request, response, generatedDir)) return;
      const method = request.method || "GET";
      const body = ["GET", "HEAD"].includes(method) ? undefined : await readLimitedBody(request);
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      const webRequest = new Request(`http://${request.headers.host}${request.url}`, { method, headers, body });
      const upstream = await handler.fetch(webRequest, { publicDirectory });
      await writeWebResponse(upstream, response, method);
    })().catch(error => {
      if (response.headersSent) response.destroy();
      else sendHttpError(response, error.status || 500, error.status === 413 ? "Request body too large" : "Unable to handle request");
    });
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  await new Promise((resolvePromise, rejectPromise) => { server.once("error", rejectPromise); server.listen(port, host, resolvePromise); });
  const result = { server, port: server.address().port };
  if (!silent) console.log(`AI 游戏创意合成器网页：http://${host}:${result.port}（Node 本机服务，实时生成图片已启用）`);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const environmentFile = resolve(ROOT, ".env.local");
    if (existsSync(environmentFile)) process.loadEnvFile(environmentFile);
    assertFixedPorts(process.env);
    if (process.argv.includes("--development")) await buildProject();
    await assertPortAvailable(WEB_PORT);
    await assertPortAvailable(WEB_PORT, "::1");
    await startLocalWeb({ publicDirectory: process.argv.some(arg => ["--development", "--source-assets"].includes(arg)) ? resolve(ROOT, "public") : undefined });
  } catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
}
