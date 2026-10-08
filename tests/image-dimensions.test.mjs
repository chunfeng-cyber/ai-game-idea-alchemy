import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizedGameplayDimensions } from '../worker/image-dimensions.mjs';

test('padding even a legal 40M long input to the opposite ratio remains within edge and pixel budgets', () => {
  for (const [width, height, ratio] of [[40000, 1000, 1 / 3], [1000, 40000, 3], [20000, 2000, 1], [100, 1, 1 / 3]]) {
    const output = normalizedGameplayDimensions(width, height, ratio);
    assert.ok(output.width <= 4096 && output.height <= 4096);
    assert.ok(output.width * output.height <= 16000000);
    assert.ok(Math.abs(output.width / output.height - ratio) < 0.01);
  }
  assert.deepEqual(normalizedGameplayDimensions(384, 216, 16 / 9), { width: 384, height: 216 });
  assert.throws(() => normalizedGameplayDimensions(0, 10, 1), /无效/);
  assert.throws(() => normalizedGameplayDimensions(100, 100, 1000), /无效/);
});
