const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { getDashboardHtml, renderDashboardViews } = require("../out/dashboard/dashboardHtml");
const { renderToolsView } = require("../out/dashboard/toolsView");
const { defaultDashboardState } = require("../out/dashboard/dashboardState");
const { availableProjectCommands } = require("../out/dashboard/buildView");
const { dashboardClient } = require("../out/dashboard/dashboardClient");
const { parseWebviewMessage } = require("../out/dashboard/webviewMessages");
const { normalizeTools } = require("../out/dashboard/managerUiState");
const { buildDiscoveryRoots } = require("../out/dashboard/projectUiState");
const { collectProjectArtifacts } = require("../out/qc1/projectArtifacts");

function stateFor(family, ids) {
  return { ...defaultDashboardState, project: { ...defaultDashboardState.project, projectDetected: true }, projectDiscovery: {
    status: "success", selectedPath: "/firmware", candidates: [], activeCandidate: {
      path: "/firmware", name: "Firmware", family, mcu: family === "STM32F1" ? "STM32F103xB" : "STM32H755xx",
      architecture: ids.length > 1 ? "dual-core" : "single-core", buildSystem: "cmake", confidence: 95,
      cores: ids.map((id) => ({ id, name: id === "cm7" ? "Cortex-M7" : id === "cm4" ? "Cortex-M4" : "Cortex-M3", startupFiles: [], linkerScripts: [] })), evidence: [], missingComponents: [], warnings: [],
    },
  } };
}

test("navigation has five real pages and context actions preserve F1/H755 modes", () => {
  const html = getDashboardHtml(defaultDashboardState);
  for (const id of ["projectPanel", "buildPanel", "toolsPanel", "diagnosticsPanel", "settingsPanel"]) assert.ok(html.includes(`id="${id}"`));
  assert.ok(availableProjectCommands(stateFor("STM32F1", ["cortex-m3"])).includes("debug"));
  assert.equal(availableProjectCommands(stateFor("STM32F1", ["cortex-m3"])).includes("debug-cm7"), false);
  assert.deepEqual(availableProjectCommands(stateFor("STM32H7", ["cm7"])).filter((command) => command.includes("cm")), ["build-cm7", "flash-cm7", "debug-cm7"]);
  assert.deepEqual(availableProjectCommands(stateFor("STM32H7", ["cm4"])).filter((command) => command.includes("cm")), ["build-cm4", "flash-cm4", "debug-cm4"]);
  const dual = availableProjectCommands(stateFor("STM32H7", ["cm7", "cm4"]));
  assert.ok(dual.includes("build") && dual.includes("flash") && dual.includes("debug-cm7") && dual.includes("debug-cm4"));
  assert.equal(dual.includes("debug"), false);
  assert.deepEqual(availableProjectCommands(defaultDashboardState), []);
});

test("project view shows documented H745 project compatibility without changing its MCU identity", () => {
  const state = stateFor("STM32H7", ["cm7", "cm4"]);
  state.projectDiscovery.activeCandidate.mcu = "STM32H745ZITx";
  state.projectDiscovery.activeCandidate.board = "NUCLEO-H745ZI-Q";
  state.projectDiscovery.activeCandidate.compatibleBoards = ["NUCLEO-H755ZI-Q"];
  const html = getDashboardHtml(state);
  assert.match(html, /STM32H745ZITx/);
  assert.match(html, /NUCLEO-H755ZI-Q/);
  assert.match(html, /Carte compatible documentée/);
});

