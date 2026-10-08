import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { handleAlchemyMcp } from "./alchemy-mcp.mjs";

const PUBLIC_DIRECTORY = fileURLToPath(new URL("../public/", import.meta.url));
const CONTENT_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", svg: "image/svg+xml", webp: "image/webp", ico: "image/x-icon",
};
const TITLE = "AI 游戏创意炼金器";
const DESCRIPTION = "把玩法、题材与美术素材投入炼金锅，生成可展示的游戏创意报告。";
const shell = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${TITLE}</title><meta name="description" content="${DESCRIPTION}"><meta property="og:title" content="${TITLE}"><meta property="og:description" content="${DESCRIPTION}"><meta property="og:image" content="/og.png"><meta name="twitter:card" content="summary_large_image"><link rel="icon" href="/favicon.svg"><style>*{box-sizing:border-box}html,body{width:100%;min-width:0;min-height:100%;margin:0}body{display:grid;place-items:center;min-height:100vh;overflow:auto;color:#18304f;background:radial-gradient(circle at 16% 18%,rgba(102,216,192,.22),transparent 32%),radial-gradient(circle at 84% 76%,rgba(154,122,242,.18),transparent 34%),#f3f0e9;font-family:ui-rounded,"PingFang SC","Microsoft YaHei",system-ui,sans-serif}.site-stage{width:720px;height:405px;position:relative;overflow:hidden;border-radius:16px;box-shadow:0 24px 70px rgba(34,56,76,.18)}.alchemy-frame{display:block;width:100%;height:100%;border:0;background:transparent}@media(max-width:719px){body{display:block}.site-stage{width:100%;height:100vh;height:100dvh;border-radius:0;box-shadow:none}}@media(prefers-color-scheme:dark){body{background:#111722}}</style></head><body><main class="site-stage"><iframe class="alchemy-frame" src="/alchemy-source.html?rev=release-20261007" title="${TITLE}" allow="fullscreen"></iframe></main></body></html>`;

function headers(type = "text/plain; charset=utf-8"): Record<string, string> {
  return { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin",
    "content-security-policy": "frame-ancestors 'self'", "x-frame-options": "SAMEORIGIN" };
}
function textResponse(text: string, status: number): Response { return new Response(text, { status, headers: headers() }); }
type Environment = { publicDirectory?: string };

const worker = {
  async fetch(request: Request, env: Environment = {}): Promise<Response> {
    const url = new URL(request.url);
    const directory = env.publicDirectory || PUBLIC_DIRECTORY;
    if (url.pathname === "/mcp") {
      const widget = await readFile(resolve(directory, "alchemy-source.html"), "utf8");
      return handleAlchemyMcp(request, widget);
    }
    if (url.pathname === "/api/generate" || url.pathname === "/api/trends") {
      return Response.json({ error: "该 API 路径已停用，请使用本机生成服务或 ChatGPT 组件。" }, { status: 410, headers: headers("application/json; charset=utf-8") });
    }
    if (!["GET", "HEAD"].includes(request.method)) return new Response("Method not allowed", { status: 405, headers: { ...headers(), allow: "GET, HEAD" } });
    if (["/", "/alchemy", "/alchemy/"].includes(url.pathname)) return new Response(request.method === "HEAD" ? null : shell, { headers: headers("text/html; charset=utf-8") });
    let filename: string;
    try { filename = decodeURIComponent(url.pathname.slice(1)); }
    catch { return textResponse("Not found", 404); }
    // Public assets are single root filenames. Never expose hidden/config/runtime files or subdirectories.
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/.test(filename)) return textResponse("Not found", 404);
    const extension = filename.split(".").at(-1)?.toLowerCase() || "";
    const type = CONTENT_TYPES[extension];
    if (!type) return textResponse("Not found", 404);
    try {
      const root = await realpath(directory);
      const path = await realpath(resolve(root, filename));
      const inside = relative(root, path);
      if (!inside || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) return textResponse("Not found", 404);
      const info = await stat(path);
      if (!info.isFile()) return textResponse("Not found", 404);
      const bytes = request.method === "HEAD" ? null : new Uint8Array(await readFile(path));
      return new Response(bytes, { headers: { ...headers(type), "content-length": String(info.size) } });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return textResponse(code === "ENOENT" || code === "ENOTDIR" ? "Not found" : "Unable to read public asset", code === "ENOENT" || code === "ENOTDIR" ? 404 : 500);
    }
  },
};
export default worker;
