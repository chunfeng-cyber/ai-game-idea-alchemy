import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { createPublicImageLookup, isPublicImageAddress, readProviderImage } from '../worker/image-download.mjs';

function connector(responseFor, calls = []) {
  return (url, options, callback) => {
    const request = new EventEmitter();
    request.end = () => queueMicrotask(() => {
      const respond = answers => {
        calls.push({ url: url.href, options, answers });
        const { status = 200, headers = {}, body = ['valid-image'] } = responseFor(url, options);
        const response = Readable.from(body.map(value => Buffer.from(value)));
        response.statusCode = status;
        response.headers = headers;
        callback(response);
      };
      if (options.lookup) options.lookup(url.hostname, { all: true }, (error, answers) => error ? request.emit('error', error) : respond(answers));
      else respond();
    });
    return request;
  };
}
const publicLookup = (_hostname, _options, callback) => callback(null, [{ address: '93.184.216.34', family: 4 }]);
const limit = { timeoutMs: 100, limit: 100 };

test('model image URLs reject local/private/link-local IPv4 and IPv6 literal variants before connecting', async () => {
  for (const address of ['localhost', '127.0.0.1', '127.9.8.7', '2130706433', '0x7f000001', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '[::1]', '[::]', '[fe80::1]', '[fc00::1]', '[::ffff:127.0.0.1]', '[::ffff:192.168.1.1]']) {
    let calls = 0;
    await assert.rejects(readProviderImage(`https://${address}/image.png`, { ...limit, requestImpl: () => { calls++; throw new Error('must not connect'); } }), /本机、内网或保留/);
    assert.equal(calls, 0, address);
  }
  assert.equal(isPublicImageAddress('8.8.8.8'), true);
  assert.equal(isPublicImageAddress('2606:4700:4700::1111'), true);
  assert.equal(isPublicImageAddress('2001:db8::1'), false);
});

test('DNS private and mixed answers fail at the socket lookup; validated answers are fixed without a second resolution', async () => {
  for (const answers of [[{ address: '10.0.0.1', family: 4 }], [{ address: '93.184.216.34', family: 4 }, { address: '::1', family: 6 }]]) {
    const calls = [];
    await assert.rejects(readProviderImage('https://untrusted.invalid/image.png', { ...limit,
      lookupImpl: (_hostname, _options, callback) => callback(null, answers), requestImpl: connector(() => ({}), calls) }), /本机、内网或保留/);
    assert.equal(calls.length, 0);
  }
  let resolutions = 0;
  const lookup = createPublicImageLookup((_hostname, _options, callback) => { resolutions++; callback(null, [{ address: '93.184.216.34', family: 4 }]); });
  const answer = await new Promise((resolve, reject) => lookup('rebinding.invalid', {}, (error, address, family) => error ? reject(error) : resolve({ address, family })));
  assert.deepEqual(answer, { address: '93.184.216.34', family: 4 });
  assert.equal(resolutions, 1);
});

test('every image redirect validates its URL and DNS independently without any model credential headers', async () => {
  for (const location of ['https://127.0.0.1/private', 'https://[::ffff:127.0.0.1]/private', 'http://cdn.invalid/plain', 'https://user:secret@cdn.invalid/image']) {
    const calls = [];
    await assert.rejects(readProviderImage('https://cdn.invalid/start', { ...limit, lookupImpl: publicLookup,
      requestImpl: connector(() => ({ status: 302, headers: { location } }), calls) }));
    assert.equal(calls.length, 1);
  }
  const calls = [];
  const bytes = await readProviderImage('https://cdn.invalid/start', { ...limit, lookupImpl: publicLookup,
    requestImpl: connector(url => url.pathname === '/start' ? { status: 302, headers: { location: '/final' } } : {}, calls) });
  assert.equal(bytes.toString(), 'valid-image');
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.options.headers.authorization, undefined);
    assert.equal(call.options.headers['x-api-key'], undefined);
    assert.deepEqual(call.answers, [{ address: '93.184.216.34', family: 4 }]);
  }
  await assert.rejects(readProviderImage('https://cdn.invalid/start', { ...limit,
    lookupImpl: (host, options, callback) => host === 'private.invalid' ? callback(null, [{ address: '192.168.1.2', family: 4 }]) : publicLookup(host, options, callback),
    requestImpl: connector(() => ({ status: 302, headers: { location: 'https://private.invalid/secret' } })) }), /本机、内网或保留/);
});

test('a user configured API exact origin permits self-hosted images while other origins remain blocked', async () => {
  const calls = [];
  const bytes = await readProviderImage('https://127.0.0.1:4433/image', { ...limit, allowedOrigin: 'https://127.0.0.1:4433', requestImpl: connector(() => ({}), calls) });
  assert.equal(bytes.toString(), 'valid-image');
  assert.equal(calls[0].options.lookup, undefined);
  await assert.rejects(readProviderImage('https://127.0.0.1:4434/image', { ...limit, allowedOrigin: 'https://127.0.0.1:4433', requestImpl: connector(() => ({})) }), /本机、内网或保留/);
});

test('image streamed and declared lengths are bounded and redirect loops end', async () => {
  for (const response of [{ headers: { 'content-length': '101' } }, { body: ['x'.repeat(60), 'x'.repeat(60)] }]) {
    await assert.rejects(readProviderImage('https://cdn.invalid/image', { ...limit, lookupImpl: publicLookup, requestImpl: connector(() => response) }), /30MB/);
  }
  await assert.rejects(readProviderImage('https://cdn.invalid/image', { ...limit, lookupImpl: publicLookup,
    requestImpl: connector(() => ({ status: 302, headers: { location: '/again' } })) }), /重定向/);
});
