import { spawn } from "node:child_process";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STATIC_FILE = /^[A-Za-z0-9_-]+\.(?:html|css|js|png|jpg|jpeg|svg|webp|ico)$/i;

// The stable filenames work in development. Production HTML carries a content
// version so browsers that cached an earlier release always request fresh code.
export function versionStaticReferences(html, assets) {
  return html.replace(/\b(href|src)="(\/[A-Za-z0-9_-]+\.(?:css|js))(?:[?#][^"]*)?"/g, (attribute, name, path) => {
    const content = assets.get(path);
    if (content === undefined) return attribute;
    const version = createHash("sha256").update(content).digest("hex").slice(0, 16);
    return `${name}="${path}?v=${version}"`;
  });
}

export async function buildProject({ silent = false } = {}) {
  const output = resolve(ROOT, "dist");
  // The absolute build target is a fixed child of this project, never user-configured.
  if (dirname(output) !== ROOT) throw new Error("Invalid build directory");
  await rm(output, { recursive: true, force: true });
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [resolve(ROOT, "node_modules", "typescript", "bin", "tsc"), "--project", resolve(ROOT, "tsconfig.json")], { cwd: ROOT, windowsHide: true, stdio: "inherit" });
    child.once("error", rejectPromise);
    child.once("exit", code => code === 0 ? resolvePromise() : rejectPromise(new Error(`TypeScript build failed (${code})`)));
  });
  await mkdir(resolve(output, "public"), { recursive: true });
  const entries = await readdir(resolve(ROOT, "public"), { withFileTypes: true });
  const files = entries.filter(entry => entry.isFile() && STATIC_FILE.test(entry.name));
  const assets = new Map();
  await Promise.all(files.map(async entry => {
    const source = resolve(ROOT, "public", entry.name);
    await copyFile(source, resolve(output, "public", entry.name));
    if (/\.(?:css|js)$/.test(entry.name)) assets.set(`/${entry.name}`, await readFile(source));
  }));
  await Promise.all(files.filter(entry => entry.name.endsWith(".html")).map(async entry => {
    const target = resolve(output, "public", entry.name);
    await writeFile(target, versionStaticReferences(await readFile(target, "utf8"), assets));
  }));
  if (!silent) console.log(`Built local Node web handler and ${files.length} public assets; runtime data and generated images excluded.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await buildProject(); }
  catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
}
