import assert from "node:assert/strict";
import { createServer } from "node:net";
import test from "node:test";
import { assertFixedPorts, assertPortAvailable, runManagedServices } from "../worker/local-launcher.mjs";

test("fixed port configuration rejects backend and webpage drift", () => {
  assert.doesNotThrow(() => assertFixedPorts({}));
  assert.doesNotThrow(() => assertFixedPorts({ PORT: "3000", ALCHEMY_CODEX_PORT: "3002" }));
  assert.throws(() => assertFixedPorts({ PORT: "3003" }), /PORT 必须为 3000/);
  assert.throws(() => assertFixedPorts({ ALCHEMY_CODEX_PORT: "3004" }), /ALCHEMY_CODEX_PORT 必须为 3002/);
});

test("an occupied port fails without choosing a different port", async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try { await assert.rejects(assertPortAvailable(port), /不可用.*EADDRINUSE/); }
  finally { await new Promise(resolve => server.close(resolve)); }
});

test("a failed service stops its peer instead of leaving the launcher running", { timeout: 10000 }, async () => {
  const result = await runManagedServices([
    { name: "test-failure", executable: process.execPath, args: ["-e", "setTimeout(() => process.exit(7), 150)"] },
    { name: "test-peer", executable: process.execPath, args: ["-e", "setInterval(() => {}, 1000)"] },
  ], { stdio: "ignore" });
  assert.equal(result, 7);
});
