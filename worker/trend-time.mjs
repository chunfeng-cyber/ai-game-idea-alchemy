const DAY_MS = 86_400_000;
const SNAPSHOT_KINDS = new Set(["platform-ranking", "platform-popular", "discussion-popular", "pageview-ranking"]);

export function trendItemTimestamp(item) {
  const value = item?.sourceTimeKind === "observed" ? item.sourceObservedAt : item?.sourcePublishedAt;
  const ms = typeof value === "string" && value.trim() ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function trendItemIsFresh(item, now = Date.now()) {
  const nowMs = typeof now === "number" ? now : new Date(now).getTime();
  const timestamp = trendItemTimestamp(item);
  const ms = timestamp ? Date.parse(timestamp) : NaN;
  if (!Number.isFinite(nowMs) || !Number.isFinite(ms) || ms > nowMs + 600_000) return false;
  if (["trend-ranking", "news-observation"].includes(item?.sourceKind)) {
    return item.sourceTimeKind !== "observed" && nowMs - ms <= (item.sourceKind === "trend-ranking" ? DAY_MS : 7 * DAY_MS);
  }
  if (!SNAPSHOT_KINDS.has(item?.sourceKind) || item.sourceTimeKind !== "observed" || nowMs - ms > DAY_MS) return false;
  for (const field of ["sourcePublishedAt", "sourceUpdatedAt"]) {
    if (item[field] == null) continue;
    const other = Date.parse(item[field]);
    if (!Number.isFinite(other) || other > nowMs + 600_000) return false;
    if (field === "sourceUpdatedAt" && nowMs - other > DAY_MS) return false;
  }
  if (item.sourceKind === "pageview-ranking") {
    const date = item.sourceDatasetDate || item.periodDate;
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    const dateMs = Date.parse(`${date}T00:00:00Z`);
    if (!Number.isFinite(dateMs) || new Date(dateMs).toISOString().slice(0, 10) !== date) return false;
    const today = Math.floor(nowMs / DAY_MS) * DAY_MS;
    if (dateMs >= today || today - dateMs > 3 * DAY_MS) return false;
  }
  return true;
}

export function trendCitationTitle(item) {
  if (item.sourceKind === "pageview-ranking") return `${item.sourceTitle}（${item.sourceDatasetDate || item.periodDate} 浏览榜）`;
  if (item.sourceTimeKind === "observed") return `${item.sourceTitle}（榜单采集）`;
  return item.sourceTitle;
}
