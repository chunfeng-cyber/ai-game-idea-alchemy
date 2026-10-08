import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCompletedResultStore } from '../worker/generation-results.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'alchemy-results-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'result.json');
  return { path, store: createCompletedResultStore({ path }) };
}
const report = (gameName, stateVersion) => ({ view: 'report', report: { gameName }, imageUrl: `http://localhost:3000/generated/alchemy-${stateVersion}.png`, stateVersion });
function gate() {
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  return { wait, release };
}

test('a delayed old poster migration cannot overwrite a newly published generation in memory or on disk', async t => {
  const { path, store } = fixture(t);
  const old = report('Old scheme', 1);
  const fresh = report('New scheme', 2);
  store.publish(old);
  const render = gate();
  const restored = store.restoreLayout(async snapshot => {
    assert.equal(snapshot, old);
    await render.wait;
    return { ...snapshot, posterUrl: 'http://localhost:3000/generated/poster-old.png' };
  });
  store.publish(fresh); // Real generation commits while restoration is waiting.
  render.release();
  assert.equal(await restored, fresh);
  assert.equal(store.read(), fresh);
  assert.deepEqual(JSON.parse(readFileSync(path)), fresh);
  assert.deepEqual(createCompletedResultStore({ path }).read(), fresh, 'restart must recover the new complete result');
});

test('overlapping migrations commit only the first current snapshot; a superseded render error cannot hide a new result', async t => {
  const { store } = fixture(t);
  store.publish(report('Original', 1));
  const delayed = gate();
  const olderRead = store.restoreLayout(async snapshot => { await delayed.wait; return { ...snapshot, posterUrl: 'late-old-layout' }; });
  const current = await store.restoreLayout(async snapshot => ({ ...snapshot, posterUrl: 'first-completed-layout' }));
  delayed.release();
  assert.equal(await olderRead, current);
  const failure = gate();
  const failedOldRead = store.restoreLayout(async () => { await failure.wait; throw new Error('old image unavailable'); });
  const fresh = store.publish(report('New complete result', 3));
  failure.release();
  assert.equal(await failedOldRead, fresh);
});

test('a current migration failure preserves the original completed report and its file', async t => {
  const { path, store } = fixture(t);
  const old = store.publish(report('Preserved', 1));
  await assert.rejects(store.restoreLayout(async () => { throw new Error('font unavailable'); }), /font unavailable/);
  assert.equal(store.read(), old);
  assert.deepEqual(JSON.parse(readFileSync(path)), old);
});
