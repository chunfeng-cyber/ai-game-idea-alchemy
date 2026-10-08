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
// Windows font initialization can contend across independent renderer processes.
// Match the app's serial generation on that platform, including cold CI hosts.
// Every test still runs in its own file.
const concurrency = process.platform === "win32" ? 1 : 2;
const child = spawn(process.execPath, ["--test", `--test-concurrency=${concurrency}`, ...tests], { cwd: root, stdio: "inherit", windowsHide: true });
child.on("error", error => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
