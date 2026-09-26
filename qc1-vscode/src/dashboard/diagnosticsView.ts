import type { DashboardState } from "./dashboardState";
import { action, escapeHtml, row } from "./html";
export function renderDiagnosticsView(state: DashboardState): string {
  const diagnostics = [state.diagnostic, ...state.diagnostics].filter((item, index, all) => all.findIndex((other) => other.code === item.code && other.checkedPath === item.checkedPath) === index);
  return `<section class="card"><h2>Diagnostics QC1</h2><div class="actions">${action("command", "Diagnostiquer", 'data-command="status"')}${action("createDiagnosticReport", "Rapport complet")}${action("copyDiagnostic", "Copier")}${action("rescanProjects", "Rescanner")}</div>
    ${diagnostics.map((diagnostic) => `<article class="diagnostic ${escapeHtml(diagnostic.level)}"><div class="candidate-head"><strong>${escapeHtml(diagnostic.code)}</strong><span class="badge">${escapeHtml(diagnostic.level)}</span></div><h3>${escapeHtml(diagnostic.title)}</h3><p>${escapeHtml(diagnostic.message)}</p>${row("Cause", diagnostic.cause)}<div class="path">${escapeHtml(diagnostic.checkedPath)}</div>${diagnostic.checkedPath && diagnostic.checkedPath !== "--" && state.diagnostics.indexOf(diagnostic) >= 0 ? action("openDiagnosticFile", "Ouvrir le fichier / dossier concerné", `data-index="${state.diagnostics.indexOf(diagnostic)}"`) : ""}</article>`).join("")}
    <p class="muted">Aucune réparation automatique du linker, startup, code source, HAL, Makefile ou CMake.</p></section>`;
}
