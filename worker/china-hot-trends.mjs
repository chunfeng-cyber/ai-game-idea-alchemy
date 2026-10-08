import { createHash } from "node:crypto";

const DAY_MS = 86_400_000;
const CONTENT_FILTER = /博彩|赌博|娱乐城|下注|赔率|真人娱乐|彩票|casino|gambling|betting|sportsbook|成人色情|性侵|性虐待|猥亵|强奸|谋杀|凶杀|恐怖袭击|恐袭|涉嫌.{0,10}(?:犯罪|诈骗)|(?:逮捕|刑拘).{0,10}(?:犯罪|诈骗|杀人)|\b(?:murder|rape|sexual assault|sexual abuse|terrorist attack)\b/i;
const SOURCES = [
  { id: "douyin", channel: "抖音", name: "抖音热榜", kind: "platform-ranking", rankKind: "official", icon: "🎵", url: "https://www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/" },
  { id: "bilibili", channel: "B站", name: "B站热门列表", kind: "platform-popular", rankKind: "list-position", icon: "📺", url: "https://api.bilibili.com/x/web-interface/popular?ps=20&pn=1" },
  { id: "toutiao", channel: "头条", name: "头条热榜", kind: "platform-ranking", rankKind: "official", icon: "🗞️", url: "https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc" },
].map((source) => ({...source, country: "中国大陆", region: "中国", geoScope: "country"}));
const ALL_SCOPE = new Set(["", "全球", "自动选择", "全部", "全国家"]);

function shorten(value, length) {
  const chars = Array.from(String(value || "").replace(/\s+/g, " ").trim());
  return chars.length > length ? `${chars.slice(0, length - 1).join("")}…` : chars.join("");
}

function safeUrl(value, allowedHost) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      && (!allowedHost || url.hostname === allowedHost || url.hostname.endsWith(`.${allowedHost}`)) ? url.toString() : "";
  } catch { return ""; }
}

function parseJson(text) {
  if (typeof text !== "string" || !text.trim() || text.length > 2_000_000) throw new Error("来源未返回有效 JSON");
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("来源未返回有效 JSON"); }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("来源未返回有效 JSON");
  return data;
}

function chinaUpdatedAt(value, nowMs) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) throw new Error("来源缺少有效榜单更新时间");
  const updated = Date.parse(`${value.replace(" ", "T")}+08:00`);
  if (!Number.isFinite(updated) || updated > nowMs + 600_000 || nowMs - updated > DAY_MS) throw new Error("榜单更新时间已过期或不可信");
  return new Date(updated).toISOString();
}

function metric(value) {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : undefined;
}

function toutiaoUrl(value) {
  const safe = safeUrl(value, "toutiao.com");
  if (!safe) return "";
  const url = new URL(safe);
  // The actual board link contains a long, changing impression payload. Its article path is stable.
  url.search = "";
  url.hash = "";
  return url.toString();
}

function sourceRows(source, body, nowMs) {
  if (source.id === "douyin") {
    if (body.status_code !== 0 || !Array.isArray(body.word_list)) throw new Error("平台热榜返回业务错误或无有效条目");
    const updatedAt = chinaUpdatedAt(body.active_time, nowMs);
    return body.word_list.map((row, index) => ({
      title: row.word, rank: index + 1, metricValue: metric(row.hot_value), metricLabel: "热度",
      url: `https://www.douyin.com/search/${encodeURIComponent(String(row.word || ""))}`,
      sourceUpdatedAt: updatedAt,
    }));
  }
  if (source.id === "bilibili") {
    if (body.code !== 0 || !Array.isArray(body.data?.list)) throw new Error("平台热门返回业务错误或无有效条目");
    return body.data.list.flatMap((row, index) => {
      if (typeof row.bvid !== "string" || !/^BV[\da-zA-Z]{10}$/.test(row.bvid)) return [];
      const published = Number(row.pubdate) * 1000;
      // A video may remain popular long after publication: validate its date without an age cutoff.
      if (row.pubdate != null && (!Number.isFinite(published) || published <= 0 || published > nowMs + 600_000)) return [];
      return [{ title: row.title, rank: index + 1, url: `https://www.bilibili.com/video/${row.bvid}`,
        ...(Number.isFinite(published) && published > 0 ? { sourcePublishedAt: new Date(published).toISOString() } : {}),
        metricValue: metric(row.stat?.view), metricLabel: "播放量（累计）" }];
    });
  }
  if (body.status !== "success" || !Array.isArray(body.data)) throw new Error("平台热榜返回业务错误或无有效条目");
  return body.data.map((row, index) => ({
    title: row.Title, rank: index + 1, url: toutiaoUrl(row.Url),
    metricValue: metric(row.HotValue), metricLabel: "热度",
  }));
}

