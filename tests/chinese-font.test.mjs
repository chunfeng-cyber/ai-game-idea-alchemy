import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveChineseFont, chineseFontStatus } from '../worker/chinese-font.mjs';

test('Chinese font selection supports native Windows, macOS and Linux files', () => {
  for (const [platform, file, family] of [
    ['win32', 'msyh.ttc', 'Microsoft YaHei'],
    ['darwin', 'PingFang.ttc', 'PingFang SC'],
    ['linux', 'NotoSansCJK-Regular.ttc', 'Noto Sans CJK SC'],
  ]) {
    const font = resolveChineseFont({ env: {}, platform, fileExists: path => path.endsWith(file) });
    assert.equal(font.family, family);
    assert.ok(font.path.endsWith(file));
  }
});

test('missing and invalid configured fonts fail explicitly, while a custom font overrides defaults', () => {
  assert.throws(() => resolveChineseFont({ env: {}, fileExists: () => false }), /未找到中文海报字体/);
  for (const path of ['missing.ttf', 'unsafe.json']) {
    assert.throws(() => resolveChineseFont({ env: { ALCHEMY_FONT_FILE: path }, fileExists: () => path !== 'missing.ttf' }), /ALCHEMY_FONT_FILE/);
  }
  const font = resolveChineseFont({ env: { ALCHEMY_FONT_FILE: './custom.otf', ALCHEMY_FONT_FAMILY: 'Custom CJK' }, fileExists: () => true });
  assert.equal(font.family, 'Custom CJK');
  assert.ok(font.path.endsWith('custom.otf'));
  assert.deepEqual(chineseFontStatus({ env: {}, fileExists: () => false }).available, false);
  assert.deepEqual(chineseFontStatus({ env: {}, platform: 'darwin', fileExists: path => path.endsWith('PingFang.ttc') }), { available: true, family: 'PingFang SC' });
});
