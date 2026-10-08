import { createHash } from "node:crypto";

const DAY_MS = 86_400_000;
const REDDIT_FEED = "https://www.reddit.com/r/popular/.rss";
const HN_FEED = "https://hacker-news.firebaseio.com/v0/topstories.json";
const LANGUAGE_NAMES = { en: "英语", ja: "日语", es: "西语", pt: "葡语", ar: "阿语", de: "德语", ko: "韩语", zh: "中文", fr: "法语", it: "意语", id: "印尼语", th: "泰语", vi: "越语", tr: "土语" };
const COUNTRY_LANGUAGES = new Map([
  ["美国", "en"], ["加拿大", "en"], ["英国", "en"], ["法国", "fr"], ["德国", "de"], ["意大利", "it"], ["西班牙", "es"],
  ["中国大陆", "zh"], ["中国香港", "zh"], ["中国台湾", "zh"], ["日本", "ja"], ["韩国", "ko"],
  ["印度尼西亚", "id"], ["泰国", "th"], ["越南", "vi"], ["菲律宾", "en"], ["马来西亚", "en"], ["新加坡", "en"],
  ["巴西", "pt"], ["墨西哥", "es"], ["阿根廷", "es"], ["哥伦比亚", "es"], ["智利", "es"],
  ["沙特阿拉伯", "ar"], ["阿联酋", "ar"], ["埃及", "ar"], ["土耳其", "tr"],
]);
const REGION_LANGUAGES = { 全球: ["en", "ja", "es"], 欧美: ["en", "de"], 日韩: ["ja", "ko"], 拉美: ["es", "pt"], 中东: ["ar", "tr"], 中国: ["zh"], 东南亚: ["en", "id"] };
const MAIN_PAGES = new Set(["Main_Page", "メインページ", "الصفحة_الرئيسة", "الصفحة_الرئيسية", "首页", "首頁", "대문", "Halaman_Utama", "Trang_Chính", "หน้าหลัก", "Ana_Sayfa"]);
const SYSTEM_NAMESPACE = /^(?:Wikipedia|Wikipédia|Wikimedia|Special|Especial|Spezial|Spécial|File|Image|Category|Template|Portal|Help|Talk|User|特別|特别|維基百科|维基百科|위키백과|특수|خاص|ويكيبيديا|ملف|Istimewa|Đặc_biệt|พิเศษ|Özel):/i;
const UNSUITABLE = /博彩|赌博|娱乐城|下注|赔率|彩票|性侵|强奸|猥亵|性虐待|殺傷|殺人|杀人|凶杀|谋杀|谋殺|绑架|綁架|恐怖袭击|恐怖攻擊|枪击|槍擊|交通事故|车祸|車禍|\b(?:casino|gambling|betting|sportsbook|draftkings|fanduel|murder|murdered|rape|rapist|kidnap\w*|abduct\w*|trafficking|terrorism|terrorist|assassination|massacre|sexual assault|sexual abuse|child sexual|shooting|homicide|killed|deadly|crimes?|criminal|arrested|indicted|sentenced)\b|pelted with rocks/i;
const SENSITIVE_NAMES = new Set(["christa pike"]);

function cleanText(value = "") {
  return String(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(x[\da-f]+|\d+);/gi, (match, code) => {
      const point = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code);
      return point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
    }).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

function xmlField(block, name) {
  return cleanText(block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1] || "");
}

function shorten(value, length) {
  const chars = Array.from(cleanText(value));
  return chars.length > length ? `${chars.slice(0, length - 1).join("")}…` : chars.join("");
}

function safeHttps(value, expectedHost) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      && (!expectedHost || url.hostname === expectedHost || url.hostname.endsWith(`.${expectedHost}`));
  } catch { return false; }
}

function unsuitable(title) {
  const text = cleanText(title).replaceAll("_", " ");
  return UNSUITABLE.test(text) || SENSITIVE_NAMES.has(text.toLowerCase());
}

function selection(scope, date) {
  const channel = scope.channel || "全渠道";
  const all = ["全渠道", "全部", "自动选择"].includes(channel);
  const country = scope.country;
  const specificCountry = country && !["全球", "全部", "全国家", "自动选择"].includes(country);
  const languages = specificCountry ? (COUNTRY_LANGUAGES.has(country) ? [COUNTRY_LANGUAGES.get(country)] : [])
    : (REGION_LANGUAGES[scope.region || "全球"] || []);
  const region = scope.region || "全球";
  const sources = [];
  if (all || channel === "Reddit") sources.push({ region, channel: "Reddit", sourceName: "Reddit 热门讨论", kind: "discussion-popular", geoScope: "global", language: "en", url: REDDIT_FEED });
  if (all || ["Wikipedia", "维基百科"].includes(channel)) {
    for (const language of languages.slice(0, 3)) sources.push({ region, channel: "Wikipedia", sourceName: `Wikipedia ${LANGUAGE_NAMES[language]}版`, kind: "pageview-ranking", geoScope: "language", language, periodDate: date, url: `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/${language}.wikipedia/all-access/${date.replaceAll("-", "/")}` });
  }
  if (all || ["Hacker News", "HackerNews"].includes(channel)) sources.push({ region, channel: "Hacker News", sourceName: "Hacker News 热门讨论", kind: "discussion-popular", geoScope: "global", language: "en", url: HN_FEED });
  return sources;
}

