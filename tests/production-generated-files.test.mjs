import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startLocalWeb } from "../worker/local-web.mjs";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4sUAAAAASUVORK5CYII=", "base64");

test("real production web serves PNGs created after startup and retains normal app routes", { timeout: 20000 }, async t => {
  const temporary = await mkdtemp(join(tmpdir(), "alchemy-production-files-"));
  const generatedDir = join(temporary, "generated");
  await mkdir(generatedDir);
  const { server, port } = await startLocalWeb({ host: "127.0.0.1", port: 0, generatedDir, silent: true });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    assert.ok(temporary.startsWith(join(tmpdir(), "alchemy-production-files-")));
    await rm(temporary, { recursive: true, force: true });
  });
  const get = (path, method = "GET") => new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path, method }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
      response.on("error", reject);
    });
    req.on("error", reject); req.end();
  });
  const app = await get("/");
  assert.equal(app.status, 200);
  assert.match(app.body.toString(), /alchemy-source\.html/);
  assert.equal((await get("/generated/fresh.png")).status, 404);
  // Create the file only after the actual Node production server has started.
  await writeFile(join(generatedDir, "fresh.png"), png);
  const image = await get("/generated/fresh.png?v=after-start");
  assert.equal(image.status, 200);
  assert.equal(image.headers["content-type"], "image/png");
  assert.equal(Number(image.headers["content-length"]), png.length);
  assert.deepEqual(image.body, png, "downloaded bytes match the newly written PNG");
  assert.equal(image.headers["cache-control"], "no-store");
  const head = await get("/generated/fresh.png", "HEAD");
  assert.equal(head.status, 200); assert.equal(head.body.length, 0);
  assert.equal(Number(head.headers["content-length"]), png.length);
  const method = await get("/generated/fresh.png", "POST");
  assert.equal(method.status, 405); assert.equal(method.headers.allow, "GET, HEAD");
  await writeFile(join(temporary, "private.txt"), "private runtime data");
  for (const path of ["/generated/../private.txt", "/generated/%2e%2e/private.txt", "/generated/%2e%2e%5cprivate.txt", "/generated/%2Fprivate.txt", "/generated/%00.png", "/generated/%ZZ.png"]) {
    assert.equal((await get(path)).status, 404, `must refuse ${path}`);
  }
  await t.test("a symlink outside the generated directory is refused", async child => {
    try { await symlink(join(temporary, "private.txt"), join(generatedDir, "outside.png")); }
    catch (error) {
      if (["EPERM", "EACCES", "ENOSYS"].includes(error.code)) { child.skip("OS does not permit symlink creation"); return; }
      throw error;
    }
    assert.equal((await get("/generated/outside.png")).status, 404);
  });
});
