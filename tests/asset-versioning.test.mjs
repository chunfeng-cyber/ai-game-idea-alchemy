import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { versionStaticReferences } from '../worker/build.mjs';
import { handleAlchemyMcp } from '../worker/alchemy-mcp.mjs';
import { sourceHtml, widgetAssets } from './helpers/widget-source.mjs';

test('every source CSS/JS URL invalidates previously cached filenames and production uses its exact content hash', () => {
  const references = [...sourceHtml.matchAll(/\b(?:href|src)="(\/[^"?]+\.(?:css|js))\?([^"#]+)"/g)];
  assert.equal(references.length, 7);
  const built = versionStaticReferences(sourceHtml, widgetAssets);
  for (const [, path] of references) {
    const hash = createHash('sha256').update(widgetAssets.get(path)).digest('hex').slice(0, 16);
    assert.ok(built.includes(`="${path}?v=${hash}"`), path);
  }
  assert.doesNotMatch(built, /\?rev=/);
});

test('changing an asset changes its URL while unrelated assets retain stable versions', () => {
  const assets = new Map([['/app.js', 'first release'], ['/ui.css', 'unchanged']]);
  const html = '<script src="/app.js?rev=old"></script><link href="/ui.css"><img src="/image.png"><script src="https://external.example/app.js"></script>';
  const first = versionStaticReferences(html, assets);
  assets.set('/app.js', 'second release');
  const second = versionStaticReferences(html, assets);
  assert.notEqual(first.match(/\/app\.js\?v=[^"]+/)[0], second.match(/\/app\.js\?v=[^"]+/)[0]);
  assert.equal(first.match(/\/ui\.css\?v=[^"]+/)[0], second.match(/\/ui\.css\?v=[^"]+/)[0]);
  assert.ok(second.includes('src="/image.png"'));
  assert.ok(second.includes('src="https://external.example/app.js"'));
  assert.equal(versionStaticReferences(second, assets), second, 'repeat builds remain deterministic');
});

test('the real MCP resource fully inlines versioned CSS/JS references', async () => {
  const request = new Request('http://localhost/mcp', {
    method: 'POST', headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: 'ui://ai-game-alchemy/lab-v1.html' } }),
  });
  const response = await handleAlchemyMcp(request, versionStaticReferences(sourceHtml, widgetAssets));
  assert.equal(response.status, 200);
  const result = await response.json();
  const html = result.result.contents[0].text;
  assert.doesNotMatch(html, /<script\b[^>]*src=/i);
  assert.doesNotMatch(html, /<link\b[^>]*href=/i);
  assert.match(html, /settings-maintenance-preview/);
  assert.match(html, /settings-font-feedback/);
  assert.match(html, /async function requestLiveGeneration/);
});
