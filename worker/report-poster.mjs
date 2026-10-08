import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { resolveChineseFont } from "./chinese-font.mjs";
import { loadSharp } from "./image-runtime.mjs";
import { assertImageFileBudget, MAX_LOCAL_IMAGE_PIXELS } from "./image-file-budget.mjs";

export const POSTER_LAYOUT_VERSION = 3;
const WIDTH = 1600;
const MARGIN = 64;
const INNER = WIDTH - MARGIN * 2;
const MAX_RECIPE_CHARACTERS = 1500;
const MAX_POSTER_HEIGHT = 8192;
const COLORS = { paper: "#fffaf0", ink: "#344850", teal: "#4ba89f", border: "#84c7bc", purple: "#9777b7", muted: "#81958c", gold: "#d7ac59" };
const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
const escape = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function brief(value, limit) {
  const text = clean(value);
  if (Array.from(text).length <= limit) return text;
  const excerpt = Array.from(text).slice(0, limit).join("");
  const sentence = Math.max(excerpt.lastIndexOf("。"), excerpt.lastIndexOf("！"), excerpt.lastIndexOf("？"));
  if (sentence >= limit * 0.45) return excerpt.slice(0, sentence + 1);
  const boundary = Math.max(excerpt.lastIndexOf("，"), excerpt.lastIndexOf("；"));
  return `${(boundary >= limit * 0.7 ? excerpt.slice(0, boundary) : excerpt).replace(/[，；、,;\s]+$/u, "")}…`;
}

function posterRecipe(report) {
  const recipe = clean(report.recipe);
  const labelled = recipe.match(/(?:用户硬约束|不可替换投入|用户投入|用户已选|本次配方|硬约束)[：:]\s*(.+?)(?=。|；|本次原创补全|从零补全|AI补全|$)/u);
  const constraints = labelled?.[1] || recipe.match(/^.*?[。！？]/u)?.[0] || recipe || [report.control, report.artStyle].filter(Boolean).join(" ＋ ");
  return constraints.replace(/[（(](?:trend-live-|trend-world-|trend-)[a-zA-Z0-9_-]+[）)]/g, "").replace(/[；。]\s*$/u, "").trim();
}

export function summarizeReportPoster(report) {
  if (!report || typeof report !== "object" || !clean(report.gameName)) throw new Error("海报缺少游戏名称或有效报告");
  const recipe = posterRecipe(report);
  if (Array.from(recipe).length > MAX_RECIPE_CHARACTERS) throw new Error("海报配方文字过长，请精简说明后继续排版；完整方案已保留");
  const gameplay = [clean(report.action), clean(report.mechanic)].filter(Boolean).join(" ");
  const sources = Array.isArray(report.sources) ? report.sources : [];
  return {
    gameName: brief(report.gameName, 54), rarity: brief(report.rarity, 8) || "创意",
    tagline: brief(report.tagline, 76), gameplay: brief(gameplay || report.coreGameplay, 118),
    control: brief(report.control, 70), marketOpportunity: brief(report.marketOpportunity, 112), recipe,
    genre: brief(clean(report.gameType).split(/[，,；;。]/u)[0] || "原创游戏概念", 30),
    panels: [
      { key: "market", label: "市场机会", body: brief(clean(report.marketOpportunity).replace(/^(?:本案的)?机会假设是[：:]\s*/u, "").split(/[，。；]/u)[0], 46) },
      { key: "gameplay", label: "核心玩法", body: brief(report.action || report.coreGameplay, 44) },
      { key: "hook", label: "买量钩子", body: brief(clean(report.adHook).split(/[：:。]/u)[0], 44) },
      { key: "art", label: "美术方向", body: brief(report.artStyle || report.artDirection, 42) },
    ],
    sourceCount: sources.length,
    sourceHosts: [...new Set(sources.flatMap((source) => {
      try { return [new URL(source.url).hostname.replace(/^www\./, "")]; } catch { return []; }
    }))].slice(0, 3).join(" · "),
  };
}

function dateLabel(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) throw new Error("海报生成时间无效");
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function infoIcon(key, x, y) {
  const drawings = {
    market: '<rect x="22" y="44" width="12" height="27" rx="4" fill="#64b9aa"/><rect x="43" y="32" width="12" height="39" rx="4" fill="#af9ac7"/><rect x="64" y="20" width="12" height="51" rx="4" fill="#e4bf78"/><path d="M22 33 49 21 75 12m-15 0h15v15"/>',
    gameplay: '<path d="M24 67h31a19 19 0 0 0 0-38H34" stroke-dasharray="6 8"/><circle cx="24" cy="67" r="7" fill="#fff9e8"/><circle cx="34" cy="29" r="7" fill="#fff9e8"/><path d="M63 37V9m0 2 19 9-19 9" fill="#af92c6" stroke="#aa8abf"/>',
    hook: '<path d="M26 15v29a23 23 0 0 0 46 0V15" stroke-width="14"/><path d="M26 15v12m46-12v12" stroke="#ac8fc5" stroke-width="14"/><path d="m49 71-4 12m27-27 11 5m-57-5-11 5" stroke="#e0b568"/>',
    art: '<path d="M72 27c-9-16-34-17-46-1-17 23-4 47 17 49 15 2 6-13 14-17 7-4 14 6 20-1 6-6 4-22-5-30Z" fill="#e9f2dc"/><circle cx="35" cy="35" r="6" fill="#dbb75e" stroke="none"/><circle cx="52" cy="27" r="6" fill="#ab91c7" stroke="none"/><circle cx="28" cy="52" r="6" fill="#86c4b2" stroke="none"/><path d="m57 64 24-32" stroke="#b78e67" stroke-width="9"/>',
  };
  return `<g transform="translate(${x} ${y})"><circle cx="49" cy="47" r="46" fill="#f7f7eb" stroke="#b2d8c6" stroke-width="2"/><g fill="none" stroke="#569c91" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">${drawings[key] || drawings.gameplay}</g></g>`;
}