test("all project values are escaped and never interpolated into inline JavaScript", () => {
  const payload = `bad'\" onclick=\"alert(1)\"><img src=x onerror=alert(1)></script><script>evil()</script>`;
  const state = stateFor("STM32F1", ["cortex-m3"]);
  const candidate = state.projectDiscovery.activeCandidate;
  candidate.path = payload; candidate.name = payload; candidate.board = payload;
  candidate.evidence = [{ type: "mcu-define", file: payload, value: payload, weight: 40 }];
  candidate.missingComponents = [{ component: "HAL", severity: "error", message: payload }];
  candidate.warnings = [{ code: payload, severity: "warning", message: payload }];
  state.projectName = payload;
  state.projectDiscovery.candidates = [{ candidate, confidenceLabel: "élevée" }];
  state.recentProjects = [{ path: payload, name: payload }];
  state.diagnostics = [{ code: payload, title: payload, cause: payload, checkedPath: payload, message: payload, level: "error" }];
  const html = getDashboardHtml(state);
  assert.equal(html.includes("<img src=x"), false);
  assert.equal(html.includes("<script>evil()"), false);
  assert.equal(/\sonclick="/.test(html), false);
  assert.ok(html.includes("&lt;img"));
  assert.ok(html.includes("script-src 'nonce-"));
  assert.equal(html.includes("script-src 'unsafe-inline'"), false);
  assert.equal((html.match(/<script /g) || []).length, 1);
  assert.ok(!dashboardClient.includes(payload));
  new vm.Script(dashboardClient);
});

test("message parser validates command and settings shapes and rejects arbitrary actions", () => {
  assert.equal(parseWebviewMessage({ type: "command", command: "rm -rf something" }), undefined);
  assert.equal(parseWebviewMessage({ type: "unknown" }), undefined);
  assert.equal(parseWebviewMessage({ type: "updateProjectSettings", projectPath: "x", buildType: "Debug", cmakePreset: "", autoDiscoverProjects: "yes" }), undefined);
  const message = parseWebviewMessage({ type: "updateProjectSettings", projectPath: "x", buildType: "Debug", cmakePreset: "", discoveryRoots: ["~/Code"], arbitrary: "ignored" });
  assert.equal(message.arbitrary, undefined);
  assert.deepEqual(message.discoveryRoots, ["~/Code"]);
  assert.deepEqual(parseWebviewMessage({ type: "useRecentProject", projectPath: "external" }), { type: "useRecentProject", projectPath: "external" });
  assert.deepEqual(parseWebviewMessage({ type: "selectStlink" }), { type: "selectStlink" });
  assert.equal(parseWebviewMessage({ type: "openDiagnosticFile", index: -1 }), undefined);
});

test("tools dashboard shows per-project probe selection and exposes a selection action", () => {
  const state = structuredClone(defaultDashboardState);
  state.environment.stlinkSelectedProbe = "ST-LINK …3030";
  const html = renderToolsView(state);
  assert.match(html, /Sonde sélectionnée pour ce projet/);
  assert.match(html, /ST-LINK …3030/);
  assert.match(html, /data-action="selectStlink"/);
});

function clientHarness() {
  const nodes = new Map(), events = {}, messages = [], windowEvents = {};
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, { id, dataset: {}, value: "", textContent: "", innerHTML: "", style: {}, checked: false, disabled: false,
      attributes: {}, listeners: {}, classList: { toggle() {} }, setAttribute(key, value) { this.attributes[key] = value; },
      addEventListener(type, callback) { this.listeners[type] = callback; }, appendChild() {}, closest() { return this; } });
    return nodes.get(id);
  }
  const panels = ["projectPanel", "buildPanel", "toolsPanel", "diagnosticsPanel", "settingsPanel"].map(node);
  const tabs = panels.map((panel) => ({ ...node(panel.id + "Tab"), dataset: { panel: panel.id } }));
  let persistent = { activePanel: "toolsPanel" };
  const document = {
    activeElement: null, getElementById: node, createElement: () => node("new"),
    querySelectorAll: (selector) => selector === ".panel" ? panels : selector === "[data-panel]" ? tabs : [],
    querySelector: () => node("track"), addEventListener: (type, callback) => { events[type] = callback; },
  };
  vm.runInNewContext(dashboardClient, { document, window: { addEventListener: (type, callback) => { windowEvents[type] = callback; } },
    acquireVsCodeApi: () => ({ getState: () => persistent, setState: (value) => { persistent = value; }, postMessage: (value) => messages.push(value) }) });
  return { node, events, messages, receive: (data) => windowEvents.message({ data }), persistent: () => persistent };
}

