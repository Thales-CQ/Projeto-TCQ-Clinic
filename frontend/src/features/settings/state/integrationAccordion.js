export function toggleExpandedPanel(current, panelId) {
  return { ...current, [panelId]: !current[panelId] };
}
