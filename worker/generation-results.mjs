import { readFileSync, statSync } from 'node:fs';
import { writeAtomicJson } from './generation-draft.mjs';

const validResult = value => value?.view === 'report' && value.report && typeof value.report === 'object'
  && !Array.isArray(value.report) && typeof value.imageUrl === 'string' && Boolean(value.imageUrl);

// One publication boundary owns the completed result and its durable file.
// Layout migration is a read that may become a write, so it must compare the
// snapshot after its asynchronous work before committing anything.
export function createCompletedResultStore({ path, onPublish = () => {} }) {
  let current = null;
  try {
    if (statSync(path).size <= 2 * 1024 * 1024) {
      const saved = JSON.parse(readFileSync(path, 'utf8'));
      if (validResult(saved)) current = saved;
    }
  } catch { /* No completed result yet, or an invalid/partial legacy file. */ }
  const publish = result => {
    if (!validResult(result)) throw new Error('完成的创意海报数据无效');
    writeAtomicJson(path, result);
    current = result;
    onPublish(current);
    return current;
  };
  return {
    read: () => current,
    publish,
    async restoreLayout(render) {
      const snapshot = current;
      if (!snapshot) return { view: 'empty' };
      let rendered;
      try { rendered = await render(snapshot); }
      catch (error) {
        // An obsolete migration failure should not hide a newly completed job.
        if (current !== snapshot) return current;
        throw error;
      }
      if (current === snapshot) publish(rendered);
      return current;
    },
  };
}
