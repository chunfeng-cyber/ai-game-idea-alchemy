import { createRequire } from 'node:module';
import { resolve } from 'node:path';

/** Share the native image runtime used by downloads and both report layouts. */
export async function loadSharp() {
  let sharp;
  try { sharp = (await import('sharp')).default; }
  catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    // Supports a renderer staged outside the checkout using its runtime.
    sharp = createRequire(resolve(process.cwd(), 'package.json'))('sharp');
  }
  // Windows regression runs reproduced native heap-corruption exits during
  // rendering. A single libvips worker passed the same rendering scenarios.
  // Each local service already accepts only one generation at a time.
  if (process.platform === 'win32') sharp.concurrency(1);
  return sharp;
}
