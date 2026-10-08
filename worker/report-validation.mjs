const TEXT_FIELDS = ['gameName', 'rarity', 'tagline', 'marketOpportunity', 'coreGameplay', 'adHook',
  'artDirection', 'recipe', 'aiCompletion', 'control', 'action', 'mechanic', 'gameType',
  'artStyle', 'topic', 'trendCatalyst', 'synthesisJudgement', 'referenceImageCaption'];
const LIMITS = { gameName: 128, rarity: 8, tagline: 512, recipe: 1500, referenceImageCaption: 512 };
const ICON_KEYS = ['market', 'gameplay', 'hook', 'art', 'recipe', 'ai'];
function text(value, field, limit, minimum = 1) {
  if (typeof value !== 'string' || value.trim().length < minimum) throw new Error(`报告字段 ${field} 缺失或无效`);
  // Reject huge UTF-16 values before allocating a codepoint array.
  if (value.length > limit * 2 || [...value].length > limit) throw new Error(`报告字段 ${field} 超过 ${limit} 字符，尚未开始生图`);
  return value;
}

export function boundedProviderReport(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('对话模型返回的报告不是对象');
  const report = {};
  for (const field of TEXT_FIELDS) report[field] = text(value[field], field, LIMITS[field] || 6000);
  if (!['普通', '稀有', '史诗', '传说'].includes(report.rarity)) throw new Error('报告稀有度无效');
  const imagePrompt = text(value.imagePrompt, 'imagePrompt', 20000, 40);
  if (!Array.isArray(value.sources) || value.sources.length > 6) throw new Error('报告来源须为最多6条的数组');
  report.sources = value.sources.map(source => {
    if (!source || typeof source !== 'object') throw new Error('报告包含无效市场来源');
    const title = text(source.title, 'source.title', 512);
    const url = text(source.url, 'source.url', 8192);
    let parsed;
    try { parsed = new URL(url); } catch (error) { throw new Error('报告包含无效市场来源', { cause: error }); }
    const publishedAt = text(source.publishedAt, 'source.publishedAt', 80);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !Number.isFinite(Date.parse(publishedAt))) throw new Error('报告包含无效市场来源');
    return { title, url, publishedAt };
  });
  if (!value.icons || typeof value.icons !== 'object' || Array.isArray(value.icons)) throw new Error('报告图标字段不完整');
  report.icons = Object.fromEntries(ICON_KEYS.map(key => [key, text(value.icons[key], `icons.${key}`, 24)]));
  return { report, imagePrompt };
}