/** Fixed ivory/mint report branding with the full dynamic gameplay image inside it. */
export async function renderReportPoster({ report, imagePath, outputPath, generatedAt }) {
  const summary = summarizeReportPoster(report);
  if (!imagePath || !existsSync(imagePath)) throw new Error("海报缺少已生成的玩法图片");
  assertImageFileBudget(imagePath);
  if (!outputPath || !/\.png$/i.test(outputPath)) throw new Error("海报输出必须为 PNG 文件");
  const sharp = await loadSharp();
  const font = resolveChineseFont();
  const layers = [];
  const shapes = [];
  async function text(value, { size = 32, width = INNER, color = COLORS.ink, bold = false, spacing = 9, align = "center", rich = false } = {}) {
    const content = rich ? value : escape(clean(value) || "待补充");
    const markup = `<span foreground="${color}"${bold ? ' weight="bold"' : ""}>${content}</span>`;
    const input = await sharp({ text: { text: markup, font: `${font.family} ${size}`, fontfile: font.path, width, wrap: "word-char", align, spacing, rgba: true } }).png().toBuffer();
    const metadata = await sharp(input).metadata();
    return { input, width: metadata.width, height: metadata.height };
  }
  const place = (block, left, top) => layers.push({ input: block.input, left: Math.round(left), top: Math.round(top) });
  const center = (block, top) => place(block, (WIDTH - block.width) / 2, top);
  function box(x, y, width, height, radius = 24, fill = "#fffdf7", shadow = true) {
    shapes.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}" stroke="${COLORS.border}" stroke-width="3"${shadow ? ' filter="url(#soft-shadow)"' : ""}/>`);
  }
  const rule = (x, y, width) => shapes.push(`<path d="M${x} ${y}h${width}" stroke="#a9d0c3" stroke-width="2" stroke-dasharray="7 10"/>`);

  box(456, 51, 688, 86, 43);
  center(await text("AI 创意炼金报告", { size: 38, color: COLORS.teal, bold: true }), 73);
  shapes.push(`<circle cx="484" cy="94" r="7" fill="${COLORS.teal}"/><circle cx="1116" cy="94" r="7" fill="${COLORS.teal}"/>`);
  let y = 185;
  const chars = Array.from(summary.gameName);
  const colon = chars.findIndex(char => /[：:]/u.test(char));
  const split = colon > 0 ? colon + 1 : Math.ceil(chars.length / 2);
  const titleMarkup = `<span foreground="${COLORS.teal}">${escape(chars.slice(0, split).join(""))}</span><span foreground="${COLORS.purple}">${escape(chars.slice(split).join(""))}</span>`;
  const title = await text(titleMarkup, { rich: true, size: chars.length <= 14 ? 119 : 78, width: INNER - 24, bold: true, spacing: 14 });
  center(title, y); y += title.height + 24;
  const tagline = await text(summary.tagline, { size: 33, width: INNER - 100 });
  center(tagline, y); y += tagline.height + 25;
  box(648, y, 304, 74, 25, "#f7f0fb", false);
  const rarity = await text(summary.rarity, { size: 36, color: COLORS.purple, bold: true, width: 180 });
  center(rarity, y + 17);
  shapes.push(`<g transform="translate(674 ${y + 17})" fill="${COLORS.gold}"><path d="m16 0 5 12 13 1-10 9 3 13-11-7-11 7 3-13-10-9 13-1Z"/><path d="M2 12q-7 20 9 33M33 12q7 20-9 33" fill="none" stroke="${COLORS.gold}" stroke-width="3"/></g>`);
  y += 74 + 37;

  const source = await sharp(imagePath, { limitInputPixels: MAX_LOCAL_IMAGE_PIXELS }).metadata();
  if (!source.width || !source.height) throw new Error("玩法图片不能解码");
  const ratio = source.height / source.width;
  const portrait = ratio >= 1.12;
  const imageWidth = INNER - 34;
  const imageHeight = portrait ? 1510 : Math.max(1040, Math.min(1380, Math.round(imageWidth * ratio)));
  const frameTop = y;
  box(MARGIN, frameTop, INNER, imageHeight + 98, 32);
  box((WIDTH - 684) / 2, frameTop + 17, 684, 59, 22, COLORS.teal, false);
  const artLabel = await text("玩法参考图  ·  游戏运行视角", { size: 28, color: "#fffdf1", bold: true });
  center(artLabel, frameTop + 29);
  // A subdued backdrop only fills unused frame space; the sharp foreground keeps every HUD edge.
  const backdrop = await sharp(imagePath, { limitInputPixels: MAX_LOCAL_IMAGE_PIXELS }).rotate().resize(imageWidth, imageHeight, { fit: "cover" }).blur(38).modulate({ saturation: 0.35, brightness: 1.15 }).composite([{ input: Buffer.from(`<svg width="${imageWidth}" height="${imageHeight}"><rect width="100%" height="100%" fill="#f8f5e9" fill-opacity="0.68"/></svg>`) }]).png().toBuffer();
  const gameplay = await sharp(imagePath, { limitInputPixels: MAX_LOCAL_IMAGE_PIXELS }).rotate().resize(imageWidth, imageHeight, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const artMask = Buffer.from(`<svg width="${imageWidth}" height="${imageHeight}"><rect width="100%" height="100%" rx="18" fill="white"/></svg>`);
  const completeArt = await sharp(backdrop).composite([{ input: gameplay }]).png().toBuffer();
  const art = await sharp(completeArt).composite([{ input: artMask, blend: "dest-in" }]).png().toBuffer();
  layers.push({ input: art, left: MARGIN + 17, top: Math.round(frameTop + 81) });
  y += imageHeight + 98 + 31;

  const gap = 24;
  const panelWidth = Math.floor((INNER - gap * 3) / 4);
  const bodyWidth = panelWidth - 36;
  const panelBlocks = await Promise.all(summary.panels.map(async panel => ({
    ...panel, heading: await text(panel.label, { size: 34, width: bodyWidth, bold: true }),
    body: await text(panel.body, { size: 28, width: bodyWidth, spacing: 9 }),
  })));
  const panelHeight = Math.max(...panelBlocks.map(panel => panel.body.height)) + 231;
  for (let i = 0; i < panelBlocks.length; i++) {
    const panel = panelBlocks[i];
    const x = MARGIN + i * (panelWidth + gap);
    box(x, y, panelWidth, panelHeight, 28);
    place(panel.heading, x + (panelWidth - panel.heading.width) / 2, y + 23);
    shapes.push(infoIcon(panel.key, x + (panelWidth - 98) / 2, y + 72));
    rule(x + 24, y + 181, panelWidth - 48);
    place(panel.body, x + (panelWidth - panel.body.width) / 2, y + 201);
  }
  y += panelHeight + 31;

  const recipe = await text(summary.recipe, { size: 36, width: INNER - 235, bold: true, align: "left", spacing: 12 });
  const recipeHeight = Math.max(151, recipe.height + 82);
  box(MARGIN, y, INNER, recipeHeight, 31);
  shapes.push(`<g transform="translate(${MARGIN + 26} ${y + (recipeHeight - 100) / 2})" fill="none" stroke="#639d92" stroke-width="4"><path d="M35 4h35v14H60v18l24 33c17 26-46 43-64 18-8-12-1-23 6-34l18-24V18H35Z" fill="#f5f5de"/><path d="M30 64c17 10 33-9 50 0 10 19-10 29-25 29-19 0-35-9-25-29Z" fill="#aa88c2" stroke="none"/><circle cx="48" cy="73" r="5" fill="#e2caec" stroke="none"/></g>`);
  const recipeLabel = await text("本次配方", { size: 28, color: COLORS.teal, bold: true, align: "left" });
  place(recipeLabel, MARGIN + 157, y + 20);
  place(recipe, MARGIN + 157, y + 62);
  y += recipeHeight + 31;
  const footer = await text(`方案 ${dateLabel(generatedAt)}  ·  来源 ${summary.sourceCount} 项${summary.sourceHosts ? ` / ${summary.sourceHosts}` : ""}`, { size: 23, color: COLORS.muted });
  center(footer, y); y += footer.height + 14;
  const note = await text("游戏画面为概念参考 · 市场机会待验证 · 完整方案与来源见应用", { size: 22, color: COLORS.muted });
  center(note, y); y += note.height + 39;
  const height = Math.max(2200, Math.ceil(y));
  if (height > MAX_POSTER_HEIGHT) throw new Error("海报排版超过安全尺寸，请精简说明后继续生成；方案和游戏图片已保留");
  const background = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}"><defs><radialGradient id="paper"><stop stop-color="#fffdf7"/><stop offset="1" stop-color="${COLORS.paper}"/></radialGradient><filter id="soft-shadow" x="-10%" y="-10%" width="120%" height="135%"><feDropShadow dx="0" dy="6" stdDeviation="7" flood-color="#a7a98c" flood-opacity="0.16"/></filter></defs><rect width="100%" height="100%" fill="url(#paper)"/>${shapes.join("")}</svg>`);
  await mkdir(dirname(outputPath), { recursive: true });
  await sharp(background).composite(layers).png().toFile(outputPath);
  return { width: WIDTH, height, outputPath, layout: "ivory-centered", layoutVersion: POSTER_LAYOUT_VERSION };
}
