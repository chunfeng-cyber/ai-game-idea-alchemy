import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import { environment } from './helpers/widget-harness.mjs';

const source = await readFile(new URL('../public/alchemy-model-settings.js', import.meta.url), 'utf8');
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
function settingsUi(fetchMock, bridge = false) {
  const env = environment({ bridge });
  const nodes = new Map();
  function node(key) {
    if (!nodes.has(key)) nodes.set(key, { dataset: {}, value: '', hidden: true, listeners: new Map(), addEventListener(name, callback) { this.listeners.set(name, callback); } });
    return nodes.get(key);
  }
  const form = node('form');
  form.elements = Object.assign([], { namedItem: node });
  const dialog = node('dialog');
  Object.assign(dialog, { open: false, setAttribute() {}, showModal() { this.open = true; }, close() { this.open = false; }, querySelector: node, querySelectorAll: selector => selector === '[data-test-kind]' ? [] : [...nodes.values()] });
  const root = { append() {}, querySelectorAll: () => [node('open')] };
  Object.assign(env.context, { document: { querySelector: () => root, createElement: () => dialog }, fetch: fetchMock, AbortSignal });
  vm.runInContext(source, env.context);
  return { node, click: key => node(key).listeners.get('click')?.() };
}
const settings = { chat: {}, image: {}, mode: 'api', fallbackEnabled: false };
const preview = { policy: { mode: 'manual', retentionDays: 30 }, planToken: 'reviewed-plan', candidateFiles: 2, candidateBytes: 3 * 1024 * 1024, keptReferenced: 4 };

test('maintenance never deletes on open or preview; only explicit confirmation posts the reviewed token', async () => {
  const calls = [];
  const ui = settingsUi(async (url, options) => {
    calls.push({ url, options });
    return response(url.endsWith('/api/settings') ? settings : url.endsWith('/api/maintenance') ? preview : { message: 'cleaned safely' });
  });
  await ui.click('open');
  assert.equal(calls.length, 2);
  assert.equal(ui.node('#settings-maintenance-cleanup').hidden, true);
  await ui.click('#settings-maintenance-preview');
  assert.equal(calls.length, 3);
  assert.match(ui.node('#settings-maintenance-feedback').textContent, /2 张图片，共 3\.00 MB/);
  assert.equal(ui.node('#settings-maintenance-cleanup').hidden, false);
  await ui.click('#settings-maintenance-cleanup');
  assert.equal(calls[3].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[3].options.body), { planToken: 'reviewed-plan' });
  assert.equal(ui.node('#settings-maintenance-cleanup').hidden, true);
  await ui.click('#settings-maintenance-cleanup');
  assert.equal(calls.length, 4, 'spent preview token cannot be posted twice');
});

test('changed storage invalidates the preview and requires a fresh review before another cleanup', async () => {
  let cleanupCalls = 0;
  const ui = settingsUi(async url => {
    if (url.endsWith('/api/settings')) return response(settings);
    if (url.endsWith('/health')) return response({ chineseFont: { available: true, family: 'test font' } });
    if (url.endsWith('/api/maintenance')) return response(preview);
    cleanupCalls++;
    return response({ error: '预览已变化' }, 409);
  });
  await ui.click('open');
  await ui.click('#settings-maintenance-preview');
  await ui.click('#settings-maintenance-cleanup');
  assert.equal(ui.node('#settings-maintenance-cleanup').hidden, true);
  assert.match(ui.node('#settings-maintenance-feedback').textContent, /重新预览/);
  await ui.click('#settings-maintenance-cleanup');
  assert.equal(cleanupCalls, 1);
});

test('empty or malformed previews cannot unlock cleanup', async () => {
  for (const payload of [{ ...preview, candidateFiles: 0 }, { ...preview, planToken: null }, { ...preview, candidateBytes: -1 }]) {
    const ui = settingsUi(async url => response(url.endsWith('/api/settings') ? settings : payload));
    await ui.click('open');
    await ui.click('#settings-maintenance-preview');
    assert.equal(ui.node('#settings-maintenance-cleanup').hidden, true);
  }
});

test('embedded host cannot use local maintenance APIs', async () => {
  let calls = 0;
  const ui = settingsUi(() => { calls++; throw new Error('must not contact localhost'); }, true);
  await ui.click('open');
  await ui.click('#settings-maintenance-preview');
  await ui.click('#settings-maintenance-cleanup');
  assert.equal(calls, 0);
});

test('settings show a missing Chinese font without blocking API configuration', async () => {
  const ui = settingsUi(async url => response(url.endsWith('/api/settings') ? settings : { chineseFont: { available: false, message: '安装 Noto Sans CJK 后重启' } }));
  await ui.click('open');
  assert.equal(ui.node('generation.mode').value, 'api');
  assert.match(ui.node('#settings-font-feedback').textContent, /Noto Sans CJK/);
  assert.equal(ui.node('#settings-font-feedback').dataset.error, 'true');
  assert.equal(ui.node('#settings-maintenance-preview').disabled, false);
});
