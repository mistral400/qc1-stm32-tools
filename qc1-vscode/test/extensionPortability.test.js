const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const Module = require("node:module");

test("extension integration: multi-root, native validation, report and CMake arguments", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "qc1-extension-integration-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const docs = path.join(root, "notes"),
    firmware = path.join(root, "électronique (Ω) l'app");
  fs.mkdirSync(docs);
  fs.mkdirSync(firmware);
  fs.writeFileSync(
    path.join(firmware, "CMakeLists.txt"),
    "project(native)\nadd_executable(board generated.c)",
  );
  const uri = (fsPath) => ({ fsPath, scheme: "file" });
  const errors = [],
    previews = [],
    scopes = [];
  const mock = {
    workspace: {
      isTrusted: false,
      workspaceFolders: [docs, firmware].map((f) => ({
        name: path.basename(f),
        uri: uri(f),
      })),
      textDocuments: [],
      getWorkspaceFolder: (value) => ({
        uri: uri(value.fsPath.startsWith(firmware) ? firmware : docs),
      }),
      getConfiguration: (section, scope) => ({
        get: (key, fallback) => {
          if (key === "buildDirectory") {
            scopes.push(scope?.fsPath);
            return scope?.fsPath === firmware ? "custom build" : "wrong-build";
          }
          return fallback;
        },
      }),
      openTextDocument: async (value) => {
        previews.push(value.content);
        return {};
      },
    },
    window: {
      activeTextEditor: undefined,
      showInputBox: async () => "diagnostic",
      withProgress: async (_options, callback) => callback({ report() {} }),
      showTextDocument: async () => {},
      showInformationMessage: async () => undefined,
      showErrorMessage: (message) => errors.push(message),
    },
    env: {
      appRoot: path.join(root, "editor"),
      appName: "VS Code test",
      language: "fr",
      uiKind: 1,
    },
    version: "1.118.0",
    UIKind: { Desktop: 1 },
    ProgressLocation: { Notification: 1 },
    Uri: { file: uri },
    languages: { getDiagnostics: () => [] },
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    extensions: { all: [], getExtension: () => undefined },
  };
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    return request === "vscode"
      ? mock
      : originalLoad.call(this, request, parent, isMain);
  };
  t.after(() => {
    Module._load = originalLoad;
  });
  const {
    getQc1Status,
    getProjectDiagnostics,
    buildProcessInvocations,
    QC1PanelProvider,
  } = require("../out/extension");
  const context = {
    extensionPath: path.resolve(__dirname, ".."),
    extension: {
      packageJSON: {
        publisher: "Mistral400",
        name: "qc1-stm32-tools",
        version: "0.3.1",
      },
    },
  };
  const status = getQc1Status(context);
  assert.equal(status.projectPath, firmware);
  assert.equal(status.buildPath, path.join(firmware, "custom build"));
  assert.ok(status.nativeCmakeOk);
  assert.ok(status.projectComplete);
  assert.ok(getProjectDiagnostics(status).every((d) => d.level !== "error"));
  const invocation = buildProcessInvocations(status, "build")[0];
  assert.ok(!invocation.args.includes("-G"));
  assert.ok(!invocation.args.some((a) => a.includes("QC1_STARTUP")));
  assert.ok(invocation.args.includes(firmware));
  const h755Status = {
    ...status,
    architecture: {
      ...status.architecture,
      family: "stm32h755",
      device: "STM32H755ZIT6",
      coreMode: "dual",
      cm7: { ...status.architecture.cm7, present: true },
      cm4: { ...status.architecture.cm4, present: true }
    },
    cm7TargetName: "firmware_CM7",
    cm4TargetName: "firmware_CM4",
    cm7ElfPath: path.join(firmware, "build", "CM7.elf"),
    cm4ElfPath: path.join(firmware, "build", "CM4.elf"),
    cm7BinPath: path.join(firmware, "build", "CM7.bin"),
    cm4BinPath: path.join(firmware, "build", "CM4.bin"),
    cmakeConfigurePreset: "Debug",
    cmakeBuildPreset: "Debug",
    openocdOk: true,
    openocdPath: "openocd"
  };
  const cm7Build = buildProcessInvocations(h755Status, "build-cm7");
  assert.deepEqual(cm7Build[0].args, ["--preset", "Debug"]);
  assert.ok(cm7Build[1].args.includes("firmware_CM7"));
  const dualFlash = buildProcessInvocations(h755Status, "flash").filter(item => item.phase === "flashing");
  assert.equal(dualFlash.length, 2);
  assert.ok(dualFlash[0].args.includes("target/stm32h7x.cfg"));
  assert.match(dualFlash[1].args.at(-1), /cpu1/);
  assert.ok(scopes.includes(firmware));
  const provider = new QC1PanelProvider(uri(context.extensionPath), context);
  await provider.createDiagnosticReport();
  assert.deepEqual(errors, []);
  assert.equal(previews.length, 1);
  assert.ok(previews[0].includes("reportSchemaVersion"));
  assert.ok(!previews[0].includes(firmware));
  assert.ok(previews[0].includes("untrusted"));
  assert.ok(previews[0].includes("## USB"));
});
