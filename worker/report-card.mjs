import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { resolveChineseFont } from "./chinese-font.mjs";
import { loadSharp } from "./image-runtime.mjs";
import { assertImageFileBudget, MAX_LOCAL_IMAGE_PIXELS } from "./image-file-budget.mjs";

const WIDTH = 1080;
const MARGIN = 54;
const INNER_WIDTH = WIDTH - MARGIN * 2;
const COLORS = {
  paper: "#f3f0e7", card: "#fffdf5", ink: "#254f49", muted: "#758981",
  teal: "#2caa96", border: "#a8d6c5", mint: "#edf5e9", blue: "#e8f4f5",
};

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function brief(value, limit) {
  const text = cleanText(value);
  if (Array.from(text).length <= limit) return text;
  const head = Array.from(text).slice(0, limit).join("");
  const sentenceEnd = Math.max(head.lastIndexOf("。"), head.lastIndexOf("！"), head.lastIndexOf("？"));
  if (sentenceEnd >= limit * 0.4) return head.slice(0, sentenceEnd + 1);
  const boundary = Math.max(head.lastIndexOf("。"), head.lastIndexOf("；"), head.lastIndexOf("，"));
  const excerpt = boundary >= limit * 0.64 ? head.slice(0, boundary) : head;
  return `${excerpt.replace(/[，；、,;\s]+$/u, "")}…`;
}

function firstSentence(value) {
  return cleanText(value).match(/^.*?[。！？]/u)?.[0]?.trim() || cleanText(value);
}

function constraintRecipe(report) {
  const recipe = cleanText(report.recipe);
  // A constraint label is never treated as the summary itself: retain everything
  // after the label through its sentence, without imposing a character limit.
  const labelled = recipe.match(/(?:用户硬约束|用户已选|本次配方|硬约束)[：:]\s*(.+?)(?=。|；|本次原创补全|AI补全|$)/u);
  if (labelled?.[1]) return labelled[1].trim().replace(/[；。]\s*$/u, "");
  return firstSentence(recipe) || [cleanText(report.control), cleanText(report.artStyle)].filter(Boolean).join(" ＋ ");
}

/** The image is deliberately concise; the original report remains the full plan. */
export function summarizeReportCard(report) {
  if (!report || typeof report !== "object" || !cleanText(report.gameName)) {
    throw new Error("创意卡缺少游戏名称或有效报告");
  }
  const recipe = constraintRecipe(report);
  if (Array.from(recipe).length > 1500) throw new Error("创意卡配方文字过长，请精简说明后继续排版");
  const action = cleanText(report.action);
  const mechanic = cleanText(report.mechanic);
  const gameplay = action ? `${action}${action.endsWith("。") ? "" : "。"}${firstSentence(mechanic)}` : cleanText(report.coreGameplay);
  return {
    gameName: brief(report.gameName, 54), rarity: brief(report.rarity, 8) || "创意",
    tagline: brief(report.tagline, 88),
    panels: [
      { title: "市场机会", key: "market", body: brief(report.marketOpportunity, 72) },
      { title: "核心玩法", key: "gameplay", body: brief(gameplay, 85) },
      { title: "买量钩子", key: "hook", body: brief(report.adHook, 73) },
      { title: "美术方向", key: "art", body: brief(report.artDirection, 73) },
    ],
    recipe,
    aiCompletion: brief(cleanText(report.aiCompletion).replace(/^用户已选[^。]*。\s*/u, ""), 90),
    sourceCount: Array.isArray(report.sources) ? report.sources.length : 0,
    sourceHosts: [...new Set((Array.isArray(report.sources) ? report.sources : []).flatMap((source) => {
      try { return [new URL(source.url).hostname.replace(/^www\./, "")]; } catch { return []; }
    }))].slice(0, 3).join(" · "),
  };
}

