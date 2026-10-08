import { validateBaseUrl } from './provider-settings.mjs';

export const MAX_PROVIDER_RESPONSE_BYTES = 45 * 1024 * 1024;

export { readProviderImage } from './image-download.mjs';

export function providerNetworkErrorMessage(error, redact = String) {
  const pending = [error]; const visited = new Set(); const codes = [];
  while (pending.length && visited.size < 16) {
    const item = pending.shift();
    if (!item || typeof item !== 'object' || visited.has(item)) continue;
    visited.add(item);
    if (typeof item.code === 'string') codes.push(item.code);
    pending.push(item.cause, ...(Array.isArray(item.errors) ? item.errors : []));
  }
  const groups = [
    [['ENOTFOUND', 'EAI_AGAIN'], 'API域名解析失败，请检查地址和代理DNS'],
    [['UND_ERR_CONNECT_TIMEOUT', 'ETIMEDOUT'], '连接API服务超时，请检查网络或代理'],
    [['ECONNREFUSED'], 'API服务拒绝连接，请检查地址、端口和代理'],
    [['ECONNRESET', 'UND_ERR_SOCKET', 'EPIPE'], 'API连接被服务或代理中断，请稍后重试'],
    [['CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'], 'API的TLS证书验证失败，请检查证书和代理证书配置'],
  ];
  for (const [known, message] of groups) {
    const code = codes.find(value => known.includes(value));
    if (code) return `模型服务连接失败：${message}（${code}）`;
  }
  return `模型服务连接失败：${String(redact(error instanceof Error ? error.message : error)).slice(0, 260)}`;
}

export async function readLimitedResponse(response, limit, message) {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > limit) { await response.body?.cancel(); throw new Error(message); }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw new Error(message); }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, length);
  } finally { reader.releaseLock(); }
}

// All authenticated requests go through one boundary. A gateway redirect must
// not forward custom credential headers (including Anthropic x-api-key).
export function createProviderHttpClient({ settings, redact, fetchImpl = globalThis.fetch }) {
  const fetchProvider = async (path, options = {}, timeoutMs, kind = 'chat') => {
    const config = settings()[kind];
    if (!config?.apiKey) throw new Error(`${kind === 'chat' ? '对话' : '生图'} API Key 未填写，请打开模型设置`);
    const timeout = timeoutMs ?? config.timeoutMs;
    if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 900000) throw new Error('模型请求超时配置无效，请打开模型设置');
    const endpoint = `${validateBaseUrl(config.apiBaseUrl)}/${String(path).replace(/^\/+/, '')}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetchImpl(endpoint, {
        ...options, redirect: 'manual', signal: controller.signal,
        headers: {
          // Model calls are infrequent and long-lived. A fresh HTTP connection
          // avoids reusing idle sockets closed by a local proxy or gateway.
          connection: 'close',
          authorization: `Bearer ${config.apiKey}`,
          ...(config.apiFormat === 'anthropic' ? { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' } : {}),
          ...(options.body ? { 'content-type': 'application/json' } : {}),
          ...(options.headers || {}),
        },
      });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        throw new Error(`模型服务返回重定向 ${response.status}；请将 API Base URL 改为供应商的最终接口地址`);
      }
      return { response, body: (await readLimitedResponse(response, MAX_PROVIDER_RESPONSE_BYTES, '模型服务响应超过 45MB，已停止读取')).toString('utf8') };
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('模型服务请求超时', { cause: error });
      throw new Error(providerNetworkErrorMessage(error, redact), { cause: error });
    } finally { clearTimeout(timer); }
  };
  return {
    async json(path, options = {}, timeoutMs, kind = 'chat') {
      const { response, body } = await fetchProvider(path, options, timeoutMs, kind);
      let payload;
      try { payload = JSON.parse(body); } catch (error) {
        if (response.ok) throw new Error('模型服务返回了无效 JSON，请核对 API Base URL 和接口格式', { cause: error });
      }
      if (!response.ok) {
        const message = payload?.error?.message || payload?.message
          || (response.status === 403 && /text\/html/i.test(response.headers.get('content-type') || '')
            ? '供应商网关拒绝了生成请求；请核对该接口的访问权限、API地址和供应商网关状态（模型目录可连接不代表生成接口可用）' : `HTTP ${response.status}`);
        const code = payload?.error?.code || payload?.error?.type || '';
        const compact = value => String(redact(value)).replace(/\s+/g, ' ').slice(0, 260);
        const error = new Error(`模型服务返回 ${response.status}${code ? `（${compact(code)}）` : ''}：${compact(message)}`);
        error.status = response.status;
        throw error;
      }
      if (!payload || typeof payload !== 'object') throw new Error('模型服务返回了无效 JSON 数据');
      if (Number.isFinite(payload.code) && payload.code !== 200) {
        throw new Error(`模型服务返回业务错误 ${payload.code}：${String(redact(payload.message || '未知错误')).replace(/\s+/g, ' ').slice(0, 260)}`);
      }
      return payload;
    },
  };
}
