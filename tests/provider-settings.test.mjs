import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSettingsStore, mergeSettings, publicSettings, settingsFromEnvironment } from '../worker/provider-settings.mjs';
import { gameplayImagePrompt } from '../worker/gameplay-frame.mjs';

const env = { ALCHEMY_API_KEY: 'legacy-test-secret', ALCHEMY_API_BASE_URL: 'https://shared.example/v1', ALCHEMY_CHAT_MODEL: 'chat', ALCHEMY_IMAGE_MODEL: 'image' };
test('first run uses API only while an explicitly saved Codex fallback survives restart', t => {
  const directory = mkdtempSync(join(tmpdir(), 'alchemy-defaults-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'settings.json');
  const store = createSettingsStore({ path, env: {} });
  assert.equal(store.public().mode, 'api');
  assert.equal(store.public().fallbackEnabled, false);
  assert.equal(store.public().chat.apiKeyConfigured, false);
  assert.equal(store.public().image.apiKeyConfigured, false);
  store.save({ fallbackEnabled: true });
  assert.equal(createSettingsStore({ path, env: {} }).public().fallbackEnabled, true);
});
test('legacy configuration migrates to independent fields and separate overrides win', () => {
  const current = settingsFromEnvironment({ ...env, ALCHEMY_CHAT_API_BASE_URL: 'https://text.example/v1', ALCHEMY_CHAT_API_KEY: 'text-test-secret', ALCHEMY_IMAGE_API_KEY: '' });
  assert.equal(current.chat.apiBaseUrl, 'https://text.example/v1');
  assert.equal(current.chat.apiKey, 'text-test-secret');
  assert.equal(current.image.apiBaseUrl, 'https://shared.example/v1');
  assert.equal(current.image.apiKey, '');
});
test('editing image credentials does not change chat credentials and empty inputs retain keys', () => {
  const original = settingsFromEnvironment(env);
  const changed = mergeSettings(original, { image: { apiBaseUrl: 'https://pictures.example/v2/', apiKey: 'image-test-secret', model: 'picture' }, chat: { apiKey: '' } });
  assert.deepEqual(changed.chat, original.chat);
  assert.equal(changed.image.apiKey, 'image-test-secret');
  assert.equal(changed.image.apiBaseUrl, 'https://pictures.example/v2');
  const publicValue = JSON.stringify(publicSettings(changed));
  assert.ok(!publicValue.includes('legacy-test-secret') && !publicValue.includes('image-test-secret'));
  assert.equal(publicSettings(changed).image.apiKeyConfigured, true);
});
test('saved independent credentials and explicit clearing survive restart', t => {
  const directory = mkdtempSync(join(tmpdir(), 'alchemy-settings-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'settings.json');
  const store = createSettingsStore({ path, env });
  store.save({ image: { apiKey: 'image-test-secret', model: 'different-image' }, chat: { clearApiKey: true } });
  const restored = createSettingsStore({ path, env }).read();
  assert.equal(restored.chat.apiKey, '');
  assert.equal(restored.image.apiKey, 'image-test-secret');
  assert.equal(restored.image.model, 'different-image');
});
test('invalid configuration cannot partially overwrite a valid saved configuration', t => {
  const directory = mkdtempSync(join(tmpdir(), 'alchemy-settings-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'settings.json');
  const store = createSettingsStore({ path, env });
  store.save({ image: { model: 'valid' } });
  const before = store.read();
  for (const patch of [{ chat: { apiBaseUrl: 'http://external.example/v1' } }, { chat: { apiBaseUrl: 'https://example.com/?key=bad' } }, { image: { size: '0:16' } }, { chat: { maxTokens: 1 } }, { image: { timeoutMs: 0 } }]) {
    assert.throws(() => store.save(patch));
    assert.deepEqual(store.read(), before);
    assert.deepEqual(createSettingsStore({ path, env }).read(), before);
  }
});
test('gameplay prompt is derived from actual gameplay and demands game camera, playable area and HUD', () => {
  const report = { gameName: '蚊尽其用', gameType: '竖屏动作', control: '滑动挥拍', action: '清理蚊子', mechanic: '连击蓄电', topic: '夏夜卧室', artStyle: '卡通3D', coreGameplay: '避开障碍清理蚊群' };
  const prompt = gameplayImagePrompt(report, '9:16');
  for (const expected of ['9:16', '固定游戏镜头', '完整可操作区域', 'HUD', '滑动挥拍', '避开障碍清理蚊群', '不画真人手', '不是氛围插画']) assert.ok(prompt.includes(expected));
});
