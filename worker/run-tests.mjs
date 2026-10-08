import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tests = (await readdir(resolve(root, "tests")))
  .filter(name => name.endsWith(".test.mjs"))
  .sort()
  .map(name => resolve(root, "tests", name));
if (!tests.length) throw new Error("No test files found");
// Bound process parallelism on developer machines and CI. Native image/font
// renderers allocate their own worker pools, so limit simultaneous test files.
// Every test still runs in its own file.
const child = spawn(process.execPath, ["--test", "--test-concurrency=2", ...tests], { cwd: root, stdio: "inherit", windowsHide: true });
child.on("error", error => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
