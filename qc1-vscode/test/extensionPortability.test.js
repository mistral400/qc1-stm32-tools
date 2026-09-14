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
