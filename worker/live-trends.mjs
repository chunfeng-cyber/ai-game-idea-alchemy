import { createHash } from "node:crypto";
import { collectChinaHotTrends } from "./china-hot-trends.mjs";
import { collectWorldHotTrends } from "./world-hot-trends.mjs";
import { trendItemIsFresh } from "./trend-time.mjs";

const DAY_MS = 86_400_000;
const CONCURRENCY = 4;
const SPAM = /博彩|赌博|娱乐城|下注|赔率|真人娱乐|棋牌|彩票|casino|cassino|gambling|betting|sportsbook|\bbets?\b|apostas|igaming|\bslots?\b|betmgm|boyd gaming|tribal gaming|gaming corporation|gaming and hospitality|\bg2e\b|draftkings|fanduel|成人|色情|sexual assault|sexual abuse|child sexual|性侵|性虐待/i;
const GAME_WORDS = /游戏|手游|电竞|小游戏|\bgames?\b|\bgaming\b|\besports?\b|playstation|nintendo|xbox|steam|ゲーム|게임|eスポーツ|e스포츠|jogo|juego|jeux|jeu vidéo|spiel|gioch|permainan|trò chơi|เกม|ألعاب|لعبة|oyun/i;
const STRONG_GAME_WORDS = /游戏|手游|电竞|\bgaming\b|\besports?\b|\b(?:video|mobile|console|indie|puzzle|casual|board|arcade) games?\b|playstation|nintendo|xbox|steam|ゲーム|게임/i;
const SPORTS_GAMES = /\b(?:asian|olympic|commonwealth|paralympic) games\b|\b(?:golf|basketball|baseball|soccer|hockey|cricket|nfl|nba|mlb)\b/i;
const REAL_INCIDENT_NEWS = /sexually\s+(?:abus\w*|assault\w*|exploit\w*)|sexual\s+(?:abuse|assault|exploitation)|\b(?:terror|terrorism|terrorist|murder|rape|fraud|criminal)\s+(?:charges?|trial|case|investigation)\b|\b(?:arrested|indicted|sentenced)\s+(?:for|over|with|after|in)\b|\b(?:hit|struck|run over)\s+by\s+(?:a\s+)?(?:car|truck|vehicle|train)\b|性侵|性虐待|猥亵|强奸|恐怖主义指控|被车撞|被撞身亡|车祸|交通事故/i;
const COUNTRIES = [
  ["美国", "欧美", "US", "en-US", "US:en", "United States"],
  ["加拿大", "欧美", "CA", "en-CA", "CA:en", "Canada"],
  ["英国", "欧美", "GB", "en-GB", "GB:en", "United Kingdom"],
  ["法国", "欧美", "FR", "fr", "FR:fr", "France"],
  ["德国", "欧美", "DE", "de", "DE:de", "Germany"],
  ["意大利", "欧美", "IT", "it", "IT:it", "Italy"],
  ["西班牙", "欧美", "ES", "es", "ES:es", "Spain"],
  ["中国大陆", "中国", "CN", "zh-CN", "CN:zh-Hans", "中国", false],
  ["中国香港", "中国", "HK", "zh-HK", "HK:zh-Hant", "香港"],
  ["中国台湾", "中国", "TW", "zh-TW", "TW:zh-Hant", "台灣"],
  ["印度尼西亚", "东南亚", "ID", "id", "ID:id", "Indonesia"],
  ["泰国", "东南亚", "TH", "th", "TH:th", "Thailand"],
  ["越南", "东南亚", "VN", "vi", "VN:vi", "Vietnam"],
  ["菲律宾", "东南亚", "PH", "en-PH", "PH:en", "Philippines"],
  ["马来西亚", "东南亚", "MY", "en-MY", "MY:en", "Malaysia"],
  ["新加坡", "东南亚", "SG", "en-SG", "SG:en", "Singapore"],
  ["日本", "日韩", "JP", "ja", "JP:ja", "日本"],
  ["韩国", "日韩", "KR", "ko", "KR:ko", "한국"],
  ["巴西", "拉美", "BR", "pt-BR", "BR:pt-419", "Brasil"],
  ["墨西哥", "拉美", "MX", "es-419", "MX:es-419", "Mexico"],
  ["阿根廷", "拉美", "AR", "es-419", "AR:es-419", "Argentina"],
  ["哥伦比亚", "拉美", "CO", "es-419", "CO:es-419", "Colombia"],
  ["智利", "拉美", "CL", "es-419", "CL:es-419", "Chile"],
  ["沙特阿拉伯", "中东", "SA", "ar", "SA:ar", "Saudi Arabia"],
  ["阿联酋", "中东", "AE", "ar", "AE:ar", "United Arab Emirates"],
  ["土耳其", "中东", "TR", "tr", "TR:tr", "Turkey"],
  ["埃及", "中东", "EG", "ar", "EG:ar", "Egypt"],
].map(([country, region, geo, hl, ceid, query, ranking = true]) => ({ country, region, geo, hl, ceid, query, ranking }));

