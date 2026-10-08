export class HttpInputError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function readJson(request, { limit = 100000, timeoutMs = 10000 } = {}) {
  const contentType = String(request.headers['content-type'] || '');
  if (!/^application\/json(?:\s*;|\s*$)/i.test(contentType)) {
    return Promise.reject(new HttpInputError(415, '请求须使用 application/json'));
  }
  const declaredLength = request.headers['content-length'];
  if (declaredLength !== undefined && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > limit)) {
    return Promise.reject(new HttpInputError(413, '请求内容过大或长度无效'));
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    const cleanup = () => {
      clearTimeout(timer);
      request.off('data', onData); request.off('end', onEnd); request.off('error', onError); request.off('aborted', onAborted);
    };
    const fail = error => { cleanup(); reject(error); };
    const onError = () => fail(new HttpInputError(400, '请求读取失败'));
    const onAborted = () => fail(new HttpInputError(400, '请求已中断'));
    const onData = chunk => {
      length += chunk.length;
      if (length > limit) { fail(new HttpInputError(413, '请求内容过大')); request.pause(); return; }
      chunks.push(chunk);
    };
    const onEnd = () => {
      cleanup();
      try {
        const value = JSON.parse(Buffer.concat(chunks, length).toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
        resolve(value);
      } catch { reject(new HttpInputError(400, 'JSON 请求格式无效')); }
    };
    const timer = setTimeout(() => { fail(new HttpInputError(408, '请求内容接收超时')); request.pause(); }, timeoutMs);
    request.on('data', onData); request.once('end', onEnd); request.once('error', onError); request.once('aborted', onAborted);
  });
}
