import dns from 'node:dns';
import https from 'node:https';
import { isIP } from 'node:net';
import { isProxyFakeImageAddress, resolvePublicImageDns } from './image-dns.mjs';

const publicAddressError = () => new Error('模型返回的图片地址指向本机、内网或保留地址，已拒绝下载');

export function isPublicImageAddress(address) {
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2))))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  if (family !== 6 || address.includes('%')) return false;
  const halves = address.toLowerCase().split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const groups = (halves.length === 1 ? left : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right]).map(value => Number.parseInt(value, 16));
  // Only globally allocated IPv6 unicast. Reject mapped/compatible IPv4,
  // transition ranges, ULA, link-local, multicast and documentation addresses.
  return groups.length === 8 && groups[0] >= 0x2000 && groups[0] <= 0x3fff
    && !(groups[0] === 0x2001 && (groups[1] <= 0x1ff || groups[1] === 0xdb8))
    && groups[0] !== 0x2002 && groups[0] !== 0x3ffe && groups[0] !== 0x3fff;
}

export function createPublicImageLookup(lookupImpl = dns.lookup, { resolveVerifiedPublic = resolvePublicImageDns } = {}) {
  return (hostname, options, callback) => {
    lookupImpl(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error) { callback(new Error('图片地址域名解析失败', { cause: error })); return; }
      const finish = answers => {
        if (!answers?.length || answers.some(value => !isPublicImageAddress(value.address)
          || isIP(value.address) !== value.family)) { callback(publicAddressError()); return; }
        if (options?.all) callback(null, answers);
        else callback(null, answers[0].address, answers[0].family);
      };
      if (addresses?.length && addresses.every(value => value.family === 4 && isProxyFakeImageAddress(value.address))) {
        Promise.resolve().then(() => resolveVerifiedPublic(hostname)).then(finish, callback);
        return;
      }
      // The socket receives these exact validated answers, rather than doing a
      // second DNS lookup after validation (which would permit DNS rebinding).
      finish(addresses);
    });
  };
}

function imageUrl(value, allowedOrigin) {
  let url;
  try { url = new URL(value); } catch (error) { throw new Error('生图模型返回的图片地址无效', { cause: error }); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('图片地址须为不含账号信息的 HTTPS 链接');
  if (url.origin !== allowedOrigin) {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (/^(?:localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host) || (isIP(host) && !isPublicImageAddress(host))) throw publicAddressError();
  }
  return url;
}

function getImageResponse(url, { signal, allowedOrigin, lookupImpl, requestImpl, publicDnsImpl }) {
  return new Promise((resolve, reject) => {
    const request = requestImpl(url, {
      method: 'GET', signal,
      ...(url.origin === allowedOrigin ? {} : { lookup: createPublicImageLookup(lookupImpl,
        { resolveVerifiedPublic: hostname => publicDnsImpl(hostname, { signal }) }) }),
      headers: { accept: 'image/png,image/jpeg,image/*;q=0.8', 'accept-encoding': 'identity' },
    }, response => resolve(response));
    request.once('error', reject);
    request.end();
  });
}

export async function readProviderImage(value, { timeoutMs, limit, allowedOrigin = '', lookupImpl = dns.lookup, publicDnsImpl = resolvePublicImageDns,
  requestImpl = (url, options, callback) => https.request(url, options, callback) }) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 900000 || !Number.isSafeInteger(limit) || limit < 1) throw new Error('图片下载限制配置无效');
  let url = imageUrl(value, allowedOrigin);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (let redirects = 0; redirects <= 5; redirects++) {
      const response = await getImageResponse(url, { signal: controller.signal, allowedOrigin, lookupImpl, requestImpl, publicDnsImpl });
      if (response.statusCode >= 300 && response.statusCode < 400) {
        response.destroy();
        const location = response.headers.location;
        if (!location || redirects === 5) throw new Error('图片下载重定向无效或过多');
        url = imageUrl(new URL(location, url).href, allowedOrigin);
        continue;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) { response.destroy(); throw new Error(`图片下载失败（HTTP ${response.statusCode}）`); }
      if (Number(response.headers['content-length'] || 0) > limit) { response.destroy(); throw new Error('生图结果超过 30MB，已拒绝写入'); }
      const chunks = [];
      let length = 0;
      for await (const chunk of response) {
        length += chunk.length;
        if (length > limit) { response.destroy(); throw new Error('生图结果超过 30MB，已拒绝写入'); }
        chunks.push(chunk);
      }
      return Buffer.concat(chunks, length);
    }
    throw new Error('图片下载失败');
  } catch (error) {
    if (controller.signal.aborted) throw new Error('图片下载超时，方案草稿已保留', { cause: error });
    throw error;
  } finally { clearTimeout(timer); }
}
