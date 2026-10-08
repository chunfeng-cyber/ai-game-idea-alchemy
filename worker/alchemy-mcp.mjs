import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { readFileSync } from "node:fs";

// Source lives in worker/, the built module in dist/server/; both have ../public.
const widgetAssets = new Map([
  "alchemy-ui.css", "alchemy-model-settings.css", "alchemy-security.js",
  "alchemy-art-assets.js", "alchemy-catalog.js", "alchemy-app.js", "alchemy-model-settings.js",
].map(name => [`/${name}`, readFileSync(new URL(`../public/${name}`, import.meta.url), "utf8")]));

const TEMPLATE_URI = "ui://ai-game-alchemy/lab-v1.html";

function isSafeWebUrl(value, allowRelative = false) {
  // eslint-disable-next-line no-control-regex -- Reject control bytes before browser URL normalization.
  if (!value || value.length > 8192 || /[\x00-\x1f\x7f\\]/.test(value)) return false;
  const input = value.trim();
  const relative = allowRelative && /^\/(?!\/)/.test(input);
  if (!relative && !/^https?:\/\//i.test(input)) return false;
  try {
    const url = new URL(input, "https://alchemy.invalid");
    return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}

const sourceUrlSchema = z.string().refine(value => isSafeWebUrl(value), "来源链接须为 HTTP(S) 地址且不能包含凭证");
const assetUrlSchema = z.string().refine(value => value === "" || isSafeWebUrl(value, true), "图片链接须为 HTTP(S) 地址或安全的站内路径");

function selfContainedWidget(html) {
  return html
    .replace(/<link\b[^>]*href="([^"]+)"[^>]*>/g, (tag, name) => {
      const source = widgetAssets.get(name.split(/[?#]/, 1)[0]);
      return source === undefined ? tag : `<style>${source.replace(/<\/style/gi, "<\\/style")}</style>`;
    })
    .replace(/<script\b([^>]*?)\bsrc="([^"]+)"([^>]*)>\s*<\/script>/g, (tag, before, name, after) => {
      const source = widgetAssets.get(name.split(/[?#]/, 1)[0]);
      return source === undefined ? tag : `<script${before}${after}>${source.replace(/<\/script/gi, "<\\/script")}</script>`;
    });
}

const sourceSchema = z.object({
  title: z.string(),
  url: sourceUrlSchema,
  publishedAt: z.string(),
});

const iconsSchema = z.object({
  market: z.string(),
  gameplay: z.string(),
  hook: z.string(),
  art: z.string(),
  recipe: z.string(),
  ai: z.string(),
});

const reportInputShape = {
  gameName: z.string(),
  rarity: z.enum(["普通", "稀有", "史诗", "传说"]),
  tagline: z.string(),
  marketOpportunity: z.string(),
  coreGameplay: z.string(),
  adHook: z.string(),
  artDirection: z.string(),
  recipe: z.string(),
  aiCompletion: z.string(),
  control: z.string(),
  action: z.string(),
  mechanic: z.string(),
  gameType: z.string(),
  artStyle: z.string(),
  topic: z.string(),
  trendCatalyst: z.string(),
  synthesisJudgement: z.string(),
  referenceImageCaption: z.string(),
  imageUrl: assetUrlSchema.optional(),
  posterUrl: assetUrlSchema.optional(),
  posterWidth: z.number().optional(),
  posterHeight: z.number().optional(),
  posterLayoutVersion: z.number().optional(),
  cardUrl: assetUrlSchema.optional(),
  cardWidth: z.number().optional(),
  cardHeight: z.number().optional(),
  sources: z.array(sourceSchema).max(6),
  icons: iconsSchema,
};

function createAlchemyServer(widgetHtml) {
  const server = new McpServer(
    { name: "ai-game-alchemy", version: "1.0.0" },
    {
      instructions:
        "Use open_alchemy_lab when the user wants to open or use the AI game alchemy interface. " +
        "When a widget-authored message starts with 【炼金器合成请求】, treat every listed ingredient as a hard constraint. " +
        "Use the host's available web-search and image-generation abilities, derive a fresh concept, then call " +
        "render_alchemy_report with the completed report. Never substitute a preset concept. If the generated image " +
        "cannot be represented by a URL, still call render_alchemy_report and include the generated image beside the widget response.",
    },
  );

  server.registerResource(
    "ai-game-alchemy-widget",
    TEMPLATE_URI,
    {},
    async () => ({
      contents: [
        {
          uri: TEMPLATE_URI,
          mimeType: "text/html;profile=mcp-app",
          text: selfContainedWidget(widgetHtml),
          _meta: {
            ui: {
              prefersBorder: false,
              csp: {
                connectDomains: [],
                resourceDomains: [],
              },
            },
            "openai/widgetDescription":
              "横屏 AI 游戏创意炼金器，可拖入操作、动作、机制、美术与题材并在当前对话中自动发起合成。",
          },
        },
      ],
    }),
  );

  server.registerTool(
    "open_alchemy_lab",
    {
      title: "打开 AI 游戏创意炼金器",
      description:
        "Use this when the user wants to open, display, or interact with the AI game idea alchemy lab.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
      _meta: {
        ui: { resourceUri: TEMPLATE_URI },
        "openai/outputTemplate": TEMPLATE_URI,
        "openai/toolInvocation/invoking": "正在打开炼金器…",
        "openai/toolInvocation/invoked": "炼金器已打开",
      },
    },
    async () => ({
      structuredContent: {
        view: "composer",
        stateVersion: 1,
      },
      content: [
        {
          type: "text",
          text: "AI 游戏创意炼金器已打开。请在组件中投入任意素材并点击开始合成。",
        },
      ],
    }),
  );

  server.registerTool(
    "render_alchemy_report",
    {
      title: "渲染炼金报告",
      description:
        "Use this after completing live market research and generating a fresh gameplay reference image for a widget-authored alchemy request. Render the final report in the alchemy UI.",
      inputSchema: reportInputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
      _meta: {
        ui: { resourceUri: TEMPLATE_URI },
        "openai/outputTemplate": TEMPLATE_URI,
        "openai/toolInvocation/invoking": "正在装入炼金报告…",
        "openai/toolInvocation/invoked": "炼金报告已出锅",
      },
    },
    async (input) => {
      const { imageUrl = "", posterUrl = "", posterWidth, posterHeight, posterLayoutVersion, cardUrl = "", cardWidth, cardHeight, ...report } = input;
      return {
        structuredContent: {
          view: "report",
          stateVersion: Date.now(),
          generatedAt: new Date().toISOString(),
          report,
          imageUrl,
          posterUrl,
          posterWidth,
          posterHeight,
          posterLayoutVersion,
          cardUrl: posterUrl || cardUrl,
          cardWidth: posterWidth || cardWidth,
          cardHeight: posterHeight || cardHeight,
        },
        content: [
          {
            type: "text",
            text: `炼金完成：《${report.gameName}》｜${report.rarity}。报告已在组件中展示。`,
          },
        ],
      };
    },
  );

  return server;
}

function withCors(response) {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, mcp-session-id, Last-Event-ID, mcp-protocol-version",
  );
  headers.set("Access-Control-Expose-Headers", "mcp-session-id, mcp-protocol-version");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function handleAlchemyMcp(request, widgetHtml) {
  if (request.method === "OPTIONS") {
    return withCors(new Response(null, { status: 204 }));
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = createAlchemyServer(widgetHtml);
  await server.connect(transport);
  return withCors(await transport.handleRequest(request));
}

