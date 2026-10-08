import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createGenerationDraftStore } from '../worker/generation-draft.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'alchemy-draft-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, 'draft.json');
}

test('a new checked scheme survives failure and restart separately from a completed report', t => {
  const path = fixture(t);
  const store = createGenerationDraftStore(path);
  const draft = store.save({ report: { gameName: 'New scheme' }, materialIds: ['swipe'], sourceRequestId: 'new-task' });
  const failed = store.update(draft.draftId, { error: 'HTTP 403' });
  assert.ok(failed.stateVersion > draft.stateVersion);
  assert.equal(store.matches(draft.draftId, draft.stateVersion), false);
  const restored = createGenerationDraftStore(path);
  assert.deepEqual(restored.read(), failed);
  assert.ok(restored.matches(failed.draftId, failed.stateVersion));
  const poster = restored.update(failed.draftId, { stage: 'poster', imageUrl: 'http://localhost:3000/generated/alchemy-new-task.png', error: '' });
  assert.equal(poster.stage, 'poster');
  assert.equal(poster.report.gameName, 'New scheme');
  assert.deepEqual(readdirSync(dirname(path)), ['draft.json'], 'atomic writes leave no unfinished temp files');
});

test('snapshots cannot mutate the persistent scheme, stale completion cannot clear a replacement', t => {
  const path = fixture(t);
  const store = createGenerationDraftStore(path);
  const first = store.save({ report: { gameName: 'First scheme' }, sourceRequestId: 'task-one' });
  first.report.gameName = 'mutated';
  assert.equal(store.read().report.gameName, 'First scheme');
  const second = store.save({ report: { gameName: 'Second scheme' }, sourceRequestId: 'task-two' });
  assert.equal(store.clear(first.draftId), false);
  assert.throws(() => store.update(first.draftId, { error: 'out of date' }), /草稿已更新/);
  assert.equal(JSON.parse(readFileSync(path)).report.gameName, 'Second scheme');
  assert.equal(store.clear(second.draftId), true);
  assert.equal(store.read(), null);
  assert.equal(existsSync(path), false);
});

test('invalid and oversized local draft data is not restored or committed', t => {
  const path = fixture(t);
  writeFileSync(path, '{partial JSON');
  assert.equal(createGenerationDraftStore(path).read(), null);
  const store = createGenerationDraftStore(path);
  assert.throws(() => store.save({ report: { gameName: 'x'.repeat(1024 * 1024) }, sourceRequestId: 'task-three' }), /过大/);
  assert.throws(() => store.save({ report: { gameName: 'Scheme' }, sourceRequestId: '../task' }), /无效/);
  assert.equal(store.read(), null);
});
