import { statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const isFile = (path) => { try { return statSync(path).isFile(); } catch { return false; } };

/** Resolve an explicit CJK font instead of silently producing missing-glyph boxes. */
export function resolveChineseFont({ env = process.env, platform = process.platform, fileExists = isFile } = {}) {
  const configured = String(env.ALCHEMY_FONT_FILE || '').trim();
  if (configured) {
    const path = resolve(configured);
    if (!/\.(?:ttf|otf|ttc|otc)$/iu.test(path) || !fileExists(path)) {
      throw new Error('ALCHEMY_FONT_FILE 必须指向有效的中文 TTF/OTF/TTC 字体文件；修正后可继续生成海报。');
    }
    return { path, family: String(env.ALCHEMY_FONT_FAMILY || 'sans-serif').trim() || 'sans-serif' };
  }
  const candidates = platform === 'win32' ? [
    [join(env.SystemRoot || 'C:/Windows', 'Fonts', 'msyh.ttc'), 'Microsoft YaHei'],
    [join(env.SystemRoot || 'C:/Windows', 'Fonts', 'simhei.ttf'), 'SimHei'],
  ] : platform === 'darwin' ? [
    ['/System/Library/Fonts/PingFang.ttc', 'PingFang SC'],
    ['/System/Library/Fonts/STHeiti Light.ttc', 'Heiti SC'],
    ['/Library/Fonts/NotoSansCJK-Regular.ttc', 'Noto Sans CJK SC'],
  ] : [
    ['/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', 'Noto Sans CJK SC'],
    ['/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc', 'Noto Sans CJK SC'],
    ['/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc', 'Noto Sans CJK SC'],
    ['/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc', 'Noto Sans CJK SC'],
  ];
  const found = candidates.find(([path]) => fileExists(path));
  if (found) return { path: found[0], family: found[1] };
  throw new Error('未找到中文海报字体。请安装 Noto CJK，或设置 ALCHEMY_FONT_FILE 指向中文字体（可同时设置 ALCHEMY_FONT_FAMILY）；方案和游戏图片会保留，可修正后继续生成。');
}

export function chineseFontStatus(options) {
  try { const font = resolveChineseFont(options); return { available: true, family: font.family }; }
  catch (error) { return { available: false, message: error.message }; }
}
