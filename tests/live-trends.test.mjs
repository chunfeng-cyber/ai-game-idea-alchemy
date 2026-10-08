import test from 'node:test';
import assert from 'node:assert/strict';
import {collectLiveTrends} from '../worker/live-trends.mjs';
const NOW='2026-10-04T10:00:00Z';
const rss=(titles, url='https://example.com/story') => '<rss><channel>'+titles.map((title,i)=>'<item><title>'+title+'</title><link>'+url+(url.includes('trends.google')?'':'/'+i)+'</link><pubDate>Sun, 04 Oct 2026 09:00:00 GMT</pubDate><ht:approx_traffic>20K+</ht:approx_traffic><source>Example News</source></item>').join('')+'</channel></rss>';
const scope={region:'欧美',country:'美国',channel:'Google Trends'};
const atom='<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Tiny garden game</title><link href="https://www.reddit.com/r/gaming/comments/xyz/tiny_garden/"/><updated>2026-10-04T09:00:00Z</updated></entry></feed>';
const fixture=async url=> {
 if(url.includes('iesdouyin'))return JSON.stringify({status_code:0,active_time:'2026-10-04 17:55:00',word_list:[{word:'小猫假日',hot_value:10000}]});
 if(url.includes('bilibili'))return JSON.stringify({code:0,data:{list:[{title:'花园小游戏',bvid:'BV1W7HY6xErH',pubdate:1600000000,stat:{view:1234567}}]}});
 if(url.includes('toutiao'))return JSON.stringify({status:'success',data:[{Title:'假日旅行',Url:'https://www.toutiao.com/trending/123/',HotValue:'8000'}]});
 if(url.includes('reddit'))return atom;
 if(url.includes('wikimedia')){const lang=url.match(/top\/(\w+)\.wikipedia/)[1];return JSON.stringify({items:[{project:lang+'.wikipedia',access:'all-access',year:'2026',month:'10',day:'03',articles:[{article:'Garden_Game',rank:5,views:12345}]}]});}
 if(url.includes('topstories'))return '[42]';
 if(url.includes('/item/'))return JSON.stringify({id:42,type:'story',title:'New puzzle editor',time:1791100800,score:123,descendants:5});
 return rss(['Garden festival','Moon viewing'],url);
};

test('regional search topics change with the fetched batch and shared feed links retain separate IDs',async()=>{
 const a=await collectLiveTrends({scope,now:NOW,fetchText:async url=>rss(['apple','apple tv'],url)});
 const b=await collectLiveTrends({scope,now:NOW,fetchText:async url=>rss(['moon festival'],url)});
 assert.equal(a.items.length,2);assert.notEqual(a.items[0].id,a.items[1].id);assert.notEqual(a.items[0].id,b.items[0].id);
 assert.equal(a.items[0].metricValue,20000);assert.equal(a.items[0].rank,undefined);
});

test('global scope uses native boards and regional search sources without news substitutions',async()=>{
 const urls=[]; const out=await collectLiveTrends({now:NOW,fetchText:async url=>{urls.push(url);return fixture(url);}});
 assert.equal(urls.some(url=>url.includes('news.google')),false);
 for(const channel of ['抖音','B站','头条','Reddit','Wikipedia','Hacker News','Google Trends'])assert.ok(out.items.some(item=>item.channel===channel),channel);
 assert.equal(out.errors.length,0);
 assert.ok(out.items.filter(item=>item.channel==='Wikipedia').every(item=>item.country==='全球'&&item.geoScope==='language'));
 assert.equal(out.items.find(item=>item.channel==='B站').sourcePublishedAt,'2020-09-13T12:26:40.000Z');
 assert.ok(out.sourceSummary.some(source=>source.country==='英国'));
});

test('unsupported social channels make no network requests and never receive platform news',async()=>{
 for(const channel of ['TikTok','Instagram','微博','YouTube Shorts','X','LINE']){
 let calls=0;const out=await collectLiveTrends({scope:{...scope,channel},now:NOW,fetchText:async()=>{calls++;return fixture('');}});
 assert.equal(calls,0);assert.deepEqual(out.items,[]);assert.match(out.errors[0].message,/尚无/);
 }
});

test('a slow source does not delay progress from a successful native board',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;});let partial;
 const done=collectLiveTrends({scope:{region:'中国',country:'中国大陆',channel:'全渠道'},now:NOW,onProgress:out=>{if(out.items.some(item=>item.channel==='抖音'))partial=out;},fetchText:async url=>{if(url.includes('bilibili'))await gate;return fixture(url);}});
 await new Promise(resolve=>setTimeout(resolve,25));assert.ok(partial);release();await done;
});

test('request concurrency stays within four including native boards and story detail requests',async()=>{
 let active=0,peak=0;const out=await collectLiveTrends({now:NOW,fetchText:async url=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,5));active--;return fixture(url);}});
 assert.ok(peak<=4);assert.ok(out.items.length<=24);assert.ok(out.items.length>10);
});

test('news is available only through its independent channel and filters unsuitable subjects',async()=>{
 const out=await collectLiveTrends({scope:{...scope,channel:'新闻观察'},now:NOW,fetchText:async()=>rss(['New puzzle game','Weather report','Casino game','Asian Games golf medal','Child sexual assault involving gaming apps'])});
 assert.deepEqual(out.items.map(item=>item.sourceTitle),['New puzzle game']);assert.equal(out.items[0].channel,'新闻观察');
});

test('source failures and unknown country do not fabricate evidence or expose fetch error details',async()=>{
 const bad=await collectLiveTrends({scope,now:NOW,fetchText:async()=>{throw new Error('Bearer secret-key');}});
 assert.deepEqual(bad.items,[]);assert.equal(bad.errors.length,1);assert.doesNotMatch(JSON.stringify(bad),/secret-key/);
 let calls=0;const unknown=await collectLiveTrends({scope:{country:'不存在'},now:NOW,fetchText:async()=>{calls++;return '';}});assert.equal(calls,0);assert.equal(unknown.items.length,0);
 const html=await collectLiveTrends({scope,now:NOW,fetchText:async()=>'<html>login</html>'});assert.deepEqual(html.items,[]);
});
