import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { summarizeReportCard, renderReportCard } from "../worker/report-card.mjs";

const report = {
  gameName: "转转看台：团子入座", rarity: "史诗", tagline: "转动三圈小看台，让软陶观众入座。",
  marketOpportunity: "移动电竞观赛题材承载低门槛旋转解谜，优先测试入座与欢呼反馈。",
  coreGameplay: "玩家旋转环形走廊，对齐门洞。", action: "转动走廊、对齐门洞，让观众自动进入对应座区。", mechanic: "三层同心环路径拼接与队伍分流。",
  adHook: "一根手指沿圆周拖动中层走廊，黄色观众成串入座。", artDirection: "软陶3D是主风格：圆润轮廓、细微指纹与哑光表面。",
  recipe: "用户硬约束：旋转（rotate）＋软陶3D（clay）。本次原创补全：同心环路径拼接。",
  aiCompletion: "AI补全环形通道、分批入座机制和原创动物观众。", sources: [{ title: "近期报道", url: "https://example.com/article" }],
};

test("card summary preserves the actual hard constraints after the label", () => {
  const summary = summarizeReportCard(report);
  assert.equal(summary.recipe, "旋转（rotate）＋软陶3D（clay）");
  assert.match(summary.panels[1].body, /转动走廊.*同心环路径拼接/);
  assert.equal(summary.sourceCount, 1);
});

test("all listed constraints survive, including a long recipe", () => {
  const longRecipe = Array.from({ length: 24 }, (_, index) => `用户指定素材${index + 1}`).join("＋");
  assert.equal(summarizeReportCard({ ...report, recipe: `用户硬约束：${longRecipe}。AI补全：场景。` }).recipe, longRecipe);
  assert.throws(() => summarizeReportCard({ ...report, recipe: '长'.repeat(1501) }), /配方文字过长/);
});

test("renderer produces a complete PNG and rejects missing original art", async () => {
  const directory = await mkdtemp(join(tmpdir(), "alchemy-card-test-"));
  try {
    const sharp = createRequire(join(process.cwd(), "package.json"))("sharp");
    const imagePath = join(directory, "art.png");
    const outputPath = join(directory, "card.png");
    await sharp({ create: { width: 1600, height: 900, channels: 3, background: "#9ec9b3" } }).png().toFile(imagePath);
    const result = await renderReportCard({ report, imagePath, outputPath, generatedAt: "2026-10-04T06:25:12.573Z" });
    const bytes = await readFile(outputPath);
    const metadata = await sharp(bytes).metadata();
    assert.equal(metadata.format, "png");
    assert.equal(metadata.width, 1080);
    assert.equal(metadata.height, result.height);
    assert.ok(result.height > 1400);
    const portraitPath = join(directory, "portrait.png");
    await sharp({ create: { width: 900, height: 1600, channels: 3, background: "#9ec9b3" } }).png().toFile(portraitPath);
    const portrait = await renderReportCard({ report, imagePath: portraitPath, outputPath: join(directory, "portrait-card.png") });
    assert.ok(portrait.height > result.height + 1000, "portrait gameplay should retain a full-width playable area instead of shrinking into a landscape slot");
    await assert.rejects(renderReportCard({ report, imagePath: join(directory, "missing.png"), outputPath }), /缺少已生成/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
