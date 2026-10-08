import test from "node:test";
import assert from "node:assert/strict";
import { collectChinaHotTrends } from "../worker/china-hot-trends.mjs";

// Captured from official public endpoints on 2026-10-04; unnecessary image/owner payload omitted.
const NOW = "2026-10-04T07:42:00.000Z";
const DOUYIN = { active_time: "2026-10-04 15:37:26", status_code: 0, word_list: [
  { word: "市井人家的炊烟笑语总是令人心安", hot_value: 11687793, label: 1 },
  { word: "足球小将在日本夺冠", hot_value: 11293432, label: 3 },
  { word: "多重优惠叠加激活假日购物车", hot_value: 11141031, label: 1 },
] };
const BILIBILI = { code: 0, message: "OK", data: { list: [
  { title: "有用版新植物：空调寒冰", bvid: "BV1W7HY6xErH", pubdate: 1791011072, stat: { view: 4862069 } },
  { title: "真龙天子，全员影帝！丐帮帮主成皇帝了，最好笑的一局！万字细嗦《我不是大师》第五局 包含；剧情、细节、历史科普、骗术拆解等", bvid: "BV1J2Ha6mETY", pubdate: 1791020052, stat: { view: 1224178 } },
] } };
const TOUTIAO = { status: "success", data: [
  { Title: "男足亚运摘铜登上《新闻联播》", HotValue: "17557973", Url: "https://www.toutiao.com/trending/7692226716819275818/?category_name=topic_innerflow" },
  { Title: "中国游客听到China一呼百应", HotValue: "15887111", Url: "https://www.toutiao.com/trending/7691584884791590931/?category_name=topic_innerflow" },
] };
const fixtures = (overrides = {}) => async (url) => {
  const source = url.includes("iesdouyin") ? "douyin" : url.includes("bilibili") ? "bilibili" : "toutiao";
  const value = overrides[source] ?? { douyin: DOUYIN, bilibili: BILIBILI, toutiao: TOUTIAO }[source];
  return typeof value === "string" ? value : JSON.stringify(value);
};

test("real captured official responses retain source order and honest metadata", async () => {
  const result = await collectChinaHotTrends({ fetchText: fixtures(), now: NOW });
  assert.deepEqual(result.items.map((item) => item.channel), ["抖音", "B站", "头条", "抖音", "B站", "头条", "抖音"]);
  assert.deepEqual(result.sourceSummary.map((source) => source.status), ["ready", "ready", "ready"]);
  assert.equal(result.errors.length, 0);
  const [douyin, bili, toutiao] = result.items;
  assert.equal(douyin.sourceUpdatedAt, "2026-10-04T07:37:26.000Z");
  assert.equal(douyin.sourcePublishedAt, undefined);
  assert.equal(douyin.rank, 1);
  assert.equal(douyin.rankKind, "official");
  assert.equal(douyin.metricValue, 11687793);
  assert.equal(bili.rankKind, "list-position");
  assert.equal(bili.sourceKind, "platform-popular");
  assert.equal(bili.metricLabel, "播放量（累计）");
  assert.equal(bili.sourceUrl, "https://www.bilibili.com/video/BV1W7HY6xErH");
  assert.equal(bili.sourcePublishedAt, new Date(1791011072 * 1000).toISOString());
  assert.equal(toutiao.sourcePublishedAt, undefined);
  assert.equal(toutiao.sourceUpdatedAt, undefined);
  assert.match(toutiao.sourceUrl, /7692226716819275818/);
  assert.equal(new URL(toutiao.sourceUrl).search, "");
  for (const item of result.items) {
    assert.equal(item.sourceObservedAt, NOW);
    assert.equal(item.sourceTimeKind, "observed");
    assert.equal(item.country, "中国大陆");
    assert.equal(item.geoScope, "country");
  }
});

