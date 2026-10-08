import test from 'node:test';
import assert from 'node:assert/strict';
import {trendItemIsFresh,trendItemTimestamp} from '../worker/trend-time.mjs';
const now=Date.parse('2026-10-04T10:00:00Z');
const popular={sourceKind:'platform-popular',sourceTimeKind:'observed',sourceObservedAt:'2026-10-04T09:55:00Z',sourcePublishedAt:'2020-01-01T00:00:00Z'};
test('current popular snapshots remain valid even for older videos',()=>{
 assert.ok(trendItemIsFresh(popular,now));assert.equal(trendItemTimestamp(popular),'2026-10-04T09:55:00.000Z');
 for(const item of [{...popular,sourceObservedAt:'2026-10-02T09:00:00Z'},{...popular,sourcePublishedAt:'2099-01-01'},{...popular,sourcePublishedAt:'invalid'},{...popular,sourceUpdatedAt:'2026-10-01T00:00:00Z'}])assert.equal(trendItemIsFresh(item,now),false);
});
test('fresh collection cannot conceal an old or invalid daily dataset',()=>{
 const wiki={sourceKind:'pageview-ranking',sourceTimeKind:'observed',sourceObservedAt:'2026-10-04T09:55:00Z',sourceDatasetDate:'2026-10-03'};
 assert.ok(trendItemIsFresh(wiki,now));
 for(const date of ['2026-09-30','2026-10-04','2026-02-30','invalid',''])assert.equal(trendItemIsFresh({...wiki,sourceDatasetDate:date},now),false,date);
});
test('published news and search trends keep separate time windows',()=>{
 const item={sourceKind:'news-observation',sourcePublishedAt:'2026-10-02T09:00:00Z'};assert.ok(trendItemIsFresh(item,now));assert.equal(trendItemIsFresh({...item,sourceKind:'trend-ranking'},now),false);
 assert.equal(trendItemIsFresh({...item,sourceKind:'fixed-seed'},now),false);
});
