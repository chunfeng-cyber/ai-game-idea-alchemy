import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const MAX_DRAFT_BYTES = 1024 * 1024;
const copy = value => value == null ? null : JSON.parse(JSON.stringify(value));

// A partially written JSON file must never replace the last recoverable scheme.
export function writeAtomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function validDraft(value) {
  return value?.view === 'draft' && /^[a-zA-Z0-9-]{1,80}$/.test(value.draftId || '')
    && Number.isSafeInteger(value.stateVersion) && value.stateVersion > 0
    && ['image', 'poster'].includes(value.stage) && value.report && typeof value.report === 'object'
    && !Array.isArray(value.report) && typeof value.report.gameName === 'string'
    && Array.isArray(value.materialIds) && typeof value.sourceRequestId === 'string'
    && /^[a-zA-Z0-9-]{1,80}$/.test(value.sourceRequestId)
    && Number.isFinite(Date.parse(value.createdAt)) && Number.isFinite(Date.parse(value.updatedAt));
}

export function createGenerationDraftStore(path) {
  let current = null;
  try {
    if (statSync(path).size <= MAX_DRAFT_BYTES) {
      const saved = JSON.parse(readFileSync(path, 'utf8'));
      if (validDraft(saved)) current = saved;
    }
  } catch { /* Empty or invalid local draft: never advertise it as recoverable. */ }

  const commit = value => {
    if (!validDraft(value) || Buffer.byteLength(JSON.stringify(value)) > MAX_DRAFT_BYTES) {
      throw new Error('创意方案草稿无效或过大，尚未开始生图');
    }
    writeAtomicJson(path, value);
    current = value;
    return copy(current);
  };
  const version = () => Math.max(Date.now(), (current?.stateVersion || 0) + 1);
  return {
    read: () => copy(current),
    matches: (id, sourceVersion) => Boolean(current && current.draftId === id && current.stateVersion === sourceVersion),
    save({ report, materialIds = [], sourceRequestId, provider = 'api', fallbackReason = '' }) {
      const now = new Date().toISOString();
      return commit({
        view: 'draft', draftId: randomUUID(), stateVersion: version(), sourceRequestId,
        createdAt: now, updatedAt: now, stage: 'image', provider, fallbackReason,
        report: copy(report), materialIds: materialIds.filter(id => typeof id === 'string').slice(0, 30), error: '',
      });
    },
    update(id, { stage, imageUrl, provider, fallbackReason, error } = {}) {
      if (!current || current.draftId !== id) throw new Error('当前草稿已更新，请刷新后继续生成海报');
      const next = { ...current, stateVersion: version(), updatedAt: new Date().toISOString() };
      for (const [key, value] of Object.entries({ stage, imageUrl, provider, fallbackReason, error })) {
        if (value !== undefined) next[key] = value;
      }
      return commit(next);
    },
    clear(id) {
      if (!current || current.draftId !== id) return false;
      rmSync(path, { force: true });
      current = null;
      return true;
    },
  };
}
