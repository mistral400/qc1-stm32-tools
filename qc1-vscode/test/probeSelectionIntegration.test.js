const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");
const { PROBE_SELECTION_STORAGE_KEY, projectProbeSelectionKey } = require("../out/qc1/probeSelection");

test("probe selection is explicit and remains isolated when switching F103/H755 projects", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qc1-probe-selection-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const f103 = path.join(root, "BluePill-F103");
  const h755 = path.join(root, "NUCLEO-H755ZI-Q");
  fs.mkdirSync(f103); fs.mkdirSync(h755);
  fs.writeFileSync(path.join(f103, "CMakeLists.txt"), "project(f103)\nadd_executable(firmware main.c)\ntarget_compile_definitions(firmware PRIVATE STM32F103xB)\n");
  fs.writeFileSync(path.join(f103, "main.c"), "int main(void) { return 0; }\n");
  fs.writeFileSync(path.join(h755, "CMakeLists.txt"), "project(h755)\nadd_executable(firmware_CM7 main.c)\ntarget_compile_definitions(firmware_CM7 PRIVATE STM32H755xx CORE_CM7)\n");
  fs.writeFileSync(path.join(h755, "main.c"), "int main(void) { return 0; }\n");
  const stInfo = path.join(root, "st-info");
  const openOcd = path.join(root, "openocd");
  for (const executable of [stInfo, openOcd]) { fs.writeFileSync(executable, "mock executable\n"); fs.chmodSync(executable, 0o755); }
  const f103Serial = "303030303030303030303030";
  const h755Serial = "ABCDEF1234567890";
  const configuration = { projectPath: f103, stlinkPath: stInfo, openocdPath: openOcd };
  let delayQuickPick = false;
  let quickPickOpened;
  let resolveQuickPick;
  let terminalStarts = 0;
  const mock = {
    Uri: { file: (fsPath) => ({ fsPath, scheme: "file" }) },
    workspace: {
      isTrusted: true,
      workspaceFolders: [],
      getConfiguration: () => ({ get: (key, fallback) => key in configuration ? configuration[key] : fallback }),
    },
    window: {
      activeTextEditor: undefined,
      showQuickPick: async (items) => {
        if (delayQuickPick) {
          quickPickOpened(items);
          return new Promise((resolve) => { resolveQuickPick = resolve; });
        }
        return items.find((item) => item.probe.serialNumber === requestedSerial);
      },
      createTerminal: () => { terminalStarts++; return { show() {} }; },
      showErrorMessage: async () => {},
      showWarningMessage: async () => {},
    },
    extensions: { getExtension: () => undefined },
  };
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) { return request === "vscode" ? mock : originalLoad.call(this, request, parent, isMain); };
  t.after(() => { Module._load = originalLoad; });

  const processTools = require("../out/qc1/processTools");
  const originalRunProcess = processTools.runProcess;
  const targetCalls = [];
  processTools.runProcess = async (executable, args) => {
    if (executable === stInfo) return {
      exitCode: 0,
      stdout: `Found 2 stlink programmers\nserial: ${f103Serial}\nchipid: 0x410\ndescr: Blue Pill ST-LINK\nserial: ${h755Serial}\nchipid: 0x450\ndescr: NUCLEO-H755ZI-Q ST-LINK`,
      stderr: "", timedOut: false, truncated: false,
    };
    assert.equal(executable, openOcd);
    const selectedSerial = args.find((arg) => arg.startsWith("adapter serial "))?.split(" ").at(-1);
    targetCalls.push(selectedSerial);
    const h7 = selectedSerial === h755Serial;
    return {
      exitCode: 0,
      stdout: `Info : STLINK V3J5M2 (API v3) VID:PID 0483:374E\nInfo : [${h7 ? "stm32h7x.cpu0" : "stm32f1x.cpu"}] target examined`,
      stderr: "", timedOut: false, truncated: false,
    };
  };
  t.after(() => { processTools.runProcess = originalRunProcess; });

  let requestedSerial = h755Serial;
  const { getQc1Status, QC1PanelProvider } = require("../out/extension");
  const assignments = new Map();
  const context = {
    extensionPath: path.resolve(__dirname, ".."),
    extension: { packageJSON: { version: "0.3.1" } },
    workspaceState: {
      get: (key, fallback) => assignments.has(key) ? assignments.get(key) : fallback,
      update: async (key, value) => { assignments.set(key, value); },
    },
  };
  const provider = Object.create(QC1PanelProvider.prototype);
  provider.context = context;
  provider.outputLines = [];
  provider.appendOutput = (line) => provider.outputLines.push(String(line));

  const f103Status = getQc1Status(context);
  assert.equal(f103Status.architecture.family, "stm32f1");
  await assert.rejects(provider.ensureStlinkSelection(true, f103Status), /famille de cible stm32f1/);
  assert.equal(getQc1Status(context).stlinkSerialNumber, "", "an incompatible target must not be persisted");
  requestedSerial = f103Serial;
  await provider.ensureStlinkSelection(true, f103Status);
  assert.equal(getQc1Status(context).stlinkSerialNumber, f103Serial);

  configuration.projectPath = h755;
  requestedSerial = h755Serial;
  const h755Status = getQc1Status(context);
  assert.equal(h755Status.architecture.family, "stm32h755");
  await provider.ensureStlinkSelection(true, h755Status);
  assert.equal(getQc1Status(context).stlinkSerialNumber, h755Serial);

  configuration.projectPath = f103;
  assert.equal(getQc1Status(context).stlinkSerialNumber, f103Serial);
  configuration.projectPath = h755;
  assert.equal(getQc1Status(context).stlinkSerialNumber, h755Serial);
  await provider.ensureStlinkSelection(false, getQc1Status(context));
  assert.deepEqual(targetCalls, [h755Serial, f103Serial, h755Serial, h755Serial]);
  assert.ok(provider.outputLines.every((line) => !line.includes(f103Serial) && !line.includes(h755Serial)));

  // If the project changes while OpenOCD's explicit probe picker is open, don't
  // start a server with the old project's target/probe decision.
  configuration.projectPath = f103;
  assignments.clear();
  delayQuickPick = true;
  const pickerShown = new Promise((resolve) => { quickPickOpened = resolve; });
  const openOcdStopped = new Promise((resolve) => {
    provider.postStatus = (message) => { if (message === "Serveur OpenOCD non démarré") resolve(); };
  });
  provider.buildRunning = false;
  provider.probeRunning = false;
  provider.startOpenOcd();
  const choices = await pickerShown;
  configuration.projectPath = h755;
  resolveQuickPick(choices.find((item) => item.probe.serialNumber === f103Serial));
  await openOcdStopped;
  assert.equal(terminalStarts, 0, "OpenOCD must not start after the active project changes");
  assert.deepEqual(targetCalls, [h755Serial, f103Serial, h755Serial, h755Serial, f103Serial]);
});
