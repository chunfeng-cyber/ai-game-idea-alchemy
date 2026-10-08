(() => {
  const localPage = () => /^http:\/\/(?:localhost|127\.0\.0\.1):3000$/.test(location.origin);
  const hostBridge = () => Boolean(window.openai && (
    typeof window.openai.sendFollowUpMessage === 'function' || 'toolOutput' in window.openai
  ));
  let parentOrigin = '';
  try { parentOrigin = new URL(document.referrer).origin; } catch { /* Opaque MCP frames may omit referrer. */ }

  function safeWebUrl(value, allowRelative = false) {
    if (typeof value !== 'string') return '';
    const input = value.trim();
    // eslint-disable-next-line no-control-regex -- Reject control bytes before URL normalization.
    if (!input || input.length > 8192 || /[\x00-\x1f\x7f\\]/.test(input)) return '';
    const relative = allowRelative && /^\/(?!\/)/.test(input);
    if (!relative && !/^https?:\/\//i.test(input)) return '';
    try {
      const url = relative ? new URL(input, location.href) : new URL(input);
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return '';
      return relative ? `${url.pathname}${url.search}${url.hash}` : url.href;
    } catch { return ''; }
  }

  function safeAssetUrl(value) {
    const safe = safeWebUrl(value, true);
    if (!safe) return '';
    try {
      const url = new URL(safe, location.href);
      // Local aliases resolve to the current application, never a different local service.
      if (localPage() && ['localhost', '127.0.0.1'].includes(url.hostname) && url.port === '3000' && url.pathname.startsWith('/generated/')) {
        return `${url.pathname}${url.search}`;
      }
    } catch { /* Absolute remote assets remain valid inside opaque MCP frames. */ }
    return safe;
  }

  function normalizeReportOutput(value) {
    if (!value || value.view !== 'report' || !value.report || typeof value.report !== 'object' || Array.isArray(value.report)) return null;
    if (typeof value.report.gameName !== 'string' || !value.report.gameName.trim()) return null;
    const report = { ...value.report };
    for (const key of ['gameName', 'rarity', 'tagline', 'marketOpportunity', 'coreGameplay', 'adHook', 'artDirection', 'recipe', 'aiCompletion', 'control', 'action', 'mechanic', 'gameType', 'artStyle', 'topic', 'trendCatalyst', 'synthesisJudgement', 'referenceImageCaption']) {
      report[key] = typeof report[key] === 'string' ? report[key].slice(0, 20000) : '';
    }
    report.sources = (Array.isArray(report.sources) ? report.sources : []).flatMap(source => {
      const url = safeWebUrl(source?.url);
      if (!url) return [];
      return [{ title: typeof source.title === 'string' ? source.title.slice(0, 500) : '参考来源', url, publishedAt: typeof source.publishedAt === 'string' ? source.publishedAt.slice(0, 100) : '' }];
    }).slice(0, 30);
    report.icons = Object.fromEntries(['market', 'gameplay', 'hook', 'art', 'recipe', 'ai'].map(key => [key, typeof report.icons?.[key] === 'string' ? report.icons[key].slice(0, 40) : '✦']));
    return { ...value, report, imageUrl: safeAssetUrl(value.imageUrl), posterUrl: safeAssetUrl(value.posterUrl), cardUrl: safeAssetUrl(value.cardUrl) };
  }

  function structuredOutput(value) {
    if (!value || typeof value !== 'object') return null;
    return value.view ? value : value.structuredContent || value.result?.structuredContent || value.params?.structuredContent || value.params?.result?.structuredContent || null;
  }

  function normalizeDraftOutput(value) {
    if (value?.view !== 'draft' || typeof value.draftId !== 'string' || !value.draftId || value.draftId.length > 200 || !Number.isSafeInteger(value.stateVersion) || value.stateVersion < 1 || !['image', 'poster'].includes(value.stage)) return null;
    const normalized = normalizeReportOutput({ ...value, view: 'report' });
    if (!normalized) return null;
    return {
      ...normalized, view: 'draft',
      materialIds: (Array.isArray(value.materialIds) ? value.materialIds : []).filter(id => typeof id === 'string').slice(0, 100),
      error: typeof value.error === 'string' ? value.error.slice(0, 1000) : '',
    };
  }

  function trustedToolMessage(event) {
    if (window.parent === window || event.source !== window.parent || event.data?.jsonrpc !== '2.0' || event.data?.method !== 'ui/notifications/tool-result') return false;
    if (localPage()) return event.origin === location.origin;
    if (!hostBridge()) return false;
    // The injected bridge and exact parent are trust anchors for opaque host sandboxes.
    if (event.origin === 'null') return true;
    let origin;
    try { origin = new URL(event.origin); } catch { return false; }
    if (origin.protocol !== 'https:' || origin.origin !== event.origin) return false;
    if (parentOrigin && parentOrigin !== 'null') return event.origin === parentOrigin;
    parentOrigin = event.origin;
    return true;
  }

  function handleToolResult(event, render, readHostOutput) {
    if (!trustedToolMessage(event)) return false;
    const output = normalizeReportOutput(structuredOutput(event.data) || structuredOutput(readHostOutput?.()));
    if (!output) return false;
    render(output);
    return true;
  }

  // Line icons simplified from the prior Lucide UI; retain THIRD_PARTY_NOTICES.md.
  const iconPaths = {
    'radio': ['M8 8a6 6 0 0 0 0 8M16 8a6 6 0 0 1 0 8M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z'],
    'maximize-2': ['M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7'],
    'hand': ['M8 13V5a2 2 0 0 1 4 0v7M12 6a2 2 0 0 1 4 0v6M16 8a2 2 0 0 1 4 0v7c0 4-3 6-6 6h-2c-2 0-3-1-4-3l-4-5a2 2 0 0 1 3-3l1 2'],
    'gamepad-2': ['M7 7h10c2 0 3 2 4 6l1 4c0 2-2 3-4 1l-3-3H9l-3 3c-2 2-4 1-4-1l1-4c1-4 2-6 4-6ZM7 10v4M5 12h4M16 11h.1M19 13h.1'],
    'palette': ['M12 3a9 9 0 1 0 0 18h1c2 0 2-2 1-3s0-3 2-3h2c3 0 4-3 2-6a9 9 0 0 0-8-6ZM7 9h.1M10 6h.1M15 6h.1M18 9h.1'],
    'library': ['M4 4v16M8 4v16M12 4v16M16 5l4 14'],
    'sparkles': ['m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3ZM20 2v4M18 4h4'],
    'shapes': ['m6 3 4 7H2l4-7ZM14 13h7v7h-7v-7ZM6 14a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z'],
    'circle-dot': ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z'],
    'gem': ['M7 3h10l5 6-10 12L2 9l5-6ZM2 9h20M7 3l5 18 5-18'],
    'boxes': ['m7 3 5 3-5 3-5-3 5-3ZM2 6v6l5 3 5-3V6M7 9v6M17 9l5 3-5 3-5-3 5-3ZM12 12v6l5 3 5-3v-6M17 15v6'],
    'pencil': ['m15 4 5 5M3 21l2-7L16 3c1-1 2-1 3 0l2 2c1 1 1 2 0 3L10 19l-7 2Z'],
    'grid-3x3': ['M3 3h18v18H3V3ZM3 9h18M3 15h18M9 3v18M15 3v18'],
    'blocks': ['M3 3h8v8H3V3ZM13 5h8v8h-8V5ZM5 13h8v8H5v-8ZM15 15h6v6h-6v-6Z'],
    'layers-3': ['m12 3 10 5-10 5L2 8l10-5ZM2 12l10 5 10-5M2 16l10 5 10-5']
  };
  function renderIcons(root) {
    root.querySelectorAll('i[data-lucide]').forEach(node => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      for (const [name, value] of Object.entries({ viewBox: '0 0 24 24', width: '16', height: '16', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'lucide' })) svg.setAttribute(name, value);
      for (const d of iconPaths[node.getAttribute('data-lucide')] || iconPaths.sparkles) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        svg.append(path);
      }
      node.replaceWith(svg);
    });
  }
  window.alchemySecurity = Object.freeze({ localPage, safeWebUrl, safeAssetUrl, normalizeReportOutput, normalizeDraftOutput, handleToolResult, renderIcons });
})();
