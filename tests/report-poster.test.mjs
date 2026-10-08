import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { renderReportPoster, summarizeReportPoster } from "../worker/report-poster.mjs";

const report = { gameName: "弧线借位：街区网球", tagline: "一划画出旋转球", action: "画弧击球、借板反弹", mechanic: "三次机会命中三个目标", control: "滑动绘制弧线", marketOpportunity: "单屏空间解谜的机会假设，优先验证首次操作理解。", recipe: "不可替换投入：滑动（swipe）＋运动（sports）＋话题（trend-world-123abc）。从零补全：借位机制。", sources: [] };

test("poster summary keeps all named inputs and separates opportunity from gameplay", () => {
  const summary = summarizeReportPoster(report);
  assert.equal(summary.recipe, "滑动（swipe）＋运动（sports）＋话题");
  assert.match(summary.gameplay, /画弧击球.*三次机会/);
  assert.match(summary.marketOpportunity, /机会假设/);
  const inputs = Array.from({ length: 30 }, (_, i) => `完整素材${i + 1}`).join("＋");
  assert.equal(summarizeReportPoster({ ...report, recipe: `用户硬约束：${inputs}。AI补全：场景` }).recipe, inputs);
  assert.throws(() => summarizeReportPoster({ ...report, recipe: '长'.repeat(1501) }), /配方文字过长/);
  assert.ok(Array.from(summarizeReportPoster({ ...report, rarity: '长'.repeat(1000) }).rarity).length <= 9);
});

test("portrait and landscape posters keep markers at every gameplay corner", async () => {
  const directory = await mkdtemp(join(tmpdir(), "alchemy-poster-test-"));
  try {
    const markers = ["#fa0101", "#01fa01", "#0101fa", "#faf001"];
    for (const [name, width, height] of [["portrait", 900, 1600], ["landscape", 1600, 900]]) {
      const imagePath = join(directory, `${name}.png`);
      const corner = (color) => Buffer.from(`<svg width="90" height="90"><rect width="90" height="90" fill="${color}"/></svg>`);
      await sharp({ create: { width, height, channels: 3, background: "#707070" } }).composite(markers.map((color, i) => ({ input: corner(color), left: i % 2 ? width - 90 : 0, top: i < 2 ? 0 : height - 90 }))).png().toFile(imagePath);
      const outputPath = join(directory, `${name}-poster.png`);
      const result = await renderReportPoster({ report, imagePath, outputPath, generatedAt: "2026-10-04T11:02:13.187Z" });
      const metadata = await sharp(outputPath).metadata();
      assert.equal(metadata.format, "png");
      assert.equal(metadata.width, 1600);
      assert.ok(metadata.height >= 2200);
      assert.equal(metadata.height, result.height);
      const { data, info } = await sharp(outputPath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const counts = new Map(markers.map(color => [color, 0]));
      for (let i = 0; i < data.length; i += info.channels) {
        const color = `#${data[i].toString(16).padStart(2, "0")}${data[i + 1].toString(16).padStart(2, "0")}${data[i + 2].toString(16).padStart(2, "0")}`;
        if (counts.has(color)) counts.set(color, counts.get(color) + 1);
      }
      assert.ok([...counts.values()].every(count => count > 2000), `${name}: original HUD and corner markers must survive`);
    }
    await assert.rejects(renderReportPoster({ report, imagePath: join(directory, "missing.png"), outputPath: join(directory, "bad.png") }), /缺少已生成/);
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + "\\") || resolve(directory).startsWith(resolve(tmpdir()) + "/"));
    await rm(directory, { recursive: true, force: true });
  }
});

test("oversized legacy and CLI image files are rejected before image decoding", async () => {
  const directory = await mkdtemp(join(tmpdir(), "alchemy-poster-budget-"));
  try {
    const imagePath = join(directory, "oversized.png");
    await writeFile(imagePath, 'invalid image header');
    await truncate(imagePath, 64 * 1024 * 1024 + 1);
    await assert.rejects(renderReportPoster({ report, imagePath, outputPath: join(directory, "poster.png") }), /64MB/);
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + "\\") || resolve(directory).startsWith(resolve(tmpdir()) + "/"));
    await rm(directory, { recursive: true, force: true });
  }
});
