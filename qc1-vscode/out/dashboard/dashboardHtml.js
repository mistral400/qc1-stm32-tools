"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderDashboardViews = renderDashboardViews;
exports.getDashboardHtml = getDashboardHtml;
/** Small WebView shell; page renderers and client behavior are independent modules. */
const crypto_1 = require("crypto");
const html_1 = require("./html");
const projectView_1 = require("./projectView");
const buildView_1 = require("./buildView");
const toolsView_1 = require("./toolsView");
const diagnosticsView_1 = require("./diagnosticsView");
const settingsView_1 = require("./settingsView");
const dashboardStyles_1 = require("./dashboardStyles");
const dashboardClient_1 = require("./dashboardClient");
function renderDashboardViews(state) {
    return {
        projectContent: (0, projectView_1.renderProjectView)(state), buildContent: (0, buildView_1.renderBuildView)(state),
        toolsContent: (0, toolsView_1.renderToolsView)(state), diagnosticsContent: (0, diagnosticsView_1.renderDiagnosticsView)(state),
    };
}
function getDashboardHtml(state) {
    const nonce = (0, crypto_1.randomBytes)(18).toString("base64");
    const views = renderDashboardViews(state);
    const routes = [
        ["projectPanel", "Projet"], ["buildPanel", "Build / Flash / Debug"], ["toolsPanel", "Outils"],
        ["diagnosticsPanel", "Diagnostics"], ["settingsPanel", "Réglages"],
    ];
    return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';"><style>${dashboardStyles_1.dashboardStyles}</style></head>
    <body><header><div><h1>QC1 STM32 <span class="version">v${(0, html_1.escapeHtml)(state.environment.extensionVersion)}</span></h1><div class="muted"><span id="heroProject">${(0, html_1.escapeHtml)(state.projectName)}</span> · <span id="heroLastCommand">${(0, html_1.escapeHtml)(state.lastCommand)}</span></div></div><span id="heroStatus" role="status">Prêt</span></header>
    <nav role="tablist" aria-label="QC1">${routes.map(([id, label], index) => `<button role="tab" data-panel="${id}" aria-controls="${id}" aria-selected="${index === 0}">${label}</button>`).join("")}</nav>
    <main><section id="projectPanel" class="panel active" role="tabpanel"><div id="projectContent">${views.projectContent}</div></section>
    <section id="buildPanel" class="panel" role="tabpanel"><div id="buildContent">${views.buildContent}</div>
      <section class="card"><h2>Terminal QC1</h2><p class="muted"><span id="terminalProject">${(0, html_1.escapeHtml)(state.projectName)}</span> · <span id="terminalLastCommand">${(0, html_1.escapeHtml)(state.lastCommand)}</span></p>
      <div class="actions">${(0, html_1.action)("clear", "Effacer")}${(0, html_1.action)("copyOutput", "Copier")}${(0, html_1.action)("saveLog", "Enregistrer le log")}${(0, html_1.action)("command", "OutputChannel", 'data-command="openLogs"')}</div><div id="output" class="terminal-output">QC1 prêt.</div>
      <p>Erreurs <span id="analysisErrors">0</span> · Warnings <span id="analysisWarnings">0</span></p><p id="analysisExplanation" class="muted">Aucune sortie analysée.</p><div id="analysisList"></div></section></section>
    <section id="toolsPanel" class="panel" role="tabpanel"><div id="toolsContent">${views.toolsContent}</div></section>
    <section id="diagnosticsPanel" class="panel" role="tabpanel"><div id="diagnosticsContent">${views.diagnosticsContent}</div></section>
    <section id="settingsPanel" class="panel" role="tabpanel">${(0, settingsView_1.renderSettingsView)()}</section></main>
    <script nonce="${nonce}">${dashboardClient_1.dashboardClient}</script></body></html>`;
}
//# sourceMappingURL=dashboardHtml.js.map