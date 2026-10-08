import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildProject } from "./build.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const WEB_PORT = 3000;
export const SIDECAR_PORT = 3002;

export function assertFixedPorts(env) {
  for (const [name, expected] of [["PORT", WEB_PORT], ["ALCHEMY_CODEX_PORT", SIDECAR_PORT]]) {
    const configured = String(env[name] ?? "").trim();
    if (configured && configured !== String(expected)) {
      throw new Error(`${name} 必须为 ${expected}；当前版本使用固定网页 3000 / 生成服务 3002 端口，请移除冲突配置`);
    }
  }
}

export function assertPortAvailable(port, host = "127.0.0.1") {
  return new Promise((resolvePromise, rejectPromise) => {
    const probe = createServer();
    probe.once("error", error => {
      if (host === "::1" && ["EAFNOSUPPORT", "EADDRNOTAVAIL"].includes(error.code)) {
        resolvePromise();
        return;
      }
      rejectPromise(new Error(`本机端口 ${port}（${host}）不可用：${error.code}。请先关闭占用该端口的服务；不会自动改用其他端口`));
    });
    probe.listen({ port, host, exclusive: true }, () => probe.close(error => error ? rejectPromise(error) : resolvePromise()));
  });
}

function terminateChildTree(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise(resolvePromise => {
    let timer;
    let killer;
    const finish = () => { clearTimeout(timer); resolvePromise(); };
    child.once("exit", finish);
    timer = setTimeout(() => {
      if (killer && killer.exitCode === null && killer.signalCode === null) killer.kill();
      try {
        if (process.platform === "win32") child.kill();
        else process.kill(-child.pid, "SIGKILL");
      } catch { /* Already stopped. */ }
      finish();
    }, 4000);
    if (process.platform === "win32") {
      // Only terminate the tree of this launcher-owned child.
      killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      killer.once("error", () => child.kill());
      killer.once("exit", code => { if (code !== 0) child.kill(); });
    } else {
      try { process.kill(-child.pid, "SIGTERM"); } catch { finish(); }
    }
  });
}

export function runManagedServices(commands, { cwd = ROOT, env = process.env, stdio = "inherit" } = {}) {
  return new Promise(resolvePromise => {
    const children = [];
    let stopping = false;
    const stop = async code => {
      if (stopping) return;
      stopping = true;
      process.removeListener("SIGINT", onInterrupt);
      process.removeListener("SIGTERM", onTerminate);
      await Promise.all(children.map(terminateChildTree));
      resolvePromise(code);
    };
    const onInterrupt = () => { void stop(130); };
    const onTerminate = () => { void stop(143); };
    process.once("SIGINT", onInterrupt);
    process.once("SIGTERM", onTerminate);
    for (const command of commands) {
      const child = spawn(command.executable, command.args, {
        cwd, env, stdio, windowsHide: true, detached: process.platform !== "win32",
      });
      children.push(child);
      child.once("error", error => {
        console.error(`${command.name} 启动失败：${error.message}`);
        void stop(1);
      });
      child.once("exit", (code, signal) => {
        if (!stopping && (code !== 0 || signal)) console.error(`${command.name} 已退出（${signal || code}），正在停止其他服务`);
        void stop(code ?? 1);
      });
    }
  });
}

export async function runLocalApp({ production = false } = {}) {
  const environmentFile = resolve(ROOT, ".env.local");
  if (existsSync(environmentFile)) process.loadEnvFile(environmentFile);
  assertFixedPorts(process.env);
  if (production && !existsSync(resolve(ROOT, "dist", "server", "index.js"))) {
    throw new Error("尚未构建生产版本，请先运行 npm run build");
  }
  for (const port of [WEB_PORT, SIDECAR_PORT]) {
    await assertPortAvailable(port);
    await assertPortAvailable(port, "::1");
  }
  if (!production) await buildProject();
  return runManagedServices([
    { name: "网页服务", executable: process.execPath, args: [resolve(ROOT, "worker", "local-web.mjs"), ...(production ? [] : ["--source-assets"])] },
    { name: "生成服务", executable: process.execPath, args: [resolve(ROOT, "worker", "codex-sidecar.mjs")] },
  ], { env: { ...process.env, PORT: String(WEB_PORT), ALCHEMY_CODEX_PORT: String(SIDECAR_PORT) } });
}
