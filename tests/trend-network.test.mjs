import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchTrendText, validateTrendSourceUrl } from '../worker/trend-network.mjs';
const source = 'https://trends.google.com/trending/rss?geo=US';

test('source network accepts only official HTTPS hosts and revalidates redirects', async () => {
  for (const value of ['http://trends.google.com/', 'https://user:pass@trends.google.com/', 'https://localhost/',
    'https://127.0.0.1/', 'https://trends.google.com.attacker.test/', 'https://trends.google.com:444/']) {
    assert.throws(() => validateTrendSourceUrl(value), /白名单/);
  }
  let calls = 0;
  await assert.rejects(fetchTrendText(source, 1000, { platform: 'linux', fetchImpl: async () => {
    calls += 1; return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } });
  } }), /白名单/);
  assert.equal(calls, 1);
  assert.equal(await fetchTrendText(source, 1000, { platform: 'linux', fetchImpl: async (_, options) => {
    assert.equal(options.redirect, 'manual'); return new Response('中文热榜');
  } }), '中文热榜');
});

test('chunked oversized feeds are bounded and HTTP errors retain only the status', async () => {
  await assert.rejects(fetchTrendText(source, 1000, { platform: 'linux', fetchImpl: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(2_000_001)); controller.close(); },
  })) }), /内容过大/);
  await assert.rejects(fetchTrendText(source, 1000, { platform: 'linux', fetchImpl: async () => new Response('private details', { status: 429 }) }), { status: 429 });
});
