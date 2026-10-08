import { statSync } from 'node:fs';

export const MAX_LOCAL_IMAGE_BYTES = 64 * 1024 * 1024;
export const MAX_LOCAL_IMAGE_PIXELS = 40_000_000;
export function assertImageFileBudget(path) {
  const file = statSync(path);
  if (!file.isFile() || file.size > MAX_LOCAL_IMAGE_BYTES) throw new Error('玩法图片超过本机 64MB 安全限制，请重新生成游戏图片');
}
