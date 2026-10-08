import { createHash } from 'node:crypto';
import { lstat, readdir, realpath, unlink } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const GENERATED_NAME = /^(?:alchemy-|card-alchemy-|poster-v\d+-alchemy-)[a-zA-Z0-9_-]+\.png$/u;
const DAY = 86_400_000;

function referencedNames(values) {
  const names = new Set();
  for (const value of values || []) {
    for (const field of ['imageUrl', 'posterUrl', 'cardUrl']) {
      try {
        const url = new URL(value?.[field], 'http://localhost:3000');
        const match = /^\/generated\/([a-zA-Z0-9_-]+\.png)$/u.exec(url.pathname);
        if (match) names.add(match[1]);
      } catch { /* Unrelated references cannot select filesystem paths. */ }
    }
  }
  return names;
}

/** Cleanup is explicit and previewed. Never follows symlinks or removes current output/configuration. */
export function createRetentionManager({ generatedDir, references = () => [], retentionDays = 30, now = Date.now }) {
  const directory = resolve(generatedDir);
  const days = Number(retentionDays);
  if (!Number.isInteger(days) || days < 1 || days > 3650) throw new Error('图片保留天数必须为 1–3650 的整数');
  let running = false;
  const scan = async () => {
    const protectedNames = referencedNames(references());
    const entries = [];
    let keptReferenced = 0;
    let root;
    try { root = await realpath(directory); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (const entry of root ? await readdir(directory, { withFileTypes: true }) : []) {
      if (!entry.isFile() || !GENERATED_NAME.test(entry.name)) continue;
      const path = resolve(directory, entry.name);
      if (!path.startsWith(directory + sep)) throw new Error('图片清理路径越界');
      if (protectedNames.has(entry.name)) { keptReferenced += 1; continue; }
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.mtimeMs > now() - days * DAY) continue;
      if (await realpath(path) !== resolve(root, entry.name)) continue;
      entries.push({ name: entry.name, size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino, dev: stat.dev });
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    const planToken = createHash('sha256').update(JSON.stringify({ days, root, entries, protected: [...protectedNames].sort() })).digest('hex');
    return { entries, planToken, keptReferenced };
  };
  const publicPlan = plan => ({ policy: { mode: 'manual', retentionDays: days }, planToken: plan.planToken,
    candidateFiles: plan.entries.length, candidateBytes: plan.entries.reduce((total, entry) => total + entry.size, 0),
    keptReferenced: plan.keptReferenced });
  return {
    preview: async () => publicPlan(await scan()),
    async cleanup(planToken) {
      if (running) throw Object.assign(new Error('图片清理正在进行'), { status: 409 });
      running = true;
      try {
        const plan = await scan();
        if (!/^[a-f0-9]{64}$/u.test(planToken || '') || planToken !== plan.planToken) {
          throw Object.assign(new Error('图片清理预览已变化，请重新查看并确认'), { status: 409 });
        }
        let removedFiles = 0;
        let removedBytes = 0;
        for (const entry of plan.entries) {
          const path = resolve(directory, entry.name);
          const stat = await lstat(path);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== entry.size || stat.mtimeMs !== entry.mtimeMs
            || stat.ino !== entry.ino || stat.dev !== entry.dev || referencedNames(references()).has(entry.name)) continue;
          if (await realpath(path) !== resolve(await realpath(directory), entry.name)) continue;
          await unlink(path);
          removedFiles += 1;
          removedBytes += entry.size;
        }
        return { removedFiles, removedBytes, keptReferenced: plan.keptReferenced };
      } finally { running = false; }
    },
  };
}
