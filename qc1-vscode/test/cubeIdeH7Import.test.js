const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const Module = require("node:module");
const { configuredCoreArtifact, readCoreBuildMetadata } = require("../out/qc1/coreBuild");
const { inspectStm32Project, isUsableStm32Project } = require("../out/qc1/projectDiscovery");

function write(file, contents = "") {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, "utf8");
}

function option(superClass, value) {
  return `<option superClass="${superClass}" value="${value}"/>`;
}

function coreProjectXml(core) {
  const suffix = core === "CM7" ? "fpv5-d16" : "fpv4-sp-d16";
  const definitions = [`CORE_${core}`, "STM32H745xx", "USE_HAL_DRIVER"];
  return `<cproject>
    ${option("com.st.stm32cube.ide.mcu.gnu.managedbuild.option.target_mcu", "STM32H745ZITx")}
    ${option("com.st.stm32cube.ide.mcu.gnu.managedbuild.option.target_board", "NUCLEO-H745ZI-Q")}
    ${option("com.st.stm32cube.ide.mcu.gnu.managedbuild.option.fpu", suffix)}
    ${option("com.st.stm32cube.ide.mcu.gnu.managedbuild.option.floatabi", "hard")}
    <option superClass="com.st.stm32cube.ide.mcu.gnu.managedbuild.tool.c.compiler.option.includepaths"><listOptionValue value="../${core}/Inc"/></option>
    <option superClass="com.st.stm32cube.ide.mcu.gnu.managedbuild.tool.c.compiler.option.definedsymbols">${definitions.map(value => `<listOptionValue value="${value}"/>`).join("")}</option>
  </cproject>`;
}

