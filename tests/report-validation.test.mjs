import assert from 'node:assert/strict';
import test from 'node:test';
import { boundedProviderReport } from '../worker/report-validation.mjs';

function report() {
  const fields = ['gameName', 'tagline', 'marketOpportunity', 'coreGameplay', 'adHook', 'artDirection', 'recipe',
    'aiCompletion', 'control', 'action', 'mechanic', 'gameType', 'artStyle', 'topic', 'trendCatalyst', 'synthesisJudgement', 'referenceImageCaption'];
  return { ...Object.fromEntries(fields.map(key => [key, '方案内容'])), rarity: '稀有', imagePrompt: 'An actual playable game screenshot with camera, obstacles, objectives and HUD.',
    sources: [], icons: { market: '📊', gameplay: '🎮', hook: '🧲', art: '🎨', recipe: '🧪', ai: '🤖' } };
}

test('a complete 30-material recipe is retained and unknown model fields are dropped', () => {
  const value = { ...report(), recipe: Array.from({ length: 30 }, (_, index) => `投入${index + 1}：完整描述`).join('＋'), unwanted: 'x'.repeat(500000), imagePath: 'private-file' };
  const checked = boundedProviderReport(value);
  assert.equal(checked.report.recipe, value.recipe);
  assert.equal(checked.report.unwanted, undefined);
  assert.equal(checked.report.imagePath, undefined);
  assert.equal(checked.report.imagePrompt, undefined);
});

test('oversized report fields, icons, sources and image prompts are refused before image generation', () => {
  for (const patch of [{ recipe: '字'.repeat(1501) }, { gameName: '😀'.repeat(129) }, { coreGameplay: '字'.repeat(6001) }, { tagline: '字'.repeat(513) }, { imagePrompt: 'x'.repeat(20001) },
    { icons: { ...report().icons, market: 'x'.repeat(25) } }, { sources: Array(7).fill({}) }]) assert.throws(() => boundedProviderReport({ ...report(), ...patch }), /超过|最多6条/);
  assert.equal(boundedProviderReport({ ...report(), gameName: '😀'.repeat(128) }).report.gameName.length, 256, 'limits count Unicode codepoints');
  assert.throws(() => boundedProviderReport({ ...report(), sources: [{ title: 'source', url: 'https://user:secret@example.com', publishedAt: new Date().toISOString() }] }), /无效市场来源/);
});
