(() => {
  const root = document.getElementById('ai-alchemy-prototype');
  const security = window.alchemySecurity;
  const field = root.querySelector('#alchemy-field');
  const pot = root.querySelector('#alchemy-pot');
  const liquid = root.querySelector('#alchemy-liquid');
  const brew = root.querySelector('#alchemy-brew');
  const recipeState = root.querySelector('#alchemy-recipe-state');
  const dropHint = root.querySelector('#alchemy-drop-hint');
  const compound = root.querySelector('#alchemy-compound span');
  const tabNote = root.querySelector('#alchemy-tab-note');
  const gameplayModes = root.querySelector('#alchemy-gameplay-modes');
  const worldState = root.querySelector('#alchemy-world-state span');
  const selectView = root.querySelector('#alchemy-select-view');
  const resultView = root.querySelector('#alchemy-result-view');
  const shell = root.querySelector('.alchemy-phone');
  const brewingLabel = root.querySelector('#alchemy-brewing-label');

  let materials = window.alchemyCatalog.materials.map(item => ({ ...item, tags: [...item.tags] }));

  let activeTab = 'control';
  let gameplayMode = 'action';
  const selected = new Set();
  let isGenerating = false;
  let brewTimers = [];
  let activePointerDrag = null;
  let suppressedClickTarget = null;
  let reportWaitTimer = null;
  let generationPollTimer = null;
  const resultCacheKey = 'alchemy-completed-result-v1';

  function clearGenerationProgress() {
    clearTimeout(generationPollTimer);
    generationPollTimer = null;
  }

  async function pollGenerationProgress(requestId) {
    if (!isGenerating || !security.localPage() || window.openai?.sendFollowUpMessage) return;
    try {
      const response = await fetch('http://127.0.0.1:3002/health', { signal: AbortSignal.timeout(5000) });
      const health = await response.json();
      const status = health.generation;
      if (isGenerating && status?.requestId === requestId) {
        const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(status.startedAt)) / 1000));
        const elapsed = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
        worldState.textContent = `${status.message} · 已等待 ${elapsed}`;
        const labels = {
          starting: '准备合成', trends: '获取热点', models: '连接生成服务',
          report: status.provider === 'codex' ? '备用方案生成中' : '生成方案中',
          image: '图片 API 绘制中', poster: '排版说明海报', card: '排版说明海报',
          fallback: '备用生成中', complete: '合成完成', failed: '合成失败'
        };
        brewingLabel.textContent = labels[status.stage] || status.message;
        brew.textContent = brewingLabel.textContent;
        recipeState.title = status.fallbackReason || '';
        if (status.fallbackReason && status.stage === 'image' && status.provider === 'api') {
          recipeState.textContent = '备用方案已完成，正在通过图片 API 绘制参考图';
        } else if (status.fallbackReason && ['poster', 'card'].includes(status.stage)) {
          recipeState.textContent = '游戏画面已完成，正在排版可保存的 PNG 海报';
        } else {
          recipeState.textContent = status.fallbackReason
            ? `${status.stage === 'report' ? '文本接口暂不可用，已切换备用方案服务' : '已启用备用服务'}：${status.fallbackReason}`
            : '';
        }
      }
    } catch { /* The generation request reports terminal connection errors. */ }
    if (isGenerating) generationPollTimer = setTimeout(() => pollGenerationProgress(requestId), 2000);
  }
  let trendLoading = false;
  let liveTrendItems = [];
  let trendCatalogItems = [];
  let trendPollTimer = null;
  let trendGeneratedAt = '';
  let trendErrors = [];
  let trendSourceSummary = [];
  let trendRequestNumber = 0;
  let loadedTrendScope = '';
  let currentReport = null;
  let currentDraft = null;
  let resultEpoch = 0;
  let trendMessage = '正在启动全球热点检索，完成后可直接拖入锅中';
  const trendScope = { region:'全球', country:'自动选择', channel:'全渠道' };
  const trendRegions = {
    '全球': {
      countries:['自动选择'],
      channels:['全渠道','Google Trends','抖音','B站','头条','Reddit','Wikipedia','Hacker News','新闻观察','TikTok','Instagram','Facebook','YouTube Shorts','X']
    },
    '中国': {
      countries:['自动选择','中国大陆','中国香港','中国台湾'],
      channels:['全渠道','抖音','B站','头条','Google Trends','Wikipedia','新闻观察','微博','快手','小红书','视频号']
    },
    '欧美': {
      countries:['自动选择','美国','加拿大','英国','法国','德国','意大利','西班牙'],
      channels:['全渠道','TikTok','Instagram','Facebook','YouTube Shorts','X','Google Trends','Reddit','Wikipedia','Hacker News','新闻观察']
    },
    '东南亚': {
      countries:['自动选择','印度尼西亚','泰国','越南','菲律宾','马来西亚','新加坡'],
      channels:['全渠道','TikTok','Facebook','Instagram','YouTube Shorts','SnackVideo / Kwai','LINE','Zalo','Google Trends','Reddit','Wikipedia','Hacker News','新闻观察']
    },
    '日韩': {
      countries:['自动选择','日本','韩国'],
      channels:['全渠道','TikTok','X','LINE','YouTube Shorts','Instagram','Google Trends','Reddit','Wikipedia','Hacker News','新闻观察']
    },
    '拉美': {
      countries:['自动选择','巴西','墨西哥','阿根廷','哥伦比亚','智利'],
      channels:['全渠道','TikTok','Instagram','Facebook','Kwai','YouTube Shorts','Google Trends','Reddit','Wikipedia','Hacker News','新闻观察']
    },
    '中东': {
      countries:['自动选择','沙特阿拉伯','阿联酋','土耳其','埃及'],
      channels:['全渠道','TikTok','Snapchat','Instagram','YouTube Shorts','Facebook','Google Trends','Reddit','Wikipedia','Hacker News','新闻观察']
    }
  };

  const connectedTrendChannels = new Set(['全渠道','Google Trends','抖音','B站','头条','Reddit','Wikipedia','Hacker News','新闻观察']);

  function byId(id) { return materials.find(item => item.id === id); }

  function isPointInside(rect, x, y) {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function shellGeometry() {
    const rect = shell.getBoundingClientRect();
    return {
      rect,
      scaleX: rect.width / shell.offsetWidth,
      scaleY: rect.height / shell.offsetHeight
    };
  }

  function flowChildren(parent, excluded = null) {
    return [...parent.children].filter(child => (
      child !== excluded &&
      (child.classList.contains('alchemy-ingredient') || child.classList.contains('alchemy-trend-card'))
    ));
  }

  function captureFlowPositions(parent, excluded = null) {
    return new Map(flowChildren(parent, excluded).map(child => [child, child.getBoundingClientRect()]));
  }

  function animateFlowPositions(before, geometry) {
    const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 260;
    before.forEach((oldRect, child) => {
      if (!child.isConnected) return;
      const newRect = child.getBoundingClientRect();
      const deltaX = (oldRect.left - newRect.left) / geometry.scaleX;
      const deltaY = (oldRect.top - newRect.top) / geometry.scaleY;
      if (Math.abs(deltaX) < .5 && Math.abs(deltaY) < .5) return;
      child.animate([
        { translate: `${deltaX}px ${deltaY}px` },
        { translate: '0px 0px' }
      ], {
        duration,
        easing: 'cubic-bezier(.2,.78,.2,1)',
        fill: 'none'
      });
    });
  }

  function clearFloatingStyles(source) {
    source.classList.remove('alchemy-drag-float');
    ['left','top','width','height','z-index','margin','pointer-events','transition','will-change'].forEach(property => {
      source.style.removeProperty(property);
    });
  }

  function beginPointerDrag(drag, event) {
    try {
      root.setPointerCapture?.(drag.pointerId);
    } catch { /* Pointer capture can be unavailable inside the host. */ }
    const sourceRect = drag.source.getBoundingClientRect();
    const geometry = shellGeometry();
    const before = captureFlowPositions(drag.parent, drag.source);
    drag.geometry = geometry;
    drag.authoredWidth = drag.source.offsetWidth;
    drag.authoredHeight = drag.source.offsetHeight;
    drag.offsetX = (event.clientX - sourceRect.left) / geometry.scaleX;
    drag.offsetY = (event.clientY - sourceRect.top) / geometry.scaleY;
    drag.source.classList.add('alchemy-drag-float');
    drag.source.style.left = `${(sourceRect.left - geometry.rect.left) / geometry.scaleX}px`;
    drag.source.style.top = `${(sourceRect.top - geometry.rect.top) / geometry.scaleY}px`;
    drag.source.style.width = `${drag.authoredWidth}px`;
    drag.source.style.height = `${drag.authoredHeight}px`;
    shell.appendChild(drag.source);
    drag.started = true;
    animateFlowPositions(before, geometry);
  }

  function updatePointerDrag(clientX, clientY) {
    const drag = activePointerDrag;
    if (!drag?.started) return false;
    const geometry = shellGeometry();
    drag.geometry = geometry;
    drag.source.style.left = `${(clientX - geometry.rect.left) / geometry.scaleX - drag.offsetX}px`;
    drag.source.style.top = `${(clientY - geometry.rect.top) / geometry.scaleY - drag.offsetY}px`;
    const isOverPot = isPointInside(pot.getBoundingClientRect(), clientX, clientY);
    pot.classList.toggle('is-pointer-over', isOverPot);
    dropHint.textContent = isOverPot ? '松手加入配方' : '拖进锅里 · 点击也可加入';
    return isOverPot;
  }

  function releasePointerCapture(pointerId) {
    try {
      if (root.hasPointerCapture?.(pointerId)) root.releasePointerCapture(pointerId);
    } catch { /* The browser may already have released pointer capture. */ }
  }

  function restorePointerDrag(drag) {
    const currentRect = drag.source.getBoundingClientRect();
    const geometry = shellGeometry();
    const before = captureFlowPositions(drag.parent);
    clearFloatingStyles(drag.source);
    if (drag.nextSibling?.parentNode === drag.parent) drag.parent.insertBefore(drag.source, drag.nextSibling);
    else drag.parent.appendChild(drag.source);
    const targetRect = drag.source.getBoundingClientRect();
    animateFlowPositions(before, geometry);
    const deltaX = (currentRect.left - targetRect.left) / geometry.scaleX;
    const deltaY = (currentRect.top - targetRect.top) / geometry.scaleY;
    const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 320;
    drag.source.animate([
      { translate: `${deltaX}px ${deltaY}px` },
      { translate: `${-deltaX * .035}px ${-deltaY * .035}px`, offset: .82 },
      { translate: '0px 0px' }
    ], {
      duration,
      easing: 'cubic-bezier(.18,.8,.2,1)',
      fill: 'none'
    });
  }

  function sinkPointerDragIntoPot(drag) {
    const geometry = shellGeometry();
    const potRect = pot.getBoundingClientRect();
    const targetLeft = (potRect.left + potRect.width / 2 - geometry.rect.left) / geometry.scaleX - drag.authoredWidth / 2;
    const targetTop = (potRect.top + potRect.height / 2 - geometry.rect.top) / geometry.scaleY - drag.authoredHeight / 2;
    const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 190;
    const animation = drag.source.animate([
      { left: drag.source.style.left, top: drag.source.style.top, transform: 'scale(1)', opacity: 1 },
      { left: `${targetLeft}px`, top: `${targetTop}px`, transform: 'scale(.52)', opacity: .08 }
    ], {
      duration,
      easing: 'cubic-bezier(.3,.72,.25,1)',
      fill: 'forwards'
    });
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      drag.source.remove();
      addMaterialToPot(drag.id);
    };
    animation.addEventListener('finish', finish, { once: true });
    setTimeout(finish, duration + 40);
  }

  function endPointerDrag(event, cancelled = false) {
    const drag = activePointerDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    releasePointerCapture(event.pointerId);
    if (!drag.started) {
      activePointerDrag = null;
      return;
    }
    event.preventDefault();
    const droppedInPot = !cancelled && updatePointerDrag(event.clientX, event.clientY);
    suppressedClickTarget = drag.source;
    activePointerDrag = null;
    pot.classList.remove('is-pointer-over');
    if (droppedInPot) sinkPointerDragIntoPot(drag);
    else {
      restorePointerDrag(drag);
      dropHint.textContent = '拖进锅里 · 点击也可加入';
    }
  }

  function enablePointerDrag(element, id) {
    element.draggable = false;
    element.addEventListener('click', event => {
      if (suppressedClickTarget !== element) return;
      suppressedClickTarget = null;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    element.addEventListener('pointerdown', event => {
      if (!event.isPrimary || event.button !== 0 || activePointerDrag || event.target.closest('a')) return;
      // On narrow touch screens, scrolling and tapping remain native and reliable.
      if (event.pointerType === 'touch' && matchMedia('(max-width: 719px)').matches) return;
      activePointerDrag = {
        id,
        source: element,
        parent: element.parentElement,
        nextSibling: element.nextSibling,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        started: false
      };
    });
  }

  window.addEventListener('pointermove', event => {
    const drag = activePointerDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.started) {
      const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      if (distance < 7) return;
      beginPointerDrag(drag, event);
    }
    event.preventDefault();
    updatePointerDrag(event.clientX, event.clientY);
  }, { passive: false });
  window.addEventListener('pointerup', event => endPointerDrag(event));
  window.addEventListener('pointercancel', event => endPointerDrag(event, true));

  function compatibility(item) {
    if (selected.has(item.id)) return 'selected';
    if (!selected.size) return 'neutral';
    let score = 0;
    selected.forEach(id => {
      const other = byId(id);
      if (!other) return;
      const shared = item.tags.filter(tag => other.tags.includes(tag)).length;
      score += shared;
      if ((item.id === 'realistic' && other.id === 'pixel') || (item.id === 'pixel' && other.id === 'realistic')) score -= 2;
      if ((item.id === 'watercolor' && other.id === 'shoot') || (item.id === 'shoot' && other.id === 'watercolor')) score -= 1;
    });
    if (score >= 3) return 'gold';
    if (score >= 2) return 'purple';
    if (score >= 1) return 'blue';
    return 'gray';
  }

  function refreshIcons() {
    security.renderIcons(root);
  }

  function materialVisualMarkup(item) {
    if (item.category === 'visual') {
      const styleX = ['0%', '33.333%', '66.667%', '100%'][item.artIndex % 4];
      const styleY = item.artIndex < 4 ? '6%' : '94%';
      return `<span class="alchemy-style-thumb" style="--style-x:${styleX};--style-y:${styleY}" role="img" aria-label="同一卡皮巴拉头像的${item.label}版本"></span><span class="alchemy-ingredient-label alchemy-style-card-label"><i data-lucide="${item.icon}" aria-hidden="true"></i>${item.label}</span>`;
    }
    if (item.category === 'trend' && item.trendMeta) {
      const safeLabel = escapeMarkup(item.label);
      const safeIcon = escapeMarkup(item.icon || '✦');
      const art = trendIconArt(item.trendMeta);
      return `<span class="alchemy-ingredient-icon is-live-trend${art ? ' has-daily-art' : ''}"${art ? ` style="${art}"` : ''} role="img" aria-label="${safeLabel}图标">${art ? '' : safeIcon}</span><span class="alchemy-ingredient-label">${safeLabel}</span>`;
    }
    const iconIndex = materials.filter(candidate => candidate.category !== 'visual').findIndex(candidate => candidate.id === item.id);
    const iconColumn = iconIndex % 8;
    const iconRow = Math.floor(iconIndex / 8);
    const iconX = `${(iconColumn / 7 * 100).toFixed(3)}%`;
    const iconY = `${(iconRow / 6 * 100).toFixed(3)}%`;
    return `<span class="alchemy-ingredient-icon" style="--icon-x:${iconX};--icon-y:${iconY}" role="img" aria-label="${item.label}图标"></span><span class="alchemy-ingredient-label">${item.label}</span>`;
  }

  function trendScopeKey() {
    return `${trendScope.region}|${trendScope.country}|${trendScope.channel}`;
  }

  function normalizeTrendText(value, fallback, max = 180) {
    return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : fallback;
  }

  function escapeMarkup(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    })[character]);
  }

  function safeTrendSpriteUrl(value) {
    const url = typeof value === 'string' ? value.trim() : '';
    if (/^\/generated\/[a-zA-Z0-9._?=&-]+$/.test(url)) return url;
    if (/^http:\/\/(?:localhost|127\.0\.0\.1):3000\/generated\/[a-zA-Z0-9._?=&-]+$/.test(url)) return url;
    return '';
  }

  function trendIconArt(meta) {
    const spriteUrl = safeTrendSpriteUrl(meta?.iconSpriteUrl);
    const index = Number.isInteger(meta?.iconIndex) ? Math.max(0, Math.min(9, meta.iconIndex)) : -1;
    if (!spriteUrl || index < 0) return '';
    const column = index % 5;
    const row = Math.floor(index / 5);
    const x = `${column * 25}%`;
    const y = `${row * 100}%`;
    return `--trend-icon-sprite:url('${spriteUrl}');--trend-icon-x:${x};--trend-icon-y:${y}`;
  }

  function normalizeTrendItem(item, index) {
    const sourceUrl = normalizeTrendText(item?.sourceUrl, '', 4096);
    const safeSourceUrl = security.safeWebUrl(sourceUrl);
    const label = normalizeTrendText(item?.shortLabel || item?.label, `实时热点 ${index + 1}`, 24);
    const rawId = normalizeTrendText(item?.id, `${Date.now()}-${index}`, 80).replace(/[^a-zA-Z0-9_-]/g, '-');
    return {
      id: `trend-${rawId}`,
      label,
      fullLabel: normalizeTrendText(item?.label, label, 80),
      icon: normalizeTrendText(item?.icon, '✦', 8),
      category:'trend',
      tags:['trend','world','adaptive',trendScope.region,trendScope.channel],
      trendMeta: {
        region: normalizeTrendText(item?.region, trendScope.region, 40),
        country: normalizeTrendText(item?.country, trendScope.country, 40),
        channel: normalizeTrendText(item?.channel, trendScope.channel, 50),
        freshness: normalizeTrendText(item?.freshness, '发布时间未知', 50),
        evidence: normalizeTrendText(item?.evidence, '缺少来源证据', 220),
        whyGameable: normalizeTrendText(item?.whyGameable, '可转化为即时互动题材', 160),
        risk: normalizeTrendText(item?.risk, '需复核热度时效', 120),
        sourceTitle: normalizeTrendText(item?.sourceTitle, '本次检索来源', 120),
        sourceUrl: safeSourceUrl,
        sourceKind: normalizeTrendText(item?.sourceKind, '', 40),
        observedChannel: normalizeTrendText(item?.observedChannel, '', 50),
        sourcePublishedAt: normalizeTrendText(item?.sourcePublishedAt, '', 40),
        sourceObservedAt: normalizeTrendText(item?.sourceObservedAt, '', 40),
        sourceTimeKind: normalizeTrendText(item?.sourceTimeKind, 'published', 30),
        sourceDatasetDate: normalizeTrendText(item?.sourceDatasetDate || item?.periodDate, '', 20),
        geoScope: normalizeTrendText(item?.geoScope, 'country', 20),
        language: normalizeTrendText(item?.language, '', 20),
        rank: Number.isInteger(item?.rank) ? item.rank : 0,
        rankKind: normalizeTrendText(item?.rankKind, '', 30),
        metricValue: Number.isFinite(item?.metricValue) ? item.metricValue : 0,
        metricLabel: normalizeTrendText(item?.metricLabel, '', 40),
        cached: item?.cached === true,
        iconSpriteUrl: safeTrendSpriteUrl(item?.iconSpriteUrl),
        iconIndex: Number.isInteger(item?.iconIndex) ? item.iconIndex : index
      }
    };
  }

  function syncLiveTrendMaterials(items) {
    materials = materials.filter(item => item.category !== 'trend' || selected.has(item.id));
    items.forEach(item => {
      if (!materials.some(candidate => candidate.id === item.id)) materials.push(item);
    });
  }

  function addTrendCard(item, index, container) {
    const meta = item.trendMeta;
    const card = document.createElement('div');
    card.className = 'alchemy-trend-card';
    card.role = 'button';
    card.tabIndex = 0;
    card.dataset.id = item.id;
    card.style.setProperty('--float-y', `${[-2,2,0,3,-1,2][index % 6]}px`);
    card.style.setProperty('--float-r', `${[-.4,.3,.2,-.3,.35,-.2][index % 6]}deg`);
    card.setAttribute('aria-label', `${item.fullLabel}。${meta.country}，${meta.channel}，${meta.freshness}。点击加入炼金锅`);
    card.title = `证据：${meta.evidence}\n游戏化：${meta.whyGameable}\n风险：${meta.risk}\n来源：${meta.sourceTitle}${meta.sourcePublishedAt ? `（${meta.sourcePublishedAt}）` : ''}`;

    const icon = document.createElement('span');
    const iconArt = trendIconArt(meta);
    icon.className = `alchemy-trend-card-icon${iconArt ? ' has-daily-art' : ''}`;
    if (iconArt) icon.setAttribute('style', iconArt);
    else icon.textContent = item.icon;
    const title = document.createElement('strong');
    title.className = 'alchemy-trend-card-title';
    title.textContent = item.fullLabel;
    const detail = document.createElement('span');
    detail.className = 'alchemy-trend-card-meta';
    const languageName = ({en:'英语',ja:'日语',es:'西语',pt:'葡语',ar:'阿语',de:'德语',ko:'韩语',zh:'中文',fr:'法语',it:'意语',id:'印尼语',th:'泰语',vi:'越语',tr:'土语'})[meta.language] || meta.language;
    const area = meta.geoScope === 'language' ? languageName + '版 · 全球阅读' : meta.country;
    const ranking = meta.rank ? (meta.rankKind === 'official' ? '第' + meta.rank + '名' : '列表第' + meta.rank + '条') : '';
    const metric = meta.metricLabel && meta.metricLabel !== '热门列表位置' ? meta.metricLabel + ' ' + new Intl.NumberFormat('zh-CN', { notation:'compact', maximumFractionDigits:1 }).format(meta.metricValue) : '';
    detail.textContent = [area, meta.channel, ranking, metric].filter(Boolean).join(' · ');
    detail.title = detail.textContent;
    const reason = document.createElement('span');
    reason.className = 'alchemy-trend-card-reason';
    const observed = meta.sourceObservedAt ? new Date(meta.sourceObservedAt).toLocaleTimeString('zh-CN', {hour:'2-digit', minute:'2-digit'}) : '';
    const timeLabel = meta.sourceDatasetDate ? meta.sourceDatasetDate + ' 浏览日榜' : meta.sourceTimeKind === 'observed' ? observed + ' 采集' : meta.freshness;
    reason.append(document.createTextNode(timeLabel + (meta.cached ? ' · 缓存' : '') + ' · '));
    const sourceLink = document.createElement('a');
    const sourceUrl = security.safeWebUrl(meta.sourceUrl);
    if (sourceUrl) sourceLink.href = sourceUrl;
    else sourceLink.setAttribute('aria-disabled', 'true');
    sourceLink.target = '_blank';
    sourceLink.rel = 'noopener noreferrer';
    sourceLink.textContent = '查看来源 ↗';
    sourceLink.style.color = 'var(--alchemy-cyan-deep)';
    sourceLink.addEventListener('click', event => event.stopPropagation());
    sourceLink.addEventListener('pointerdown', event => event.stopPropagation());
    reason.append(sourceLink);
    card.title = meta.evidence + '\n' + meta.whyGameable + '\n' + meta.risk + '\n榜单采集：' + (meta.sourceObservedAt || '不适用') + '\n发表：' + (meta.sourcePublishedAt || '来源未提供');
    card.append(icon, title, detail, reason);

    const choose = event => { if (!event.target.closest('a')) toggleMaterial(item.id); };
    card.addEventListener('click', choose);
    card.addEventListener('keydown', event => {
      if (!event.target.closest('a') && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        choose();
      }
    });
    enablePointerDrag(card, item.id);
    container.appendChild(card);
  }

  function renderTrendExplorer() {
    field.classList.add('is-trend');
    field.innerHTML = '';
    const explorer = document.createElement('section');
    explorer.className = 'alchemy-trend-explorer';

    const regionList = document.createElement('div');
    regionList.className = 'alchemy-region-list';
    Object.keys(trendRegions).forEach(region => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'alchemy-region-chip';
      button.textContent = region;
      button.setAttribute('aria-pressed', region === trendScope.region ? 'true' : 'false');
      button.addEventListener('click', () => {
        if (trendScope.region === region) return;
        trendScope.region = region;
        trendScope.country = trendRegions[region].countries[0];
        trendScope.channel = trendRegions[region].channels[0];
        fetchLiveTrends();
      });
      regionList.appendChild(button);
    });

    const filters = document.createElement('div');
    filters.className = 'alchemy-trend-filters';
    const createSelect = (label, values, current, onChange) => {
      const wrap = document.createElement('label');
      wrap.className = 'alchemy-trend-select-wrap';
      const caption = document.createElement('span');
      caption.textContent = label;
      const select = document.createElement('select');
      select.className = 'alchemy-trend-select';
      select.setAttribute('aria-label', label);
      values.forEach(value => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label === '渠道' && !connectedTrendChannels.has(value) ? value + '（未接入）' : value;
        option.selected = value === current;
        select.appendChild(option);
      });
      select.addEventListener('change', () => onChange(select.value));
      wrap.append(caption, select);
      return wrap;
    };
    const regionConfig = trendRegions[trendScope.region];
    filters.appendChild(createSelect('国家', regionConfig.countries, trendScope.country, value => {
      trendScope.country = value;
      fetchLiveTrends();
    }));
    filters.appendChild(createSelect('渠道', regionConfig.channels, trendScope.channel, value => {
      trendScope.channel = value;
      fetchLiveTrends();
    }));
    const refresh = document.createElement('button');
    refresh.type = 'button';
    refresh.className = 'alchemy-trend-refresh';
    refresh.disabled = trendLoading;
    refresh.textContent = trendLoading ? '正在刷新' : '刷新热点';
    refresh.addEventListener('click', () => fetchLiveTrends(true));
    filters.appendChild(refresh);

    const status = document.createElement('div');
    status.className = 'alchemy-trend-status';
    const statusText = document.createElement('strong');
    statusText.textContent = trendMessage;
    const scopeText = document.createElement('span');
    scopeText.textContent = `${trendScope.region} / ${trendScope.country} / ${trendScope.channel} · ${visibleTrendCount()} 条 · ${trendSourceSummary.filter(source => source.status === 'ready').length} 个来源可用`;
    scopeText.title = trendSourceSummary.map(source => `${source.country}/${source.sourceName || source.channel}: ${source.status === 'ready' ? source.availableCount + '条' : '读取失败'}`).join('\n');
    status.append(statusText, scopeText);
    if (trendErrors.length) {
      const issues = document.createElement('span');
      issues.textContent = trendErrors.map(error => `${error.country || '当前范围'}/${error.observedChannel || error.channel || '来源'}：${error.message}`).join('；');
      status.appendChild(issues);
    }

    const cards = document.createElement('div');
    cards.className = 'alchemy-trend-cards';
    const visible = liveTrendItems.filter(item => !selected.has(item.id));
    if (!visible.length) {
      const empty = document.createElement('div');
      empty.className = `alchemy-trend-empty${trendLoading ? ' is-loading' : ''}`;
      const copy = document.createElement('div');
      copy.textContent = trendMessage;
      empty.appendChild(copy);
      cards.appendChild(empty);
    } else {
      visible.forEach((item, index) => addTrendCard(item, index, cards));
    }

    explorer.append(regionList, filters, status, cards);
    field.appendChild(explorer);
    refreshIcons();
  }

  function matchesTrendScope(item) {
    const meta = item.trendMeta;
    if (trendScope.region !== '全球' && meta.region !== trendScope.region) return false;
    if (meta.geoScope === 'country' && trendScope.country !== '自动选择' && meta.country !== trendScope.country) return false;
    if (trendScope.channel !== '全渠道' && meta.channel !== trendScope.channel && meta.observedChannel !== trendScope.channel) return false;
    return true;
  }

  function visibleTrendCount() {
    return trendCatalogItems.filter(matchesTrendScope).length;
  }

  function applyTrendScope() {
    liveTrendItems = trendCatalogItems.filter(matchesTrendScope);
    syncLiveTrendMaterials(liveTrendItems);
    const time = trendGeneratedAt ? new Date(trendGeneratedAt).toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit' }) : '';
    const failures = trendErrors.map(error => `${error.country || ''}/${error.observedChannel || error.channel || '来源'}：${error.message}`).join('；');
    trendMessage = trendLoading ? (liveTrendItems.length ? '已显示 ' + liveTrendItems.length + ' 条，继续读取其余来源…' : '正在获取当前范围的真实榜单…')
      : liveTrendItems.length ? `${liveTrendItems.length} 条当前来源 · ${time} 检索${trendErrors.length ? ` · ${trendErrors.length} 个来源未取到数据` : ''}`
      : `当前范围暂无可用数据${failures ? `：${failures}` : ''}，可刷新重试`;
    worldState.textContent = trendLoading ? '实时来源刷新中' : `实时来源 ${liveTrendItems.length} 条${trendErrors.length ? ' · 部分来源失败' : ''}`;
    if (activeTab === 'trend') renderTrendExplorer();
  }

  async function fetchLiveTrends(force = false, polling = false) {
    clearTimeout(trendPollTimer);
    if (!security.localPage() || window.openai?.sendFollowUpMessage) {
      trendLoading = false;
      trendMessage = '宿主中的实时热点由当前对话检索；在本机合成器可浏览实时榜单。';
      worldState.textContent = '使用当前对话检索热点与生成';
      if (activeTab === 'trend') renderTrendExplorer();
      return;
    }
    const requestNumber = ++trendRequestNumber;
    const requestedScope = trendScopeKey();
    trendLoading = true;
    if (!polling && loadedTrendScope !== requestedScope) { trendCatalogItems = []; liveTrendItems = []; trendErrors = []; trendSourceSummary = []; }
    applyTrendScope();
    try {
      const query = new URLSearchParams(trendScope);
      if (force) query.set('refresh', '1');
      const response = await fetch(`http://127.0.0.1:3002/api/trends?${query}`, { signal: AbortSignal.timeout(10000) });
      const output = await response.json().catch(() => ({}));
      if (requestNumber !== trendRequestNumber || requestedScope !== trendScopeKey()) return;
      if (!response.ok && response.status !== 202) throw new Error(output.error || '实时热点服务未启动');
      trendCatalogItems = (Array.isArray(output.items) ? output.items : []).map(normalizeTrendItem);
      trendGeneratedAt = output.generatedAt || '';
      trendErrors = Array.isArray(output.errors) ? output.errors : [];
      trendSourceSummary = Array.isArray(output.sourceSummary) ? output.sourceSummary : [];
      if (response.status === 202 || output.status === 'loading') {
        applyTrendScope();
        trendPollTimer = setTimeout(() => fetchLiveTrends(false, true), 2000);
        return;
      }
      loadedTrendScope = requestedScope;
      trendLoading = false;
      applyTrendScope();
      trendPollTimer = setTimeout(() => fetchLiveTrends(true, true), 15 * 60 * 1000);
    } catch (error) {
      if (requestNumber !== trendRequestNumber) return;
      trendLoading = false;
      trendMessage = `${error instanceof Error ? error.message : '实时热点加载失败'}，可点击刷新重试`;
      worldState.textContent = '实时热点加载失败';
      if (activeTab === 'trend') renderTrendExplorer();
    }
  }

  function renderMaterials() {
    if (activeTab === 'trend') {
      renderTrendExplorer();
      field.setAttribute('aria-labelledby', 'alchemy-trend-tab');
      tabNote.textContent = '真实榜单每15分钟自动刷新，也可手动刷新；卡片保留排名、热度和来源';
      return;
    }
    field.classList.remove('is-trend');
    field.innerHTML = '';
    let visible = materials.filter(item => item.category === activeTab && !selected.has(item.id));
    if (activeTab === 'gameplay') visible = visible.filter(item => item.kind === gameplayMode);
    visible.forEach((item, index) => {
      const state = compatibility(item);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `alchemy-ingredient compat-${state === 'selected' ? 'gold' : state}${selected.has(item.id) ? ' is-selected' : ''}`;
      button.dataset.id = item.id;
      button.setAttribute('aria-pressed', selected.has(item.id) ? 'true' : 'false');
      button.setAttribute('aria-label', `${item.label}材料，${selected.has(item.id) ? '已加入' : '点击加入'}`);
      button.style.setProperty('--float-y', `${[-3,4,0,6,-1,3,-4,2][index % 8]}px`);
      button.style.setProperty('--float-r', `${[-2,2,1,-1,2,-2,1,0][index % 8]}deg`);
      if (item.category === 'visual') {
        button.classList.add('is-style-card');
      }
      button.innerHTML = materialVisualMarkup(item);
      button.addEventListener('click', () => toggleMaterial(item.id));
      enablePointerDrag(button, item.id);
      field.appendChild(button);
    });
    const tabIds = { control:'alchemy-control-tab', gameplay:'alchemy-gameplay-tab', visual:'alchemy-visual-tab', topic:'alchemy-topic-tab', trend:'alchemy-trend-tab' };
    const notes = {
      control:'选择玩家实际使用的控制方式',
      gameplay:'选择核心行为；游戏类型由组合自动推导',
      visual:'同一玩法场景，只替换美术风格，方便直接比较',
      topic:'选择稳定的基础世界与常规题材',
      trend:'全球实时话题催化；出锅前会再次校验'
    };
    field.setAttribute('aria-labelledby', tabIds[activeTab]);
    tabNote.textContent = activeTab === 'gameplay'
      ? (gameplayMode === 'action' ? '选择游戏里真正发生的动作' : '选择动作如何形成循环和目标')
      : notes[activeTab];
    refreshIcons();
  }

  function renderPot() {
    const existingTokens = new Map(
      [...liquid.querySelectorAll('.alchemy-pot-token')].map(token => [token.dataset.id, token])
    );
    const previousRects = new Map(
      [...existingTokens].map(([id, token]) => [id, token.getBoundingClientRect()])
    );
    const floatMotions = [
      ['5px','3px','3deg','3.6s','-.5s'], ['3px','5px','4deg','4.1s','-1.2s'], ['6px','3px','2deg','3.4s','-.8s'],
      ['4px','6px','4deg','4.4s','-1.7s'], ['5px','4px','3deg','3.9s','-.3s'], ['3px','5px','5deg','4.2s','-1.4s']
    ];
    const selectedIds = [...selected];
    const tokenCount = selectedIds.length;
    const tokenSize = tokenCount <= 6 ? 64 : tokenCount <= 12 ? 60 : tokenCount <= 20 ? 56 : 52;
    const radiusX = tokenCount <= 6 ? 31 : tokenCount <= 12 ? 34 : 36;
    const radiusY = tokenCount <= 6 ? 29 : tokenCount <= 12 ? 31 : 33;
    const renderedTokens = [];
    selectedIds.forEach((id, index) => {
      const item = byId(id);
      if (!item) return;
      let radialProgress = 0;
      let angleDegrees = -90;
      if (tokenCount > 1 && tokenCount <= 6) {
        radialProgress = tokenCount === 2 ? .66 : tokenCount === 3 ? .7 : .78;
        angleDegrees = (tokenCount === 2 ? 180 : -90) + index * (360 / tokenCount);
      } else if (tokenCount > 6) {
        radialProgress = .3 + .7 * Math.sqrt(index / Math.max(1, tokenCount - 1));
        angleDegrees = -90 + index * 137.508;
      }
      const angle = angleDegrees * Math.PI / 180;
      const tokenX = 50 + Math.cos(angle) * radiusX * radialProgress;
      const tokenY = 50 + Math.sin(angle) * radiusY * radialProgress;
      const rotation = ((index * 17) % 23) - 11;
      const motion = floatMotions[index % floatMotions.length];
      let token = existingTokens.get(id);
      const isNew = !token;
      if (isNew) {
        token = document.createElement('button');
        token.type = 'button';
        token.dataset.id = id;
        token.className = `alchemy-pot-token${item.category === 'visual' ? ' is-style-card' : ''}`;
        token.setAttribute('aria-label', `移除${item.label}`);
        token.innerHTML = materialVisualMarkup(item);
        token.addEventListener('click', () => toggleMaterial(id));
        token.style.setProperty('--drift-x', motion[0]);
        token.style.setProperty('--drift-y', motion[1]);
        token.style.setProperty('--token-sway', motion[2]);
        token.style.setProperty('--token-duration', motion[3]);
        token.style.setProperty('--token-delay', motion[4]);
        liquid.appendChild(token);
      }
      existingTokens.delete(id);
      token.style.setProperty('--token-size', `${tokenSize}px`);
      token.style.setProperty('--token-x', `${tokenX.toFixed(2)}%`);
      token.style.setProperty('--token-y', `${tokenY.toFixed(2)}%`);
      token.style.setProperty('--token-r', `${rotation}deg`);
      token.style.zIndex = String(3 + index % 5);
      renderedTokens.push({ id, token, isNew });
    });
    existingTokens.forEach(token => token.remove());

    const geometry = shellGeometry();
    const liquidRect = liquid.getBoundingClientRect();
    const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 300;
    renderedTokens.forEach(({ id, token, isNew }) => {
      const targetRect = token.getBoundingClientRect();
      if (isNew) {
        const deltaX = (liquidRect.left + liquidRect.width / 2 - targetRect.left - targetRect.width / 2) / geometry.scaleX;
        const deltaY = (liquidRect.top + liquidRect.height / 2 - targetRect.top - targetRect.height / 2) / geometry.scaleY;
        token.animate([
          { translate: `${deltaX}px ${deltaY}px`, scale: '.58', opacity: .08 },
          { translate: '0px 0px', scale: '1.07', opacity: 1, offset: .76 },
          { translate: '0px 0px', scale: '1', opacity: 1 }
        ], {
          duration,
          easing: 'cubic-bezier(.18,.78,.2,1)',
          fill: 'none'
        });
        return;
      }
      const previousRect = previousRects.get(id);
      if (!previousRect) return;
      const deltaX = (previousRect.left - targetRect.left) / geometry.scaleX;
      const deltaY = (previousRect.top - targetRect.top) / geometry.scaleY;
      if (Math.abs(deltaX) < .5 && Math.abs(deltaY) < .5) return;
      token.animate([
        { translate: `${deltaX}px ${deltaY}px`, scale: '1' },
        { translate: `${-deltaX * .025}px ${-deltaY * .025}px`, scale: '1.035', offset: .8 },
        { translate: '0px 0px', scale: '1' }
      ], {
        duration,
        easing: 'cubic-bezier(.18,.78,.2,1)',
        fill: 'none'
      });
    });
    const controlParts = [...selected].map(byId).filter(item => item?.category === 'control');
    const gameplayParts = [...selected].map(byId).filter(item => item?.category === 'gameplay');
    const actionParts = gameplayParts.filter(item => item.kind === 'action');
    const systemParts = gameplayParts.filter(item => item.kind === 'system');
    const visualParts = [...selected].map(byId).filter(item => item?.category === 'visual');
    const topicParts = [...selected].map(byId).filter(item => item?.category === 'topic');
    if (controlParts.length && actionParts.length && systemParts.length) {
      const coreName = `${controlParts[0].label} × ${actionParts[0].label} → ${systemParts[0].label}`;
      const visualName = visualParts.length ? ` · ${visualParts[0].label}化` : '';
      const topicName = topicParts.length ? ` · ${topicParts[0].label}世界` : '';
      compound.textContent = `${coreName}${visualName}${topicName}`;
    } else if (selected.size) {
      compound.textContent = `${[...selected].map(id => byId(id)?.label).filter(Boolean).join(' × ')} · AI 将补齐其余维度`;
    } else {
      compound.textContent = '放入任意一种材料即可开始';
    }
    pot.classList.toggle('is-ready', selected.size > 0);
    recipeState.textContent = selected.size ? `已加入 ${selected.size} 种 · 其余维度由 AI 按市场补全` : '请先放入 1 种材料';
    brew.disabled = selected.size === 0;
    brew.textContent = selected.size ? '开始实时合成' : '请先放入 1 种材料';
    refreshIcons();
  }

  function toggleMaterial(id) {
    const item = byId(id);
    if (selected.has(id)) {
      selected.delete(id);
    } else {
      if (item?.category === 'visual' || item?.category === 'topic') {
        materials.filter(candidate => candidate.category === item.category).forEach(candidate => selected.delete(candidate.id));
      }
      selected.add(id);
    }
    renderMaterials();
    renderPot();
  }

  function addMaterialToPot(id) {
    const item = byId(id);
    if (!item) return;
    if (item.category === 'visual' || item.category === 'topic') {
      materials.filter(candidate => candidate.category === item.category).forEach(candidate => selected.delete(candidate.id));
    }
    selected.add(id);
    dropHint.textContent = '已加入，继续挑选材料';
    renderMaterials();
    renderPot();
  }

  root.querySelectorAll('.alchemy-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      activeTab = tab.dataset.tab;
      root.querySelectorAll('.alchemy-tab').forEach(other => other.setAttribute('aria-selected', other === tab ? 'true' : 'false'));
      gameplayModes.hidden = activeTab !== 'gameplay';
      renderMaterials();
    });
  });

  root.querySelectorAll('.alchemy-gameplay-mode').forEach(button => {
    button.addEventListener('click', () => {
      gameplayMode = button.dataset.gameplayMode;
      root.querySelectorAll('.alchemy-gameplay-mode').forEach(other => other.setAttribute('aria-pressed', other === button ? 'true' : 'false'));
      renderMaterials();
    });
  });

  pot.addEventListener('dragover', event => {
    event.preventDefault();
    dropHint.textContent = '松手加入配方';
  });
  pot.addEventListener('dragleave', () => { dropHint.textContent = '拖进锅里 · 点击也可加入'; });
  pot.addEventListener('drop', event => {
    event.preventDefault();
    const id = event.dataTransfer.getData('text/plain');
    addMaterialToPot(id);
  });

  function liveGenerationPrompt(isRemix = false) {
    const chosen = [...selected].map(byId).filter(Boolean);
    const categoryNames = { control:'操作', gameplay:'玩法', visual:'美术风格', topic:'题材', trend:'实时话题' };
    const materialLines = chosen.map(item => {
      const detail = item.category === 'gameplay' ? (item.kind === 'action' ? '游戏动作' : '玩法机制') : categoryNames[item.category];
      if (item.category === 'trend' && item.trendMeta) {
        const meta = item.trendMeta;
        return `- ${detail}：${item.fullLabel || item.label}（素材ID：${item.id}；${meta.region}/${meta.country}/${meta.channel}；证据：${meta.evidence}；来源：${meta.sourceTitle} ${meta.sourceUrl}）`;
      }
      return `- ${detail}：${item.label}（素材ID：${item.id}）`;
    }).join('\n');
    return `【炼金器合成请求】请亲自接管本次${isRemix ? '重新' : ''}生成。收到后立即执行，不要询问确认，不要复述配方等待回复。\n\n用户投入的硬约束素材：\n${materialLines}\n\n实时题材检索范围：\n- 地区：${trendScope.region}\n- 国家：${trendScope.country}\n- 渠道：${trendScope.channel}\n\n严格要求：\n1. 禁止从预设标题、固定组合、预设报告或现成参考图中抽取结果；必须按本次素材从零推导。\n2. 先联网检索并交叉核对当前全球游戏市场、短视频小游戏趋势、可试玩广告和买量素材信号；按上面的地区、国家、渠道补全实时催化，并给出真实来源。\n3. 用户投入素材不可替换。只补全用户未选的操作、游戏动作、玩法机制、游戏类型、题材、美术风格与实时催化；冲突时说明主次和保留方式。\n4. 必须调用图片生成能力，现场生成一张全新的游戏运行画面：按玩法选择固定游戏镜头，完整可操作区域占主体，清晰呈现目标、障碍、游戏内触点/操作轨迹、机制反馈与必要 HUD。不要真人手、手机机身、产品照片、电影特写、宣传海报或氛围插画；禁止复用炼金器内置图集。\n5. 市场机会、核心玩法、买量钩子、美术方向、本次配方、AI 补全分别生成与本案语义一致的单个图标，不能用无关固定图标。\n6. 报告必须包含：游戏名、稀有度、市场机会、核心玩法、买量钩子、美术方向、本次配方、AI 补全说明、合成判断、来源和玩法参考图。\n7. 研究、推导和生图完成后，必须调用当前 App 的 render_alchemy_report 工具，把完整字段写回炼金器。imageUrl 有可传入的生成图地址时必须填写；若宿主无法提供地址，仍要调用工具，并同时在对话中展示新生成的玩法图。\n8. 在完成 render_alchemy_report 调用前不要结束本次任务。`;
  }

  function clearBrewStages() {
    brewTimers.forEach(timer => clearTimeout(timer));
    brewTimers = [];
    shell.classList.remove('is-brewing', 'brew-stage-1', 'brew-stage-2', 'brew-stage-3', 'brew-stage-4');
    pot.classList.remove('is-brewing');
    brewingLabel.hidden = true;
    recipeState.title = '';
  }

  function setBrewStage(stage) {
    shell.classList.remove('brew-stage-1', 'brew-stage-2', 'brew-stage-3', 'brew-stage-4');
    shell.classList.add(`brew-stage-${stage}`);
  }

  function startBrewAnimation() {
    clearBrewStages();
    shell.classList.add('is-brewing');
    pot.classList.add('is-brewing');
    brewingLabel.textContent = '准备合成';
    brewingLabel.hidden = false;
    setBrewStage(1);
    brewTimers = [
      setTimeout(() => setBrewStage(2), 2200),
      setTimeout(() => setBrewStage(3), 5000),
      setTimeout(() => setBrewStage(4), 8200)
    ];
  }

  function resetAfterGenerationError(message = '生成失败，请重试') {
    isGenerating = false;
    clearGenerationProgress();
    clearTimeout(reportWaitTimer);
    reportWaitTimer = null;
    clearBrewStages();
    brew.disabled = false;
    brew.textContent = '重新合成';
    recipeState.textContent = message;
    worldState.textContent = currentDraft ? '方案已保存，可继续生成海报' : '合成失败，可直接重试';
    renderDraftState();
  }

  function renderDraftState() {
    for (const prefix of ['alchemy', 'alchemy-result']) {
      const panel = root.querySelector(`#${prefix}-draft-panel`);
      const button = root.querySelector(`#${prefix}-resume-draft`);
      panel.hidden = !currentDraft;
      button.disabled = isGenerating;
      root.querySelector(`#${prefix}-draft-title`).textContent = currentDraft ? `已保存方案：《${currentDraft.report.gameName}》` : '';
      button.textContent = currentDraft?.stage === 'poster' ? '继续排版海报' : '继续生成海报';
    }
  }

  function acceptSavedDraft(value) {
    const draft = security.normalizeDraftOutput(value);
    if (!draft) return false;
    currentDraft = draft;
    renderDraftState();
    return true;
  }

  async function restoreSavedDraft() {
    if (!security.localPage() || window.openai?.sendFollowUpMessage || isGenerating) return;
    const restoringEpoch = resultEpoch;
    try {
      const response = await fetch('http://127.0.0.1:3002/api/draft', { signal: AbortSignal.timeout(20000) });
      if (!response.ok) return;
      const payload = await response.json();
      if (isGenerating || resultEpoch !== restoringEpoch) return;
      if (acceptSavedDraft(payload)) worldState.textContent = '有已保存方案，可继续生成海报';
      else if (payload?.view === 'empty') { currentDraft = null; renderDraftState(); }
    } catch { /* Existing completed reports remain usable while the service is unavailable. */ }
  }

  function setReportText(id, value) {
    const node = root.querySelector(`#${id}`);
    if (node) node.textContent = value || '—';
  }

  function setGeneratedIcon(id, value) {
    const node = root.querySelector(`#${id}`);
    if (!node) return;
    node.classList.add('is-generated-icon');
    node.textContent = value || '✦';
  }

  function localAssetUrl(value) {
    return security.safeAssetUrl(value);
  }

  function applyGeneratedReport(payload) {
    const report = payload.report;
    currentReport = payload;
    const cardImage = root.querySelector('#alchemy-card-image');
    const openCard = root.querySelector('#alchemy-card-open');
    const saveCard = root.querySelector('#alchemy-save-card');
    const details = root.querySelector('#alchemy-report-details');
    details.hidden = true;
    root.querySelector('.alchemy-report').classList.remove('is-open');
    root.querySelector('#alchemy-expand').textContent = '展开方案';
    root.querySelector('#alchemy-expand').setAttribute('aria-expanded', 'false');
    const posterAsset = payload.posterUrl || payload.cardUrl;
    const cardUrl = posterAsset ? localAssetUrl(posterAsset) : '';
    cardImage.hidden = !cardUrl;
    saveCard.hidden = !cardUrl;
    if (cardUrl) {
      cardImage.src = cardUrl;
      cardImage.alt = `《${report.gameName}》创意说明海报：游戏画面、精简玩法、配方与市场机会`;
      openCard.href = cardUrl;
      saveCard.href = cardUrl;
      saveCard.download = `${report.gameName.replace(/[\\/:*?"<>|]/g, '-')}-创意说明海报.png`;
      setReportText('alchemy-card-status', `${payload.posterWidth || payload.cardWidth || ''} × ${payload.posterHeight || payload.cardHeight || ''} PNG · 点击查看完整海报`);
      cardImage.onerror = () => { cardImage.hidden = true; saveCard.hidden = true; setReportText('alchemy-card-status', '海报加载失败，请刷新后重试'); };
    } else {
      cardImage.removeAttribute('src');
      openCard.removeAttribute('href');
      saveCard.removeAttribute('href');
      setReportText('alchemy-card-status', '本次输出缺少海报图片，请展开查看方案');
    }
    setReportText('alchemy-rarity', report.rarity);
    setReportText('alchemy-result-title', report.gameName);
    setReportText('alchemy-result-hook', report.tagline);
    setReportText('alchemy-gameplay-reference-type', [report.control, report.action, report.mechanic, report.artStyle].filter(Boolean).join(' · '));
    setReportText('alchemy-report-market', report.marketOpportunity);
    setReportText('alchemy-report-gameplay-new', report.coreGameplay);
    setReportText('alchemy-report-ad-hook', report.adHook);
    setReportText('alchemy-report-visual-new', report.artDirection);
    setReportText('alchemy-report-recipe', report.recipe);
    setReportText('alchemy-auto-note-text', report.aiCompletion);
    setReportText('alchemy-report-control', report.control);
    setReportText('alchemy-report-action', report.action);
    setReportText('alchemy-report-gameplay', report.mechanic);
    setReportText('alchemy-report-type', report.gameType);
    setReportText('alchemy-report-visual', report.artStyle);
    setReportText('alchemy-report-topic', report.topic);
    setReportText('alchemy-report-world', report.trendCatalyst);
    setReportText('alchemy-report-why', report.synthesisJudgement);

    const art = root.querySelector('#alchemy-gameplay-reference-art');
    art.alt = report.referenceImageCaption;
    let artPlaceholder = root.querySelector('.alchemy-gameplay-reference-placeholder');
    if (!artPlaceholder) {
      artPlaceholder = document.createElement('div');
      artPlaceholder.className = 'alchemy-gameplay-reference-placeholder';
      art.insertAdjacentElement('afterend', artPlaceholder);
    }
    const imageUrl = localAssetUrl(payload.imageUrl);
    if (imageUrl) {
      art.hidden = false;
      art.src = imageUrl;
      artPlaceholder.hidden = true;
      art.onerror = () => {
        art.hidden = true;
        artPlaceholder.hidden = false;
        artPlaceholder.textContent = '玩法参考图已在当前对话生成；当前宿主未提供可嵌入地址';
      };
    } else {
      art.removeAttribute('src');
      art.hidden = true;
      artPlaceholder.hidden = false;
      artPlaceholder.textContent = '玩法参考图已在当前对话现场生成';
    }

    const iconMap = {
      market: 'alchemy-icon-market', gameplay: 'alchemy-icon-gameplay',
      hook: 'alchemy-icon-hook', art: 'alchemy-icon-art',
      recipe: 'alchemy-icon-recipe', ai: 'alchemy-icon-ai'
    };
    Object.entries(iconMap).forEach(([key, id]) => setGeneratedIcon(id, report.icons?.[key]));

    const sourceLine = root.querySelector('#alchemy-market-source');
    sourceLine.textContent = '参考来源：';
    (report.sources || []).filter(source => security.safeWebUrl(source.url)).forEach((source, index) => {
      if (index) sourceLine.append(' · ');
      const link = document.createElement('a');
      link.href = security.safeWebUrl(source.url);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = `${source.title}${source.publishedAt ? `（${source.publishedAt}）` : ''}`;
      sourceLine.append(link);
    });
    sourceLine.append(`｜生成：${new Date(payload.generatedAt).toLocaleString('zh-CN')}`);
    if (payload.provider === 'codex-report-api-image') sourceLine.append('｜生成方式：备用方案服务＋生图 API');
    else if (payload.provider === 'api-image-remake') sourceLine.append('｜生成方式：保留方案＋生图 API 重绘游戏画面');
    else if (payload.provider === 'codex-image-remake') sourceLine.append('｜生成方式：保留方案＋备用生图服务');
    else if (payload.provider === 'codex-fallback') sourceLine.append('｜生成方式：备用服务（主服务暂不可用）');
  }

  function structuredToolOutput(value) {
    if (!value || typeof value !== 'object') return null;
    if (value.view) return value;
    if (value.structuredContent) return value.structuredContent;
    if (value.result?.structuredContent) return value.result.structuredContent;
    if (value.params?.structuredContent) return value.params.structuredContent;
    if (value.params?.result?.structuredContent) return value.params.result.structuredContent;
    return null;
  }

  function finishWithGeneratedReport(output) {
    output = security.normalizeReportOutput(output);
    if (!output) return false;
    resultEpoch += 1;
    applyGeneratedReport(output);
    clearTimeout(reportWaitTimer);
    reportWaitTimer = null;
    clearBrewStages();
    isGenerating = false;
    clearGenerationProgress();
    currentDraft = null;
    renderDraftState();
    try { localStorage.setItem(resultCacheKey, JSON.stringify({ output, materials: [...selected] })); } catch { /* Storage can be disabled by the host. */ }
    brew.disabled = false;
    brew.textContent = '开始实时合成';
    worldState.textContent = (output.posterUrl || output.cardUrl) ? '创意说明海报已生成，可保存 PNG' : '报告已生成';
    selectView.hidden = true;
    resultView.hidden = false;
    return true;
  }

  function readCurrentHostOutput() {
    return structuredToolOutput(window.openai?.toolOutput);
  }

  window.addEventListener('message', event => {
    security.handleToolResult(event, finishWithGeneratedReport, readCurrentHostOutput);
  });

  const initialArt = root.querySelector('#alchemy-gameplay-reference-art');
  initialArt?.removeAttribute('src');
  queueMicrotask(() => finishWithGeneratedReport(readCurrentHostOutput()));

  async function restoreCompletedResult() {
    if (!security.localPage() || window.openai?.sendFollowUpMessage || isGenerating) return;
    try {
      const cached = JSON.parse(localStorage.getItem(resultCacheKey) || 'null');
      const cachedOutput = security.normalizeReportOutput(cached?.output);
      if (cachedOutput && (cachedOutput.posterUrl || cachedOutput.cardUrl)) {
        selected.clear();
        (Array.isArray(cached.materials) ? cached.materials : []).filter(byId).forEach(id => selected.add(id));
        renderMaterials();
        renderPot();
        finishWithGeneratedReport(cachedOutput);
      }
    } catch { /* Continue with the server's last completed result. */ }
    const restoringReport = currentReport;
    const restoringEpoch = resultEpoch;
    try {
      const response = await fetch('http://127.0.0.1:3002/api/result', { signal: AbortSignal.timeout(20000) });
      if (!response.ok) return;
      const payload = await response.json();
      if (isGenerating || resultEpoch !== restoringEpoch || currentReport !== restoringReport || window.openai?.sendFollowUpMessage) return;
      const output = security.normalizeReportOutput(payload);
      if (output) {
        // The local service owns its persisted result; another copy's browser timestamp is not authoritative.
        selected.clear();
        (Array.isArray(output.materialIds) ? output.materialIds : []).filter(byId).forEach(id => selected.add(id));
        renderMaterials();
        renderPot();
        finishWithGeneratedReport(output);
      } else if (payload?.view === 'empty' && !payload.report) {
        resultEpoch += 1;
        currentReport = null;
        selected.clear();
        try { localStorage.removeItem(resultCacheKey); } catch { /* Storage can be disabled by the host. */ }
        for (const selector of ['#alchemy-card-image', '#alchemy-gameplay-reference-art']) root.querySelector(selector).removeAttribute('src');
        for (const selector of ['#alchemy-card-open', '#alchemy-save-card']) root.querySelector(selector).removeAttribute('href');
        resultView.hidden = true;
        selectView.hidden = false;
        renderMaterials();
        renderPot();
        applyTrendScope();
      }
    } catch { /* Keep the valid browser snapshot while the local service is unavailable. */ }
  }

  async function requestLiveGeneration(isRemix = false, imageOnly = false, resumeDraft = false) {
    if ((!selected.size && !imageOnly && !resumeDraft) || isGenerating || (resumeDraft && !currentDraft)) return;
    const savedDraft = currentDraft;
    let refreshDraftAfterFailure = false;
    if (resumeDraft) {
      selected.clear();
      savedDraft.materialIds.filter(byId).forEach(id => selected.add(id));
      renderMaterials();
      renderPot();
    }
    resultEpoch += 1;
    isGenerating = true;
    renderDraftState();
    selectView.hidden = false;
    resultView.hidden = true;
    startBrewAnimation();
    brew.disabled = true;
    brew.textContent = '合成中';
    recipeState.textContent = '';
    worldState.textContent = '合成中';
    try {
      const prompt = resumeDraft ? '' : liveGenerationPrompt(isRemix);
      if (window.openai?.sendFollowUpMessage) {
        if (imageOnly || resumeDraft) throw new Error('请在本地合成器中生成游戏画面');
        await window.openai.sendFollowUpMessage({
          prompt,
          scrollToBottom: false
        });
        reportWaitTimer = setTimeout(() => {
          if (isGenerating) resetAfterGenerationError('本次合成等待超时，可直接重试');
        }, 300000);
      } else {
        if (!security.localPage()) throw new Error('请通过 npm run local 打开本机合成器，或在提供生成能力的宿主中使用');
        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        generationPollTimer = setTimeout(() => pollGenerationProgress(requestId), 800);
        const endpoint = resumeDraft ? '/api/resume-image' : (imageOnly ? '/api/regenerate-image' : '/api/generate');
        const response = await fetch(`http://127.0.0.1:3002${endpoint}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(resumeDraft ? { requestId, draftId: savedDraft.draftId, sourceDraftVersion: savedDraft.stateVersion } : imageOnly ? { requestId, sourceStateVersion: currentReport?.stateVersion } : { prompt, requestId, scope: trendScope, materialIds: [...selected] }),
          signal: AbortSignal.timeout(25 * 60 * 1000)
        });
        const output = await response.json().catch(() => ({}));
        if (!response.ok && output.draftReady) acceptSavedDraft(output.draft);
        if (!response.ok && resumeDraft && response.status === 409) { currentDraft = null; renderDraftState(); refreshDraftAfterFailure = true; }
        if (!response.ok) throw new Error(output.error || '本地 Codex 服务未启动');
        if (!finishWithGeneratedReport(output)) throw new Error('本地 Codex 返回的报告格式无效');
      }
    } catch (error) {
      const message = error instanceof TypeError && /fetch/i.test(error.message)
        ? '本地生成服务未启动，请先运行 npm run local 后重试'
        : (error instanceof Error ? error.message : '生成失败，请重试');
      resetAfterGenerationError(message);
      if (refreshDraftAfterFailure) restoreSavedDraft();
    }
  }

  brew.addEventListener('click', () => requestLiveGeneration(false));
  root.querySelector('#alchemy-regenerate-image').addEventListener('click', () => requestLiveGeneration(false, true));
  root.querySelector('#alchemy-resume-draft').addEventListener('click', () => requestLiveGeneration(false, false, true));
  root.querySelector('#alchemy-result-resume-draft').addEventListener('click', () => requestLiveGeneration(false, false, true));

  root.querySelector('#alchemy-fullscreen').addEventListener('click', async event => {
    try {
      if (window.openai?.requestDisplayMode) {
        await window.openai.requestDisplayMode({ mode: 'fullscreen' });
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      event.currentTarget.querySelector('span').textContent = '当前宿主未允许全屏';
    }
  });

  root.querySelector('#alchemy-back').addEventListener('click', () => {
    resultView.hidden = true;
    selectView.hidden = false;
    isGenerating = false;
    clearBrewStages();
    worldState.textContent = `实时来源 ${liveTrendItems.length} 条`;
    renderPot();
  });

  root.querySelector('#alchemy-remix').addEventListener('click', () => {
    requestLiveGeneration(true);
  });

  root.querySelector('#alchemy-expand').addEventListener('click', event => {
    const details = root.querySelector('#alchemy-report-details');
    details.hidden = !details.hidden;
    root.querySelector('.alchemy-report').classList.toggle('is-open', !details.hidden);
    event.currentTarget.textContent = details.hidden ? '展开方案' : '收起方案';
    event.currentTarget.setAttribute('aria-expanded', String(!details.hidden));
  });

  renderMaterials();
  renderPot();
  fetchLiveTrends();
  restoreCompletedResult().finally(restoreSavedDraft);
  refreshIcons();
})();
