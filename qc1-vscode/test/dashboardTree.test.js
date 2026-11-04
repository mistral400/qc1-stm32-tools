const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const { defaultDashboardState } = require("../out/dashboard/dashboardState");
const { buildDashboardTree } = require("../out/dashboard/dashboardTreeModel");

function findNode(nodes, id) {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = findNode(node.children || [], id);
    if (child) return child;
  }
}

test("native explorer projects shared project, artifact, diagnostics and probe state", () => {
  const state = structuredClone(defaultDashboardState);
  state.projectName = "Lab STM32";
  state.project.targetFamily = "STM32F1";
  state.project.targetDevice = "STM32F103xB";
  state.project.projectStatus = "OK";
  state.project.workspacePath = "/tmp/lab";
  state.projectDiscovery.selectedPath = "/tmp/lab";
  state.recentProjects = [{ path: "/tmp/recent", name: "Ancien projet", mcu: "STM32F103xB", available: true }];
  state.projectDiscovery.candidates = [{
    candidate: {
      path: "/tmp/candidate", name: "Projet détecté", family: "STM32F1", mcu: "STM32F103xB",
      architecture: "single-core", cores: [], buildSystem: "cmake", confidence: 90,
      evidence: [], missingComponents: [], warnings: [],
    },
    confidenceLabel: "élevée",
  }];
  state.artifacts = [{ id: "elf-1", kind: "ELF", core: "CM7", path: "/tmp/lab/build/fw.elf", sizeBytes: 2048 }];
  state.diagnostics = [
    { code: "QC1-WARN", level: "warning", title: "Warning", message: "À vérifier", cause: "Configuration", checkedPath: "/tmp/lab/CMakeLists.txt" },
    { code: "QC1-ERR", level: "error", title: "Erreur", message: "Cible absente", cause: "CMake", checkedPath: "/tmp/lab/build" },
  ];
  state.hardwareSessions = [{ owner: "Flash QC1", kind: "programming", probe: "ST-Link ***42", project: "Lab STM32" }];
  state.environment.stlinkProbeStatus = "OK";
  state.environment.stlinkSelectedProbe = "ST-Link ***42";
  const before = structuredClone(state);

  const tree = buildDashboardTree(state);
  assert.deepEqual(tree.map((node) => node.id), ["qc1:projects", "qc1:artifacts", "qc1:diagnostics", "qc1:hardware"]);
  assert.equal(findNode(tree, "project:active").description, "STM32F1 · STM32F103xB · OK");
  assert.equal(findNode(tree, "recent:/tmp/recent").command.command, "qc1.selectProjectFromTree");
  assert.equal(findNode(tree, "candidate:/tmp/candidate").command.arguments[0], "/tmp/candidate");
  assert.equal(findNode(tree, "artifact:elf-1").command.command, "revealFileInOS");
  assert.equal(findNode(tree, "diagnostic:QC1-ERR:0").label, "Erreur", "blocking errors sort before warnings");
  assert.match(findNode(tree, "hardware:probe").description, /Connectée/);
  assert.equal(findNode(tree, "hardware:session:0").description, "ST-Link ***42 · Lab STM32");
  assert.deepEqual(state, before, "the tree is a read-only projection and does not own business state");
});

test("empty explorer categories show concise placeholders instead of fake actions", () => {
  const tree = buildDashboardTree(structuredClone(defaultDashboardState));
  assert.equal(findNode(tree, "artifact:none").label, "Aucun artefact connu");
  assert.equal(findNode(tree, "diagnostic:none").label, "Aucun problème signalé");
  assert.equal(findNode(tree, "hardware:no-sessions").label, "Aucune session QC1 connue");
  assert.equal(tree.every((group) => group.command.command === "qc1.openDashboardPage"), true);
});

test("TreeDataProvider exposes accessible items and refresh events without owning state", () => {
  const originalLoad = Module._load;
  class EventEmitter {
    listeners = new Set();
    event = (listener) => { this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) }; };
    fire(value) { for (const listener of this.listeners) listener(value); }
    dispose() { this.listeners.clear(); }
  }
  class TreeItem {
    constructor(label, collapsibleState) { this.label = label; this.collapsibleState = collapsibleState; }
  }
  class ThemeIcon { constructor(id) { this.id = id; } }
  Module._load = function (request, parent, isMain) {
    if (request === "vscode") return {
      EventEmitter,
      TreeItem,
      ThemeIcon,
      TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    };
    return originalLoad.call(this, request, parent, isMain);
  };
  let QC1DashboardTreeProvider;
  try { ({ QC1DashboardTreeProvider } = require("../out/dashboard/dashboardTreeProvider")); }
  finally { Module._load = originalLoad; }

  const provider = new QC1DashboardTreeProvider(() => structuredClone(defaultDashboardState));
  let changed = false;
  const listener = provider.onDidChangeTreeData(() => { changed = true; });
  const [projects, artifacts] = provider.getChildren();
  const projectItem = provider.getTreeItem(projects);
  const artifactItem = provider.getTreeItem(artifacts);
  assert.equal(projectItem.collapsibleState, 2);
  assert.equal(projectItem.accessibilityInformation.role, "treeitem");
  assert.equal(projectItem.command.command, "qc1.openDashboardPage");
  assert.equal(artifactItem.collapsibleState, 1);
  provider.refresh();
  assert.equal(changed, true);
  listener.dispose();
  provider.dispose();
});
