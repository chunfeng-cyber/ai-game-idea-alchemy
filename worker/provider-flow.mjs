import { runImageTask } from './image-task.mjs';

// Keep the working image API when only the text API is unavailable.
export async function runProviderFlow(services) {
  const stage = (name, provider, message, fallbackReason = '') => services.onStage?.({ stage: name, provider, message, fallbackReason });
  const recordError = (kind, error) => {
    const reason = services.onApiError?.(kind, error) || String(error?.message || error);
    return reason;
  };
  const fullFallback = async (reason) => {
    if (!services.allowFallback) throw new Error(reason);
    stage('fallback', 'codex', '备用服务正在生成方案和参考图', reason);
    const result = await services.generateCodexFull();
    return { ...result, provider: 'codex-fallback', fallbackReason: reason };
  };
  let models;
  try {
    stage('models', 'api', '正在连接生成服务');
    models = await services.resolveModels();
  } catch (error) {
    return fullFallback(recordError('models', error));
  }
  let draft;
  let fallbackReason = '';
  try {
    stage('report', 'api', '正在生成创意方案');
    draft = await services.generateApiReport(models.chatModel);
    services.onChatSuccess?.();
  } catch (error) {
    fallbackReason = recordError('chat', error);
    if (!services.allowFallback) throw new Error(fallbackReason, { cause: error });
    stage('report', 'codex', '文本服务暂不可用，备用服务正在生成方案', fallbackReason);
    // If this fails, return the error instead of repeating an entire slow job.
    draft = await services.generateCodexReport();
  }
  // Persist the checked report before either image service can incur a charge.
  await services.onDraft?.(draft, { provider: fallbackReason ? 'codex-report-api-image' : 'api', fallbackReason });
  const image = await runImageTask({
    allowFallback: services.allowFallback,
    generateApi: () => services.generateApiImage(draft.imagePrompt, models.imageModel),
    generateFallback: () => services.generateCodexImage(draft.imagePrompt),
    onApiSuccess: services.onImageSuccess,
    onApiError: error => recordError('image', error),
    onStage: status => stage(status.stage, status.provider,
      status.provider === 'api' ? '方案已生成，正在绘制参考图' : '备用服务正在绘制同一方案的参考图',
      [fallbackReason, status.fallbackReason].filter(Boolean).join('；')),
  });
  fallbackReason = [fallbackReason, image.fallbackReason].filter(Boolean).join('；');
  if (image.provider === 'codex') return { report: draft.report, provider: 'codex-image-fallback', fallbackReason };
  return { report: draft.report, provider: fallbackReason ? 'codex-report-api-image' : 'api', fallbackReason };
}
