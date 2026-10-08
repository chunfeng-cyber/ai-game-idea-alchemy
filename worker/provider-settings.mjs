import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const clean = value => String(value ?? '').trim();
const number = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const format = value => clean(value).toLowerCase();

export function settingsFromEnvironment(env = {}) {
  const sharedBase = clean(env.ALCHEMY_API_BASE_URL) || 'https://api.openai.com/v1';
  const sharedKey = clean(env.ALCHEMY_API_KEY);
  const chatModel = clean(env.ALCHEMY_CHAT_MODEL);
  return {
    mode: format(env.ALCHEMY_PROVIDER_MODE) || 'api',
    fallbackEnabled: format(env.ALCHEMY_FALLBACK_MODE || 'none') === 'codex',
    chat: {
      apiBaseUrl: clean(env.ALCHEMY_CHAT_API_BASE_URL) || sharedBase,
      apiKey: env.ALCHEMY_CHAT_API_KEY === undefined ? sharedKey : clean(env.ALCHEMY_CHAT_API_KEY),
      apiFormat: format(env.ALCHEMY_CHAT_API_FORMAT) || (chatModel.startsWith('anthropic/') ? 'anthropic' : 'openai'),
      model: chatModel, timeoutMs: number(env.ALCHEMY_CHAT_TIMEOUT_MS || env.ALCHEMY_API_TIMEOUT_MS, 180000),
      maxTokens: number(env.ALCHEMY_CHAT_MAX_TOKENS, 4096), temperature: number(env.ALCHEMY_CHAT_TEMPERATURE, 0.75),
    },
    image: {
      apiBaseUrl: clean(env.ALCHEMY_IMAGE_API_BASE_URL) || sharedBase,
      apiKey: env.ALCHEMY_IMAGE_API_KEY === undefined ? sharedKey : clean(env.ALCHEMY_IMAGE_API_KEY),
      apiFormat: format(env.ALCHEMY_IMAGE_API_FORMAT || env.ALCHEMY_PROVIDER_KIND) || (sharedBase.includes('console.echojoy.cn') ? 'echojoy' : 'openai'),
      model: clean(env.ALCHEMY_IMAGE_MODEL), size: clean(env.ALCHEMY_IMAGE_SIZE) || '1536x864',
      resolution: clean(env.ALCHEMY_IMAGE_RESOLUTION) || '1K', quality: format(env.ALCHEMY_IMAGE_QUALITY) || 'medium',
      timeoutMs: number(env.ALCHEMY_IMAGE_TIMEOUT_MS || env.ALCHEMY_API_TIMEOUT_MS, 180000),
      pollIntervalMs: number(env.ALCHEMY_POLL_INTERVAL_MS, 2000),
    },
  };
}

export function validateBaseUrl(value) {
  let url;
  try { url = new URL(clean(value)); } catch { throw new Error('API Base URL 无效'); }
  if (url.username || url.password || url.search || url.hash) throw new Error('Base URL 不应含账号、密钥、查询参数或片段');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('API 地址须为 HTTPS，或本机 localhost HTTP');
  }
  return url.toString().replace(/\/+$/, '');
}

function bounded(value, name, low, high, integer = false) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < low || parsed > high || (integer && !Number.isInteger(parsed))) {
    throw new Error(`${name}须为 ${low}–${high}${integer ? ' 的整数' : ''}`);
  }
  return parsed;
}