test("client route persists, click messages are mapped, and settings submit is complete", () => {
  const client = clientHarness();
  assert.equal(client.persistent().activePanel, "toolsPanel");
  const button = client.node("button"); button.dataset = { action: "useProject", path: `C:\\Code\\l'app` };
  client.events.click({ target: button });
  assert.equal(client.messages.at(-1).projectPath, `C:\\Code\\l'app`);
  button.dataset = { action: "selectStlink" };
  client.events.click({ target: button });
  assert.equal(client.messages.at(-1).type, "selectStlink");
  button.dataset = { panel: "buildPanel" }; client.events.click({ target: button });
  assert.equal(client.persistent().activePanel, "buildPanel");
  client.node("projectPathInput").value = "~/Code/firmware";
  client.node("buildTypeInput").value = "Release"; client.node("cmakePresetInput").value = "release";
  client.node("baudRateInput").value = "115200"; client.node("discoveryRootsInput").value = "~/Code\n~/Documents/STM32\n";
  client.node("projectSettingsForm").listeners.submit({ preventDefault() {} });
  const message = client.messages.at(-1);
  assert.equal(message.type, "updateProjectSettings");
  assert.equal(message.buildType, "Release");
  assert.equal(message.baudRate, 115200);
  assert.deepEqual(Array.from(message.discoveryRoots), ["~/Code", "~/Documents/STM32"]);
});

test("client host updates preserve terminal output and unsaved settings", () => {
  const client = clientHarness();
  client.receive({ type: "output", lines: ["compiler output"] });
  const output = client.node("output").textContent;
  client.receive({ type: "dashboardState", views: { projectContent: "<h2>Safe host HTML</h2>", output: "bad" }, state: { projectName: "Firmware", lastCommand: "build" } });
  assert.equal(client.node("output").textContent, output);
  assert.equal(client.node("projectContent").innerHTML, "<h2>Safe host HTML</h2>");
  client.node("projectPathInput").value = "unsaved";
  client.events.input({ target: client.node("projectPathInput") });
  client.receive({ type: "settings", settings: { projectPath: "persisted", discoveryRoots: [] } });
  assert.equal(client.node("projectPathInput").value, "unsaved");
});

test("scan roots expand home syntax but never expand into whole-machine scans", () => {
  const roots = buildDiscoveryRoots([path.parse(process.cwd()).root], "", [], ["~", "~/Code"]);
  assert.deepEqual(roots, [path.join(os.homedir(), "Code")]);
});

test("normalizes tools from the existing status without inferring a connected ST-Link", () => {
  const tools = normalizeTools({ compilerOk: true, compilerPath: "/gcc", compilerSource: "PATH", gdbOk: false, cmakeOk: false, ninjaOk: false, makeOk: false, makeGenerator: "", makePath: "Not found", openocdOk: false, stlinkToolOk: true, stlinkPath: "/st-info", debuggerOk: false });
  assert.equal(tools.find((tool) => tool.name === "ST-Link CLI").status, "OK");
  assert.equal(tools.find((tool) => tool.name === "GDB").status, "Manquant");
  assert.equal(tools.find((tool) => tool.name === "Make").status, "Manquant");
  assert.equal(tools.length, 8);
  const view = renderDashboardViews(defaultDashboardState).toolsContent;
  assert.ok(view.includes("Inconnu"));
  assert.ok(!view.includes(">Connecté<"));
});

test("artifact inspection reads existing outputs including separate cores and changes no files", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qc1-artifacts-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cm7 = path.join(root, "CM7", "firmware.elf"), cm4 = path.join(root, "CM4", "firmware.elf");
  fs.mkdirSync(path.dirname(cm7)); fs.mkdirSync(path.dirname(cm4));
  fs.writeFileSync(cm7, "elf7"); fs.writeFileSync(cm4, "elf4");
  fs.writeFileSync(cm7.replace(/elf$/, "bin"), "bin7");
  fs.writeFileSync(path.join(root, "extra.hex"), "hex");
  const custom = path.join(root, "CM4", "CUSTOM.ELF");
  fs.writeFileSync(custom, "customelf");
  const artifacts = await collectProjectArtifacts(root, [{ path: cm7, core: "CM7" }, { path: cm4, core: "CM4" }, { path: custom, core: "CM4" }]);
  assert.ok(artifacts.some((artifact) => artifact.core === "CM7" && artifact.kind === "ELF"));
  assert.ok(artifacts.some((artifact) => artifact.core === "CM4" && artifact.kind === "ELF"));
  assert.ok(artifacts.some((artifact) => artifact.kind === "HEX"));
  assert.ok(artifacts.some((artifact) => artifact.path === custom && artifact.kind === "ELF"));
  assert.equal(artifacts.length, 5);
});
