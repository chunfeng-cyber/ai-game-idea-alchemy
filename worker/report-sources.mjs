import { trendItemIsFresh, trendItemTimestamp, trendCitationTitle } from "./trend-time.mjs";

function httpsUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch { return false; }
}

function usableItem(item, now) {
  if (!item || typeof item !== "object" || !httpsUrl(item.sourceUrl)
    || typeof item.sourceTitle !== "string" || !item.sourceTitle.trim()
    || !trendItemIsFresh(item, now)) return false;
  return true;
}

/** Validate model citations against the actual, fresh evidence supplied for this request. */
export function validatedReportSources(sources, items, now = Date.now()) {
  const nowMs = typeof now === "number" ? now : new Date(now).getTime();
  if (!Number.isFinite(nowMs)) throw new TypeError("来源校验时间无效");
  if (!Array.isArray(sources) || sources.length < 1 || sources.length > 6) {
    throw new Error("报告必须包含 1–6 条本次获取的来源");
  }
  const usable = (Array.isArray(items) ? items : []).filter((item) => usableItem(item, nowMs));
  return sources.map((source) => {
    if (!source || typeof source !== "object" || !httpsUrl(source.url)
      || typeof source.title !== "string" || !source.title.trim()) {
      throw new Error("报告包含缺失或无效的 HTTPS 来源");
    }
    const matches = usable.filter((item) => item.sourceUrl === source.url
      && (item.sourceKind !== "trend-ranking" || source.title.includes(item.sourceTitle)));
    // Ranking topics share a feed URL. Prefer an exact raw title, then the most specific included title.
    const match = matches.find((item) => item.sourceTitle === source.title)
      || matches.sort((left, right) => right.sourceTitle.length - left.sourceTitle.length)[0];
    if (!match) throw new Error("报告引用了本次未获取或已过期的来源，请刷新热点后重试");
    return { title: trendCitationTitle(match), url: match.sourceUrl, publishedAt: trendItemTimestamp(match) };
  });
}
