import assert from 'node:assert/strict';
import test from 'node:test';
import { runProviderFlow } from '../worker/provider-flow.mjs';

function services(overrides = {}) {
  const calls = [];
  const draft = { report: { gameName: 'Fresh recipe' }, imagePrompt: 'Fresh image prompt' };
  return {
    calls,
    allowFallback: true,
    resolveModels: async () => ({ chatModel: 'text', imageModel: 'image' }),
    generateApiReport: async () => { calls.push('api-report'); return draft; },
    generateCodexReport: async () => { calls.push('codex-report'); return draft; },
    generateApiImage: async (prompt, model) => { calls.push(['api-image', prompt, model]); },
    generateCodexFull: async () => { calls.push('codex-full'); return { view: 'report', report: draft.report }; },
    generateCodexImage: async prompt => { calls.push(['codex-image', prompt]); },
    onStage: (status) => calls.push(['stage', status.stage, status.provider]),
    onApiError: (_kind, error) => error.message,
    ...overrides,
  };
}

test('a rejected text API keeps the working image API and exposes the fallback', async () => {
  const s = services({ generateApiReport: async () => { throw new Error('HTTP 403'); } });
  const result = await runProviderFlow(s);
  assert.equal(result.provider, 'codex-report-api-image');
  assert.equal(result.fallbackReason, 'HTTP 403');
  assert.equal(result.report.gameName, 'Fresh recipe');
  assert.ok(s.calls.includes('codex-report'));
  assert.deepEqual(s.calls.find(x => Array.isArray(x) && x[0] === 'api-image'), ['api-image', 'Fresh image prompt', 'image']);
  assert.ok(!s.calls.includes('codex-full'));
});

test('successful APIs produce an API result without invoking a fallback', async () => {
  const s = services();
  const result = await runProviderFlow(s);
  assert.equal(result.provider, 'api');
  assert.equal(result.fallbackReason, '');
  assert.ok(!s.calls.includes('codex-report'));
  assert.ok(!s.calls.includes('codex-full'));
});

test('a failed fallback report ends the job instead of repeating a full generation', async () => {
  const s = services({
    generateApiReport: async () => { throw new Error('HTTP 403'); },
    generateCodexReport: async () => { throw new Error('Report timeout'); },
  });
  await assert.rejects(runProviderFlow(s), /Report timeout/);
  assert.ok(!s.calls.includes('codex-full'));
  assert.ok(!s.calls.some(x => Array.isArray(x) && x[0] === 'api-image'));
});

test('disabling fallback returns the real API error immediately', async () => {
  const s = services({ allowFallback: false, generateApiReport: async () => { throw new Error('HTTP 403'); } });
  await assert.rejects(runProviderFlow(s), /HTTP 403/);
  assert.ok(!s.calls.includes('codex-report'));
  assert.ok(!s.calls.includes('codex-full'));
});

test('an image API failure draws the saved report with fallback without repeating text', async () => {
  const s = services({ generateApiImage: async () => { throw new Error('Image service offline'); } });
  const result = await runProviderFlow(s);
  assert.equal(result.provider, 'codex-image-fallback');
  assert.equal(result.fallbackReason, 'Image service offline');
  assert.equal(s.calls.filter(value => value === 'api-report').length, 1);
  assert.deepEqual(s.calls.find(value => Array.isArray(value) && value[0] === 'codex-image'), ['codex-image', 'Fresh image prompt']);
  assert.ok(!s.calls.includes('codex-full'));
});

test('a checked draft is saved before a failed image call, including report fallback', async () => {
  const s = services({
    generateApiReport: async () => { throw new Error('chat offline'); },
    generateApiImage: async () => { s.calls.push('failed-image'); throw new Error('image offline'); },
    onDraft: async (draft, metadata) => { s.calls.push('saved-draft'); assert.equal(draft.report.gameName, 'Fresh recipe'); assert.equal(metadata.fallbackReason, 'chat offline'); },
    generateCodexImage: async () => { throw new Error('fallback image offline'); },
  });
  await assert.rejects(runProviderFlow(s), /fallback image offline/);
  assert.ok(s.calls.indexOf('saved-draft') < s.calls.indexOf('failed-image'));
  assert.ok(!s.calls.includes('codex-full'));
});

test('a failed draft checkpoint prevents image charges and full regeneration', async () => {
  const s = services({ onDraft: async () => { throw new Error('disk full'); } });
  await assert.rejects(runProviderFlow(s), /disk full/);
  assert.ok(!s.calls.some(value => Array.isArray(value) && value[0].includes('image')));
  assert.ok(!s.calls.includes('codex-full'));
});
