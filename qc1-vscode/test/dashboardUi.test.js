const assert = require("node:assert/strict");
const test = require("node:test");

const { dashboardClient } = require("../out/dashboard/dashboardClient");
const { getDashboardHtml } = require("../out/dashboard/dashboardHtml");
const { renderBuildView } = require("../out/dashboard/buildView");
const { dashboardStyles } = require("../out/dashboard/dashboardStyles");
const { defaultDashboardState } = require("../out/dashboard/dashboardState");

function stateFor(family) {
  const state = structuredClone(defaultDashboardState);
  state.project.projectDetected = true;
  state.project.cmakeProjectReady = true;
  state.project.targetFamily = family;
  return state;
}

test("dashboard navigation exposes five labelled tabs and hides inactive panels accessibly", () => {
  const html = getDashboardHtml(defaultDashboardState);
  assert.match(html, /role="tablist" aria-label="Navigation QC1"/);
  for (const [tab, panel] of [
    ["projectTab", "projectPanel"], ["buildTab", "buildPanel"], ["toolsTab", "toolsPanel"],
    ["diagnosticsTab", "diagnosticsPanel"], ["settingsTab", "settingsPanel"],
  ]) {
    assert.match(html, new RegExp(`id="${tab}"[^>]*aria-controls="${panel}"`));
    assert.match(html, new RegExp(`id="${panel}"[^>]*aria-labelledby="${tab}"`));
  }
  assert.match(html, /id="buildPanel"[^>]*aria-hidden="true" hidden/);
  assert.match(dashboardClient, /event\.key==='ArrowRight'/);
  assert.match(dashboardClient, /event\.key==='Home'/);
});

test("editor dashboard starts on the requested page and can be navigated by the host", () => {
  const html = getDashboardHtml(defaultDashboardState, "diagnosticsPanel");
  assert.match(html, /data-initial-panel="diagnosticsPanel"/);
  assert.match(html, /id="diagnosticsTab"[^>]*aria-selected="true"[^>]*tabindex="0"/);
  assert.match(html, /id="diagnosticsPanel"[^>]*aria-hidden="false"(?! hidden)/);
  assert.match(dashboardClient, /msg\.type==='navigate' && routes\.includes\(msg\.panel\)/);
  assert.match(dashboardClient, /msg\.type==='outputSnapshot'/);
});

test("F1 build actions distinguish the primary build and keep maintenance actions advanced", () => {
  const html = renderBuildView(stateFor("STM32F1"));
  assert.match(html, /class="action-primary" data-action="command" data-command="build"/);
  assert.match(html, /class="action-secondary" data-action="command" data-command="flash"/);
  assert.match(html, /<summary>Actions avancées<\/summary>/);
  assert.match(html, /class="action-quiet" data-action="command" data-command="clean"/);
  assert.match(html, /class="action-quiet" data-action="command" data-command="rebuild"/);
});

test("build, programming and verification results retain independent status styling", () => {
  const state = stateFor("STM32F1");
  state.operations.build = { status: "success", message: "Compilation terminée" };
  state.operations.programming = { status: "failed", message: "ST-Link absent" };
  const html = renderBuildView(state);
  assert.match(html, /Résultat Build<\/span><span class="value operation-state success">Réussi · Compilation terminée/);
  assert.match(html, /Programmation<\/span><span class="value operation-state error">Échoué · ST-Link absent/);
});

test("dual-core H7 labels the aggregate actions and retains per-core actions", () => {
  const state = stateFor("STM32H7");
  state.projectDiscovery.activeCandidate = {
    family: "STM32H7",
    cores: [{ id: "cm7" }, { id: "cm4" }],
  };
  const html = renderBuildView(state);
  assert.match(html, /data-command="build"[^>]*>Build tous les cœurs/);
  assert.match(html, /data-command="flash"[^>]*>Flash tous les cœurs/);
  for (const command of ["build-cm7", "build-cm4", "flash-cm7", "flash-cm4", "debug-cm7", "debug-cm4"])
    assert.ok(html.includes(`data-command="${command}"`), `${command} remains available`);
});

test("single-core H7 keeps its flash and debug actions in the visible secondary group", () => {
  const state = stateFor("STM32H7");
  state.projectDiscovery.activeCandidate = { family: "STM32H7", cores: [{ id: "cm7" }] };
  const html = renderBuildView(state);
  assert.match(html, /class="action-primary" data-action="command" data-command="build-cm7"/);
  assert.match(html, /class="action-secondary" data-action="command" data-command="flash-cm7"/);
  assert.match(html, /class="action-secondary" data-action="command" data-command="debug-cm7"/);
});

test("dashboard styles define compact, reduced-motion and forced-colors behavior", () => {
  assert.match(dashboardStyles, /max-width: 400px/);
  assert.match(dashboardStyles, /max-width: 600px/);
  assert.match(dashboardStyles, /prefers-reduced-motion: reduce/);
  assert.match(dashboardStyles, /forced-colors: active/);
  assert.match(dashboardStyles, /--vscode-contrastBorder/);
});
