import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import { html, environment, report, notification, widget } from './helpers/widget-harness.mjs';

test('shared URL validator rejects active protocols, credentials and ambiguous URLs', () => {
  const { security } = environment();
  for (const url of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>', 'data:image/svg+xml,<svg/>', 'file:///etc/passwd', 'blob:https://example.com/id', '//evil.example/path', 'https://user:password@example.com/', 'https://example.com/\nattack', 'https://example.com\\@evil.example/', '']) {
    assert.equal(security.safeWebUrl(url, true), '', url);
    assert.equal(security.safeAssetUrl(url), '', url);
  }
  assert.equal(security.safeWebUrl('https://example.com/a?q=1'), 'https://example.com/a?q=1');
  assert.equal(security.safeAssetUrl('/generated/poster.png?v=12'), '/generated/poster.png?v=12');
  assert.equal(security.safeAssetUrl('http://127.0.0.1:3000/generated/poster.png?v=12'), '/generated/poster.png?v=12');
  assert.equal(security.safeWebUrl('/generated/poster.png'), '', 'sources require an absolute HTTP(S) URL');
});

test('local tool-result notifications require the exact same-origin parent and JSON-RPC envelope', () => {
  const { security, parent } = environment();
  const calls = [];
  const event = notification(parent, report());
  for (const badEvent of [
    { ...event, origin: 'https://evil.example' },
    { ...event, origin: 'null' },
    { ...event, source: {} },
    { ...event, data: { ...event.data, jsonrpc: undefined } },
    { ...event, data: { ...event.data, method: 'other' } },
  ]) assert.equal(security.handleToolResult(badEvent, output => calls.push(output)), false);
  assert.equal(calls.length, 0, 'rejected windows cannot update results');
  assert.equal(security.handleToolResult(event, output => calls.push(output)), true);
  assert.equal(calls.length, 1);
});

test('host notifications preserve injected ChatGPT bridge support while rejecting other windows and origins', () => {
  const { security, parent } = environment({ origin: 'https://widget.example', referrer: 'https://chatgpt.com/conversation', bridge: true });
  const event = notification(parent, report({ imageUrl: 'https://images.example/game.png', posterUrl: 'https://images.example/poster.png' }), 'https://chatgpt.com');
  assert.equal(security.handleToolResult(event, () => {}), true);
  assert.equal(security.handleToolResult({ ...event, source: {} }, () => {}), false);
  assert.equal(security.handleToolResult({ ...event, origin: 'https://evil.example' }, () => {}), false);
  assert.equal(security.handleToolResult({ ...event, origin: 'null' }, () => {}), true, 'opaque-origin MCP parent remains supported only with an injected bridge');
  const noBridge = environment({ origin: 'https://widget.example', referrer: 'https://chatgpt.com' });
  assert.equal(noBridge.security.handleToolResult(notification(noBridge.parent, report(), 'https://chatgpt.com'), () => {}), false);
});

test('host with no referrer pins its injected parent origin rather than trusting arbitrary future senders', () => {
  const { security, parent } = environment({ origin: 'null', referrer: '', bridge: true });
  assert.equal(security.handleToolResult(notification(parent, report(), 'https://host.example'), () => {}), true);
  assert.equal(security.handleToolResult(notification(parent, report(), 'https://another.example'), () => {}), false);
  assert.equal(security.handleToolResult(notification({}, report(), 'null'), () => {}), false);
});

test('report normalization strips unsafe links for HTTP, cache and host outputs without converting text into markup', () => {
  const { security } = environment();
  const output = security.normalizeReportOutput(report({
    imageUrl: 'data:text/html,attack', posterUrl: 'javascript:attack()', cardUrl: 'file:///secret',
    report: { gameName: '<img src=x onerror=attack()>', sources: [{ title: 'unsafe', url: 'javascript:attack()' }, { title: '<script>text only</script>', url: 'https://example.com/real' }], icons: { market: { bad: true } } },
  }));
  assert.equal(output.imageUrl, '');
  assert.equal(output.posterUrl, '');
  assert.equal(output.cardUrl, '');
  assert.equal(output.report.sources.length, 1);
  assert.equal(output.report.sources[0].url, 'https://example.com/real');
  assert.equal(output.report.gameName, '<img src=x onerror=attack()>', 'rendering uses textContent');
  assert.equal(output.report.icons.market, '✦');
  assert.equal(security.normalizeReportOutput({ view: 'report', report: { gameName: {} } }), null);
});

test('the real widget listener rejects forged reports and clears stale unsafe poster/image links', () => {
  const ui = widget();
  ui.send(notification({}, report({ posterUrl: 'javascript:attack()' })));
  assert.equal(ui.storage.size, 0);
  assert.equal(ui.node('#alchemy-result-view').hidden, true);
  ui.send(notification(ui.parent, report()));
  assert.equal(ui.node('#alchemy-result-view').hidden, false);
  assert.equal(ui.node('#alchemy-card-open').href, '/generated/poster.png');
  assert.equal(ui.node('#alchemy-save-card').href, '/generated/poster.png');
  ui.send(notification(ui.parent, report({ imageUrl: 'javascript:attack()', posterUrl: 'data:text/html,attack' })));
  assert.equal(ui.node('#alchemy-card-open').href, undefined);
  assert.equal(ui.node('#alchemy-save-card').href, undefined);
  assert.equal(ui.node('#alchemy-card-image').src, undefined);
  assert.equal(ui.node('#alchemy-gameplay-reference-art').src, undefined);
  assert.equal(ui.node('#alchemy-save-card').hidden, true);
  const cached = JSON.parse(ui.storage.get('alchemy-completed-result-v1'));
  assert.equal(cached.output.posterUrl, '');
  assert.equal(cached.output.imageUrl, '');
});

