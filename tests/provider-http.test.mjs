import assert from 'node:assert/strict';
import test from 'node:test';
import { createProviderHttpClient, readLimitedResponse, providerNetworkErrorMessage } from '../worker/provider-http.mjs';
import { createServer } from 'node:http';

const settings = () => ({ chat: { apiBaseUrl: 'https://provider.invalid/v1', apiKey: 'private-key', apiFormat: 'anthropic', timeoutMs: 500 }, image: { apiBaseUrl: 'https://provider.invalid/v1', apiKey: 'image-key', timeoutMs: 500 } });
const redact = value => String(value).replaceAll('private-key', '[redacted]');

test('authenticated model calls reject redirects without forwarding Anthropic credentials', async () => {
  const calls = [];
  const client = createProviderHttpClient({ settings, redact, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return new Response('', { status: 307, headers: { location: 'https://untrusted.invalid/stolen' } });
  } });
  await assert.rejects(client.json('messages', { method: 'POST', body: '{}' }), /重定向 307/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(calls[0].options.headers['x-api-key'], 'private-key');
  assert.equal(calls[0].url, 'https://provider.invalid/v1/messages');
});

test('provider error metadata stays compatible with finite parameter adaptation and redacts secrets', async () => {
  const client = createProviderHttpClient({ settings, redact, fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'private-key unsupported max_tokens', code: 'bad_parameter' } }), { status: 422 }) });
  await assert.rejects(client.json('chat/completions'), error => error.status === 422 && error.message.includes('max_tokens') && !error.message.includes('private-key'));
});

test('provider HTTP success with invalid JSON is an explicit error rather than an empty success', async () => {
  for (const body of ['<html>gateway</html>', 'null', '3']) {
    const client = createProviderHttpClient({ settings, redact, fetchImpl: async () => new Response(body) });
    await assert.rejects(client.json('models'), /无效 JSON/);
  }
});

test('the timeout covers model body reads and aborts the request', async () => {
  const client = createProviderHttpClient({ settings, redact, fetchImpl: async (_url, options) => new Response(new ReadableStream({ start(controller) {
    options.signal.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')), { once: true });
  } })) });
  await assert.rejects(client.json('models', {}, 5), /请求超时/);
});

test('streamed and declared response limits cancel before unbounded allocation', async () => {
  let canceled = false;
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(20)); }, cancel() { canceled = true; } });
  await assert.rejects(readLimitedResponse(new Response(stream), 10, 'bounded body'), /bounded body/);
  assert.equal(canceled, true);
  await assert.rejects(readLimitedResponse(new Response('', { headers: { 'content-length': '100' } }), 10, 'bounded length'), /bounded length/);
});

test('nested fetch errors identify DNS, certificate and reset failures without disclosing credentials', async () => {
  for (const [code, expected] of [['ENOTFOUND', '域名解析'], ['UND_ERR_CONNECT_TIMEOUT', '连接API服务超时'],
    ['ECONNRESET', '连接被服务或代理中断'], ['CERT_HAS_EXPIRED', 'TLS证书验证失败']]) {
    const cause = new Error('private-key'); cause.code = code;
    const error = new TypeError('fetch failed', { cause: new AggregateError([cause]) });
    assert.match(providerNetworkErrorMessage(error, redact), new RegExp(expected));
    assert.ok(!providerNetworkErrorMessage(error, redact).includes('private-key'));
    const client = createProviderHttpClient({ settings, redact, fetchImpl: async () => { throw error; } });
    await assert.rejects(client.json('messages', { method: 'POST', body: '{}' }), new RegExp(code));
  }
});

test('real HTTP model requests use separate connections and are never automatically replayed', async t => {
  const sockets = new Set(); let calls = 0;
  const server = createServer((request, response) => {
    calls++; sockets.add(request.socket);
    response.writeHead(200, { 'content-type': 'application/json' }); response.end('{"ok":true}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const localSettings = () => ({ chat: { ...settings().chat, apiBaseUrl: `http://127.0.0.1:${server.address().port}` } });
  const client = createProviderHttpClient({ settings: localSettings, redact });
  assert.deepEqual(await client.json('models'), { ok: true });
  assert.deepEqual(await client.json('messages', { method: 'POST', body: '{}' }), { ok: true });
  assert.equal(calls, 2); assert.equal(sockets.size, 2);
});

test('gateway HTML 403 reports an HTTP rejection rather than implying successful model access', async () => {
  let calls = 0;
  const client = createProviderHttpClient({ settings, redact, fetchImpl: async () => { calls++; return new Response('<html>Forbidden</html>', { status: 403, headers: { 'content-type': 'text/html' } }); } });
  await assert.rejects(client.json('messages', { method: 'POST', body: '{}' }), error => error.status === 403 && /供应商网关拒绝/.test(error.message) && /模型目录/.test(error.message));
  assert.equal(calls, 1);
});
