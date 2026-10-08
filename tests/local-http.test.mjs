import assert from 'node:assert/strict';
import test from 'node:test';
import { PassThrough } from 'node:stream';
import { readJson } from '../worker/local-http.mjs';

function request(headers = { 'content-type': 'application/json' }) {
  const stream = new PassThrough();
  stream.headers = headers;
  return stream;
}

test('local JSON input accepts one bounded object and rejects other JSON shapes', async () => {
  const req = request({ 'content-type': 'application/json; charset=utf-8' });
  const result = readJson(req);
  req.end('{"requestId":"safe-task"}');
  assert.deepEqual(await result, { requestId: 'safe-task' });
  for (const value of ['null', '[]', '1', '{broken']) {
    const invalid = request();
    const pending = readJson(invalid);
    invalid.end(value);
    await assert.rejects(pending, error => error.status === 400 && /JSON/.test(error.message));
  }
});

test('declared and streamed request sizes are limited, unsupported input gets 415', async () => {
  await assert.rejects(readJson(request({ 'content-type': 'text/plain' })), error => error.status === 415);
  await assert.rejects(readJson(request({ 'content-type': 'application/json', 'content-length': '100001' })), error => error.status === 413);
  const req = request();
  const result = readJson(req, { limit: 10 });
  req.write('x'.repeat(11));
  await assert.rejects(result, error => error.status === 413);
  req.destroy();
});

test('slow request bodies release their read budget instead of locking generation indefinitely', async () => {
  const req = request();
  await assert.rejects(readJson(req, { timeoutMs: 5 }), error => error.status === 408);
  req.destroy();
});