test('the widget uses built-in icons without a runtime CDN script', () => {
  assert.doesNotMatch(html, /<script[^>]*src=["']https?:\/\//i);
  assert.doesNotMatch(html, /unpkg\.com/);
  const { security } = environment();
  assert.equal(typeof security.renderIcons, 'function');
});

test('embedded and remote widgets make no localhost requests for trends, reports or drafts', async () => {
  for (const bridge of [true, false]) {
    let calls = 0;
    widget({ origin: 'https://widget.example', referrer: 'https://chatgpt.com', bridge, fetchMock() { calls++; throw new Error('must not contact localhost'); } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 0);
  }
});

test('self-contained settings explain the MCP boundary without contacting a users localhost service', async () => {
  const env = environment({ origin: 'https://widget.example', referrer: 'https://chatgpt.com', bridge: true });
  const settingsSource = await readFile(new URL('../public/alchemy-model-settings.js', import.meta.url), 'utf8');
  const callbacks = new Map();
  const fields = Array.from({ length: 4 }, () => ({ disabled: false }));
  const feedbackNodes = new Map();
  const feedbackNode = selector => { if (!feedbackNodes.has(selector)) feedbackNodes.set(selector, { textContent: '', dataset: {}, addEventListener(name, callback) { callbacks.set(`${selector}:${name}`, callback); } }); return feedbackNodes.get(selector); };
  const form = { addEventListener(name, callback) { callbacks.set(`form:${name}`, callback); } };
  const dialog = {
    open: false, setAttribute() {}, showModal() { this.open = true; },
    querySelector(selector) {
      if (selector === 'form') return form;
      if (selector === '.alchemy-settings-close') return { addEventListener(name, callback) { callbacks.set(`close:${name}`, callback); } };
      return feedbackNode(selector);
    },
    querySelectorAll(selector) { return selector === '[data-test-kind]' ? [] : fields; },
    addEventListener() {},
  };
  const button = { addEventListener(name, callback) { callbacks.set(`open:${name}`, callback); } };
  const root = { append() {}, querySelectorAll: () => [button] };
  let fetches = 0;
  Object.assign(env.context, { document: { querySelector: () => root, createElement: () => dialog }, fetch() { fetches++; throw new Error('must not contact localhost'); } });
  vm.runInContext(settingsSource, env.context);
  await callbacks.get('open:click')();
  assert.equal(dialog.open, true);
  assert.equal(fetches, 0);
  assert.ok(fields.every(field => field.disabled));
  assert.match(feedbackNode('#settings-feedback').textContent, /独立 API 设置需在本机合成器中填写/);
});

async function mcp(method, params) {
  const worker = (await import(new URL('../dist/server/index.js', import.meta.url))).default;
  const response = await worker.fetch(new Request('http://localhost/mcp', {
    method: 'POST', headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }), { ASSETS: { fetch: async () => new Response('', { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(response.status, 200);
  return response.json();
}

test('MCP resource inlines all split widget assets and has no relative CSS/JS requests', async () => {
  const payload = await mcp('resources/read', { uri: 'ui://ai-game-alchemy/lab-v1.html' });
  const text = payload.result.contents[0].text;
  assert.match(text, /\.alchemy-settings-grid/);
  assert.match(text, /dialog\.id = 'alchemy-model-settings'/);
  assert.match(text, /window\.alchemyCatalog/);
  assert.match(text, /normalizeDraftOutput/);
  assert.match(text, /\(max-width: 719px\)/);
  assert.match(text, /async function requestLiveGeneration/);
  assert.doesNotMatch(text, /<script\b[^>]*src=/i);
  assert.doesNotMatch(text, /<link\b[^>]*href=/i);
  assert.match(text, /独立 API 设置需在本机合成器中填写/);
});

test('MCP rejects active or credential-bearing URLs at the actual tool schema', async () => {
  const base = Object.fromEntries(['gameName', 'tagline', 'marketOpportunity', 'coreGameplay', 'adHook', 'artDirection', 'recipe', 'aiCompletion', 'control', 'action', 'mechanic', 'gameType', 'artStyle', 'topic', 'trendCatalyst', 'synthesisJudgement', 'referenceImageCaption'].map(key => [key, '安全测试']));
  base.rarity = '普通';
  base.icons = Object.fromEntries(['market', 'gameplay', 'hook', 'art', 'recipe', 'ai'].map(key => [key, '✦']));
  base.sources = [];
  for (const invalid of [
    { posterUrl: 'javascript:attack()' },
    { cardUrl: 'data:text/html,attack' },
    { imageUrl: 'file:///private' },
    { sources: [{ title: 'unsafe', publishedAt: '', url: 'https://user:password@example.com/' }] },
  ]) {
    const payload = await mcp('tools/call', { name: 'render_alchemy_report', arguments: { ...base, ...invalid } });
    assert.ok(payload.error || payload.result?.isError, 'unsafe tool arguments cannot reach rendering');
  }
  const good = await mcp('tools/call', { name: 'render_alchemy_report', arguments: { ...base, posterUrl: 'https://images.example/poster.png', imageUrl: '/generated/game.png' } });
  assert.equal(good.result.structuredContent.posterUrl, 'https://images.example/poster.png');
});