function asItem(source, row, observedAt) {
  const sourceTitle = typeof row.title === "string" ? row.title.replace(/\s+/g, " ").trim() : "";
  const sourceUrl = safeUrl(row.url);
  if (!sourceTitle || sourceTitle.length > 1500 || !sourceUrl || CONTENT_FILTER.test(sourceTitle)) return null;
  const official = source.rankKind === "official";
  return {
    id: `live-cn-${source.id}-${createHash("sha256").update(sourceUrl).digest("hex").slice(0, 20)}`,
    region: "中国", country: "中国大陆", channel: source.channel, observedChannel: source.channel,
    name: source.name, label: shorten(sourceTitle, 80), shortLabel: shorten(sourceTitle, 24), icon: source.icon,
    freshness: "本次抓取的当前平台榜单",
    evidence: `${source.name}${official ? `第 ${row.rank} 名` : `第 ${row.rank} 条`}收录“${shorten(sourceTitle, 100)}”；${official ? "为平台当前热榜" : "为平台热门列表，列表位置不代表全站排名"}。`,
    whyGameable: "可把热门主题转化为原创角色、关卡目标或视觉钩子；玩法需按本次配方推导。",
    risk: "需核对题材语境及版权；平台榜单和累计播放量不能解释为买量效果。",
    sourceTitle, sourceUrl, sourceFeedUrl: source.url, sourceName: source.name,
    sourceKind: source.kind, sourceTimeKind: "observed", sourceObservedAt: observedAt,
    ...(row.sourcePublishedAt ? { sourcePublishedAt: row.sourcePublishedAt } : {}),
    ...(row.sourceUpdatedAt ? { sourceUpdatedAt: row.sourceUpdatedAt } : {}),
    rank: row.rank, rankKind: source.rankKind, geoScope: "country",
    ...(row.metricValue !== undefined ? { metricValue: row.metricValue, metricLabel: row.metricLabel } : {}),
  };
}

/** Direct public Chinese platform snapshots. No authentication, fixed seeds, or news fallbacks. */
export async function collectChinaHotTrends({ fetchText, scope = {}, now = new Date(), limit = 10, onProgress } = {}) {
  if (typeof fetchText !== "function") throw new TypeError("fetchText 必须是网络读取函数");
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(nowMs)) throw new TypeError("now 必须是有效时间");
  const fetchedAt = new Date(nowMs).toISOString();
  const region = String(scope.region || "");
  const country = String(scope.country || "");
  const channel = String(scope.channel || "");
  const eligibleGeo = ALL_SCOPE.has(region) || region === "中国";
  const eligibleCountry = ALL_SCOPE.has(country) || country === "中国大陆";
  const allChannels = !channel || ["全渠道", "全部", "自动选择", "全球"].includes(channel);
  const sources = eligibleGeo && eligibleCountry ? SOURCES.filter((source) => allChannels || source.channel === channel) : [];
  const itemLimit = Math.max(1, Math.min(10, Math.floor(Number(limit)) || 10));
  // There are only three independent sources: this bounds concurrent reads to three.
  const results = await Promise.all(sources.map(async (source) => {
    try {
      const rows = sourceRows(source, parseJson(await fetchText(source.url)), nowMs);
      const observedAt = fetchText.observedAt?.(source.url) || fetchedAt;
      const items = rows.map((row) => asItem(source, row, observedAt)).filter(Boolean);
      const result = { source, items, error: items.length ? "" : "平台当前榜单没有可用条目" };
      onProgress?.(result);
      return result;
    } catch (error) {
      const known = /^(?:来源未返回有效 JSON|来源缺少有效榜单更新时间|榜单更新时间已过期或不可信|平台(?:热榜|热门)返回业务错误或无有效条目)$/.test(error?.message || "");
      const result = { source, items: [], error: known ? error.message : "公开平台来源读取失败" };
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
  return {
    items, fetchedAt,
    errors: results.filter((result) => result.error).map(({ source, error }) => ({
      country: "中国大陆", channel: source.channel, observedChannel: source.channel,
      sourceKind: source.kind, url: source.url, message: error,
    })),
    sourceSummary: results.map(({ source, items: candidates, error }) => ({
      country: "中国大陆", region: "中国", geoScope: "country", channel: source.channel, observedChannel: source.channel,
      sourceKind: source.kind, url: source.url, availableCount: candidates.length,
      selectedCount: items.filter((item) => item.sourceFeedUrl === source.url).length,
      status: error ? "unavailable" : "ready",
    })),
  };
}