export function mergeSettings(current, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('模型配置格式无效');
  const result = structuredClone(current);
  if (patch.mode !== undefined) {
    if (!['api', 'codex'].includes(patch.mode)) throw new Error('生成方式无效');
    result.mode = patch.mode;
  }
  if (patch.fallbackEnabled !== undefined) {
    if (typeof patch.fallbackEnabled !== 'boolean') throw new Error('备用服务开关无效');
    result.fallbackEnabled = patch.fallbackEnabled;
  }
  for (const kind of ['chat', 'image']) {
    if (patch[kind] === undefined) continue;
    const input = patch[kind];
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('模型配置格式无效');
    const next = result[kind];
    if (input.apiBaseUrl !== undefined) next.apiBaseUrl = validateBaseUrl(input.apiBaseUrl);
    if (input.apiFormat !== undefined) {
      if (!(kind === 'chat' ? ['openai', 'anthropic'] : ['openai', 'echojoy']).includes(input.apiFormat)) throw new Error('接口格式无效');
      next.apiFormat = input.apiFormat;
    }
    if (input.model !== undefined) {
      next.model = clean(input.model);
      // eslint-disable-next-line no-control-regex -- Model identifiers must reject C0 control characters, including newlines.
      if (next.model.length > 160 || /[\r\n\x00-\x1f]/.test(next.model)) throw new Error('模型名无效');
    }
    if (input.clearApiKey === true) next.apiKey = '';
    else if (input.apiKey !== undefined && clean(input.apiKey)) {
      next.apiKey = clean(input.apiKey);
      // eslint-disable-next-line no-control-regex -- Keys become HTTP headers; reject every C0 control character to keep them valid.
      if (next.apiKey.length > 4096 || /[\r\n\x00-\x1f]/.test(next.apiKey)) throw new Error('API Key 格式无效');
    }
    if (input.timeoutMs !== undefined) next.timeoutMs = bounded(input.timeoutMs, '超时毫秒', 10000, 900000, true);
    if (kind === 'chat') {
      if (input.maxTokens !== undefined) next.maxTokens = bounded(input.maxTokens, '最大输出 tokens', 512, 32768, true);
      if (input.temperature !== undefined) next.temperature = bounded(input.temperature, '随机程度', 0, 2);
    } else {
      if (input.size !== undefined) {
        const size = clean(input.size);
        const match = size.match(/^(\d{1,4})(x|:)(\d{1,4})$/);
        if (!match || Number(match[1]) <= 0 || Number(match[3]) <= 0 || (match[2] === 'x' && Math.min(Number(match[1]), Number(match[3])) < 256)) throw new Error('画幅请填 16:9、9:16 或 1536x864 等有效值');
        const ratio = Number(match[1]) / Number(match[3]);
        if (ratio < 1 / 3 || ratio > 3) throw new Error('游戏画幅比例须介于 1:3 与 3:1 之间');
        next.size = size;
      }
      if (input.resolution !== undefined) {
        if (!['1K', '2K', '4K'].includes(input.resolution)) throw new Error('分辨率无效');
        next.resolution = input.resolution;
      }
      if (input.quality !== undefined) {
        if (!['low', 'medium', 'high', 'auto'].includes(input.quality)) throw new Error('图片质量无效');
        next.quality = input.quality;
      }
      if (input.pollIntervalMs !== undefined) next.pollIntervalMs = bounded(input.pollIntervalMs, '轮询毫秒', 750, 30000, true);
    }
  }
  return result;
}

export function publicSettings(settings) {
  const publicPart = { mode: settings.mode, fallbackEnabled: settings.fallbackEnabled };
  for (const kind of ['chat', 'image']) {
    const { apiKey, ...fields } = settings[kind];
    publicPart[kind] = { ...fields, apiKeyConfigured: Boolean(apiKey) };
  }
  return publicPart;
}

export function createSettingsStore({ path, env = process.env }) {
  let current = settingsFromEnvironment(env);
  let restored = false;
  if (existsSync(path)) {
    // Invalid stored configuration is explicit; never silently re-enable old credentials.
    const saved = JSON.parse(readFileSync(path, 'utf8'));
    if (saved.schemaVersion !== 1) throw new Error('模型配置文件版本无效');
    current = mergeSettings(current, saved.settings);
    // Empty saved credentials are deliberate and must survive restarts.
    for (const kind of ['chat', 'image']) if (saved.settings[kind]?.apiKey === '') current[kind].apiKey = '';
    restored = true;
  }
  return {
    read: () => structuredClone(current),
    public: () => ({ ...publicSettings(current), savedLocally: restored }),
    save(patch) {
      const next = mergeSettings(current, patch);
      mkdirSync(dirname(path), { recursive: true });
      const temporary = `${path}.tmp`;
      writeFileSync(temporary, JSON.stringify({ schemaVersion: 1, settings: next }, null, 2), { encoding: 'utf8', mode: 0o600 });
      renameSync(temporary, path);
      current = next;
      restored = true;
      return this.public();
    },
  };
}
