const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

test("extension refreshes CubeMX utility targets and core artifacts after configure without leaking CMake expressions", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qc1 H755 pipeline "));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const build = path.join(root, "build");
  const settings = { projectPath: root, buildDirectory: "build" };
  const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
  write(path.join(root, "CMakeLists.txt"), "project(MyProject)\n");
  write(path.join(root, "board.ioc"), "Mcu.Name=STM32H755ZITx\n");
  for (const core of ["CM7", "CM4"]) write(path.join(root, core, "CMakeLists.txt"), "project(${CMAKE_PROJECT_NAME})\n");
  const originalLoad = Module._load;
  const vscode = {
    Uri: { file: fsPath => ({ fsPath }) },
    workspace: { workspaceFolders: [], getConfiguration: () => ({ get: (key, fallback) => settings[key] ?? fallback }) },
    extensions: { getExtension: () => undefined }, window: { activeTextEditor: undefined }
  };
  Module._load = function(request, parent, main) { return request === "vscode" ? vscode : originalLoad.call(this, request, parent, main); };
  let extension;
  try { extension = require("../out/extension"); } finally { Module._load = originalLoad; }
  const context = { extensionPath: path.resolve(__dirname, "..") };
  assert.equal(extension.createQc1ErrorFromProcess(Object.assign(new Error("Process timeout"), { timedOut: true }), "qc1 build-cm7", root, "", "").code, "QC1-CMD-002");
  assert.equal(extension.createQc1ErrorFromProcess(new Error("Ninja failed"), "qc1 build-cm7", root, "", "").code, "QC1-CMD-001");
  const initial = extension.getQc1Status(context);
  const plan = extension.buildProcessInvocations(initial, "build-cm7");
  assert.equal(plan[0].phase, "configuring");
  assert.ok(plan.every(invocation => invocation.args.every(arg => !arg.includes("${"))));
  const reply = path.join(build, ".cmake", "api", "v1", "reply");
  write(path.join(reply, "index-test.json"), JSON.stringify({ objects: [{ kind: "codemodel", version: { major: 2 }, jsonFile: "model.json" }] }));
  write(path.join(reply, "model.json"), JSON.stringify({ paths: { source: root, build }, configurations: [{ name: "Debug", targets: [{ jsonFile: "cm7.json" }, { jsonFile: "cm4.json" }] }] }));
  let cache = `CMAKE_HOME_DIRECTORY:INTERNAL=${root}\nCMAKE_BUILD_TYPE:STRING=Debug\n`;
  for (const core of ["CM7", "CM4"]) {
    write(path.join(reply, `${core.toLowerCase()}.json`), JSON.stringify({ name: `MyProject_${core}`, type: "UTILITY" }));
    const elf = path.join(root, "arbitrary output", `MyProject_${core}.elf`);
    write(elf, "ELF fixture");
    cache += `ST_DUAL_CORE_${core}_PROJECT_BUILD_TARGET:FILEPATH=${elf}\n`;
  }
  write(path.join(build, "CMakeCache.txt"), cache);
  const configured = extension.getQc1Status(context);
  assert.equal(configured.cm7TargetName, "MyProject_CM7");
  assert.equal(configured.cm4TargetName, "MyProject_CM4");
  assert.equal(extension.getProjectDiagnostics({ ...configured, architecture: { ...configured.architecture,
    cm7: { ...configured.architecture.cm7, linkerScriptPath: "", linkerCandidates: [path.join(root, "CM7", "flash_CM7.ld"), path.join(root, "CM7", "sram_CM7.ld")] }
  } }).some(diagnostic => diagnostic.title === "LINKER_CM7_SELECTION_UNRESOLVED"), true);
  assert.throws(() => extension.buildProcessInvocations({ ...configured, openocdOk: false, stFlashOk: true, stFlashPath: "/tools/st-flash" }, "flash-cm4"), /OpenOCD requis/);
  for (const core of ["cm7", "cm4"]) {
    const flash = extension.buildProcessInvocations({ ...configured, openocdOk: true, openocdPath: "/tools/openocd" }, `flash-${core}`);
    const command = flash.find(invocation => invocation.phase === "flashing");
    assert.match(command.args.at(-1), new RegExp(`targets stm32h7x.cpu${core === "cm7" ? 0 : 1}`));
    assert.ok(command.args.at(-1).includes(configured[`${core}ElfPath`].replace(/\\/g, "/")));
    assert.ok(command.args.includes("set DUAL_BANK 1"));
  }
  for (const core of ["cm7", "cm4"]) {
    const single = { ...configured, architecture: { ...configured.architecture, coreMode: core,
      [core === "cm7" ? "cm4" : "cm7"]: { ...configured.architecture[core === "cm7" ? "cm4" : "cm7"], present: false } } };
    const command = extension.buildProcessInvocations({ ...single, openocdOk: true, openocdPath: "/tools/openocd" }, `flash-${core}`).find(invocation => invocation.phase === "flashing");
    assert.match(command.args.at(-1), new RegExp(`targets stm32h7x.cpu${core === "cm7" ? 0 : 1}`));
    assert.equal(command.args.includes("set DUAL_BANK 1"), core === "cm4", "CM4-only firmware still requires the physical dual-core target");
  }
  settings.cm4ElfPath = configured.cm7ElfPath;
  assert.equal(extension.getQc1Status(context).cm4ElfPath, "");
});