const DEFAULT_COUNTRIES = ["美国", "英国", "中国大陆", "印度尼西亚", "日本", "巴西", "沙特阿拉伯"];
const CHANNEL_WORDS = new Map([
  ["TikTok", /tiktok/i], ["Instagram", /instagram/i], ["Facebook", /facebook/i],
  ["YouTube Shorts", /\byoutube(?:['’]s)?(?:\s+(?:launches|expands|updates|introduces|adds|tests))?\s+shorts\b|\bshorts\s+(?:on|for|from|by)\s+youtube\b|youtube短视频/i],
  ["X", /\btwitter\b|\bx(?:['’]s)?\s+(?:platform|app|social network|users|posts)\b|X\s*(?:平台|社交平台|应用)/i],
  ["Reddit", /reddit/i],
  ["抖音", /抖音|douyin/i], ["微博", /微博|weibo/i], ["快手", /快手|kuaishou/i],
  ["小红书", /小红书|xiaohongshu|rednote/i], ["B站", /bilibili|b站|哔哩哔哩/i],
  ["视频号", /视频号|wechat channels/i], ["Kwai", /kwai|快手/i],
  ["SnackVideo / Kwai", /snackvideo|kwai/i],
  ["LINE", /\bline\s+(?:messenger|messaging|app|chat|games?|pay|stickers?|corporation|friends|voom|mini app)\b|LINE\s*(?:应用|聊天|通讯|通信|即时通讯|贴图|貼圖|スタンプ|アプリ|メッセンジャー|友だち|ゲーム|ミニアプリ)|ライン.{0,20}(?:アプリ|スタンプ|ゲーム)/i],
  ["Zalo", /\bzalo\b/i], ["Snapchat", /snapchat/i],
]);

function decodeXml(value = "") {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(x[\da-f]+|\d+);/gi, (match, code) => {
      const point = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code);
      return point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
    })
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&").trim();
}

function xmlField(block, name) {
  return decodeXml(block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1] || "");
}

function safeHttps(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch { return false; }
}

function shorten(value, length) {
  const chars = Array.from(value.replace(/\s+/g, " ").trim());
  return chars.length > length ? `${chars.slice(0, length - 1).join("")}…` : chars.join("");
}

function selectCountries(scope) {
  const requested = scope.country;
  if (requested && !["全球", "自动选择", "全部", "全国家"].includes(requested)) {
    return COUNTRIES.filter((entry) => entry.country === requested
      && (!scope.region || scope.region === "全球" || entry.region === scope.region));
  }
  if (scope.region && scope.region !== "全球") return COUNTRIES.filter((entry) => entry.region === scope.region).slice(0, 5);
  return DEFAULT_COUNTRIES.map((country) => COUNTRIES.find((entry) => entry.country === country));
}

function sourcesFor(scope) {
  const countries = selectCountries(scope);
  const channel = scope.channel || "全渠道";
  if (!["全渠道", "Google Trends", "新闻观察"].includes(channel)) return [];
  if (channel !== "新闻观察") return countries
    .filter((country) => country.ranking)
    .map((country) => ({ ...country, kind: "trend-ranking", channel: "Google Trends", observedChannel: "Google Trends", url: `https://trends.google.com/trending/rss?geo=${country.geo}` }));
  return countries.map((country) => {
    const query = `${country.geo === "CN" || country.geo === "HK" || country.geo === "TW" ? "(游戏 OR 电竞 OR 小游戏)" : '(gaming OR "video games" OR "mobile games" OR esports)'} ${country.query} when:7d -casino -gambling -betting -slot -sportsbook`;
    const url = new URL("https://news.google.com/rss/search");
    for (const [key, value] of Object.entries({ q: query, hl: country.hl, gl: country.geo, ceid: country.ceid })) url.searchParams.set(key, value);
    return { ...country, kind: "news-observation", channel: "新闻观察", observedChannel: "新闻观察", url: url.toString() };
  });
}

function parseItems(xml, source, nowMs) {
  if (typeof xml !== "string" || xml.length > 2_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml) || !/<rss\b/i.test(xml)) throw new Error("来源未返回有效 RSS");
  const maxAge = source.kind === "trend-ranking" ? DAY_MS : 7 * DAY_MS;
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].flatMap((match) => {
    const block = match[1];
    const title = xmlField(block, "title");
    const link = xmlField(block, "link");
    const published = Date.parse(xmlField(block, "pubDate"));
    if (!title || !safeHttps(link) || !Number.isFinite(published) || published > nowMs + 600_000 || nowMs - published > maxAge || SPAM.test(title) || REAL_INCIDENT_NEWS.test(title)) return [];
    const publisher = xmlField(block, "source") || (source.kind === "trend-ranking" ? "Google Trends" : "Google News RSS");
    const label = title.endsWith(` - ${publisher}`) ? title.slice(0, -publisher.length - 3) : title;
    if (source.kind === "news-observation") {
      if (REAL_INCIDENT_NEWS.test(label)) return [];
      const pattern = CHANNEL_WORDS.get(source.observedChannel);
      if (pattern ? !pattern.test(label) : (!GAME_WORDS.test(label) || (SPORTS_GAMES.test(label) && !STRONG_GAME_WORDS.test(label)))) return [];
    }
    const ranking = source.kind === "trend-ranking";
    const hours = Math.max(0, Math.floor((nowMs - published) / 3_600_000));
    const relatedArticles = ranking ? [...block.matchAll(/<ht:news_item>([\s\S]*?)<\/ht:news_item>/gi)].flatMap((entry) => {
      const url = xmlField(entry[1], "ht:news_item_url");
      return safeHttps(url) ? [{ title: xmlField(entry[1], "ht:news_item_title"), url, publisher: xmlField(entry[1], "ht:news_item_source") }] : [];
    }) : [];
    // The official Trends feed uses one shared link for every topic; include its raw topic to prevent collisions.
    const identity = ranking ? `${link}#${encodeURIComponent(title)}` : link;
    return [{
      id: `live-${createHash("sha256").update(identity).digest("hex").slice(0, 20)}`,
      region: source.region, country: source.country, channel: source.channel, observedChannel: source.observedChannel,
      shortLabel: shorten(label, 24), label: shorten(label, 80), icon: ranking ? "📈" : "📰",
      freshness: hours < 1 ? "1 小时内发布" : hours < 24 ? `${hours} 小时内发布` : `${Math.floor(hours / 24)} 天内发布`,
      evidence: shorten(ranking ? `${source.country} Google Trends 当前搜索趋势榜收录“${title}”；属于搜索趋势，不能解释为社交平台热榜。`
        : `${source.country}版 Google News RSS 收录 ${publisher} 的“${title}”；这是近期资讯观察，未证实平台热榜或传播热度。`, 220),
      whyGameable: "可把来源主题转化为原创角色、关卡目标或视觉钩子；具体玩法需按本次配方推导。",
      risk: "需核对题材语境及版权；资讯收录不等于买量效果或平台热度。",
      sourceTitle: title, sourceUrl: link, sourcePublishedAt: new Date(published).toISOString(),
      sourceKind: source.kind, sourceName: publisher, sourceFeedUrl: source.url,
      sourceTimeKind: "published", geoScope: "country",
      approxTraffic: ranking ? xmlField(block, "ht:approx_traffic") : "", relatedArticles,
    }];
  });
}

function trafficValue(value) {
  const text = String(value || '').replace(/[,+]/g, '');
  const amount = Number.parseFloat(text);
  return Number.isFinite(amount) ? amount * (/M/i.test(text) ? 1_000_000 : /K/i.test(text) ? 1000 : 1) : 0;
}

/** Original public boards and regional search trends. News remains an explicit independent channel. */
export async function collectLiveTrends({ fetchText, scope = {}, now = new Date(), limit = 24, onProgress } = {}) {
  if (typeof fetchText !== 'function') throw new TypeError('fetchText 必须是网络读取函数');
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(nowMs)) throw new TypeError('now 必须是有效时间');
  const itemLimit = Math.max(1, Math.min(40, Math.floor(Number(limit)) || 24));
  const fetchedAt = new Date(nowMs).toISOString();
  const results = new Map();
  // The same network budget also covers native collectors and HN story details.
  let active = 0;
  const queue = [];
  const limitedFetch = async (url) => {
    await new Promise((resolve) => {
      const start = () => { active += 1; resolve(); };
      if (active < CONCURRENCY) start(); else queue.push(start);
    });
    try { return await fetchText(url); }
    finally { active -= 1; queue.shift()?.(); }
  };
  limitedFetch.observedAt = fetchText.observedAt;
  const snapshot = () => {
    // Round robin across individual feeds, preserving each feed's own order.
    // Sorting feed keys makes final selection independent of network completion order.
    const entries = [...results.values()].sort((a, b) => a.source.url.localeCompare(b.source.url));
    const items = [];
    const seen = new Set();
    for (let row = 0; row < itemLimit && items.length < itemLimit; row += 1) {
      for (const result of entries) {
        const item = result.items[row];
        if (!item || seen.has(item.id) || !trendItemIsFresh(item, nowMs)) continue;
        seen.add(item.id); items.push(item);
        if (items.length >= itemLimit) break;
      }
    }
    return { items, fetchedAt,
      errors: entries.filter((result) => result.error).map(({source, error}) => ({country: source.country || '全球', channel: source.channel, sourceKind: source.kind, url: source.url, message: error})),
      sourceSummary: entries.map(({source, items: candidates, error}) => ({
        country: source.country || '全球', region: source.region || '全球', channel: source.channel,
        sourceName: source.sourceName || source.name || source.channel,
        sourceKind: source.kind, geoScope: source.geoScope || 'country', language: source.language || '',
        periodDate: source.periodDate || '', url: source.url, availableCount: candidates.length,
        observedAt: candidates[0]?.sourceObservedAt || '',
        selectedCount: items.filter((item) => item.sourceFeedUrl === source.url).length, status: error ? 'unavailable' : 'ready',
      })),
    };
  };
  const add = (result) => {
    results.set(result.source.url, result);
    onProgress?.(snapshot());
  };
  if (!selectCountries(scope).length) {
    return {items: [], fetchedAt, errors: [{message: '检索范围没有受支持的国家'}], sourceSummary: []};
  }
  const channel = scope.channel || '全渠道';
  const supported = ['全渠道', 'Google Trends', '新闻观察', '抖音', 'B站', '头条', 'Reddit', 'Wikipedia', 'Hacker News'];
  if (!supported.includes(channel)) {
    add({source: {url: '', channel, country: scope.country, kind: 'unsupported'}, items: [], error: channel + ' 尚无可稳定读取的公开热榜接口'});
    return snapshot();
  }
  const tasks = [];
  if (channel !== '新闻观察' && channel !== 'Google Trends') {
    tasks.push(collectChinaHotTrends({fetchText: limitedFetch, scope, now, limit: 10, onProgress: add}));
    tasks.push(collectWorldHotTrends({fetchText: limitedFetch, scope, now, limit: 40, onProgress: add}));
  }
  for (const source of sourcesFor(scope)) {
    tasks.push((async () => {
      try {
        const items = parseItems(await limitedFetch(source.url), source, nowMs);
        if (source.kind === 'trend-ranking') {
          for (const item of items) { item.metricValue = trafficValue(item.approxTraffic); item.metricLabel = '搜索量（约）'; }
          items.sort((a, b) => b.metricValue - a.metricValue);
        } else items.sort((a, b) => Date.parse(b.sourcePublishedAt) - Date.parse(a.sourcePublishedAt));
        add({source, items, error: items.length ? '' : '未找到时效与内容均可核验的条目'});
      } catch { add({source, items: [], error: '公开来源读取失败'}); }
    })());
  }
  await Promise.all(tasks);
  if (!results.size) add({source: {url: '', channel, country: scope.country, kind: 'unsupported'}, items: [], error: '当前国家和渠道没有可用公开热榜'});
  return snapshot();
}
