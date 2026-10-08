import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRetentionManager } from '../worker/runtime-retention.mjs';

test('cleanup previews and deletes only old generated outputs, protecting latest report, draft and unrelated files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'alchemy-retention-'));
  try {
    const old = new Date(Date.now() - 60 * 86_400_000);
    for (const name of ['alchemy-unused.png', 'alchemy-current.png', 'poster-v3-alchemy-current.png', 'alchemy-draft.png', 'important.png', 'provider-settings.json']) {
      await writeFile(join(directory, name), name);
      await utimes(join(directory, name), old, old);
    }
    await writeFile(join(directory, 'alchemy-recent.png'), 'recent');
    const manager = createRetentionManager({ generatedDir: directory, references: () => [
      { imageUrl: 'http://localhost:3000/generated/alchemy-current.png?v=1', posterUrl: '/generated/poster-v3-alchemy-current.png' },
      { imageUrl: '/generated/alchemy-draft.png' },
    ] });
    const plan = await manager.preview();
    assert.equal(plan.candidateFiles, 1);
    assert.equal(plan.keptReferenced, 3);
    const result = await manager.cleanup(plan.planToken);
    assert.equal(result.removedFiles, 1);
    await assert.rejects(readFile(join(directory, 'alchemy-unused.png')), { code: 'ENOENT' });
    for (const name of ['alchemy-current.png', 'poster-v3-alchemy-current.png', 'alchemy-draft.png', 'important.png', 'provider-settings.json', 'alchemy-recent.png']) {
      assert.ok(await readFile(join(directory, name)));
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a changed cleanup plan requires a fresh preview and never applies a stale token', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'alchemy-retention-'));
  try {
    let references = [];
    const path = join(directory, 'alchemy-new.png');
    await writeFile(path, 'image');
    const old = new Date(Date.now() - 60 * 86_400_000);
    await utimes(path, old, old);
    const manager = createRetentionManager({ generatedDir: directory, references: () => references });
    const plan = await manager.preview();
    references = [{ imageUrl: '/generated/alchemy-new.png' }];
    await assert.rejects(manager.cleanup(plan.planToken), { status: 409 });
    assert.equal(await readFile(path, 'utf8'), 'image');
    const next = await manager.preview();
    assert.equal(next.candidateFiles, 0);
    assert.equal((await manager.cleanup(next.planToken)).removedFiles, 0);
    assert.throws(() => createRetentionManager({ generatedDir: directory, retentionDays: 0 }), /保留天数/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
