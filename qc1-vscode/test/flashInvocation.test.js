const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

function loadExtensionWithVscodeMock() {
  const originalLoad = Module._load;
  const vscode = {
    Uri: { file: fsPath => ({ fsPath }) },
    workspace: { workspaceFolders: [], getConfiguration: () => ({ get: (_key, fallback) => fallback }) },
    window: { activeTextEditor: undefined },
    extensions: { getExtension: () => undefined },
  };
  Module._load = function(request, parent, isMain) {
    return request === "vscode" ? vscode : originalLoad.call(this, request, parent, isMain);
  };
  try { return require("../out/extension"); }
  finally { Module._load = originalLoad; }
}

test("st-flash plan uses a new BIN, then readback, then an explicit reset", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qc1-st-flash-plan-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, "project");
  const build = path.join(project, "build");
  const tools = path.join(root, "tools");
  const linker = path.join(project, "linker.ld");
  const compiler = path.join(tools, "arm-none-eabi-gcc");
  const objcopy = path.join(tools, "arm-none-eabi-objcopy");
  const elf = path.join(build, "firmware.elf");
  const staleBin = path.join(build, "firmware.bin");
  const staging = path.join(root, "unique-operation-stage");
  fs.mkdirSync(build, { recursive: true });
  fs.mkdirSync(tools, { recursive: true });
  fs.mkdirSync(staging);
  fs.writeFileSync(linker, "MEMORY { FLASH (rx) : ORIGIN = 0x08000000, LENGTH = 64K }\n");
  fs.writeFileSync(objcopy, "tool stub");
  fs.writeFileSync(elf, "ELF fixture");
  fs.writeFileSync(staleBin, "OLD BIN MUST NOT BE USED");

  const { buildProcessInvocations } = loadExtensionWithVscodeMock();
  const status = {
    projectPath: project, projectName: "firmware", cmakeSourcePath: project, buildPath: build,
    nativeCmakeOk: true, cmakeConfigurePreset: "", cmakeBuildPreset: "", cmakePath: "/tools/cmake",
    compilerOk: true, compilerPath: compiler, cubeIdeImport: false,
    architecture: { family: "stm32f1", device: "STM32F103xB", coreMode: "single", cm7: { present: false }, cm4: { present: false } },
    cm7ElfPath: "", cm4ElfPath: "", cm7BinPath: "", cm4BinPath: "", elfPath: elf, binPath: staleBin,
    linkerScriptPath: linker, stFlashPath: "/tools/st-flash", stlinkSerialNumber: "", openocdOk: false,
  };
  const plan = buildProcessInvocations(status, "flash", staging);
  assert.deepEqual(plan.map(item => item.phase), ["configuring", "building", "flashing", "flashing", "verifying", "resetting"]);
  const conversion = plan[2];
  const write = plan[3];
  const readback = plan[4];
  const reset = plan[5];
  assert.equal(conversion.args[3], elf);
  assert.equal(conversion.args[4], path.join(staging, "stm32.bin"));
  assert.notEqual(conversion.args[4], staleBin);
  assert.deepEqual(write.args, ["write", path.join(staging, "stm32.bin"), "0x08000000"]);
  assert.ok(write.args.includes("write"));
  assert.ok(!write.args.includes("--reset"));
  assert.equal(readback.inputArtifact, "readback");
  assert.equal(readback.sourceArtifactPath, path.join(staging, "stm32.bin"));
  assert.equal(reset.phase, "resetting");
  assert.deepEqual(reset.args, ["reset"]);
});

test("st-flash refuses to plan a fallback when objcopy is missing", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qc1-st-flash-no-objcopy-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, "project");
  const build = path.join(project, "build");
  const tools = path.join(root, "tools");
  const linker = path.join(project, "linker.ld");
  const compiler = path.join(tools, "arm-none-eabi-gcc");
  fs.mkdirSync(build, { recursive: true });
  fs.mkdirSync(tools, { recursive: true });
  fs.writeFileSync(linker, "MEMORY { FLASH (rx) : ORIGIN = 0x08000000, LENGTH = 64K }\n");
  fs.writeFileSync(compiler, "tool stub");
  const { buildProcessInvocations } = loadExtensionWithVscodeMock();
  const status = {
    projectPath: project, projectName: "firmware", cmakeSourcePath: project, buildPath: build,
    nativeCmakeOk: true, cmakeConfigurePreset: "", cmakeBuildPreset: "", cmakePath: "/tools/cmake",
    compilerOk: true, compilerPath: compiler, cubeIdeImport: false,
    architecture: { family: "stm32f1", device: "STM32F103xB", coreMode: "single", cm7: { present: false }, cm4: { present: false } },
    cm7ElfPath: "", cm4ElfPath: "", cm7BinPath: "", cm4BinPath: "", elfPath: path.join(build, "firmware.elf"),
    binPath: path.join(build, "firmware.bin"), linkerScriptPath: linker, stFlashPath: "/tools/st-flash", stlinkSerialNumber: "", openocdOk: false,
  };
  assert.throws(() => buildProcessInvocations(status, "flash", path.join(root, "stage")), /objcopy est requis/);
});

test("st-flash refuses OpenOCD-only reset profiles before planning a flash", () => {
  const { buildProcessInvocations } = loadExtensionWithVscodeMock();
  const status = {
    projectPath: "/firmware", cmakeSourcePath: "/firmware", buildPath: "/firmware/build", nativeCmakeOk: true,
    cmakeConfigurePreset: "", cmakeBuildPreset: "", cmakePath: "/tools/cmake", compilerOk: true,
    architecture: { family: "stm32f1", device: "STM32F103xB", coreMode: "single", cm7: { present: false }, cm4: { present: false } },
    cm7ElfPath: "", cm4ElfPath: "", elfPath: "/firmware/build/main.elf", linkerScriptPath: "/firmware/linker.ld",
    stFlashPath: "/tools/st-flash", openocdOk: false,
  };
  assert.throws(() => buildProcessInvocations(status, "flash", "/tmp/stage", { mode: "hardware-nrst" }), /nécessite OpenOCD/);
  assert.throws(() => buildProcessInvocations(status, "flash", "/tmp/stage", { mode: "backend-default", adapterSpeedKHz: 400 }), /nécessite OpenOCD/);
});
