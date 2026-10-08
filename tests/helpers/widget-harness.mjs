import assert from 'node:assert/strict';
import vm from 'node:vm';
import { html, widgetAssets } from './widget-source.mjs';

export { html };
const securityScript = html.match(/<script\b[^>]*\bid="alchemy-security"[^>]*>([\s\S]*?)<\/script>/)?.[1];
assert.ok(securityScript, 'the same security functions must be present in local and MCP HTML');

export function environment({ origin = 'http://localhost:3000', referrer = origin, bridge = false } = {}) {
  const parent = {};
  const window = { parent, openai: bridge ? { sendFollowUpMessage() {} } : undefined };
  const location = new URL(origin === 'null' ? 'about:blank' : `${origin}/alchemy-source.html`);
  const context = vm.createContext({ window, location, document: { referrer }, URL });
  vm.runInContext(securityScript, context);
  return { window, parent, context, security: window.alchemySecurity };
}

export function report(overrides = {}) {
  return {
    view: 'report', stateVersion: 12, generatedAt: '2026-10-06T00:00:00Z',
    report: { gameName: '安全测试方案', rarity: '普通', sources: [{ title: '安全来源', url: 'https://example.com/real', publishedAt: '' }], icons: {} },
    imageUrl: '/generated/game.png', posterUrl: '/generated/poster.png',
    ...overrides,
  };
}

export function notification(parent, output, origin = 'http://localhost:3000') {
  return { source: parent, origin, data: { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: output } } };
}

// A light DOM facade executes the real widget script and its registered listener.
// It records writes without a browser, a model request, or a network dependency.
export function widget({ cached, fetchMock = () => new Promise(() => {}), origin, referrer, bridge } = {}) {
  const env = environment({ origin, referrer, bridge });
  const nodes = new Map();
  const listeners = new Map();
  const storage = new Map();
  if (cached) storage.set('alchemy-completed-result-v1', JSON.stringify(cached));
  class Node {
    constructor() {
      this.children = []; this.dataset = {}; this.attributes = new Map(); this.hidden = true;
      this.listeners = new Map();
      this.style = { setProperty() {} }; this.offsetWidth = 720; this.offsetHeight = 405;
      this.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
    }
    querySelector(selector) { return node(selector); }
    querySelectorAll() { return []; }
    setAttribute(key, value) { this.attributes.set(key, value); }
    getAttribute(key) { return this.attributes.get(key); }
    removeAttribute(key) { this.attributes.delete(key); delete this[key]; }
    addEventListener(name, listener) { this.listeners.set(name, listener); }
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.append(child); }
    insertAdjacentElement(_position, child) { this.append(child); }
    getBoundingClientRect() { return { left: 0, top: 0, width: 720, height: 405 }; }
    animate() { return { finished: Promise.resolve(), cancel() {} }; }
  }
  function node(selector) { if (!nodes.has(selector)) nodes.set(selector, new Node()); return nodes.get(selector); }
  env.window.addEventListener = (name, listener) => listeners.set(name, listener);
  Object.assign(env.context, {
    document: { referrer: 'http://localhost:3000', getElementById: () => node('#root'), createElement: () => new Node(), createElementNS: () => new Node() },
    fetch: fetchMock, AbortSignal, URLSearchParams, Intl,
    setTimeout: () => 1, clearTimeout() {}, queueMicrotask() {}, matchMedia: () => ({ matches: true }),
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
  });
  const main = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match => match[1]).find(script => script.includes("const root = document.getElementById('ai-alchemy-prototype')"));
  vm.runInContext(widgetAssets.get('/alchemy-catalog.js'), env.context);
  vm.runInContext(main, env.context);
  return { ...env, node, storage, send: listeners.get('message'), click: selector => node(selector).listeners.get('click')?.({ currentTarget: node(selector) }) };
}
