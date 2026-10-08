import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, randomFillSync } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

test('a clean API-only user can configure two providers, generate, recover and receive honest failures without external services', { timeout: 60000 }, async t => {
  const temp = mkdtempSync(join(tmpdir(), 'alchemy-onboarding-'));
  const runtime = join(temp, 'runtime');
  const generated = join(temp, 'generated');
  mkdirSync(runtime);
  mkdirSync(generated);
  const report = { gameName: '弧线小球场', rarity: '稀有', tagline: '画出弧线借板得分', marketOpportunity: '短回合操作理解需要测试', coreGameplay: '画弧击球，借墙反弹命中目标', adHook: '一笔弧线完成意想不到的反弹', artDirection: '清楚可读的卡通球场', recipe: '用户硬约束：滑动（swipe）＋运动（sports）。AI补全：反弹目标。', aiCompletion: '补全球场与目标', control: '滑动', action: '画弧击球', mechanic: '借墙反弹', gameType: '休闲解谜', artStyle: '卡通3D', topic: '街区球场', trendCatalyst: '无实时证据，待验证', synthesisJudgement: '保留两项投入', referenceImageCaption: '完整游戏关卡与HUD', sources: [], icons: { market: '📊', gameplay: '🎮', hook: '🧲', art: '🎨', recipe: '🧪', ai: '🤖' }, imagePrompt: 'An actual playable game screenshot showing a small tennis court, ball trajectory, obstacles, target and HUD.' };
  const rgb = Buffer.alloc(384 * 216 * 3);
  randomFillSync(rgb);
  const png = await sharp(rgb, { raw: { width: 384, height: 216, channels: 3 } }).png().toBuffer();
  assert.ok(png.length > 10000);
  const longRgb = Buffer.alloc(400 * 16 * 3);
  randomFillSync(longRgb);
  const longPng = await sharp(longRgb, { raw: { width: 400, height: 16, channels: 3 } }).png().toBuffer();
  const outputPath = url => join(generated, new URL(url).pathname.split('/').pop());
  const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
  writeFileSync(join(temp, 'fixture.png'), png);
  // Actual provider HTTP requests remain local. Image URL downloads use an
  // in-process response; any unexpected public request fails the test.
  const preload = join(temp, 'offline-fetch.mjs');
  writeFileSync(preload, `import { readFileSync } from 'node:fs';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
const originalFetch = globalThis.fetch;
const originalHttpsRequest = https.request;
const png = readFileSync(${JSON.stringify(join(temp, 'fixture.png'))});
https.request = (input, options, callback) => {
  const url = new URL(input);
  if (url.hostname !== 'cold-image.invalid') return originalHttpsRequest(input, options, callback);
  const request = new EventEmitter();
  request.end = () => queueMicrotask(() => {
    const oversized = url.pathname === '/oversized.png';
    const data = oversized ? (function* () { for (let count = 0; count < 62; count++) yield Buffer.alloc(512 * 1024); })() : [png];
    const response = Readable.from(data);
    response.statusCode = 200;
    response.headers = {'content-type': 'image/png'};
    callback(response);
  });
  return request;
};
globalThis.fetch = (input, options) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.protocol === 'http:' && url.hostname === '127.0.0.1') return originalFetch(input, options);
  throw new Error('External network forbidden in onboarding test: ' + url.origin);
};`);
  const chatRequests = [];
  const imageRequests = [];
  let chatMode = 'strict';
  let imageMode = 'strict';
  let taskPolls = 0;
  const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const parseBody = async req => { let body = ''; for await (const chunk of req) body += chunk; return JSON.parse(body); };
  const chatServer = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer cold-chat-secret');
    if (req.url === '/v1/models') { json(res, 200, { data: [{ id: 'cold-chat' }] }); return; }
    if (req.url === '/v1/messages') {
      assert.equal(req.headers['x-api-key'], 'cold-chat-secret');
      assert.equal(req.headers['anthropic-version'], '2023-06-01');
      const body = await parseBody(req);
      chatRequests.push(body);
      assert.equal(body.model, 'cold-anthropic');
      assert.equal(body.max_tokens, 4096);
      json(res, 200, { content: [{ type: 'text', text: JSON.stringify(report) }] });
      return;
    }
    assert.equal(req.url, '/v1/chat/completions');
    const body = await parseBody(req);
    chatRequests.push(body);
    if (chatMode === 'auth') { json(res, 401, { error: { message: 'cold-chat-secret invalid; unsupported response_format' } }); return; }
    if (chatMode === 'strict') {
      if ('max_tokens' in body) { json(res, 400, { error: { message: "Unsupported parameter: 'max_tokens'; use 'max_completion_tokens'" } }); return; }
      if ('temperature' in body) { json(res, 400, { error: { message: "Unsupported parameter: 'temperature'" } }); return; }
      if ('response_format' in body) { json(res, 422, { error: { message: "Unknown parameter: 'response_format'" } }); return; }
      assert.equal(body.max_completion_tokens, 4096);
    }
    const responseReport = chatMode === 'fabricated' ? { ...report, sources: [{ title: '编造热度', url: 'https://example.invalid/fake', publishedAt: new Date().toISOString() }] }
      : chatMode === 'oversized-recipe' ? { ...report, recipe: '投入'.repeat(1000) } : report;
    json(res, 200, { choices: [{ message: { content: JSON.stringify(responseReport) } }] });
  });
  const imageServer = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer cold-image-secret');
    if (req.url === '/v1/models') { json(res, 200, { data: [{ id: 'cold-image' }] }); return; }
    if (req.url === '/v1/tasks/cold-echojoy') {
      taskPolls++;
      if (imageMode === 'echojoy-failed') { json(res, 200, { data: { status: 'failed', error: 'fake image task failure' } }); return; }
      if (imageMode === 'echojoy-canceled') { json(res, 200, { data: { status: 'cancelled', message: 'fake task cancellation' } }); return; }
      json(res, 200, { data: taskPolls === 1 ? { status: 'processing' } : { status: 'success', images: [{ b64_json: png.toString('base64') }] } });
      return;
    }
    assert.equal(req.url, '/v1/images/generations');
    const body = await parseBody(req);
    imageRequests.push(body);
    if (imageMode.startsWith('echojoy-')) {
      assert.equal(body.model_id, 'cold-echojoy');
      assert.equal(body.input_data.aspect_ratio, '16:9');
      assert.match(body.input_data.prompt, /HUD/);
      json(res, 200, { data: { task_id: 'cold-echojoy' } });
      return;
    }
    if (imageMode === 'auth') { json(res, 403, { error: { message: 'cold-image-secret rejected; unsupported quality' } }); return; }
    if (imageMode === 'invalid') { json(res, 200, { data: [{ b64_json: 'A'.repeat(200) }] }); return; }
    if (imageMode === 'large-base64') { json(res, 200, { data: [{ b64_json: 'A'.repeat(Math.ceil((30 * 1024 * 1024 + 1) / 3) * 4) }] }); return; }
    if (imageMode === 'large-stream') { json(res, 200, { imageUrl: 'https://cold-image.invalid/oversized.png' }); return; }
    if (imageMode === 'url') { json(res, 200, { imageUrl: 'https://cold-image.invalid/game.png' }); return; }
    if (imageMode === 'long-image') { json(res, 200, { data: [{ b64_json: longPng.toString('base64') }] }); return; }
    if (imageMode === 'strict') {
      for (const field of ['response_format', 'output_format', 'quality', 'n']) {
        if (field in body) { json(res, 400, { error: { message: field === 'quality' ? "Invalid value for quality: 'medium'; must be 'standard' or 'hd'" : `Unsupported parameter: '${field}'` } }); return; }
      }
      if (body.size === '1536x864') { json(res, 400, { error: { message: "Invalid size; must be '1536x1024'" } }); return; }
    }
    json(res, 200, { data: [{ b64_json: png.toString('base64') }] });
  });
  const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  await Promise.all([listen(chatServer), listen(imageServer)]);
  const portServer = createServer();
  await listen(portServer);
  const port = portServer.address().port;
  await new Promise(resolve => portServer.close(resolve));
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(?:ALCHEMY_|CODEX_|OPENAI_)/.test(name)));
  Object.assign(env, { ALCHEMY_ENV_FILE: '', ALCHEMY_CODEX_PORT: String(port), ALCHEMY_RUNTIME_DIR: runtime, ALCHEMY_GENERATED_DIR: generated, CODEX_HOME: join(temp, 'no-codex-login') });
  let child;
  let logs = '';
  const api = async (path, body) => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: body ? 'POST' : 'GET', headers: { Origin: 'http://localhost:3000', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
      return { status: response.status, body: await response.json() };
    } catch (error) {
      // Give a disconnected child time to emit its exit event so a native
      // renderer crash is distinguishable from an HTTP timeout.
      await new Promise(resolve => setTimeout(resolve, 100));
      throw new Error(`Isolated API ${path} failed; sidecar exit=${child?.exitCode}, signal=${child?.signalCode}; ${error.cause?.code || error.message}\n${logs.slice(-4000)}`, { cause: error });
    }
  };
  const stop = async () => { if (child && child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; } };
  const start = async () => {
    child = spawn(process.execPath, ['--import', pathToFileURL(preload).href, 'worker/codex-sidecar.mjs'], { cwd: resolve('.'), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', chunk => { logs += chunk; });
    child.stderr.on('data', chunk => { logs += chunk; });
    for (let attempt = 0; attempt < 50; attempt++) {
      try { await api('/health'); return; } catch { if (child.exitCode !== null) throw new Error(`Isolated sidecar exited: ${logs}`); await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    throw new Error('Isolated sidecar did not start');
  };
  t.after(async () => {
    await stop();
    chatServer.closeAllConnections(); imageServer.closeAllConnections();
    await Promise.all([new Promise(resolve => chatServer.close(resolve)), new Promise(resolve => imageServer.close(resolve))]);
    assert.ok(temp.startsWith(join(tmpdir(), 'alchemy-onboarding-')));
    rmSync(temp, { recursive: true, force: true });
  });
  await start();
  const first = (await api('/api/settings')).body;
  assert.equal(first.mode, 'api');
  assert.equal(first.fallbackEnabled, false);
  assert.equal(first.chat.apiKeyConfigured, false);
  assert.equal(first.image.apiKeyConfigured, false);
  assert.deepEqual((await api('/api/result')).body, { view: 'empty' });
  const scope = { region: '欧美', country: '美国', channel: 'TikTok' };
  const recipe = id => ({ requestId: id, prompt: '用户投入滑动与运动两个硬约束，请从零推导完整原创游戏方案。', materialIds: ['swipe', 'sports'], scope });
  const unconfigured = await api('/api/generate', recipe('no-keys'));
  assert.equal(unconfigured.status, 500);
  assert.match(unconfigured.body.error, /模型设置/);
  assert.equal(chatRequests.length + imageRequests.length, 0);
  assert.equal((await api('/health')).body.generation.stage, 'failed');
  const saved = await api('/api/settings', { chat: { apiBaseUrl: `http://127.0.0.1:${chatServer.address().port}/v1`, apiKey: 'cold-chat-secret', model: 'cold-chat' }, image: { apiBaseUrl: `http://127.0.0.1:${imageServer.address().port}/v1`, apiKey: 'cold-image-secret', model: 'cold-image' } });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.fallbackEnabled, false);
  assert.ok(!JSON.stringify(saved.body).includes('cold-chat-secret') && !JSON.stringify(saved.body).includes('cold-image-secret'));
  for (const kind of ['chat', 'image']) assert.equal((await api('/api/settings/test', { kind })).body.modelListed, true);
  const result = await api('/api/generate', recipe('cold-start'));
  assert.equal(result.status, 200, result.body.error);
  assert.equal(result.body.provider, 'api');
  assert.deepEqual(result.body.materialIds, ['swipe', 'sports']);
  assert.deepEqual(result.body.report.sources, []);
  assert.match(result.body.report.marketOpportunity, /^待验证的市场假设：/);
  assert.match(result.body.report.trendCatalyst, /未获取可核验实时来源/);
  assert.equal(result.body.posterLayoutVersion, 3);
  assert.equal(result.body.posterWidth, 1600);
  assert.ok(readFileSync(outputPath(result.body.posterUrl)).length > 10000);
  assert.match(new URL(result.body.imageUrl).pathname, /^\/generated\/alchemy-[a-f0-9-]{36}\.png$/);
  const originalHashes = { image: hash(outputPath(result.body.imageUrl)), poster: hash(outputPath(result.body.posterUrl)) };
  assert.equal(chatRequests.length, 4);
  assert.equal(imageRequests.length, 6);
  assert.match(chatRequests.at(-1).messages[1].content, /sources 必须是空数组/);
  assert.match(imageRequests.at(-1).prompt, /完整可操作区域/);
  await stop();
  await start();
  const restoredSettings = (await api('/api/settings')).body;
  assert.equal(restoredSettings.chat.apiKeyConfigured, true);
  assert.equal(restoredSettings.image.apiKeyConfigured, true);
  assert.equal(restoredSettings.fallbackEnabled, false);
  assert.deepEqual((await api('/api/result')).body, result.body);
  let previousImageCalls = imageRequests.length;
  let previousChatCalls = chatRequests.length;
  assert.equal((await api('/api/generate', recipe('cold-start'))).status, 409, 'a completed request ID is rejected across restart');
  assert.equal(chatRequests.length, previousChatCalls);
  assert.equal(imageRequests.length, previousImageCalls);
  chatMode = 'auth';
  previousChatCalls = chatRequests.length;
  const chatDenied = await api('/api/generate', recipe('chat-denied'));
  assert.equal(chatDenied.status, 500);
  assert.match(chatDenied.body.error, /401/);
  assert.ok(!chatDenied.body.error.includes('cold-chat-secret'));
  assert.equal(chatRequests.length - previousChatCalls, 1, 'auth errors must not trigger parameter retries or Codex');
  chatMode = 'normal';
  imageMode = 'auth';
  previousImageCalls = imageRequests.length;
  const imageDenied = await api('/api/generate', recipe('image-denied'));
  assert.equal(imageDenied.status, 500);
  assert.match(imageDenied.body.error, /403/);
  assert.equal(imageRequests.length - previousImageCalls, 1);
  assert.deepEqual((await api('/api/result')).body, result.body, 'failed generation preserves the completed result');
  assert.equal(imageDenied.body.draftReady, true);
  const failedDraft = imageDenied.body.draft;
  assert.equal(failedDraft.view, 'draft');
  assert.equal(failedDraft.sourceRequestId, 'image-denied');
  assert.deepEqual(failedDraft.materialIds, ['swipe', 'sports']);
  assert.ok(!JSON.stringify(failedDraft).includes('cold-image-secret'));
  await stop();
  await start();
  assert.deepEqual((await api('/api/draft')).body, failedDraft, 'failed new scheme survives restart');
  assert.equal((await api('/health')).body.draftReady, true);
  previousChatCalls = chatRequests.length;
  previousImageCalls = imageRequests.length;
  const staleDraft = await api('/api/resume-image', { requestId: 'stale-draft', draftId: failedDraft.draftId, sourceDraftVersion: failedDraft.stateVersion - 1 });
  assert.equal(staleDraft.status, 409);
  assert.equal(imageRequests.length, previousImageCalls);
  const retryFailed = await api('/api/resume-image', { requestId: 'retry-image-denied', draftId: failedDraft.draftId, sourceDraftVersion: failedDraft.stateVersion });
  assert.equal(retryFailed.status, 500);
  assert.equal(chatRequests.length, previousChatCalls, 'resume failure never calls a chat API');
  assert.deepEqual((await api('/api/result')).body, result.body);
  assert.ok(retryFailed.body.draft.stateVersion > failedDraft.stateVersion);
  imageMode = 'normal';
  const continued = await api('/api/resume-image', { requestId: 'continued-image', draftId: retryFailed.body.draft.draftId, sourceDraftVersion: retryFailed.body.draft.stateVersion });
  assert.equal(continued.status, 200, continued.body.error);
  assert.equal(continued.body.provider, 'api-image-resume');
  assert.deepEqual(continued.body.report, failedDraft.report);
  assert.deepEqual(continued.body.materialIds, ['swipe', 'sports']);
  assert.equal(chatRequests.length, previousChatCalls, 'successful resume does not repay text generation');
  assert.deepEqual((await api('/api/draft')).body, { view: 'empty' });
  assert.equal((await api('/health')).body.draftReady, false);
  assert.equal((await api('/api/resume-image', { requestId: 'completed-draft', draftId: failedDraft.draftId, sourceDraftVersion: failedDraft.stateVersion })).status, 409);
  env.ALCHEMY_FONT_FILE = join(temp, 'missing-chinese-font.ttf');
  await stop(); await start();
  assert.equal((await api('/health')).body.chineseFont.available, false);
  const posterFailure = await api('/api/generate', recipe('cold-start')); // Reuse an older historical request ID after a newer result exists.
  assert.equal(posterFailure.status, 500);
  assert.match(posterFailure.body.error, /ALCHEMY_FONT_FILE/);
  assert.equal(posterFailure.body.draft.stage, 'poster');
  assert.match(new URL(posterFailure.body.draft.imageUrl).pathname, /^\/generated\/alchemy-[a-f0-9-]{36}\.png$/);
  assert.notEqual(posterFailure.body.draft.imageUrl, result.body.imageUrl);
  assert.equal(hash(outputPath(result.body.imageUrl)), originalHashes.image, 'historical request ID reuse cannot overwrite a completed game image');
  assert.equal(hash(outputPath(result.body.posterUrl)), originalHashes.poster, 'poster failure cannot damage an earlier completed poster');
  assert.deepEqual((await api('/api/result')).body, continued.body, 'poster failure preserves the last complete result');
  const posterDraft = posterFailure.body.draft;
  previousChatCalls = chatRequests.length;
  previousImageCalls = imageRequests.length;
  delete env.ALCHEMY_FONT_FILE;
  await stop(); await start();
  const posterContinued = await api('/api/resume-image', { requestId: 'poster-font-fixed', draftId: posterDraft.draftId, sourceDraftVersion: posterDraft.stateVersion });
  assert.equal(posterContinued.status, 200, posterContinued.body.error);
  assert.equal(posterContinued.body.imageUrl, posterDraft.imageUrl);
  assert.equal(chatRequests.length, previousChatCalls, 'poster continuation does not call text');
  assert.equal(imageRequests.length, previousImageCalls, 'poster continuation reuses the already paid image');
  assert.deepEqual((await api('/api/draft')).body, { view: 'empty' });
  for (const [mode, id, message] of [['invalid', 'invalid-image', /有效 PNG\/JPEG/], ['large-base64', 'oversized-base64', /30MB/], ['large-stream', 'oversized-stream', /30MB/]]) {
    imageMode = mode;
    const filesBefore = readdirSync(generated).sort();
    const failure = await api('/api/generate', recipe(id));
    assert.equal(failure.status, 500);
    assert.match(failure.body.error, message);
    assert.deepEqual(readdirSync(generated).sort(), filesBefore, 'invalid images cannot leave a new output file');
    assert.equal((await api('/health')).body.busy, false);
  }
  chatMode = 'fabricated';
  previousImageCalls = imageRequests.length;
  const fabricated = await api('/api/generate', recipe('fake-source'));
  assert.equal(fabricated.status, 500);
  assert.match(fabricated.body.error, /不可编造市场证据/);
  assert.equal(imageRequests.length, previousImageCalls);
  chatMode = 'oversized-recipe';
  const oversizedReport = await api('/api/generate', recipe('oversized-report'));
  assert.equal(oversizedReport.status, 500);
  assert.match(oversizedReport.body.error, /recipe 超过 1500/);
  assert.equal(imageRequests.length, previousImageCalls, 'oversized model text must not incur image charges');
  previousChatCalls = chatRequests.length;
  const expired = await api('/api/generate', { ...recipe('expired-hotspot'), materialIds: ['swipe', 'trend-unfetched-or-expired'] });
  assert.equal(expired.status, 500);
  assert.match(expired.body.error, /未获取或已过期的热点/);
  assert.equal(chatRequests.length, previousChatCalls);
  chatMode = 'normal';
  imageMode = 'url';
  const recovered = await api('/api/generate', recipe('url-recovered'));
  assert.equal(recovered.status, 200, recovered.body.error);
  assert.ok(existsSync(outputPath(recovered.body.posterUrl)));
  assert.equal((await api('/health')).body.providerReady, true);
  imageMode = 'long-image';
  await api('/api/settings', { image: { size: '1:3' } });
  const padded = await api('/api/regenerate-image', { requestId: 'long-strip-padding', sourceStateVersion: recovered.body.stateVersion });
  assert.equal(padded.status, 200, padded.body.error);
  const paddedSize = await sharp(readFileSync(outputPath(padded.body.imageUrl))).metadata();
  assert.ok(paddedSize.width <= 4096 && paddedSize.height <= 4096 && paddedSize.width * paddedSize.height <= 16000000);
  assert.ok(Math.abs(paddedSize.width / paddedSize.height - 1 / 3) < 0.01);
  await api('/api/settings', { image: { size: '16:9' } });
  await api('/api/settings', { chat: { apiFormat: 'anthropic', model: 'cold-anthropic' }, image: { apiFormat: 'echojoy', model: 'cold-echojoy', pollIntervalMs: 750 } });
  imageMode = 'echojoy-success';
  taskPolls = 0;
  const asynchronous = await api('/api/generate', recipe('anthropic-echojoy'));
  assert.equal(asynchronous.status, 200, asynchronous.body.error);
  assert.equal(asynchronous.body.provider, 'api');
  assert.equal(taskPolls, 2);
  assert.ok(existsSync(outputPath(asynchronous.body.posterUrl)));
  for (const mode of ['echojoy-failed', 'echojoy-canceled']) {
    imageMode = mode;
    const failure = await api('/api/generate', recipe(mode));
    assert.equal(failure.status, 500);
    assert.match(failure.body.error, /Echojoy 生图任务/);
    assert.equal((await api('/health')).body.busy, false);
    assert.deepEqual((await api('/api/result')).body, asynchronous.body);
  }
  assert.ok(!logs.includes('cold-chat-secret') && !logs.includes('cold-image-secret'));
  assert.ok(!logs.includes('External network forbidden'));
});
