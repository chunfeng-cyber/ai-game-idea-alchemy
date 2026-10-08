import test from 'node:test';
import assert from 'node:assert/strict';
import {collectWorldHotTrends} from '../worker/world-hot-trends.mjs';
const now='2026-10-04T10:00:00Z';
const wiki=JSON.stringify({items:[{project:'ja.wikipedia',access:'all-access',year:'2026',month:'10',day:'03',articles:[{article:'メインページ',rank:1,views:900},{article:'Garden_Game',rank:7,views:800}]}]});
test('Japanese language reading rankings retain original rank and never claim country traffic',async()=>{
 const out=await collectWorldHotTrends({scope:{region:'日韩',country:'日本',channel:'Wikipedia'},now,fetchText:async()=>wiki});
 assert.equal(out.items.length,1);const item=out.items[0];assert.equal(item.rank,7);assert.equal(item.metricValue,800);assert.equal(item.country,'全球');assert.equal(item.geoScope,'language');assert.equal(item.sourceDatasetDate,'2026-10-03');
});
test('old datasets and malformed authentication pages produce an unavailable source',async()=>{
 for(const body of [wiki.replace('"03"','"01"'),'<html>login</html>']){
 const out=await collectWorldHotTrends({scope:{country:'日本',channel:'Wikipedia'},now,fetchText:async()=>body});assert.equal(out.items.length,0);assert.equal(out.errors.length,1);
 }
});
test('Reddit list order is preserved without inventing votes and old pinned entries are omitted',async()=>{
 const body='<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Old pinned game</title><link href="https://www.reddit.com/old"/><updated>2025-01-01T09:00:00Z</updated></entry><entry><title>New game</title><link href="https://www.reddit.com/new"/><updated>2026-10-04T09:00:00Z</updated></entry></feed>';
 const out=await collectWorldHotTrends({scope:{channel:'Reddit'},now,fetchText:async()=>body});assert.equal(out.items.length,1);assert.equal(out.items[0].rank,2);assert.equal(out.items[0].rankKind,'list-position');assert.equal(out.items[0].sourcePublishedAt,'2026-10-04T09:00:00.000Z');
});
