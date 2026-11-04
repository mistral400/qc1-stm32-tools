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

export type DashboardPanelId = "projectPanel" | "buildPanel" | "toolsPanel" | "diagnosticsPanel" | "settingsPanel";

export function renderDashboardViews(state: DashboardState): Record<string, string> {
  return {
    projectContent: renderProjectView(state), buildContent: renderBuildView(state),
    toolsContent: renderToolsView(state), diagnosticsContent: renderDiagnosticsView(state),
  };
}
export function getDashboardHtml(state: DashboardState, initialPanel: DashboardPanelId = "projectPanel"): string {
  const nonce = randomBytes(18).toString("base64");
  const views = renderDashboardViews(state);
  const routes = [
    { panel: "projectPanel", tab: "projectTab", label: "Projet", compact: "Projet" },
    { panel: "buildPanel", tab: "buildTab", label: "Build / Flash / Debug", compact: "Build" },
    { panel: "toolsPanel", tab: "toolsTab", label: "Outils", compact: "Outils" },
    { panel: "diagnosticsPanel", tab: "diagnosticsTab", label: "Diagnostics", compact: "Diag." },
    { panel: "settingsPanel", tab: "settingsTab", label: "Réglages", compact: "Régl." },
  ];
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';"><style>${dashboardStyles}</style></head>
    <body data-initial-panel="${initialPanel}"><header class="app-header"><div class="header-copy"><h1>QC1 STM32 <span class="version">v${escapeHtml(state.environment.extensionVersion)}</span></h1><div class="muted header-context"><span id="heroProject">${escapeHtml(state.projectName)}</span> · <span id="heroLastCommand">${escapeHtml(state.lastCommand)}</span></div></div><span id="heroStatus" class="status-pill" role="status">Prêt</span></header>
    <nav class="route-nav" role="tablist" aria-label="Navigation QC1" aria-orientation="horizontal">${routes.map(({ panel, tab, label, compact }) => `<button id="${tab}" type="button" role="tab" data-panel="${panel}" aria-label="${label}" title="${label}" aria-controls="${panel}" aria-selected="${panel === initialPanel}" tabindex="${panel === initialPanel ? 0 : -1}"><span class="tab-label-full">${label}</span><span class="tab-label-compact">${compact}</span></button>`).join("")}</nav>
    <main><section id="projectPanel" class="panel${initialPanel === "projectPanel" ? " active" : ""}" role="tabpanel" aria-labelledby="projectTab" tabindex="0" aria-hidden="${initialPanel !== "projectPanel"}" ${initialPanel !== "projectPanel" ? "hidden" : ""}><div id="projectContent">${views.projectContent}</div></section>
    <section id="buildPanel" class="panel${initialPanel === "buildPanel" ? " active" : ""}" role="tabpanel" aria-labelledby="buildTab" tabindex="0" aria-hidden="${initialPanel !== "buildPanel"}" ${initialPanel !== "buildPanel" ? "hidden" : ""}><div id="buildContent">${views.buildContent}</div>
      <section class="card"><h2>Terminal QC1</h2><p class="muted"><span id="terminalProject">${escapeHtml(state.projectName)}</span> · <span id="terminalLastCommand">${escapeHtml(state.lastCommand)}</span></p>
      <div class="actions">${action("clear", "Effacer")}${action("copyOutput", "Copier")}${action("saveLog", "Enregistrer le log")}${action("command", "OutputChannel", 'data-command="openLogs"')}</div><div id="output" class="terminal-output">QC1 prêt.</div>
      <p>Erreurs <span id="analysisErrors">0</span> · Warnings <span id="analysisWarnings">0</span></p><p id="analysisExplanation" class="muted">Aucune sortie analysée.</p><div id="analysisList"></div></section></section>
    <section id="toolsPanel" class="panel${initialPanel === "toolsPanel" ? " active" : ""}" role="tabpanel" aria-labelledby="toolsTab" tabindex="0" aria-hidden="${initialPanel !== "toolsPanel"}" ${initialPanel !== "toolsPanel" ? "hidden" : ""}><div id="toolsContent">${views.toolsContent}</div></section>
    <section id="diagnosticsPanel" class="panel${initialPanel === "diagnosticsPanel" ? " active" : ""}" role="tabpanel" aria-labelledby="diagnosticsTab" tabindex="0" aria-hidden="${initialPanel !== "diagnosticsPanel"}" ${initialPanel !== "diagnosticsPanel" ? "hidden" : ""}><div id="diagnosticsContent">${views.diagnosticsContent}</div></section>
    <section id="settingsPanel" class="panel${initialPanel === "settingsPanel" ? " active" : ""}" role="tabpanel" aria-labelledby="settingsTab" tabindex="0" aria-hidden="${initialPanel !== "settingsPanel"}" ${initialPanel !== "settingsPanel" ? "hidden" : ""}>${renderSettingsView()}</section></main>
    <script nonce="${nonce}">${dashboardClient}</script></body></html>`;
}