test("country and regional scope never labels mainland boards as Hong Kong or Taiwan", async () => {
  for (const scope of [{ country: "中国香港" }, { country: "中国台湾" }, { country: "日本" }, { region: "日韩" }, { region: "欧美", country: "中国大陆" }]) {
    let requests = 0;
    const result = await collectChinaHotTrends({ fetchText: async () => { requests += 1; return ""; }, scope, now: NOW });
    assert.equal(requests, 0);
    assert.equal(result.items.length, 0);
  }
  const result = await collectChinaHotTrends({ fetchText: fixtures(), scope: { region: "中国", country: "中国大陆", channel: "抖音" }, now: NOW });
  assert.equal(result.sourceSummary.length, 1);
  assert.equal(result.items.length, 3);
  assert.ok(result.items.every((item) => item.channel === "抖音"));
  const noMatch = await collectChinaHotTrends({ fetchText: fixtures(), scope: { channel: "微博" }, now: NOW });
  assert.equal(noMatch.items.length, 0);
});

test("old video publication dates remain valid in a freshly observed popular list", async () => {
  const oldBili = structuredClone(BILIBILI);
  oldBili.data.list[0].pubdate = 1600000000;
  const result = await collectChinaHotTrends({ fetchText: fixtures({ bilibili: oldBili }), scope: { channel: "B站" }, now: NOW });
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].sourcePublishedAt, new Date(1600000000 * 1000).toISOString());
  assert.equal(result.items[0].sourceObservedAt, NOW);
});

test("non JSON challenges, business errors, and stale updates fail without fallback content", async () => {
  const result = await collectChinaHotTrends({ fetchText: fixtures({
    douyin: { ...DOUYIN, active_time: "2026-10-01 15:37:26" },
    bilibili: { code: -352, message: "-352" },
    toutiao: "<!doctype html><title>Sina Visitor System</title>",
  }), now: NOW });
  assert.equal(result.items.length, 0);
  assert.equal(result.errors.length, 3);
  assert.ok(result.sourceSummary.every((source) => source.status === "unavailable"));
  assert.match(result.errors[0].message, /过期/);
  assert.match(result.errors[1].message, /业务错误/);
  assert.match(result.errors[2].message, /JSON/);
});

test("filtering unsuitable topics preserves official ranks and other sources survive failure", async () => {
  const filteredDouyin = { ...DOUYIN, word_list: [{ word: "博彩下注赔率", hot_value: 999 }, { word: "市井人家的炊烟笑语总是令人心安", hot_value: 12 }] };
  const result = await collectChinaHotTrends({ fetchText: fixtures({ douyin: filteredDouyin, toutiao: { status: "error", data: [] } }), now: NOW });
  const douyin = result.items.find((item) => item.channel === "抖音");
  assert.equal(douyin.rank, 2);
  assert.equal(result.items.some((item) => /博彩/.test(item.label)), false);
  assert.equal(result.errors.length, 1);
  assert.ok(result.items.some((item) => item.channel === "B站"));
});

test("source fetch exceptions do not expose credentials and requests never exceed three", async () => {
  let active = 0;
  let maximum = 0;
  const result = await collectChinaHotTrends({ fetchText: async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    throw new Error("Bearer secret-token");
  }, now: NOW });
  assert.equal(maximum, 3);
  assert.equal(result.items.length, 0);
  assert.equal(JSON.stringify(result).includes("secret-token"), false);
});

test("invalid links and malformed active_time are rejected, and limit applies after round robin", async () => {
  const invalidToutiao = { status: "success", data: [{ Title: "不可靠链接", Url: "https://evil.example/123", HotValue: "1" }] };
  const result = await collectChinaHotTrends({ fetchText: fixtures({ toutiao: invalidToutiao }), now: NOW, limit: 2 });
  assert.equal(result.items.length, 2);
  assert.equal(result.errors.length, 1);
  const missingDate = await collectChinaHotTrends({ fetchText: fixtures({ douyin: { ...DOUYIN, active_time: "today" } }), now: NOW, scope: { channel: "抖音" } });
  assert.equal(missingDate.items.length, 0);
  await assert.rejects(collectChinaHotTrends({ fetchText: fixtures(), now: "invalid" }), /有效时间/);
});