test("imports a real-shaped CubeIDE H745 dual-core project and builds separate images in paths with spaces", async t => {
  const host = fs.mkdtempSync(path.join(os.tmpdir(), "QC1 H7 import Ω "));
  t.after(() => fs.rmSync(host, { recursive: true, force: true }));
  const project = path.join(host, "GPIO Demo Ω");
  const sdk = path.join(host, "STM32CubeH7 SDK");
  const cmake = spawnSync("cmake", ["--version"], { encoding: "utf8" });
  const make = spawnSync("make", ["--version"], { encoding: "utf8" });
  const gcc = spawnSync("arm-none-eabi-gcc", ["--version"], { encoding: "utf8" });
  const objdump = spawnSync("arm-none-eabi-objdump", ["--version"], { encoding: "utf8" });
  if (cmake.error || cmake.status !== 0 || make.error || make.status !== 0 || gcc.error || gcc.status !== 0 || objdump.error || objdump.status !== 0) {
    t.skip("CMake, make, arm-none-eabi-gcc and arm-none-eabi-objdump are required for this integration test");
    return;
  }

  for (const core of ["CM7", "CM4"]) {
    const flashOrigin = core === "CM7" ? "0x08000000" : "0x08100000";
    write(path.join(project, "STM32CubeIDE", core, ".cproject"), coreProjectXml(core));
    write(path.join(project, "STM32CubeIDE", core, ".project"), `<projectDescription><name>GPIO_Demo_${core}</name></projectDescription>`);
    write(path.join(project, core, "Inc", "stm32h7xx_hal_conf.h"), "#define HAL_GPIO_MODULE_ENABLED\n");
    write(path.join(project, core, "Src", "main.c"), "int common_value(void); int main(void) { return common_value(); }\n");
    write(path.join(project, "STM32CubeIDE", core, "Example", "User", "Startup", "startup_stm32h745zitx.s"), "/* CubeIDE startup fixture */\n");
    write(path.join(project, "STM32CubeIDE", core, "STM32H745ZITX_FLASH.ld"), `ENTRY(main)\nMEMORY {\n  FLASH (rx) : ORIGIN = ${flashOrigin}, LENGTH = 2M\n  RAM (rwx) : ORIGIN = 0x24000000, LENGTH = 512K\n}\nSECTIONS {\n  .text : { *(.text*) *(.rodata*) } > FLASH\n  .data : { *(.data*) } > RAM\n  .bss : { *(.bss*) } > RAM\n}\n`);
  }
  write(path.join(project, "Common", "Src", "system_stm32h7xx.c"), "int common_value(void) { return 42; }\n");
  write(path.join(project, "MDK-ARM", "startup_stm32h745xx.s"), "/* must never be selected by CubeIDE import */\n");

  const inspection = inspectStm32Project(project, undefined, sdk);
  assert.equal(inspection.layout, "stm32cubeide");
  assert.equal(inspection.projectName, "GPIO_Demo");
  assert.equal(inspection.architecture.family, "stm32h7");
  assert.equal(inspection.architecture.device, "STM32H745ZITx");
  assert.equal(inspection.architecture.board, "NUCLEO-H745ZI-Q");
  assert.equal(inspection.architecture.coreMode, "dual");
  assert.match(inspection.architecture.cm7.startupPath, /STM32CubeIDE[\\/]CM7/);
  assert.match(inspection.architecture.cm4.startupPath, /STM32CubeIDE[\\/]CM4/);
  assert.doesNotMatch(inspection.architecture.cm7.startupPath, /MDK-ARM/);
  assert.equal(inspection.architecture.cm7.compileOptions.includes("-mfpu=fpv5-d16"), true);
  assert.equal(inspection.architecture.cm4.compileOptions.includes("-mfpu=fpv4-sp-d16"), true);
  assert.equal(isUsableStm32Project(inspection), true);

  const settings = { projectPath: project, buildDirectory: "build QC1 Ω", cubeH7Path: "", autoDetectProject: false };
  const vscode = {
    Uri: { file: fsPath => ({ fsPath }) },
    workspace: { workspaceFolders: [], getConfiguration: () => ({ get: (key, fallback) => settings[key] ?? fallback }) },
    extensions: { getExtension: () => undefined },
    window: { activeTextEditor: undefined },
  };
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) { return request === "vscode" ? vscode : originalLoad.call(this, request, parent, isMain); };
  let extension;
  try { extension = require("../out/extension"); } finally { Module._load = originalLoad; }
  const context = { extensionPath: path.resolve(__dirname, "..") };
  const missingStatus = extension.getQc1Status(context);
  assert.equal(missingStatus.cubeIdeImport, true);
  assert.equal(missingStatus.cubeIdeDependenciesComplete, false);
  const missingDiagnostics = extension.getProjectDiagnostics(missingStatus);
  assert.equal(missingDiagnostics.some(item => ["QC1-H7-003", "QC1-H7-006", "QC1-H7-007"].includes(item.code) && item.level === "error"), true);
  assert.equal(missingDiagnostics.some(item => item.title === "CMAKE_QC1_INTROUVABLE"), false);
  if (!missingStatus.ninjaOk && missingStatus.makeOk)
    assert.equal(missingDiagnostics.some(item => item.code === "QC1-H755-021"), false);

  write(path.join(sdk, "Drivers", "STM32H7xx_HAL_Driver", "Inc", "stm32h7xx_hal.h"), "");
  write(path.join(sdk, "Drivers", "STM32H7xx_HAL_Driver", "Src", "stm32h7xx_hal.c"), "");
  write(path.join(sdk, "Drivers", "STM32H7xx_HAL_Driver", "Src", "stm32h7xx_hal_gpio.c"), "");
  write(path.join(sdk, "Drivers", "CMSIS", "Include", "core_cm7.h"), "");
  write(path.join(sdk, "Drivers", "CMSIS", "Include", "core_cm4.h"), "");
  write(path.join(sdk, "Drivers", "CMSIS", "Device", "ST", "STM32H7xx", "Include", "stm32h745xx.h"), "");
  settings.cubeH7Path = sdk;
  const status = extension.getQc1Status(context);
  assert.equal(status.cubeIdeImport, true);
  assert.equal(status.cubeIdeDependenciesComplete, true);
  assert.equal(status.projectComplete, true);
  const configure = extension.buildProcessInvocations(status, "build")[0];
  assert.ok(configure.args.includes("-DQC1_BUILD_H7=ON"));
  assert.ok(configure.args.find(argument => argument.startsWith("-DQC1_CM7_SOURCES=")).includes(path.join(project, "CM7", "Src", "main.c")));
  assert.ok(configure.args.find(argument => argument.startsWith("-DQC1_CM7_SOURCES=")).includes(path.join(project, "STM32CubeIDE", "CM7", "Example", "User", "Startup", "startup_stm32h745zitx.s")));
  assert.ok(configure.args.find(argument => argument.startsWith("-DQC1_CM4_SOURCES=")).includes(path.join(project, "CM4", "Src", "main.c")));
  assert.ok(configure.args.find(argument => argument.startsWith("-DQC1_CM7_COMPILE_OPTIONS=")).includes("-mfpu=fpv5-d16"));
  assert.ok(configure.args.find(argument => argument.startsWith("-DQC1_CM4_COMPILE_OPTIONS=")).includes("-mfpu=fpv4-sp-d16"));
  assert.ok(configure.args.includes(`-DQC1_CM7_LINKER_SCRIPT=${inspection.architecture.cm7.linkerScriptPath}`));
  assert.ok(configure.args.includes(`-DQC1_CM4_LINKER_SCRIPT=${inspection.architecture.cm4.linkerScriptPath}`));

  const args = [...configure.args];
  assert.ok(args.includes(status.ninjaOk ? "Ninja" : status.makeGenerator));
  const build = status.buildPath;
  const query = path.join(build, ".cmake", "api", "v1", "query", "client-qc1");
  write(path.join(query, "codemodel-v2"));
  write(path.join(query, "toolchains-v1"));
  const configured = spawnSync("cmake", args, { cwd: project, encoding: "utf8", timeout: 30000 });
  assert.equal(configured.status, 0, `${configured.stdout}\n${configured.stderr}`);
  assert.match(fs.readFileSync(path.join(build, "build-report.json"), "utf8"), /"status": "configured"/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(build, "build-report.json"), "utf8")).artifacts.map(item => item.core), ["CM7", "CM4"]);

  const buildCore = core => spawnSync("cmake", ["--build", build, "--target", `firmware_${core}`], { cwd: project, encoding: "utf8", timeout: 60000 });
  for (const core of ["cm7", "cm4"]) {
    const built = buildCore(core);
    assert.equal(built.status, 0, `${core.toUpperCase()} build failed:\n${built.stdout}\n${built.stderr}`);
    const directory = path.join(build, core.toUpperCase());
    for (const extension of ["elf", "bin", "hex", "map"]) {
      const artifact = path.join(directory, `firmware.${extension}`);
      assert.ok(fs.existsSync(artifact), `Missing ${artifact}; build tree: ${fs.readdirSync(build, { recursive: true }).join(", ")}`);
      assert.ok(fs.statSync(artifact).size > 0);
    }
  }
  const metadata = readCoreBuildMetadata(path.join(__dirname, "..", "resources", "cmake"), build, "Debug");
  for (const core of ["cm7", "cm4"]) {
    const elf = configuredCoreArtifact(metadata, core);
    assert.equal(elf, path.join(build, core.toUpperCase(), "firmware.elf"));
  }
  const builtStatus = extension.getQc1Status(context);
  await extension.writeH7BuildReport(builtStatus, "build");
  const buildReport = JSON.parse(fs.readFileSync(path.join(build, "build-report.json"), "utf8"));
  assert.equal(buildReport.status, "built");
  assert.deepEqual(buildReport.artifacts.map(item => item.buildStatus), ["built", "built"]);
  assert.equal(buildReport.artifacts[0].memoryRegions.some(region => region.name === "FLASH" && region.origin === "0x08000000"), true);
  assert.equal(buildReport.artifacts[1].memoryRegions.some(region => region.name === "FLASH" && region.origin === "0x08100000"), true);
  for (const [core, origin] of [["CM7", "08000000"], ["CM4", "08100000"]]) {
    const elf = path.join(build, core, "firmware.elf");
    const sections = spawnSync("arm-none-eabi-objdump", ["-h", elf], { encoding: "utf8" });
    assert.equal(sections.status, 0, sections.stderr);
    assert.match(sections.stdout, new RegExp(`\\.text[\\s\\S]*?${origin}`));
  }
});
