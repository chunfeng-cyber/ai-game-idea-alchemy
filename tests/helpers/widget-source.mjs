import { readFile } from 'node:fs/promises';

export const sourceHtml = await readFile(new URL('../../public/alchemy-source.html', import.meta.url), 'utf8');
export const widgetAssets = new Map(await Promise.all([
  'alchemy-ui.css', 'alchemy-model-settings.css', 'alchemy-security.js',
  'alchemy-art-assets.js', 'alchemy-catalog.js', 'alchemy-app.js', 'alchemy-model-settings.js',
].map(async name => [`/${name}`, await readFile(new URL(`../../public/${name}`, import.meta.url), 'utf8')])));

// Test the scripts users load, retaining IDs and dependency order after the split.
export const html = sourceHtml
  .replace(/<link\b[^>]*href="([^"]+)"[^>]*>/g, (tag, name) => widgetAssets.has(name.split(/[?#]/, 1)[0]) ? `<style>${widgetAssets.get(name.split(/[?#]/, 1)[0])}</style>` : tag)
  .replace(/<script\b([^>]*?)\bsrc="([^"]+)"([^>]*)>\s*<\/script>/g, (tag, before, name, after) => widgetAssets.has(name.split(/[?#]/, 1)[0]) ? `<script${before}${after}>${widgetAssets.get(name.split(/[?#]/, 1)[0])}</script>` : tag);
