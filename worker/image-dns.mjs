// A local proxy can return benchmark-range Fake-IP answers. Never allow that
// range as an image destination: corroborate the hostname with authenticated
// public DNS and pass the verified answers to the actual image socket instead.
const DNS_SERVICES = ['https://cloudflare-dns.com/dns-query', 'https://dns.google/resolve'];
const MAX_DNS_BYTES = 65536;

export function isProxyFakeImageAddress(address) {
  return /^198\.(?:18|19)\.(?:\d{1,3})\.(?:\d{1,3})$/u.test(address);
}

async function dnsAnswer(hostname, type, endpoint, { fetchImpl, signal }) {
  const url = new URL(endpoint);
  url.searchParams.set('name', hostname);
  url.searchParams.set('type', type);
  const response = await fetchImpl(url.href, { redirect: 'error', signal, headers: { accept: 'application/dns-json' } });
  if (!response.ok) { await response.body?.cancel(); throw new Error('公网DNS服务暂不可用'); }
  if (Number(response.headers.get('content-length')) > MAX_DNS_BYTES) { await response.body?.cancel(); throw new Error('公网DNS响应过大'); }
  const reader = response.body?.getReader();
  const chunks = []; let size = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_DNS_BYTES) { await reader.cancel(); throw new Error('公网DNS响应过大'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
  }
  const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const normalized = value => String(value || '').toLowerCase().replace(/\.$/u, '');
  const recordType = type === 'A' ? 1 : 28;
  if (data.Status !== 0 || data.TC === true || !Array.isArray(data.Question)
    || !data.Question.some(question => normalized(question.name) === normalized(hostname) && question.type === recordType)) {
    throw new Error('公网DNS未能验证图片域名');
  }
  const answers = Array.isArray(data.Answer) ? data.Answer : [];
  const names = new Set([normalized(hostname)]);
  for (let pass = 0; pass < 8; pass++) {
    for (const record of answers) if (record.type === 5 && names.has(normalized(record.name))) names.add(normalized(record.data));
  }
  return answers.filter(record => record.type === recordType && names.has(normalized(record.name)))
    .map(record => ({ address: String(record.data), family: recordType === 1 ? 4 : 6 }));
}

export async function resolvePublicImageDns(hostname, { fetchImpl = globalThis.fetch, signal } = {}) {
  let lastError;
  for (const endpoint of DNS_SERVICES) {
    const attemptSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(6500)]) : AbortSignal.timeout(6500);
    try {
      const families = await Promise.all(['A', 'AAAA'].map(type => dnsAnswer(hostname, type, endpoint, { fetchImpl, signal: attemptSignal })));
      const addresses = families.flat();
      if (!addresses.length) throw new Error('公网DNS没有返回图片地址');
      // Public/private validation remains at the socket lookup boundary; do not
      // try another resolver to hide a private or mixed successful DNS answer.
      return addresses;
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
    }
  }
  throw new Error('本机代理DNS返回198.18/15地址，但公网DNS验证失败；请检查代理网络后重试', { cause: lastError });
}
