export function normalizedGameplayDimensions(width, height, targetRatio, { maxEdge = 4096, maxPixels = 16000000 } = {}) {
  if (![width, height].every(value => Number.isSafeInteger(value) && value > 0)
    || !Number.isFinite(targetRatio) || targetRatio < 1 / 3 || targetRatio > 3) throw new Error('游戏图片尺寸或比例无效');
  const ratio = width / height;
  const canvasWidth = ratio > targetRatio ? width : height * targetRatio;
  const canvasHeight = ratio > targetRatio ? width / targetRatio : height;
  const scale = Math.min(1, maxEdge / canvasWidth, maxEdge / canvasHeight, Math.sqrt(maxPixels / canvasWidth / canvasHeight));
  return { width: Math.max(1, Math.floor(canvasWidth * scale)), height: Math.max(1, Math.floor(canvasHeight * scale)) };
}
