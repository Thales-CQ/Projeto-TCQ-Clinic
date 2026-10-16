let integrationActive = null;
const listeners = new Set();

export function getCepIntegrationStatus() {
  return integrationActive;
}

export function publishCepIntegrationStatus(value) {
  const nextStatus = typeof value === "boolean" ? value : null;
  if (integrationActive === nextStatus) return;
  integrationActive = nextStatus;
  for (const listener of listeners) listener(integrationActive);
}

export function subscribeCepIntegrationStatus(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
