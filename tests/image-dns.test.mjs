import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { resolvePublicImageDns } from '../worker/image-dns.mjs';
import { createPublicImageLookup, readProviderImage } from '../worker/image-download.mjs';

const fakeLookup = (_host, _options, callback) => callback(null, [{ address: '198.18.1.57', family: 4 }]);
const publicAnswers = [{ address: '93.184.216.34', family: 4 }];
const query = (lookup, host = 'cdn.example.com') => new Promise((resolve, reject) => lookup(host, { all: true }, (error, value) => error ? reject(error) : resolve(value)));

test('proxy Fake-IP is independently validated and only public answers reach the image socket', async () => {
  let validatedHost; let connectedAnswers;
  const bytes = await readProviderImage('https://cdn.example.com/image.png', { timeoutMs: 1000, limit: 50, lookupImpl: fakeLookup,
    publicDnsImpl: async host => { validatedHost = host; return publicAnswers; },
    requestImpl: (url, options, callback) => {
      assert.equal(options.headers.authorization, undefined);
      const request = new EventEmitter();
      request.end = () => options.lookup(url.hostname, { all: true }, (error, answers) => {
        if (error) { request.emit('error', error); return; }
        connectedAnswers = answers;
        const response = Readable.from([Buffer.from('image')]); response.statusCode = 200; response.headers = {};
        callback(response);
      });
      return request;
    } });
  assert.equal(bytes.toString(), 'image');
  assert.equal(validatedHost, 'cdn.example.com');
  assert.deepEqual(connectedAnswers, publicAnswers);
});

test('Fake-IP never admits private/mixed public DNS answers or IP family mismatches', async () => {
  for (const answers of [[{ address: '127.0.0.1', family: 4 }], [...publicAnswers, { address: '::1', family: 6 }],
    [{ address: '198.18.1.57', family: 4 }], [{ address: '93.184.216.34', family: 6 }]]) {
    await assert.rejects(query(createPublicImageLookup(fakeLookup, { resolveVerifiedPublic: async () => answers })), /本机、内网或保留/);
  }
});

test('ordinary private and mixed local DNS are rejected without trying to replace those answers', async () => {
  for (const answers of [[{ address: '10.0.0.1', family: 4 }], [...publicAnswers, { address: '198.18.1.57', family: 4 }]]) {
    let consulted = false;
    await assert.rejects(query(createPublicImageLookup((_host, _options, callback) => callback(null, answers),
      { resolveVerifiedPublic: async () => { consulted = true; return publicAnswers; } })), /本机、内网或保留/);
    assert.equal(consulted, false);
  }
  await assert.rejects(query(createPublicImageLookup(fakeLookup, { resolveVerifiedPublic: async () => { throw new Error('公网DNS验证失败'); } })), /公网DNS验证失败/);
});

test('public DNS validates both families, follows only the question CNAME chain and sends no provider headers', async () => {
  const calls = [];
  const addresses = await resolvePublicImageDns('cdn.example.com', { fetchImpl: async (value, options) => {
    const url = new URL(value); const type = url.searchParams.get('type'); calls.push({ url, options });
    return new Response(JSON.stringify({ Status: 0, Question: [{ name: 'cdn.example.com.', type: type === 'A' ? 1 : 28 }], Answer: type === 'A' ? [
      { name: 'cdn.example.com.', type: 5, data: 'edge.example.com.' },
      { name: 'edge.example.com.', type: 1, data: '93.184.216.34' },
      { name: 'unrelated.example.com.', type: 1, data: '10.0.0.1' },
    ] : [] }));
  } });
  assert.deepEqual(addresses, publicAnswers);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.options.redirect, 'error');
    assert.deepEqual(call.options.headers, { accept: 'application/dns-json' });
    assert.equal(call.url.hostname, 'cloudflare-dns.com');
  }
});

test('DNS malformed, wrong question and oversized answers fail closed without unbounded reads', async () => {
  for (const response of [() => new Response('bad json'), () => new Response(JSON.stringify({ Status: 0, Question: [{ name: 'wrong.example', type: 1 }], Answer: [] })),
    () => new Response('x', { headers: { 'content-length': '65537' } })]) {
    await assert.rejects(resolvePublicImageDns('cdn.example.com', { fetchImpl: async () => response() }), /公网DNS验证失败/);
  }
});

test('verified private DNS is never concealed by retrying a second public resolver', async () => {
  const calls = [];
  const lookup = createPublicImageLookup(fakeLookup, { resolveVerifiedPublic: hostname => resolvePublicImageDns(hostname, { fetchImpl: async (value) => {
    const url = new URL(value); calls.push(url.hostname); const type = url.searchParams.get('type') === 'A' ? 1 : 28;
    return new Response(JSON.stringify({ Status: 0, Question: [{ name: hostname, type }], Answer: type === 1 ? [{ name: hostname, type, data: '10.0.0.1' }] : [] }));
  } }) });
  await assert.rejects(query(lookup), /本机、内网或保留/);
  assert.deepEqual(calls, ['cloudflare-dns.com', 'cloudflare-dns.com']);
});
