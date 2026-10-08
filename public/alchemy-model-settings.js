(() => {
  const root = document.querySelector('#ai-alchemy-prototype');
  if (!root) return;
  const dialog = document.createElement('dialog');
  dialog.id = 'alchemy-model-settings';
  dialog.setAttribute('aria-labelledby', 'alchemy-settings-title');
  const field = (kind, name, label, type = 'text', extra = '') => `<label class="alchemy-settings-field" for="settings-${kind}-${name}">${label}<input id="settings-${kind}-${name}" name="${kind}.${name}" type="${type}" ${extra}></label>`;
  const select = (kind, name, label, options) => `<label class="alchemy-settings-field" for="settings-${kind}-${name}">${label}<select id="settings-${kind}-${name}" name="${kind}.${name}">${options.map(([value, text]) => `<option value="${value}">${text}</option>`).join('')}</select></label>`;
  const section = (kind, title, description) => `<section class="alchemy-settings-section ${kind}"><h3>${title}</h3><p>${description}</p>
    ${select(kind, 'apiFormat', '接口格式', kind === 'chat' ? [['openai', 'OpenAI 兼容'], ['anthropic', 'Anthropic Messages']] : [['echojoy', 'Echojoy 异步生图'], ['openai', 'OpenAI 兼容生图']])}
    ${field(kind, 'apiBaseUrl', 'API Base URL', 'url', 'required placeholder="https://…/v1" autocomplete="off"')}
    <label class="alchemy-settings-field" for="settings-${kind}-apiKey">API Key<input id="settings-${kind}-apiKey" name="${kind}.apiKey" type="password" autocomplete="new-password" spellcheck="false"><small id="settings-${kind}-key-state"></small></label>
    <label class="alchemy-settings-check"><input id="settings-${kind}-clearApiKey" type="checkbox">清除这组已保存密钥</label>
    ${field(kind, 'model', '模型名', 'text', 'placeholder="填写供应商提供的完整模型名" autocomplete="off"')}
    ${kind === 'chat' ? `<div class="alchemy-settings-pair">${field(kind, 'maxTokens', '最大输出 tokens', 'number', 'min="512" max="32768" step="1" required')}${field(kind, 'temperature', '随机程度', 'number', 'min="0" max="2" step="0.05" required')}</div>` : `${field(kind, 'size', '画幅 / 尺寸', 'text', 'required placeholder="16:9、9:16 或 1536x864"')}<div class="alchemy-settings-pair">${select(kind, 'resolution', 'Echojoy 分辨率', [['1K','1K'],['2K','2K'],['4K','4K']])}${select(kind, 'quality', '质量', [['low','低'],['medium','中'],['high','高'],['auto','自动']])}</div>${field(kind, 'pollIntervalMs', 'Echojoy 轮询间隔（毫秒）', 'number', 'min="750" max="30000" step="250" required')}`}
    ${field(kind, 'timeoutMs', '请求 / 任务超时（毫秒）', 'number', 'min="10000" max="900000" step="1000" required')}
    <button class="alchemy-settings-test" type="button" data-test-kind="${kind}">保存并检查${kind === 'chat' ? '对话' : '生图'}连接</button><div class="alchemy-settings-feedback" id="settings-${kind}-feedback" role="status"></div>${kind === 'image' ? '<div class="alchemy-settings-feedback" id="settings-font-feedback" role="status"></div>' : ''}</section>`;
  dialog.innerHTML = `<form id="alchemy-settings-form"><header class="alchemy-settings-header"><h2 id="alchemy-settings-title">模型设置</h2><button class="alchemy-settings-close" type="button" aria-label="关闭模型设置">×</button></header><p class="alchemy-settings-intro">两组服务独立填写；保存后下次生成生效。密钥仅保存到本机服务端，留空保持原值。</p><div class="alchemy-settings-body"><div class="alchemy-settings-grid">${section('chat', '对话模型', '负责创意方案、玩法和海报说明')}${section('image', '生图模型', '负责实际游戏视角与玩法画面')}</div><div class="alchemy-settings-policy">${select('generation', 'mode', '主要生成方式', [['api', '使用填写的 API'], ['codex', '本机 Codex']])}<label class="alchemy-settings-check"><input id="settings-fallback" type="checkbox">API 失败时允许本机 Codex 备用生成</label><p>连接检查只读取模型目录，不执行生成。目录可访问仍可能没有模型调用权限。</p></div><section class="alchemy-settings-maintenance"><h3>图片存储</h3><p>手动清理 30 天前未被使用的图片；当前海报和已保存方案的图片会保留。</p><div class="alchemy-settings-maintenance-actions"><button class="alchemy-settings-test" id="settings-maintenance-preview" type="button">预览可清理图片</button><button class="alchemy-settings-test" id="settings-maintenance-cleanup" type="button" hidden>确认清理</button></div><div id="settings-maintenance-feedback" class="alchemy-settings-feedback" role="status"></div></section></div><footer class="alchemy-settings-footer"><button class="alchemy-settings-save" type="submit">保存配置</button><div id="settings-feedback" class="alchemy-settings-feedback" role="status"></div></footer></form>`;
  root.append(dialog);
  const form = dialog.querySelector('form');
  let locked = false;
  let unavailable = false;
  let maintenancePlan = null;
  const maintenancePreview = dialog.querySelector('#settings-maintenance-preview');
  const maintenanceCleanup = dialog.querySelector('#settings-maintenance-cleanup');
  const numericFields = new Set(['maxTokens', 'temperature', 'timeoutMs', 'pollIntervalMs']);
  function feedback(id, message, isError = false) {
    const node = dialog.querySelector(`#${id}`);
    node.textContent = message;
    node.dataset.error = String(isError);
  }
  function fillSettings(settings) {
    for (const kind of ['chat', 'image']) {
      for (const [name, value] of Object.entries(settings[kind])) {
        const input = form.elements.namedItem(`${kind}.${name}`);
        if (input) input.value = String(value);
      }
      form.elements.namedItem(`${kind}.apiKey`).value = '';
      dialog.querySelector(`#settings-${kind}-clearApiKey`).checked = false;
      dialog.querySelector(`#settings-${kind}-key-state`).textContent = settings[kind].apiKeyConfigured ? '已保存密钥，留空保持；不会回显' : '尚未填写这组密钥';
    }
    form.elements.namedItem('generation.mode').value = settings.mode;
    dialog.querySelector('#settings-fallback').checked = settings.fallbackEnabled;
  }
  function readPatch() {
    const patch = { mode: form.elements.namedItem('generation.mode').value, fallbackEnabled: dialog.querySelector('#settings-fallback').checked };
    for (const kind of ['chat', 'image']) {
      patch[kind] = {};
      for (const input of form.elements) {
        if (!input.name?.startsWith(`${kind}.`)) continue;
        const name = input.name.slice(kind.length + 1);
        patch[kind][name] = numericFields.has(name) ? Number(input.value) : input.value.trim();
      }
      patch[kind].clearApiKey = dialog.querySelector(`#settings-${kind}-clearApiKey`).checked;
    }
    return patch;
  }
  async function api(path, options = {}) {
    if (!window.alchemySecurity?.localPage() || window.openai?.sendFollowUpMessage) throw new Error('独立 API 设置仅支持本机合成器');
    const response = await fetch(`http://127.0.0.1:3002${path}`, { ...options, signal: AbortSignal.timeout(25000), headers: { 'content-type': 'application/json', ...options.headers } });
    const payload = await response.json();
    if (!response.ok) {
      const error = new Error(payload.error || '模型服务暂不可用');
      error.status = response.status;
      throw error;
    }
    return payload;
  }
  function lock(value) {
    locked = value;
    dialog.querySelectorAll('input,select,.alchemy-settings-test,.alchemy-settings-save').forEach(node => { node.disabled = value || unavailable; });
  }
  async function save() {
    const saved = await api('/api/settings', { method: 'POST', body: JSON.stringify(readPatch()) });
    fillSettings(saved);
    feedback('settings-feedback', saved.message);
    return saved;
  }
  root.querySelectorAll('[data-model-settings]').forEach(button => button.addEventListener('click', async () => {
    if (dialog.open) return;
    dialog.showModal();
    maintenancePlan = null;
    maintenanceCleanup.hidden = true;
    feedback('settings-maintenance-feedback', '点击预览后，再确认清理。');
    feedback('settings-feedback', '正在读取已保存配置…');
    for (const kind of ['chat', 'image']) feedback(`settings-${kind}-feedback`, '');
    unavailable = !window.alchemySecurity?.localPage() || Boolean(window.openai?.sendFollowUpMessage);
    if (unavailable) {
      feedback('settings-feedback', '当前组件使用宿主生成；独立 API 设置需在本机合成器中填写。');
      lock(false);
      return;
    }
    lock(true);
    try {
      const [settings, health] = await Promise.all([api('/api/settings'), api('/health').catch(() => ({}))]);
      fillSettings(settings);
      const font = health.chineseFont;
      feedback('settings-font-feedback', font?.available === true ? `海报中文字体：${font.family || '可用'}` : font?.available === false ? (font.message || '未检测到中文字体，请安装 Noto Sans CJK 后重启服务。') : '中文字体检查暂不可用，可继续保存配置。', font?.available === false);
      feedback('settings-feedback', settings.busy ? '生成正在进行，完成后可保存配置' : '填写两组服务后保存即可');
    } catch { feedback('settings-feedback', '无法读取本机配置，请确认本地生成服务已启动', true); }
    finally { lock(false); }
  }));
  dialog.querySelector('.alchemy-settings-close').addEventListener('click', () => { if (!locked) dialog.close(); });
  dialog.addEventListener('close', () => {
    maintenancePlan = null;
    maintenanceCleanup.hidden = true;
    for (const kind of ['chat', 'image']) form.elements.namedItem(`${kind}.apiKey`).value = '';
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (locked) return;
    lock(true);
    try { await save(); } catch (error) { feedback('settings-feedback', error.message, true); }
    finally { lock(false); }
  });
  dialog.querySelectorAll('[data-test-kind]').forEach(button => button.addEventListener('click', async () => {
    if (locked || !form.reportValidity()) return;
    const kind = button.dataset.testKind;
    lock(true);
    feedback(`settings-${kind}-feedback`, '正在保存并读取这组模型目录…');
    try {
      await save();
      const result = await api('/api/settings/test', { method: 'POST', body: JSON.stringify({ kind }) });
      feedback(`settings-${kind}-feedback`, result.message, !result.modelListed);
    } catch (error) { feedback(`settings-${kind}-feedback`, error.message, true); }
    finally { lock(false); }
  }));
  maintenancePreview.addEventListener('click', async () => {
    if (locked || unavailable) return;
    maintenancePlan = null;
    maintenanceCleanup.hidden = true;
    lock(true);
    feedback('settings-maintenance-feedback', '正在检查图片存储…');
    try {
      const result = await api('/api/maintenance');
      const count = Array.isArray(result.candidateFiles) ? result.candidateFiles.length : result.candidateFiles;
      if (!Number.isSafeInteger(count) || count < 0 || !Number.isFinite(result.candidateBytes) || result.candidateBytes < 0 || typeof result.planToken !== 'string' || !result.planToken) throw new Error('清理预览无效，请重新预览');
      const kept = Array.isArray(result.keptReferenced) ? result.keptReferenced.length : Number(result.keptReferenced || 0);
      feedback('settings-maintenance-feedback', `可清理 ${count} 张图片，共 ${(result.candidateBytes / 1024 / 1024).toFixed(2)} MB。当前报告与草稿引用的 ${kept} 张图片保留。`);
      if (count) { maintenancePlan = result.planToken; maintenanceCleanup.hidden = false; }
    } catch (error) { feedback('settings-maintenance-feedback', error.message, true); }
    finally { lock(false); }
  });
  maintenanceCleanup.addEventListener('click', async () => {
    if (locked || unavailable || !maintenancePlan) return;
    const planToken = maintenancePlan;
    maintenancePlan = null;
    maintenanceCleanup.hidden = true;
    lock(true);
    feedback('settings-maintenance-feedback', '正在清理已预览图片…');
    try {
      const result = await api('/api/maintenance/cleanup', { method: 'POST', body: JSON.stringify({ planToken }) });
      feedback('settings-maintenance-feedback', result.message || '清理完成，当前报告和草稿已保留。');
    } catch (error) { feedback('settings-maintenance-feedback', error.status === 409 ? `${error.message}，请重新预览后再确认。` : error.message, true); }
    finally { lock(false); }
  });
})();
