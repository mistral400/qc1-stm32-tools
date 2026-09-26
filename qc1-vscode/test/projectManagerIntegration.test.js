const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const Module = require("node:module");

test("manager integration: scopes, external projects, restart, watchers and manual H755", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qc1-manager-integration-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, "workspace"), external = path.join(root, "externe Ω"), other = path.join(root, "autre"), h755 = path.join(root, "manualH755");
  for (const directory of [workspace, external, other, h755]) {
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, "CMakeLists.txt"), "project(firmware)\nadd_executable(firmware main.c)\ntarget_compile_definitions(firmware PRIVATE STM32F103xB)\n");
    fs.writeFileSync(path.join(directory, "main.c"), "int main(void) { return 0; }\n");
  }
  fs.writeFileSync(path.join(h755, "CMakeLists.txt"), "project(manual)\nadd_executable(firmware_CM7 main.c)\ntarget_compile_definitions(firmware_CM7 PRIVATE STM32H755xx CORE_CM7)\n");
  const uri = (fsPath) => ({ fsPath, scheme: "file" });
  const global = { projectPath: other }, scoped = { projectPath: workspace }, folder = { cmakePreset: "" };
  const writes = [], watchers = [], subscriptions = [], history = new Map();
  let tokenDisposed = 0;
  const cancellationHandlers = [];
  const disposable = () => { const entry = { disposed: false, dispose() { this.disposed = true; } }; subscriptions.push(entry); return entry; };
  const mock = {
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    Uri: { file: uri },
    RelativePattern: class { constructor(base, pattern) { this.base = base; this.pattern = pattern; } },
    ProgressLocation: { Notification: 1 },
    workspace: {
      isTrusted: false, workspaceFolders: [{ uri: uri(workspace), name: "workspace" }], textDocuments: [],
      getWorkspaceFolder: (resource) => resource.fsPath.startsWith(workspace) ? { uri: uri(workspace) } : undefined,
      getConfiguration: (_section, resource) => ({
        get: (key, fallback) => resource?.fsPath === external && key in folder ? folder[key] : key in scoped ? scoped[key] : key in global ? global[key] : fallback,
        inspect: (key) => ({ workspaceFolderValue: resource?.fsPath === external ? folder[key] : undefined }),
        update: async (key, value, target) => { writes.push({ key, value, target, resource: resource?.fsPath }); (target === 3 ? folder : target === 2 ? scoped : global)[key] = value; },
      }),
      onDidChangeConfiguration: () => disposable(), onDidChangeWorkspaceFolders: () => disposable(),
      createFileSystemWatcher: (pattern) => {
        const entry = { ...disposable(), pattern, onDidChange(handler) { this.changed = handler; return disposable(); }, onDidCreate: () => disposable(), onDidDelete: () => disposable() };
        watchers.push(entry); return entry;
      },
    },
    window: {
      activeTextEditor: undefined, showInformationMessage: async () => undefined,
      withProgress: async (_options, callback) => callback({ report() {} }, { onCancellationRequested: (handler) => { cancellationHandlers.push(handler); return { dispose() { tokenDisposed++; } }; } }),
      showOpenDialog: async () => [uri(external)],
    },
    env: { appRoot: path.join(root, "editor") }, extensions: { all: [], getExtension: () => undefined },
  };
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) { return request === "vscode" ? mock : originalLoad.call(this, request, parent, isMain); };
  t.after(() => { Module._load = originalLoad; });
  const { getQc1Status, getProjectDiagnostics, QC1PanelProvider } = require("../out/extension");
  const context = {
    extensionPath: path.resolve(__dirname, ".."), extension: { packageJSON: { version: "0.3.1" } },
    globalState: { get: (key, fallback) => history.get(key) ?? fallback, update: async (key, value) => { history.set(key, value); } },
  };
  const provider = new QC1PanelProvider(uri(context.extensionPath), context);
  t.after(() => provider.dispose());

  await provider.updateProjectSettings({ projectPath: external, cmakePreset: "" });
  assert.equal(getQc1Status(context).projectPath, external);
  assert.equal(writes.find((item) => item.key === "projectPath").target, 2, "external selection overrides the old workspace value instead of writing a shadowed User value");
  assert.equal(global.projectPath, other, "unrelated User setting is preserved");
  assert.equal(writes.find((item) => item.key === "cmakePreset").target, 3, "existing resource override is preserved");
  assert.equal(provider.discovery.snapshot.activeCandidate.path, external);
  const relativeTool = path.join(external, "tools", process.platform === "win32" ? "cmake.exe" : "cmake");
  fs.mkdirSync(path.dirname(relativeTool)); fs.writeFileSync(relativeTool, "#!/bin/sh\nexit 0\n"); fs.chmodSync(relativeTool, 0o755);
  global.cmakePath = path.relative(external, relativeTool);
  assert.equal(getQc1Status(context).cmakePath, relativeTool, "relative tool settings resolve against the active external project, not the unrelated workspace");
  delete global.cmakePath;
  assert.equal(watchers.length, 7);
  assert.ok(watchers.every((watcher) => watcher.pattern.base === external && watcher.pattern.pattern !== "**/*"));
  watchers[0].changed(uri(path.join(external, "build", "CMakeLists.txt")));
  assert.equal(provider.discovery.snapshot.stale, false, "generated build files do not invalidate discovery");
  watchers[0].changed(uri(path.join(external, "CMakeLists.txt")));
  assert.equal(provider.discovery.snapshot.stale, true);
  const oldWatchers = [...watchers];
  await provider.updateProjectSettings({ projectPath: other });
  assert.ok(oldWatchers.every((watcher) => watcher.disposed));
  provider.buildRunning = true;
  const probeMessages = [];
  const previousPostStatus = provider.postStatus;
  provider.postStatus = (message, state) => probeMessages.push({ message, state });
  provider.detectStlink();
  provider.postStatus = previousPostStatus;
  assert.match(probeMessages.at(-1).message, /fin de l'opération QC1/);
  assert.equal(provider.probeRunning, false);
  await assert.rejects(provider.updateProjectSettings({ projectPath: external }), /opération/);
  assert.equal(getQc1Status(context).projectPath, other);
  provider.buildRunning = false;
  await provider.chooseProjectFolder();
  assert.equal(tokenDisposed, 1, "progress cancellation subscription is disposed after discovery");
  const scanner = require("../out/qc1/projectScanner"), originalDiscover = scanner.discoverProjects;
  const calls = [];
  scanner.discoverProjects = (options) => new Promise(resolve => calls.push({ options, resolve }));
  try {
    const old = provider.discovery.scan([external]), latest = provider.discovery.scan([other]);
    cancellationHandlers[1]();
    assert.equal(calls[1].options.signal.aborted, false, "an obsolete notification cannot cancel the current request");
    calls[1].resolve([]); await latest;
    calls[0].resolve([]); await old;
    assert.equal(provider.discovery.snapshot.status, "success");
    assert.equal(tokenDisposed, 3);
  } finally { scanner.discoverProjects = originalDiscover; }

  provider.dispose();
  assert.ok(watchers.every((watcher) => watcher.disposed));
  const restarted = new QC1PanelProvider(uri(context.extensionPath), context);
  await restarted.refreshManagerContext();
  assert.equal(restarted.discovery.snapshot.selectedPath, other, "same canonical setting survives provider recreation");
  restarted.dispose();

  mock.workspace.workspaceFolders = undefined;
  for (const key of Object.keys(scoped)) delete scoped[key];
  const emptyWindow = new QC1PanelProvider(uri(context.extensionPath), context);
  await emptyWindow.updateProjectSettings({ projectPath: external });
  assert.equal(writes.at(-1).target, 1);
  assert.equal(getQc1Status(context).projectPath, external, "an empty window can operate on an explicit external project");
  emptyWindow.dispose();
  global.projectPath = h755;
  const manual = getQc1Status(context);
  assert.equal(manual.architecture.coreMode, "cm7");
  assert.equal(manual.projectComplete, true);
  assert.ok(getProjectDiagnostics(manual).every((diagnostic) => diagnostic.level !== "error"), "HAL/CMSIS/startup supplied by native CMake are not mandatory CubeMX folders");
  assert.ok(!getProjectDiagnostics(manual).some((diagnostic) => ["QC1-H755-010", "QC1-H755-011", "QC1-H755-012"].includes(diagnostic.code)), "unused optional dependencies do not generate misleading missing-dependency warnings");
});
