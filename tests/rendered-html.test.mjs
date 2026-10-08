import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { html as widgetHtml } from './helpers/widget-source.mjs';

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  return (await import(workerUrl.href)).default;
}

const env = {
  ASSETS: {
    fetch: async () => new Response("Not found", { status: 404 }),
  },
};

const context = {
  waitUntil() {},
  passThroughOnException() {},
};

test("server-renders the alchemy preview", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    env,
    context,
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>AI 游戏创意炼金器<\/title>/);
  assert.match(html, /<iframe[^>]+src="\/alchemy-source\.html\?rev=[^"\s]+"/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("widget supports ChatGPT host and authenticated local Codex generation", async () => {
  const [html, packageSource] = await Promise.all([
    Promise.resolve(widgetHtml),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(html, /sendFollowUpMessage/);
  assert.match(html, /requestDisplayMode\(\{ mode: 'fullscreen' \}\)/);
  assert.match(html, /ui\/notifications\/tool-result/);
  assert.match(html, /render_alchemy_report/);
  assert.match(html, /【炼金器合成请求】/);
  assert.match(html, /function enablePointerDrag\(element, id\)/);
  assert.match(html, /element\.draggable = false/);
  assert.match(html, /function animateFlowPositions\(before, geometry\)/);
  assert.match(html, /function restorePointerDrag\(drag\)/);
  assert.match(html, /alchemy-drag-float/);
  assert.match(html, /const existingTokens = new Map/);
  assert.match(html, /previousRects\.get\(id\)/);
  assert.match(html, /touch-action: none/);
  assert.match(html, /const endpoint = resumeDraft \? '\/api\/resume-image' : \(imageOnly \? '\/api\/regenerate-image' : '\/api\/generate'\)/);
  assert.match(html, /http:\/\/127\.0\.0\.1:3002\$\{endpoint\}/);
  assert.match(html, /本地生成服务未启动，请先运行 npm run local 后重试/);
  assert.doesNotMatch(html, /fetch\('\/api\/(?:generate|trends)'/);
  assert.equal(JSON.parse(packageSource).scripts.dev, "node worker/local-dev.mjs");
});

test("live trend cards reserve readable spacing for larger labels", async () => {
  const html = widgetHtml;

  assert.match(html, /grid-auto-rows:\s*102px/);
  assert.match(html, /row-gap:\s*3px/);
  assert.match(html, /\.alchemy-trend-card-title\s*\{[\s\S]*?font-size:\s*15px/);
  assert.match(html, /\.alchemy-trend-card-meta\s*\{[\s\S]*?line-height:\s*1\.4/);
});

test("local sidecar rejects reports without a newly written image", async () => {
  const sidecar = await readFile(
    new URL("../worker/codex-sidecar.mjs", import.meta.url),
    "utf8",
  );
  const schema = JSON.parse(await readFile(
    new URL("../worker/alchemy-report.schema.json", import.meta.url),
    "utf8",
  ));

  assert.match(sidecar, /@openai["', ]+,?\s*["']codex/);
  assert.match(sidecar, /["']--sandbox["'][\s\S]*["']workspace-write["']/);
  assert.match(sidecar, /imagegen 技能的内置 image_gen 工具/);
  assert.match(sidecar, /不要调用或等待 render_alchemy_report/);
  assert.match(sidecar, /不要再次启动浏览器或发起网页请求/);
  assert.match(sidecar, /!existsSync\(targetImagePath\)/);
  assert.ok(schema.required.includes("imagePath"));
  assert.ok(schema.required.includes("sources"));
});

test("model API provider stays server-side and requires a real generated image", async () => {
  const [html, sidecar, envExample] = await Promise.all([
    Promise.resolve(widgetHtml),
    readFile(new URL("../worker/codex-sidecar.mjs", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);

  assert.match(sidecar, /ALCHEMY_API_KEY/);
  assert.match(sidecar, /chat\/completions/);
  assert.match(sidecar, /providerSettings\.chat\.apiFormat === "anthropic"/);
  assert.match(sidecar, /providerJson\("messages"/);
  assert.match(sidecar, /images\/generations/);
  assert.match(sidecar, /tasks\/\$\{encodeURIComponent\(taskId\)\}/);
  assert.match(sidecar, /model_id:\s*imageModel/);
  assert.match(sidecar, /providerSettings\.image\.apiFormat === "echojoy"/);
  assert.match(sidecar, /writeNormalizedImage/);
  assert.match(sidecar, /providerConfigured/);
  assert.match(sidecar, /validGeneratedImage/);
  assert.match(sidecar, /runProviderFlow/);
  assert.doesNotMatch(html, /ALCHEMY_API_KEY|authorization:\s*[`'"]Bearer/i);
  assert.match(envExample, /ALCHEMY_API_BASE_URL/);
  assert.match(envExample, /ALCHEMY_CHAT_MODEL/);
  assert.match(envExample, /ALCHEMY_IMAGE_MODEL/);
  assert.match(envExample, /ALCHEMY_FALLBACK_MODE=none/);
  assert.match(envExample, /ALCHEMY_CHAT_API_FORMAT=openai/);
  assert.match(envExample, /^ALCHEMY_CHAT_API_KEY=$/m);
  assert.match(envExample, /^ALCHEMY_IMAGE_API_KEY=$/m);
  assert.doesNotMatch(envExample, /console\.echojoy\.cn|claude-opus|image-2\.5-flare/);
});

test("MCP endpoint exposes the alchemy tools", async () => {
  const worker = await loadWorker();
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: {},
  };
  const response = await worker.fetch(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    env,
    context,
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(
    payload.result.tools.map((tool) => tool.name),
    ["open_alchemy_lab", "render_alchemy_report"],
  );
  assert.equal(
    payload.result.tools[0]._meta.ui.resourceUri,
    "ui://ai-game-alchemy/lab-v1.html",
  );
});
