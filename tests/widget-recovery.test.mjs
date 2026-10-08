import assert from 'node:assert/strict';
import test from 'node:test';
import { widget, environment, report, notification } from './helpers/widget-harness.mjs';

const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const settle = () => new Promise(resolve => setImmediate(resolve));
const draft = (overrides = {}) => ({ view: 'draft', draftId: 'saved-draft-1', stateVersion: 123, stage: 'image', materialIds: ['drag'], report: report().report, error: 'image unavailable', ...overrides });

test('saved draft appears beside the completed report and resumes only its image job', async () => {
  const calls = [];
  let complete;
  const ui = widget({ fetchMock: (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/api/result')) return Promise.resolve(response(report()));
    if (url.endsWith('/api/draft')) return Promise.resolve(response(draft()));
    if (url.endsWith('/api/resume-image')) return new Promise(resolve => { complete = resolve; });
    return new Promise(() => {});
  } });
  await settle();
  assert.equal(ui.node('#alchemy-result-view').hidden, false);
  assert.equal(ui.node('#alchemy-result-draft-panel').hidden, false);
  assert.equal(ui.node('#alchemy-card-open').href, '/generated/poster.png', 'existing completed poster remains available');
  const resume = ui.click('#alchemy-result-resume-draft');
  assert.equal(ui.node('#alchemy-resume-draft').disabled, true);
  await ui.click('#alchemy-resume-draft');
  const requests = calls.filter(call => call.url.endsWith('/api/resume-image'));
  assert.equal(requests.length, 1, 'a second tap cannot start the same job');
  const body = JSON.parse(requests[0].options.body);
  assert.equal(body.draftId, 'saved-draft-1');
  assert.equal(body.sourceDraftVersion, 123);
  assert.equal(typeof body.requestId, 'string');
  assert.deepEqual(Object.keys(body).sort(), ['draftId', 'requestId', 'sourceDraftVersion']);
  assert.equal(calls.filter(call => call.url.endsWith('/api/generate')).length, 0);
  complete(response(report({ posterUrl: '/generated/new.png' })));
  await resume;
  assert.equal(ui.node('#alchemy-card-open').href, '/generated/new.png');
  assert.equal(ui.node('#alchemy-result-draft-panel').hidden, true);
});

test('failed new generation exposes saved draft without replacing the previous completed poster', async () => {
  const ui = widget({ cached: { output: report(), materials: ['drag'] }, fetchMock: (url) => {
    if (url.endsWith('/api/generate')) return Promise.resolve(response({ error: 'image unavailable', draftReady: true, draft: draft({ report: { ...report().report, gameName: 'new saved plan' } }) }, 502));
    return new Promise(() => {});
  } });
  await ui.click('#alchemy-remix');
  await settle();
  assert.equal(ui.node('#alchemy-draft-panel').hidden, false);
  assert.equal(ui.node('#alchemy-draft-title').textContent, '已保存方案：《new saved plan》');
  assert.equal(ui.node('#alchemy-card-open').href, '/generated/poster.png');
  assert.equal(ui.node('#alchemy-resume-draft').disabled, false);
});

test('a draft can resume after startup with no completed report or selected ingredients', async () => {
  const calls = [];
  const ui = widget({ fetchMock: (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/api/result')) return Promise.resolve(response({ view: 'empty' }));
    if (url.endsWith('/api/draft')) return Promise.resolve(response(draft({ stage: 'poster', materialIds: [] })));
    if (url.endsWith('/api/resume-image')) return Promise.resolve(response(report()));
    return new Promise(() => {});
  } });
  await settle();
  assert.equal(ui.node('#alchemy-resume-draft').textContent, '继续排版海报');
  await ui.click('#alchemy-resume-draft');
  assert.equal(calls.filter(call => call.url.endsWith('/api/resume-image')).length, 1);
  assert.equal(ui.node('#alchemy-result-view').hidden, false);
});

test('stale resume gets a fresh draft instead of allowing repeated requests with the stale ID', async () => {
  let reads = 0;
  const ui = widget({ fetchMock: (url) => {
    if (url.endsWith('/api/result')) return Promise.resolve(response({ view: 'empty' }));
    if (url.endsWith('/api/draft')) return Promise.resolve(response(draft({ stateVersion: ++reads, draftId: `draft-${reads}` })));
    if (url.endsWith('/api/resume-image')) return Promise.resolve(response({ error: 'draft changed' }, 409));
    return new Promise(() => {});
  } });
  await settle();
  await ui.click('#alchemy-resume-draft');
  await settle();
  assert.equal(reads, 2);
  assert.equal(ui.node('#alchemy-draft-panel').hidden, false);
});

test('late draft restore cannot reintroduce a draft after a new report has completed', async () => {
  let reply;
  const ui = widget({ fetchMock: (url) => {
    if (url.endsWith('/api/result')) return Promise.resolve(response({ view: 'empty' }));
    if (url.endsWith('/api/draft')) return new Promise(resolve => { reply = resolve; });
    return new Promise(() => {});
  } });
  await settle();
  ui.send(notification(ui.parent, report()));
  reply(response(draft()));
  await settle();
  assert.equal(ui.node('#alchemy-draft-panel').hidden, true);
});

test('draft normalization rejects invalid identity and strips unsafe image/source links', () => {
  const { security } = environment();
  for (const value of [draft({ draftId: {} }), draft({ stateVersion: -1 }), draft({ stage: 'complete' }), draft({ report: { gameName: '' } })]) assert.equal(security.normalizeDraftOutput(value), null);
  const output = security.normalizeDraftOutput(draft({ imageUrl: 'javascript:bad()', report: { ...report().report, sources: [{ url: 'data:text/html,bad' }] } }));
  assert.equal(output.imageUrl, '');
  assert.equal(output.report.sources.length, 0);
});
