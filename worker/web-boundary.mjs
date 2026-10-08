import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export const MAX_MCP_BODY_BYTES = 1024 * 1024;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const MCP_METHODS = new Set(["GET", "POST", "DELETE", "OPTIONS"]);

export function trustedLocalHost(host, port) {
  if (typeof host !== "string" || !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) return false;
  try {
    const url = new URL(`http://${host}`);
    return LOOPBACK_HOSTS.has(url.hostname) && Number(url.port || 80) === port;
  } catch { return false; }
}

export function safeRequestTarget(target) {
  if (typeof target !== "string" || !target.startsWith("/") || target.startsWith("//") || target.length > 8192) return false;
  let pathname;
  try { pathname = decodeURIComponent(target.split("?")[0]); } catch { return false; }
  // Check before URL's dot-segment normalization can hide attempted traversal.
  // eslint-disable-next-line no-control-regex -- URL inputs must reject control bytes.
  return !/[\\\x00-\x1f\x7f]/.test(pathname) && !pathname.split("/").some(segment => segment === "." || segment === "..");
}

export function sendHttpError(response, status, text, extra = {}) {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra });
  response.end(text);
}

export async function readLimitedBody(request, limit = MAX_MCP_BODY_BYTES) {
  const announced = request.headers["content-length"];
  if (announced !== undefined && (!/^\d+$/.test(String(announced)) || Number(announced) > limit)) {
    request.resume();
    throw Object.assign(new Error("Request body too large"), { status: 413 });
  }
  return new Promise((resolvePromise, rejectPromise) => {
    let size = 0;
    const chunks = [];
    const cleanup = () => { request.removeListener("data", onData); request.removeListener("end", onEnd); request.removeListener("error", onError); request.removeListener("aborted", onAbort); };
    const fail = error => { cleanup(); request.resume(); rejectPromise(error); };
    const onData = chunk => {
      size += chunk.length;
      if (size > limit) { fail(Object.assign(new Error("Request body too large"), { status: 413 })); return; }
      chunks.push(chunk);
    };
    const onEnd = () => { cleanup(); resolvePromise(chunks.length ? Buffer.concat(chunks, size) : undefined); };
    const onError = error => { cleanup(); rejectPromise(error); };
    const onAbort = () => { cleanup(); rejectPromise(new Error("Request aborted")); };
    request.on("data", onData); request.once("end", onEnd); request.once("error", onError); request.once("aborted", onAbort);
  });
}

export function mcpMethodAllowed(method) { return MCP_METHODS.has(method); }

export async function writeWebResponse(upstream, response, method) {
  const headers = {};
  upstream.headers.forEach((value, name) => {
    if (!["connection", "keep-alive", "transfer-encoding"].includes(name)) headers[name] = value;
  });
  response.writeHead(upstream.status, headers);
  if (method === "HEAD" || !upstream.body) { await upstream.body?.cancel(); response.end(); return; }
  await pipeline(Readable.fromWeb(upstream.body), response);
}
