import assert from 'node:assert/strict';
import test from 'node:test';
import { report, notification, widget } from './helpers/widget-harness.mjs';

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function namedReport(name, overrides = {}) {
  const base = report();
  return { ...base, ...overrides, report: { ...base.report, gameName: name, ...overrides.report } };
}

const response = (output, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => output });
const settle = () => new Promise(resolve => setImmediate(resolve));
const savedResult = ui => JSON.parse(ui.storage.get('alchemy-completed-result-v1'));
const newerBrowserCache = () => ({ output: namedReport('another-copy-cache', { stateVersion: 9999, posterUrl: '/generated/missing-mock.png' }), materials: ['tap'] });

test('startup restore uses the local persisted result even when a different copy cached a newer timestamp', async () => {
  const result = deferred();
  const ui = widget({ cached: newerBrowserCache(), fetchMock: url => String(url).endsWith('/api/result') ? result.promise : new Promise(() => {}) });
  assert.equal(ui.node('#alchemy-card-open').href, '/generated/missing-mock.png', 'valid cache is available while the service is loading');
  result.resolve(response(namedReport('local-authoritative', { stateVersion: 1, posterUrl: '/generated/real-old.png', materialIds: ['drag'] })));
  await settle();
  assert.equal(ui.node('#alchemy-result-title').textContent, 'local-authoritative');
  assert.equal(ui.node('#alchemy-card-open').href, '/generated/real-old.png');
  assert.equal(savedResult(ui).output.stateVersion, 1);
  assert.deepEqual(savedResult(ui).materials, ['drag'], 'restored recipe replaces the other copy selection');
});

test('startup restore clears only this application cache when the server explicitly returns view empty', async () => {
  const result = deferred();
  const ui = widget({ cached: newerBrowserCache(), fetchMock: url => String(url).endsWith('/api/result') ? result.promise : new Promise(() => {}) });
  ui.storage.set('other-application-cache', 'keep');
  result.resolve(response({ view: 'empty' }));
  await settle();
  assert.equal(ui.storage.has('alchemy-completed-result-v1'), false);
  assert.equal(ui.storage.get('other-application-cache'), 'keep');
  assert.equal(ui.node('#alchemy-result-view').hidden, true);
  assert.equal(ui.node('#alchemy-select-view').hidden, false);
  assert.equal(ui.node('#alchemy-card-open').href, undefined);
  assert.equal(ui.node('#alchemy-save-card').href, undefined);
  assert.equal(ui.node('#alchemy-brew').disabled, true, 'a cleared local result has no leftover cached recipe');
});

test('startup restore retains the valid cache for unavailable or malformed server responses', async t => {
  const cases = [
    ['HTTP error with report-looking body', () => response(namedReport('must-not-apply'), 500)],
    ['forbidden empty-looking body', () => response({ view: 'empty' }, 403)],
    ['null JSON is not the documented empty result', () => response(null)],
    ['invalid report shape', () => response({ view: 'report', report: { gameName: {} } })],
    ['invalid JSON', () => ({ ok: true, json: async () => { throw new Error('invalid JSON'); } })],
    ['network unavailable', () => Promise.reject(new TypeError('Failed to fetch'))],
  ];
  for (const [name, reply] of cases) await t.test(name, async () => {
    const ui = widget({ cached: newerBrowserCache(), fetchMock: url => String(url).endsWith('/api/result') ? Promise.resolve().then(reply) : new Promise(() => {}) });
    await settle();
    assert.equal(ui.node('#alchemy-card-open').href, '/generated/missing-mock.png');
    assert.equal(savedResult(ui).output.report.gameName, 'another-copy-cache');
    assert.equal(ui.node('#alchemy-result-view').hidden, false);
  });
});

test('startup restore cannot replace the UI while a new user generation is in progress', async () => {
  const result = deferred(), generation = deferred();
  const ui = widget({ cached: newerBrowserCache(), fetchMock: url => {
    if (String(url).endsWith('/api/result')) return result.promise;
    if (String(url).endsWith('/api/generate')) return generation.promise;
    return new Promise(() => {});
  } });
  const pendingGeneration = ui.click('#alchemy-brew');
  result.resolve(response(namedReport('old-local-result', { materialIds: ['drag'] })));
  await settle();
  assert.equal(ui.node('#alchemy-brew').disabled, true);
  assert.equal(ui.node('#alchemy-result-view').hidden, true);
  assert.equal(savedResult(ui).output.report.gameName, 'another-copy-cache');
  generation.resolve(response(namedReport('new-generation')));
  await pendingGeneration;
  assert.equal(ui.node('#alchemy-result-title').textContent, 'new-generation');
});

test('startup restore cannot overwrite a new generation that finished after the restore request began', async () => {
  const result = deferred();
  const ui = widget({ cached: newerBrowserCache(), fetchMock: url => {
    if (String(url).endsWith('/api/result')) return result.promise;
    if (String(url).endsWith('/api/generate')) return Promise.resolve(response(namedReport('new-generation', { stateVersion: 5, posterUrl: '/generated/new-game.png' })));
    return new Promise(() => {});
  } });
  await ui.click('#alchemy-brew');
  result.resolve(response(namedReport('old-local-result', { stateVersion: 99999, materialIds: ['drag'] })));
  await settle();
  assert.equal(ui.node('#alchemy-card-open').href, '/generated/new-game.png');
  assert.equal(savedResult(ui).output.report.gameName, 'new-generation');
  assert.deepEqual(savedResult(ui).materials, ['tap']);
});

test('startup restore cannot erase a failed new generation after its pending flag clears', async () => {
  const result = deferred();
  const ui = widget({ cached: newerBrowserCache(), fetchMock: url => {
    if (String(url).endsWith('/api/result')) return result.promise;
    if (String(url).endsWith('/api/generate')) return Promise.resolve(response({ error: 'new generation failed' }, 500));
    return new Promise(() => {});
  } });
  await ui.click('#alchemy-brew');
  assert.equal(ui.node('#alchemy-recipe-state').textContent, 'new generation failed');
  result.resolve(response({ view: 'empty' }));
  await settle();
  assert.equal(ui.node('#alchemy-recipe-state').textContent, 'new generation failed');
  assert.equal(savedResult(ui).output.report.gameName, 'another-copy-cache', 'generation epoch protects against late restore even if currentReport did not change');
});

test('startup restore cannot clear a report delivered by the trusted host while the request was pending', async () => {
  const result = deferred();
  const ui = widget({ cached: newerBrowserCache(), fetchMock: url => String(url).endsWith('/api/result') ? result.promise : new Promise(() => {}) });
  ui.send(notification(ui.parent, namedReport('just-completed-report')));
  result.resolve(response({ view: 'empty' }));
  await settle();
  assert.equal(ui.node('#alchemy-result-title').textContent, 'just-completed-report');
  assert.equal(savedResult(ui).output.report.gameName, 'just-completed-report');
});

test('startup restore with an empty server recipe does not retain selections from the cache', async () => {
  const ui = widget({ cached: newerBrowserCache(), fetchMock: url => String(url).endsWith('/api/result') ? Promise.resolve(response(namedReport('local-result', { materialIds: [] }))) : new Promise(() => {}) });
  await settle();
  assert.deepEqual(savedResult(ui).materials, []);
  ui.click('#alchemy-back');
  assert.equal(ui.node('#alchemy-brew').disabled, true);
});

