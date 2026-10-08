import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

const MAX_BYTES = 2_000_000;
const TRUSTED_HOSTS = new Set(['www.iesdouyin.com', 'api.bilibili.com', 'www.toutiao.com', 'www.reddit.com',
  'trends.google.com', 'news.google.com', 'wikimedia.org', 'hacker-news.firebaseio.com']);
const HEADERS = { 'user-agent': 'Mozilla/5.0 AI-Game-Alchemy/1.0 (local creative research tool)',
  accept: 'application/json, application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8' };

export function validateTrendSourceUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('实时来源地址无效'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443')
    || !TRUSTED_HOSTS.has(url.hostname)) throw new Error('实时来源地址不在公开来源白名单');
  return url;
}

async function limitedText(response, limit = MAX_BYTES) {
  if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new Error('实时来源返回内容过大'); }
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) { await reader.cancel(); throw new Error('实时来源返回内容过大'); }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { reader.releaseLock(); }
}

// Windows uses its system network settings. HttpClient streams before buffering,
// and redirect targets are checked in JavaScript before another request is sent.
const WINDOWS_SCRIPT = `
$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'
Add-Type -AssemblyName System.Net.Http
$handler=[Net.Http.HttpClientHandler]::new(); $handler.AllowAutoRedirect=$false
$handler.AutomaticDecompression=[Net.DecompressionMethods]::GZip -bor [Net.DecompressionMethods]::Deflate
$client=[Net.Http.HttpClient]::new($handler); $client.Timeout=[TimeSpan]::FromMilliseconds([int]$env:ALCHEMY_TREND_TIMEOUT_MS)
$client.DefaultRequestHeaders.TryAddWithoutValidation('User-Agent',$env:ALCHEMY_TREND_USER_AGENT) | Out-Null
$client.DefaultRequestHeaders.TryAddWithoutValidation('Accept','application/json, application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8') | Out-Null
$client.DefaultRequestHeaders.TryAddWithoutValidation('Accept-Language','zh-CN,zh;q=0.9,en;q=0.8') | Out-Null
$response=$null; $stream=$null; $memory=$null
try {
  $response=$client.GetAsync($env:ALCHEMY_TREND_SOURCE_URL,[Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
  $status=[int]$response.StatusCode
  if($status -ge 300 -and $status -lt 400){ [Console]::Error.Write('ALCHEMY_REDIRECT:'+([string]$response.Headers.Location)); exit 3 }
  if(-not $response.IsSuccessStatusCode){ [Console]::Error.Write('ALCHEMY_STATUS:'+$status); exit 4 }
  $limit=2000000
  if($response.Content.Headers.ContentLength -gt $limit){ [Console]::Error.Write('ALCHEMY_TOO_LARGE'); exit 5 }
  $stream=$response.Content.ReadAsStreamAsync().GetAwaiter().GetResult(); $memory=[IO.MemoryStream]::new(); $buffer=[byte[]]::new(16384)
  while(($count=$stream.Read($buffer,0,$buffer.Length)) -gt 0){
    if($memory.Length+$count -gt $limit){ [Console]::Error.Write('ALCHEMY_TOO_LARGE'); exit 5 }
    $memory.Write($buffer,0,$count)
  }
  $bytes=$memory.ToArray(); [Console]::OpenStandardOutput().Write($bytes,0,$bytes.Length)
} catch { [Console]::Error.Write('ALCHEMY_NETWORK_ERROR'); exit 6 }
finally { if($stream){$stream.Dispose()}; if($memory){$memory.Dispose()}; if($response){$response.Dispose()}; $client.Dispose(); $handler.Dispose() }
`;

function windowsResponse(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_SCRIPT], {
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ALCHEMY_TREND_SOURCE_URL: url, ALCHEMY_TREND_TIMEOUT_MS: String(timeoutMs), ALCHEMY_TREND_USER_AGENT: HEADERS['user-agent'] },
    });
    const decoder = new StringDecoder('utf8');
    let body = ''; let diagnostic = ''; let byteCount = 0; let settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); if (error) reject(error); else resolve(value); };
    const timer = setTimeout(() => { child.kill(); finish(new Error('实时来源请求超时')); }, timeoutMs + 2000);
    child.stdout.on('data', chunk => {
      byteCount += chunk.length;
      if (byteCount > MAX_BYTES) { child.kill(); finish(new Error('实时来源返回内容过大')); return; }
      body += decoder.write(chunk);
    });
    child.stderr.on('data', chunk => { if (diagnostic.length < 4096) diagnostic += chunk.toString('utf8').slice(0, 4096 - diagnostic.length); });
    child.on('error', () => finish(new Error('Windows 实时来源网络组件无法启动')));
    child.on('close', code => {
      if (code === 0) { finish(null, { text: body + decoder.end() }); return; }
      if (code === 3 && diagnostic.startsWith('ALCHEMY_REDIRECT:')) { finish(null, { redirect: diagnostic.slice(17).trim() }); return; }
      if (diagnostic.includes('ALCHEMY_TOO_LARGE')) { finish(new Error('实时来源返回内容过大')); return; }
      const status = Number(diagnostic.match(/^ALCHEMY_STATUS:(\d{3})$/u)?.[1]);
      if (status) { finish(Object.assign(new Error(`来源返回 HTTP ${status}`), { status })); return; }
      finish(new Error('公开来源网络读取失败'));
    });
  });
}

export async function fetchTrendText(value, timeoutMs = 15_000, { platform = process.platform, fetchImpl = fetch } = {}) {
  let url = validateTrendSourceUrl(value);
  const budget = Math.max(100, Math.min(30_000, Number(timeoutMs) || 15_000));
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budget);
  try {
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      const remaining = budget - (Date.now() - started);
      if (remaining <= 0) throw new Error('实时来源请求超时');
      if (platform === 'win32') {
        const response = await windowsResponse(url.href, remaining);
        if (!response.redirect) return response.text;
        url = validateTrendSourceUrl(new URL(response.redirect, url).href);
      } else {
        const response = await fetchImpl(url.href, { redirect: 'manual', signal: controller.signal, headers: HEADERS });
        if (response.status >= 300 && response.status < 400) {
          await response.body?.cancel();
          const next = response.headers.get('location');
          if (!next) throw new Error('实时来源重定向缺少地址');
          url = validateTrendSourceUrl(new URL(next, url).href);
        } else {
          if (!response.ok) { await response.body?.cancel(); throw Object.assign(new Error(`来源返回 HTTP ${response.status}`), { status: response.status }); }
          return await limitedText(response);
        }
      }
    }
    throw new Error('实时来源重定向次数过多');
  } catch (error) {
    if (controller.signal.aborted) throw new Error('实时来源请求超时', { cause: error });
    throw error;
  } finally { clearTimeout(timer); }
}
