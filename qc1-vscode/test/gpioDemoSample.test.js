const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { findStm32Project, inspectStm32Project, isUsableStm32Project } = require("../out/qc1/projectDiscovery");
const { analyzeProject } = require("../out/qc1/projectScanner");
const { spawnSync } = require("node:child_process");
const Module = require("node:module");

const project = process.env.QC1_GPIO_DEMO_PATH || path.join(
  os.homedir(),
  "Downloads",
  "STMicroelectronics STM32CubeH7 master Projects-NUCLEO-H745ZI-Q_Examples_GPIO_GPIO_Demo",
);
const sdk = process.env.QC1_CUBE_H7_PATH || path.join(os.homedir(), "Downloads", "QC1-Releases", "STM32CubeH7-v1.13.0");

test("recognizes the local official GPIO_Demo CubeIDE project without selecting the MDK startup", async t => {
  if (!fs.existsSync(project)) {
    t.skip("Set QC1_GPIO_DEMO_PATH to the local STM32CubeH7 GPIO_Demo folder to run this integration check");
    return;
  }
  const inspection = inspectStm32Project(project, undefined, process.env.QC1_CUBE_H7_PATH || "");
  const detected = findStm32Project(project);
  assert.equal(detected?.root, project);
  assert.equal(inspection.layout, "stm32cubeide");
  assert.equal(inspection.projectName, "GPIO_Demo");
  assert.equal(inspection.architecture.family, "stm32h7");
  assert.equal(inspection.architecture.device, "STM32H745ZITx");
  assert.equal(inspection.architecture.board, "NUCLEO-H745ZI-Q");
  assert.equal(inspection.architecture.coreMode, "dual");
  assert.equal(isUsableStm32Project(inspection), true);
  for (const core of ["cm7", "cm4"]) {
    const item = inspection.architecture[core];
    assert.ok(item.sources.some(file => file.endsWith(`${path.sep}${core.toUpperCase()}${path.sep}Src${path.sep}main.c`)));
    assert.ok(item.sources.some(file => file.includes(`${path.sep}Common${path.sep}Src${path.sep}`)));
    assert.ok(item.startupPath.includes(path.join("STM32CubeIDE", core.toUpperCase())));
    assert.ok(item.linkerScriptPath.includes(path.join("STM32CubeIDE", core.toUpperCase())));
  }
  assert.equal(inspection.startupCandidates.some(file => file.includes(`${path.sep}MDK-ARM${path.sep}`)), true);
  assert.equal(inspection.architecture.cm7.startupPath.includes(`${path.sep}MDK-ARM${path.sep}`), false);
  const candidate = await analyzeProject(project);
  assert.equal(candidate?.mcu, "STM32H745ZITx");
  assert.equal(candidate?.board, "NUCLEO-H745ZI-Q");
  assert.deepEqual(candidate?.compatibleBoards, ["NUCLEO-H755ZI-Q"]);
});

test("builds the official GPIO_Demo CM7 and CM4 through QC1's CubeIDE CMake pipeline when STM32CubeH7 is installed", t => {
  if (!fs.existsSync(project)) {
    t.skip("Set QC1_GPIO_DEMO_PATH to the local STM32CubeH7 GPIO_Demo folder to run this build integration");
    return;
  }
  if (!fs.existsSync(path.join(sdk, "Drivers"))) {
    t.skip("Set QC1_CUBE_H7_PATH to a local STM32CubeH7 installation; QC1 does not download dependencies");
    return;
  }
  for (const binary of ["cmake", "arm-none-eabi-gcc", "arm-none-eabi-objdump"]) {
    const result = spawnSync(binary, ["--version"], { encoding: "utf8" });
    if (result.error || result.status !== 0) {
      t.skip(`${binary} is required for the real GPIO_Demo build integration`);
      return;
    }
  }

  const settings = { projectPath: project, buildDirectory: "build/qc1", cubeH7Path: sdk, autoDetectProject: false };
  const vscode = {
    Uri: { file: fsPath => ({ fsPath }) },
    workspace: { workspaceFolders: [], getConfiguration: () => ({ get: (key, fallback) => settings[key] ?? fallback }) },
    extensions: { all: [], getExtension: () => undefined },
    window: { activeTextEditor: undefined },
    env: { appRoot: "", appName: "VS Code test", language: "en", uiKind: 1 },
    version: "1.141.0",
    UIKind: { Desktop: 1 },
  };
  const originalLoad = Module._load;
  let extension;
  try {
    Module._load = function(request, parent, isMain) {
      return request === "vscode" ? vscode : originalLoad.call(this, request, parent, isMain);
    };
    extension = require("../out/extension");
  } finally {
    Module._load = originalLoad;
  }
  const context = {
    extensionPath: path.resolve(__dirname, ".."),
    extension: { packageJSON: { publisher: "Mistral400", name: "qc1-stm32-tools", version: "0.4.0" } },
  };
  const status = extension.getQc1Status(context);
  if (!status.ninjaOk && !status.makeOk) {
    t.skip("Ninja or a compatible Make generator is required for the real GPIO_Demo build");
    return;
  }
  assert.equal(status.cubeIdeImport, true);
  assert.equal(status.cubeIdeDependenciesComplete, true,
    extension.getProjectDiagnostics(status).map(item => `${item.code}: ${item.message}`).join("\n"));
  const invocations = extension.buildProcessInvocations(status, "build");
  const configure = invocations.find(item => item.phase === "configuring");
  const build = invocations.find(item => item.phase === "building");
  assert.ok(configure && build);
  assert.ok(configure.args.includes(status.ninjaOk ? "Ninja" : status.makeGenerator));
  const fileApiQuery = path.join(status.buildPath, ".cmake", "api", "v1", "query", "client-qc1");
  fs.mkdirSync(fileApiQuery, { recursive: true });
  fs.writeFileSync(path.join(fileApiQuery, "codemodel-v2"), "", "utf8");
  fs.writeFileSync(path.join(fileApiQuery, "toolchains-v1"), "", "utf8");
  const configured = spawnSync(status.cmakePath, configure.args, { cwd: project, encoding: "utf8", timeout: 60000 });
  assert.equal(configured.status, 0, `${configured.stdout}\n${configured.stderr}`);
  const built = spawnSync(status.cmakePath, build.args, { cwd: project, encoding: "utf8", timeout: 240000 });
  assert.equal(built.status, 0, `${built.stdout}\n${built.stderr}`);

  for (const core of ["CM7", "CM4"]) {
    const output = path.join(status.buildPath, core);
    for (const extensionName of ["elf", "bin", "hex", "map"]) {
      const artifact = path.join(output, `firmware.${extensionName}`);
      assert.ok(fs.existsSync(artifact) && fs.statSync(artifact).size > 0, `Missing ${artifact}`);
    }
    const elf = path.join(output, "firmware.elf");
    const sections = spawnSync("arm-none-eabi-objdump", ["-h", elf], { encoding: "utf8" });
    assert.equal(sections.status, 0, sections.stderr);
    assert.match(sections.stdout, core === "CM7" ? /\.isr_vector\s+\S+\s+08000000/ : /\.isr_vector\s+\S+\s+08100000/);
  }
  return extension.writeH7BuildReport(extension.getQc1Status(context), "build").then(() => {
    const report = JSON.parse(fs.readFileSync(path.join(status.buildPath, "build-report.json"), "utf8"));
    assert.equal(report.status, "built");
    assert.deepEqual(report.artifacts.map(item => item.buildStatus), ["built", "built"]);
  });
});