function baseItem(source, title, url, observedAt) {
  return {
    id: `world-${createHash("sha256").update(url).digest("hex").slice(0, 20)}`,
    region: source.region, country: "全球", channel: source.channel, observedChannel: source.channel,
    label: shorten(title, 80), shortLabel: shorten(title, 24), icon: source.kind === "pageview-ranking" ? "📚" : "💬",
    sourceTitle: cleanText(title), sourceUrl: url, sourceFeedUrl: source.url, sourceName: source.sourceName,
    sourceKind: source.kind, sourceObservedAt: observedAt, sourceTimeKind: "observed", snapshotAt: observedAt,
    geoScope: source.geoScope, language: source.language,
    whyGameable: "可提取话题中的目标、角色关系或视觉元素，转化为原创关卡与玩法钩子；具体方案按本次配方推导。",
    risk: "仅反映当前来源的讨论或阅读兴趣；需核对语境、版权及题材，不代表短视频传播或买量效果。",
  };
}

function parseReddit(xml, source, nowMs, observedAt) {
  if (typeof xml !== "string" || xml.length > 2_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml) || !/<feed\b[^>]*xmlns=["']http:\/\/www\.w3\.org\/2005\/Atom["']/i.test(xml)) throw new Error("invalid_atom");
  const matches = [...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)];
  return matches.flatMap((match, index) => {
    const block = match[1];
    const title = xmlField(block, "title");
    const linkTags = [...block.matchAll(/<link\b([^>]*?)\/?>/gi)];
    const url = linkTags.map((entry) => cleanText(entry[1].match(/\bhref=["']([^"']+)["']/i)?.[1] || "")).find((entry) => safeHttps(entry, "reddit.com"));
    const publishedMs = Date.parse(xmlField(block, "published") || xmlField(block, "updated"));
    // Old pinned threads must not become new topics just because the listing was fetched today.
    if (!title || !url || unsuitable(title) || !Number.isFinite(publishedMs) || publishedMs > nowMs + 600_000 || nowMs - publishedMs > 3 * DAY_MS) return [];
    return [{ ...baseItem(source, title, url, observedAt), sourcePublishedAt: new Date(publishedMs).toISOString(),
      rank: index + 1, rankKind: "list-position", metricLabel: "热门列表位置", metricValue: index + 1,
      freshness: "当前热门讨论", evidence: `Reddit 当前热门讨论列表第 ${index + 1} 位：“${shorten(title, 150)}”。公开 RSS 未提供投票数；地域是全球默认讨论，未提供国家排名。` }];
  });
}

function parseWiki(text, source, observedAt) {
  if (typeof text !== "string" || text.length > 2_000_000) throw new Error("invalid_json");
  const data = JSON.parse(text);
  const dataset = data.items?.find((item) => item.project === `${source.language}.wikipedia` && item.access === "all-access");
  const datasetDate = dataset && `${dataset.year}-${String(dataset.month).padStart(2, "0")}-${String(dataset.day).padStart(2, "0")}`;
  if (datasetDate !== source.periodDate || !Array.isArray(dataset.articles)) throw new Error("invalid_dataset_date");
  return dataset.articles.flatMap((entry) => {
    const article = typeof entry.article === "string" ? entry.article : "";
    if (!article || MAIN_PAGES.has(article) || SYSTEM_NAMESPACE.test(article) || unsuitable(article)
      || !Number.isInteger(entry.rank) || entry.rank < 1 || !Number.isFinite(entry.views) || entry.views < 0) return [];
    const title = article.replaceAll("_", " ");
    const url = `https://${source.language}.wikipedia.org/wiki/${encodeURIComponent(article)}`;
    return [{ ...baseItem(source, title, url, observedAt), rank: entry.rank, rankKind: "official", metricValue: entry.views,
      metricLabel: "昨日浏览量", periodDate: source.periodDate, sourceDatasetDate: source.periodDate, freshness: `${source.periodDate} 日榜`,
      evidence: `${source.sourceName} ${source.periodDate} 官方浏览榜第 ${entry.rank} 名，${entry.views.toLocaleString("en-US")} 次浏览。“${shorten(title, 130)}”；这是语言版阅读兴趣日榜，并非国家实时热榜。` }];
  });
}

