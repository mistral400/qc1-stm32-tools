/** Small WebView shell; page renderers and client behavior are independent modules. */
import { randomBytes } from "crypto";
import type { DashboardState } from "./dashboardState";
import { escapeHtml, action } from "./html";
import { renderProjectView } from "./projectView";
import { renderBuildView } from "./buildView";
import { renderToolsView } from "./toolsView";
import { renderDiagnosticsView } from "./diagnosticsView";
import { renderSettingsView } from "./settingsView";
import { dashboardStyles } from "./dashboardStyles";
import { dashboardClient } from "./dashboardClient";

export function renderDashboardViews(state: DashboardState): Record<string, string> {
  return {
    projectContent: renderProjectView(state), buildContent: renderBuildView(state),
    toolsContent: renderToolsView(state), diagnosticsContent: renderDiagnosticsView(state),
  };
}
export function getDashboardHtml(state: DashboardState): string {
  const nonce = randomBytes(18).toString("base64");
  const views = renderDashboardViews(state);
  const routes = [
    ["projectPanel", "Projet"], ["buildPanel", "Build / Flash / Debug"], ["toolsPanel", "Outils"],
    ["diagnosticsPanel", "Diagnostics"], ["settingsPanel", "Réglages"],
  ];
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';"><style>${dashboardStyles}</style></head>
    <body><header><div><h1>QC1 STM32 <span class="version">v${escapeHtml(state.environment.extensionVersion)}</span></h1><div class="muted"><span id="heroProject">${escapeHtml(state.projectName)}</span> · <span id="heroLastCommand">${escapeHtml(state.lastCommand)}</span></div></div><span id="heroStatus" role="status">Prêt</span></header>
    <nav role="tablist" aria-label="QC1">${routes.map(([id, label], index) => `<button role="tab" data-panel="${id}" aria-controls="${id}" aria-selected="${index === 0}">${label}</button>`).join("")}</nav>
    <main><section id="projectPanel" class="panel active" role="tabpanel"><div id="projectContent">${views.projectContent}</div></section>
    <section id="buildPanel" class="panel" role="tabpanel"><div id="buildContent">${views.buildContent}</div>
      <section class="card"><h2>Terminal QC1</h2><p class="muted"><span id="terminalProject">${escapeHtml(state.projectName)}</span> · <span id="terminalLastCommand">${escapeHtml(state.lastCommand)}</span></p>
      <div class="actions">${action("clear", "Effacer")}${action("copyOutput", "Copier")}${action("saveLog", "Enregistrer le log")}${action("command", "OutputChannel", 'data-command="openLogs"')}</div><div id="output" class="terminal-output">QC1 prêt.</div>
      <p>Erreurs <span id="analysisErrors">0</span> · Warnings <span id="analysisWarnings">0</span></p><p id="analysisExplanation" class="muted">Aucune sortie analysée.</p><div id="analysisList"></div></section></section>
    <section id="toolsPanel" class="panel" role="tabpanel"><div id="toolsContent">${views.toolsContent}</div></section>
    <section id="diagnosticsPanel" class="panel" role="tabpanel"><div id="diagnosticsContent">${views.diagnosticsContent}</div></section>
    <section id="settingsPanel" class="panel" role="tabpanel">${renderSettingsView()}</section></main>
    <script nonce="${nonce}">${dashboardClient}</script></body></html>`;
}
