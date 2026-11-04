const assert = require("node:assert/strict");
const test = require("node:test");
const { dashboardClient } = require("../out/dashboard/dashboardClient");
const { defaultDashboardState } = require("../out/dashboard/dashboardState");
const { renderDiagnosticsView } = require("../out/dashboard/diagnosticsView");
const { renderToolsView } = require("../out/dashboard/toolsView");
const { parseWebviewMessage } = require("../out/dashboard/webviewMessages");

test("Tools page exposes integrated serial TX/RX, framing, graph and explicit privacy", () => {
  const state = structuredClone(defaultDashboardState);
  state.environment.serialPort = "/dev/ttyACM0";
  state.environment.baudRate = 115200;
  const html = renderToolsView(state);
  for (const id of ["serialConnectForm", "serialPortSelect", "serialBaudRate", "serialParity", "serialStopBits", "serialSendForm", "serialOutput", "serialGraph"])
    assert.ok(html.includes("id=\"" + id + "\""), id + " should be present");
  assert.match(html, /les données restent en mémoire de session/);
  assert.match(html, /qc1_plot/);
  assert.match(dashboardClient, /serialConnect/);
  assert.match(dashboardClient, /serialSend/);
  assert.match(dashboardClient, /createElementNS/);
  assert.match(dashboardClient, /serialUiLines\.splice/);
  assert.match(dashboardClient, /point\.timeMs/);
  assert.match(dashboardClient, /serialRtsCts/);
});

test("serial bridge accepts a bounded valid configuration and rejects invalid values", () => {
  const valid = parseWebviewMessage({
    type: "serialConnect",
    options: { path: "/dev/ttyACM0", baudRate: 115200, dataBits: 8, parity: "none", stopBits: 1, rtscts: false },
  });
  assert.equal(valid.type, "serialConnect");
  assert.equal(valid.options.path, "/dev/ttyACM0");
  assert.equal(parseWebviewMessage({
    type: "serialConnect",
    options: { path: "/dev/ttyACM0", baudRate: 115200, dataBits: 9, parity: "none", stopBits: 1 },
  }), undefined);
  assert.equal(parseWebviewMessage({ type: "serialSend", text: "AA", mode: "shell", appendNewline: false }), undefined);
  assert.equal(parseWebviewMessage({ type: "serialGraphControl", action: "erase-all" }), undefined);
});

test("Diagnostics page shows bounded operation history and manual guided solutions", () => {
  const state = structuredClone(defaultDashboardState);
  state.operationHistory = [{
    id: "test-entry", project: "lab-f103", occurredAt: "2026-11-04T12:00:00.000Z",
    operation: "Flash", durationMs: 2000, result: "failed", tools: ["ARM GCC", "OpenOCD"],
    backend: "OpenOCD", verification: "failed", error: "Échec à /private/lab/image.elf",
  }];
  state.diagnostic = { code: "QC1-USB-001", level: "error", title: "Permission USB refusée", message: "EACCES sur ST-Link", cause: "Accès système", checkedPath: "--" };
  const html = renderDiagnosticsView(state);
  assert.match(html, /Historique des opérations/);
  assert.match(html, /lab-f103/);
  assert.match(html, /Vérifier l&#39;accès USB/);
  assert.match(html, /règles udev/);
  assert.match(html, /Résumé local borné/);
});
