import test from "node:test";
import assert from "node:assert/strict";
import { validatedReportSources } from "../worker/report-sources.mjs";

const NOW = Date.parse("2026-10-04T10:00:00Z");
const news = {
  sourceKind: "news-observation", sourceTitle: "New puzzle game - Publisher",
  sourceUrl: "https://example.com/puzzle-game", sourcePublishedAt: "2026-10-03T09:00:00Z",
};
const cite = (item, extra = {}) => ({ title: item.sourceTitle, url: item.sourceUrl, publishedAt: item.sourcePublishedAt, ...extra });

test("unknown and non-HTTPS citation links are rejected", () => {
  for (const url of ["https://invented.example/story", "http://example.com/puzzle-game", "javascript:alert(1)", "https://user:password@example.com/puzzle-game"]) {
    assert.throws(() => validatedReportSources([cite(news, { url })], [news], NOW), /来源/);
  }
});

test("news expires after seven days and ranking evidence expires after one day", () => {
  const oldNews = { ...news, sourcePublishedAt: "2026-09-27T09:59:59Z" };
  const oldRanking = { ...news, sourceKind: "trend-ranking", sourcePublishedAt: "2026-10-03T09:59:59Z" };
  assert.throws(() => validatedReportSources([cite(oldNews)], [oldNews], NOW), /过期/);
  assert.throws(() => validatedReportSources([cite(oldRanking)], [oldRanking], NOW), /过期/);
  const boundary = { ...news, sourcePublishedAt: "2026-09-27T10:00:00Z" };
  assert.equal(validatedReportSources([cite(boundary)], [boundary], NOW).length, 1);
});

test("the model's invented title and wrong date are replaced with actual source metadata", () => {
  const result = validatedReportSources([cite(news, { title: "unsupported model paraphrase", publishedAt: "2099-01-01" })], [news], NOW);
  assert.deepEqual(result, [{ title: news.sourceTitle, url: news.sourceUrl, publishedAt: "2026-10-03T09:00:00.000Z" }]);
});

test("shared ranking feed links require the matching full source title", () => {
  const url = "https://trends.google.com/trending/rss?geo=US";
  const topics = ["apple", "apple tv", "moon festival"].map((sourceTitle) => ({
    sourceKind: "trend-ranking", sourceTitle, sourceUrl: url, sourcePublishedAt: "2026-10-04T09:00:00Z",
  }));
  assert.equal(validatedReportSources([{ title: "apple tv", url }], topics, NOW)[0].title, "apple tv");
  assert.equal(validatedReportSources([{ title: "Current search: moon festival", url }], topics, NOW)[0].title, "moon festival");
  assert.throws(() => validatedReportSources([{ title: "invented topic", url }], topics, NOW), /未获取/);
});

test("missing citations, invalid source metadata and future evidence are rejected", () => {
  for (const sources of [undefined, [], Array.from({ length: 7 }, () => cite(news)), [null], [{ url: news.sourceUrl }]]) {
    assert.throws(() => validatedReportSources(sources, [news], NOW), /来源/);
  }
  for (const item of [
    { ...news, sourcePublishedAt: "" }, { ...news, sourcePublishedAt: "not a date" },
    { ...news, sourcePublishedAt: "2026-10-04T11:00:00Z" },
    { ...news, sourceKind: "fixed-seed" }, { ...news, sourceTitle: "" },
  ]) assert.throws(() => validatedReportSources([cite(news)], [item], NOW), /未获取|过期/);
});

test("platform citations use the actual snapshot time and identify its meaning", () => {
  const item = {...news, sourceKind: "platform-popular", sourceTimeKind: "observed", sourceObservedAt: "2026-10-04T09:55:00Z", sourcePublishedAt: "2020-01-01T00:00:00Z"};
  const result = validatedReportSources([cite(item)], [item], NOW);
  assert.equal(result[0].publishedAt, "2026-10-04T09:55:00.000Z");
  assert.match(result[0].title, /榜单采集/);
  const stale = {...item, sourceObservedAt: "2026-10-01T09:55:00Z"};
  assert.throws(() => validatedReportSources([cite(stale)], [stale], NOW), /过期/);
});

test("Wikipedia citations keep the dataset date instead of implying new article publication", () => {
  const item = {...news, sourceKind: "pageview-ranking", sourceTimeKind: "observed", sourceObservedAt: "2026-10-04T09:55:00Z", sourceDatasetDate: "2026-10-03"};
  assert.match(validatedReportSources([cite(item)], [item], NOW)[0].title, /2026-10-03 浏览榜/);
  assert.throws(() => validatedReportSources([cite(item)], [{...item, sourceDatasetDate: "2026-09-01"}], NOW), /过期/);
});