async function parseHn(text, source, nowMs, observedAt, fetchText) {
  if (typeof text !== "string" || text.length > 100_000) throw new Error("invalid_json");
  const ids = JSON.parse(text);
  if (!Array.isArray(ids) || !ids.length || !ids.every((id) => Number.isSafeInteger(id) && id > 0)) throw new Error("invalid_list");
  const result = await Promise.all(ids.slice(0, 5).map(async (id, index) => {
    try {
      const itemText = await fetchText(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
      if (typeof itemText !== "string" || itemText.length > 200_000) return null;
      const story = JSON.parse(itemText);
      const publishedMs = Number(story?.time) * 1000;
      if (!story || story.id !== id || story.type !== "story" || story.dead || story.deleted || typeof story.title !== "string" || !story.title.trim() || unsuitable(story.title)
        || !Number.isFinite(publishedMs) || publishedMs > nowMs + 600_000 || nowMs - publishedMs > 7 * DAY_MS
        || !Number.isFinite(story.score) || story.score < 0) return null;
      const url = `https://news.ycombinator.com/item?id=${id}`;
      return { ...baseItem(source, story.title, url, observedAt), sourcePublishedAt: new Date(publishedMs).toISOString(),
        rank: index + 1, rankKind: "official", metricValue: story.score, metricLabel: "社区投票分数",
        commentCount: Number.isFinite(story.descendants) && story.descendants >= 0 ? story.descendants : 0,
        relatedArticles: safeHttps(story.url) ? [{ title: cleanText(story.title), url: story.url, publisher: "原文" }] : [],
        freshness: "当前科技热门", evidence: `Hacker News 当前官方热门榜第 ${index + 1} 名，${story.score} 分、${Number(story.descendants) || 0} 条评论：“${shorten(story.title, 130)}”。这是英语科技社区榜，未提供国家维度。` };
    } catch { return null; }
  }));
  return result.filter(Boolean);
}

function limitConcurrency(fetchText, concurrency = 4) {
  let active = 0;
  const queue = [];
  const release = () => {
    active -= 1;
    queue.shift()?.();
  };
  return async (url) => {
    await new Promise((resolve) => {
      const start = () => { active += 1; resolve(); };
      if (active < concurrency) start(); else queue.push(start);
    });
    try { return await fetchText(url); } finally { release(); }
  };
}

/** Native discussion and reading rankings; missing feeds never become news-search substitutes. */
export async function collectWorldHotTrends({ fetchText, scope = {}, now = new Date(), limit = 10, onProgress } = {}) {
  if (typeof fetchText !== "function") throw new TypeError("fetchText 必须是网络读取函数");
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(nowMs)) throw new TypeError("now 必须是有效时间");
  const itemLimit = Math.max(1, Math.min(50, Math.floor(Number(limit)) || 10));
  const observedAt = new Date(nowMs).toISOString();
  const periodDate = new Date(nowMs - DAY_MS).toISOString().slice(0, 10);
  const sources = selection(scope, periodDate);
  const limitedFetch = limitConcurrency(fetchText);
  limitedFetch.observedAt = fetchText.observedAt;
  const results = await Promise.all(sources.map(async (source) => {
    try {
      const text = await limitedFetch(source.url);
      const sourceObservedAt = limitedFetch.observedAt?.(source.url) || observedAt;
      const items = source.channel === "Reddit" ? parseReddit(text, source, nowMs, sourceObservedAt)
        : source.channel === "Wikipedia" ? parseWiki(text, source, sourceObservedAt)
          : await parseHn(text, source, nowMs, sourceObservedAt, limitedFetch);
      const result = { source, items, error: items.length ? "" : "原生榜单没有可用的适合创意合成条目" };
      onProgress?.(result);
      return result;
    } catch (error) {
      const rateLimited = error?.status === 429 || error?.statusCode === 429 || /\b429\b/.test(String(error?.message || ""));
      // Keep returned diagnostics fixed: arbitrary network errors may contain headers or credentials.
      const result = { source, items: [], error: rateLimited ? "公开来源限流，请稍后重试" : "公开原生榜单读取或结构校验失败" };
      onProgress?.(result);
      return result;
    }
  }));
  const items = [];
  const seen = new Set();
  for (let row = 0; row < itemLimit && items.length < itemLimit; row += 1) {
    for (const result of results) {
      const item = result.items[row];
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
      if (items.length >= itemLimit) break;
    }
  }
  return { items, fetchedAt: observedAt,
    errors: results.filter((result) => result.error).map(({ source, error }) => ({ country: "全球", channel: source.channel, observedChannel: source.channel,
      sourceKind: source.kind, geoScope: source.geoScope, language: source.language, periodDate: source.periodDate || "", url: source.url, message: error })),
    sourceSummary: results.map(({ source, items: candidates, error }) => ({ country: "全球", channel: source.channel, observedChannel: source.channel,
      sourceKind: source.kind, sourceName: source.sourceName, geoScope: source.geoScope, language: source.language, supportsCountry: false,
      periodDate: source.periodDate || "", snapshotAt: observedAt, url: source.url, availableCount: candidates.length,
      selectedCount: items.filter((item) => item.sourceFeedUrl === source.url).length, status: error ? "unavailable" : "ready" })),
  };
}
