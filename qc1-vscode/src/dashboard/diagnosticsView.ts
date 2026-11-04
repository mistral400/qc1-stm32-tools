import type { DashboardState } from "./dashboardState";
import { action, escapeHtml, row } from "./html";
import { getDiagnosticGuidance } from "../qc1/diagnosticGuidance";

export function renderDiagnosticsView(state: DashboardState): string {
  const diagnostics = [state.diagnostic, ...state.diagnostics].filter((item, index, all) => all.findIndex((other) => other.code === item.code && other.checkedPath === item.checkedPath) === index);
  const diagnosticCards = diagnostics.map((diagnostic) => {
    const guidance = getDiagnosticGuidance(diagnostic);
    const suggestions = guidance.map((item) => `<details class="guided-solution"><summary>${escapeHtml(item.title)}</summary><ol>${item.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol></details>`).join("");
    return `<article class="diagnostic ${escapeHtml(diagnostic.level)}"><div class="candidate-head"><strong>${escapeHtml(diagnostic.code)}</strong><span class="badge">${escapeHtml(diagnostic.level)}</span></div><h3>${escapeHtml(diagnostic.title)}</h3><p>${escapeHtml(diagnostic.message)}</p>${row("Cause", diagnostic.cause)}<div class="path">${escapeHtml(diagnostic.checkedPath)}</div>${suggestions}${diagnostic.checkedPath && diagnostic.checkedPath !== "--" && state.diagnostics.indexOf(diagnostic) >= 0 ? action("openDiagnosticFile", "Ouvrir le fichier / dossier concerné", `data-index="${state.diagnostics.indexOf(diagnostic)}"`) : ""}</article>`;
  }).join("");
  const history = state.operationHistory || [];
  const operationHistory = history.length ? history.map((entry) => `<article class="operation-history-item"><div class="candidate-head"><strong>${escapeHtml(entry.operation)} · ${escapeHtml(entry.project)}</strong><span class="badge ${entry.result === "failed" ? "error" : entry.result === "success" ? "success" : "warning"}">${escapeHtml(entry.result)}</span></div><p class="muted">${escapeHtml(new Date(entry.occurredAt).toLocaleString())} · ${Math.round(entry.durationMs / 100) / 10} s · ${escapeHtml(entry.tools.join(", ") || "Outils inconnus")}</p><p>Backend : ${escapeHtml(entry.backend || "—")} · Vérification : ${escapeHtml(entry.verification || "—")}</p>${entry.error ? `<p class="error">${escapeHtml(entry.error)}</p>` : ""}</article>`).join("") : `<p class="muted">Aucune opération dans cette session.</p>`;
  return `<section class="card"><h2>Diagnostics QC1</h2><div class="actions">${action("command", "Diagnostiquer", 'data-command="status"')}${action("createDiagnosticReport", "Rapport complet")}${action("copyDiagnostic", "Copier")}${action("rescanProjects", "Rescanner")}</div>
    ${diagnosticCards}
    <p class="muted">Les solutions proposées sont des vérifications manuelles; QC1 ne répare pas automatiquement le linker, startup, code source, HAL, Makefile ou CMake.</p></section>
    <section class="card"><div class="section-heading"><h2>Historique des opérations</h2>${history.length ? action("clearOperationHistory", "Effacer l'historique", "", false, "quiet") : ""}</div><p class="muted">Résumé local borné; chemins complets, données UART, numéros de sonde et journaux bruts ne sont pas retenus.</p>${operationHistory}</section>`;
}
