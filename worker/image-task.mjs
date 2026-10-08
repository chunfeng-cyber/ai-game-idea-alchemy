// Shared by first generation, saved-draft continuation and completed-result
// redraw. Once a report exists, every fallback works on that same report.
export async function runImageTask(services) {
  let fallbackReason = '';
  if (services.apiEnabled !== false) {
    try {
      services.onStage?.({ stage: 'image', provider: 'api', fallbackReason: '' });
      await services.generateApi();
      services.onApiSuccess?.();
      return { provider: 'api', fallbackReason: '' };
    } catch (error) {
      fallbackReason = services.onApiError?.(error) || String(error?.message || error);
      if (!services.allowFallback) throw new Error(fallbackReason, { cause: error });
    }
  }
  services.onStage?.({ stage: 'fallback', provider: 'codex', fallbackReason });
  await services.generateFallback();
  return { provider: 'codex', fallbackReason };
}
