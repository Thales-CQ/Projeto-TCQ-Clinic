export function setCepActivationDraft(configuration, isActive) {
  return { ...configuration, is_active: Boolean(isActive) };
}
