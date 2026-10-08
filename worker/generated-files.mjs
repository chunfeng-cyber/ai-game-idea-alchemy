import { open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";

function endError(response, status, text, headers = {}) {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers });
  response.end(text);
}

/** Serve only generated PNGs from the current directory, never the build snapshot. */
export async function serveGeneratedFile(request, response, directory) {
  const pathname = (request.url || "/").split("?")[0];
  if (!pathname.startsWith("/generated/")) return false;
  if (!["GET", "HEAD"].includes(request.method)) {
    endError(response, 405, "Method not allowed", { allow: "GET, HEAD" });
    return true;
  }
  let file;
  try {
    const filename = decodeURIComponent(pathname.slice("/generated/".length));
    // All sidecar images and posters use a single ASCII .png filename.
    if (!/^[A-Za-z0-9_-]+\.png$/.test(filename)) {
      endError(response, 404, "Not found");
      return true;
    }
    const root = await realpath(directory);
    const path = await realpath(resolve(root, filename));
    const inside = relative(root, path);
    if (!inside || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
      endError(response, 404, "Not found");
      return true;
    }
    file = await open(path, "r");
    const stat = await file.stat();
    if (!stat.isFile()) {
      await file.close(); file = null;
      endError(response, 404, "Not found");
      return true;
    }
    response.writeHead(200, {
      "content-type": "image/png",
      "content-length": stat.size,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    if (request.method === "HEAD") {
      await file.close(); file = null;
      response.end();
    } else {
      await pipeline(file.createReadStream(), response);
      file = null;
    }
  } catch (error) {
    if (file) await file.close().catch(() => {});
    if (response.headersSent) response.destroy();
    else endError(response, ["ENOENT", "ENOTDIR"].includes(error.code) || error instanceof URIError ? 404 : 500, ["ENOENT", "ENOTDIR"].includes(error.code) || error instanceof URIError ? "Not found" : "Unable to read generated image");
  }
  return true;
}
