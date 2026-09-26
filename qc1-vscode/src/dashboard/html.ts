/** Never interpolate project content into JavaScript or event handlers. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[character] || character));
}
export function row(label: string, value: unknown): string {
  return `<div class="row"><span class="muted">${escapeHtml(label)}</span><span class="value">${escapeHtml(value || "—")}</span></div>`;
}
export function action(type: string, label: string, data = "", disabled = false): string {
  return `<button data-action="${escapeHtml(type)}" ${data} ${disabled ? "disabled" : ""}>${escapeHtml(label)}</button>`;
}
export function pathData(value: string): string { return `data-path="${escapeHtml(value)}"`; }
export function compactPath(value: string, maxLength = 65): string {
  return value.length > maxLength ? `…${value.slice(-maxLength)}` : value;
}