function markupText(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function iconSvg(key, x, y) {
  const common = `transform="translate(${x} ${y})" fill="none" stroke="#2b8f7c" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"`;
  const drawings = {
    market: '<circle cx="21" cy="21" r="17" fill="#e3efe0"/><path d="M9 29h25M12 24v-7m8 7V12m8 12V8"/><path d="m10 14 10-6 11 2" stroke="#e7a55d"/>',
    gameplay: '<circle cx="21" cy="21" r="18" fill="#e4eeef" stroke="none"/><path d="M8 21a13 13 0 0 1 22-9m4 9a13 13 0 0 1-22 9"/><path d="m30 6 1 7-7-1m-12 24-1-7 7 1" stroke="#e7a55d"/>',
    hook: '<circle cx="21" cy="21" r="18" fill="#f8eddb" stroke="none"/><path d="M13 8v29m1-27c9 6 10-4 18 1v12c-8-5-10 5-18-1"/><path d="M9 37h10"/>',
    art: '<path d="M32 7c-11-5-25 2-26 15-1 11 11 16 17 13 3-2-2-5 1-8 3-3 8 2 11-1 4-5 3-14-3-19Z" fill="#e3efe0"/><circle cx="16" cy="15" r="3" fill="#e9af62" stroke="none"/><circle cx="25" cy="12" r="3" fill="#71bbd1" stroke="none"/><circle cx="12" cy="25" r="3" fill="#e18b81" stroke="none"/><path d="m24 31 13-16"/>',
  };
  return `<g ${common}>${drawings[key] || drawings.gameplay}</g>`;
}

function dateLabel(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) throw new Error("创意卡生成时间无效");
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

/**
 * Render a complete, downloadable PNG from a real report and its generated art.
 * @param {{report: object, imagePath: string, outputPath: string, generatedAt?: string}} input
 * @returns {Promise<{width: number, height: number, outputPath: string}>}
 */
export async function renderReportCard({ report, imagePath, outputPath, generatedAt }) {
  const summary = summarizeReportCard(report);
  if (!imagePath || !existsSync(imagePath)) throw new Error("创意卡缺少已生成的玩法图片");
  assertImageFileBudget(imagePath);
  if (!outputPath || !/\.png$/i.test(outputPath)) throw new Error("创意卡输出必须为 PNG 文件");
  const sharp = await loadSharp();
  const font = resolveChineseFont();
  const textLayers = [];
  const shapes = [];
  async function textBlock(value, { size = 29, width = INNER_WIDTH, color = COLORS.ink, bold = false, align = "left", spacing = 9 } = {}) {
    const body = markupText(cleanText(value) || "待验证");
    const text = `<span foreground="${color}"${bold ? ' weight="bold"' : ""}>${body}</span>`;
    const png = await sharp({ text: { text, font: `${font.family} ${size}`, fontfile: font.path, width, wrap: "word-char", align, spacing, rgba: true } }).png().toBuffer();
    const metadata = await sharp(png).metadata();
    return { input: png, width: metadata.width, height: metadata.height };
  }
  function place(block, left, top) { textLayers.push({ input: block.input, left: Math.round(left), top: Math.round(top) }); }
  function box(x, y, width, height, fill, radius = 26, stroke = COLORS.border) { shapes.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`); }

  const brand = await textBlock("AI 创意合成器", { size: 26, width: 600, color: COLORS.teal, bold: true });
  place(brand, MARGIN + 6, 60);
  box(WIDTH - MARGIN - 128, 49, 128, 54, "#f4eddb", 27, "#e4cc94");
  const rarity = await textBlock(summary.rarity, { size: 26, width: 112, color: "#91712f", bold: true, align: "center" });
  place(rarity, WIDTH - MARGIN - 128 + (128 - rarity.width) / 2, 61);

  let y = 135;
  const title = await textBlock(summary.gameName, { size: 51, bold: true, align: "center", spacing: 9 });
  place(title, (WIDTH - title.width) / 2, y); y += title.height + 21;
  const tagline = await textBlock(summary.tagline, { size: 29, width: INNER_WIDTH - 28, color: COLORS.muted, align: "center" });
  place(tagline, (WIDTH - tagline.width) / 2, y); y += tagline.height + 24;

  const imageWidth = INNER_WIDTH - 4;
  const sourceMetadata = await sharp(imagePath, { limitInputPixels: MAX_LOCAL_IMAGE_PIXELS }).metadata();
  if (!sourceMetadata.width || !sourceMetadata.height) throw new Error("玩法图片不能解码");
  const imageHeight = Math.max(1, Math.round(imageWidth * Math.min(3, sourceMetadata.height / sourceMetadata.width)));
  const art = await sharp(imagePath, { limitInputPixels: MAX_LOCAL_IMAGE_PIXELS }).rotate().resize(imageWidth, imageHeight, { fit: "contain", background: COLORS.mint }).png().toBuffer();
  const mask = Buffer.from(`<svg width="${imageWidth}" height="${imageHeight}"><rect width="100%" height="100%" rx="22" fill="white"/></svg>`);
  const roundedArt = await sharp(art).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
  box(MARGIN, y, INNER_WIDTH, imageHeight + 66, "#f6f8ef", 26);
  const artLabel = await textBlock("原创游戏画面参考", { size: 24, color: COLORS.muted });
  place(artLabel, MARGIN + 22, y + 16);
  textLayers.push({ input: roundedArt, left: MARGIN + 2, top: y + 63 });
  y += imageHeight + 66 + 28;

  const gap = 22;
  const panelWidth = Math.floor((INNER_WIDTH - gap) / 2);
  const panelBodies = await Promise.all(summary.panels.map((panel) => textBlock(panel.body, { size: 28, width: panelWidth - 44, spacing: 8 })));
  for (let row = 0; row < 2; row += 1) {
    const panelHeight = Math.max(...panelBodies.slice(row * 2, row * 2 + 2).map((block) => block.height)) + 107;
    for (let column = 0; column < 2; column += 1) {
      const index = row * 2 + column;
      const x = MARGIN + column * (panelWidth + gap);
      box(x, y, panelWidth, panelHeight, row === 0 ? "#f3f6e9" : "#fffaf0", 24);
      shapes.push(iconSvg(summary.panels[index].key, x + 22, y + 20));
      const label = await textBlock(summary.panels[index].title, { size: 28, width: panelWidth - 86, color: COLORS.teal, bold: true });
      place(label, x + 76, y + 25);
      place(panelBodies[index], x + 22, y + 82);
    }
    y += panelHeight + gap;
  }

  const recipeBody = await textBlock(summary.recipe, { size: 30, width: INNER_WIDTH - 48, bold: true, spacing: 9 });
  const recipeHeight = recipeBody.height + 83;
  box(MARGIN, y, INNER_WIDTH, recipeHeight, COLORS.mint, 24);
  const recipeLabel = await textBlock("本次配方 · 用户硬约束", { size: 25, color: COLORS.teal, bold: true });
  place(recipeLabel, MARGIN + 24, y + 17);
  place(recipeBody, MARGIN + 24, y + 61);
  y += recipeHeight + 22;

  const aiBody = await textBlock(summary.aiCompletion, { size: 27, width: INNER_WIDTH - 48, color: COLORS.muted, spacing: 8 });
  const aiHeight = aiBody.height + 78;
  box(MARGIN, y, INNER_WIDTH, aiHeight, COLORS.blue, 24, "#d7e9e6");
  const aiLabel = await textBlock("AI 补全", { size: 25, color: COLORS.teal, bold: true });
  place(aiLabel, MARGIN + 24, y + 17);
  place(aiBody, MARGIN + 24, y + 60);
  y += aiHeight + 28;

  const footer = await textBlock(`生成于 ${dateLabel(generatedAt)}  ·  参考来源 ${summary.sourceCount} 项${summary.sourceHosts ? ` · ${summary.sourceHosts}` : ""}`, { size: 23, width: INNER_WIDTH, color: COLORS.muted, align: "center", spacing: 6 });
  place(footer, (WIDTH - footer.width) / 2, y); y += footer.height + 14;
  const disclaimer = await textBlock("创意评级不代表市场验证 · 完整方案与来源链接见应用", { size: 21, width: INNER_WIDTH, color: COLORS.muted, align: "center" });
  place(disclaimer, (WIDTH - disclaimer.width) / 2, y); y += disclaimer.height + 42;

  const height = Math.ceil(y);
  if (height > 8192) throw new Error("创意卡排版超过安全尺寸，请精简说明或调整画幅");
  const background = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}"><rect width="100%" height="100%" fill="${COLORS.paper}"/><rect x="18" y="18" width="${WIDTH - 36}" height="${height - 36}" rx="43" fill="${COLORS.card}" stroke="#dedfd0" stroke-width="2"/>${shapes.join("")}</svg>`);
  await mkdir(dirname(outputPath), { recursive: true });
  await sharp(background).composite(textLayers).png().toFile(outputPath);
  return { width: WIDTH, height, outputPath };
}
