const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  findStm32Project,
  inspectStm32Project,
  isUsableStm32Project,
  resolveConfiguredProjectPath
} = require("../out/qc1/projectDiscovery");

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "qc1-project-test-"));
}

function write(filePath, content = "") {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

test("detects a native bare-metal CMake project without Core or Drivers", (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(path.join(root, "CMakeLists.txt"), "project(Prog3-Lab-0)\n");
  write(path.join(root, "Src", "main.c"), "int main(void) { return 0; }\n");
  write(path.join(root, "Src", "startup_stm32f103xb.s"));
  write(path.join(root, "stm32f103xb_flash.ld"), "MEMORY {}\n");

  const inspection = inspectStm32Project(root);
  assert.equal(inspection.layout, "native-cmake");
  assert.equal(inspection.projectName, "Prog3-Lab-0");
  assert.equal(isUsableStm32Project(inspection), true);
  assert.equal(inspection.startupPath, path.join(root, "Src", "startup_stm32f103xb.s"));
});

test("ignores stale linker scripts under build and selects the source F103 linker", (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(path.join(root, "CMakeLists.txt"), "project(firmware)\n");
  write(path.join(root, "Src", "main.c"));
  write(path.join(root, "Src", "startup_stm32f103xb.s"));
  write(path.join(root, "stm32f103xb_flash.ld"));
  write(path.join(root, "build", "Debug", "stm32f102xb_flash.ld"));

  assert.equal(inspectStm32Project(root).linkerScriptPath, path.join(root, "stm32f103xb_flash.ld"));
});

test("finds a nested native CMake firmware when auto-detection scans a workspace", (t) => {
  const workspace = fixture();
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const project = path.join(workspace, "course", "labs", "Lab 0", "Prog3-Lab-0");
  write(path.join(project, "CMakeLists.txt"), "project(Prog3-Lab-0)\n");
  write(path.join(project, "Src", "main.c"));
  write(path.join(project, "Src", "startup_stm32f103xb.s"));
  write(path.join(project, "stm32f103xb_flash.ld"));

  assert.equal(findStm32Project(workspace)?.root, project);
});

test("resolves a configured project path relative to the workspace", () => {
  assert.equal(
    resolveConfiguredProjectPath("labs/firmware", "/workspace"),
    path.resolve("/workspace/labs/firmware")
  );
});

test("detects a CubeMX STM32H755 dual-core project from independent evidence", (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(path.join(root, "Nucleo.ioc"), "Mcu.Name=STM32H755ZITx\nProjectManager.TargetToolchain=CMake\n");
  write(path.join(root, "CMakeLists.txt"), "project(NUCLEO_H755ZI_Q)\nadd_subdirectory(CM7)\nadd_subdirectory(CM4)\n");
  write(path.join(root, "CM7", "CMakeLists.txt"), "project(firmware_CM7)\nadd_executable(${PROJECT_NAME} Core/Src/main.c)\ntarget_compile_definitions(${PROJECT_NAME} PRIVATE CORE_CM7 STM32H755xx)\n");
  write(path.join(root, "CM4", "CMakeLists.txt"), "project(firmware_CM4)\nadd_executable(${PROJECT_NAME} Core/Src/main.c)\ntarget_compile_definitions(${PROJECT_NAME} PRIVATE CORE_CM4 STM32H755xx)\n");
  write(path.join(root, "CM7", "Core", "Src", "main.c"));
  write(path.join(root, "CM4", "Core", "Src", "main.c"));
  write(path.join(root, "CM7", "Core", "Startup", "startup_stm32h755xx_CM7.s"));
  write(path.join(root, "CM4", "Core", "Startup", "startup_stm32h755xx_CM4.s"));
  write(path.join(root, "CM7", "STM32H755XX_FLASH_CM7.ld"));
  write(path.join(root, "CM4", "STM32H755XX_FLASH_CM4.ld"));
  write(path.join(root, "Drivers", "STM32H7xx_HAL_Driver", "Inc", "stm32h7xx_hal.h"));
  write(path.join(root, "Drivers", "CMSIS", "Include", "core_cm7.h"));
  write(path.join(root, "Drivers", "CMSIS", "Device", "ST", "STM32H7xx", "Include", "stm32h755xx.h"));
  write(path.join(root, "Drivers", "BSP", "STM32H7xx_Nucleo", "stm32h7xx_nucleo.h"));

  const architecture = inspectStm32Project(root).architecture;
  assert.equal(architecture.family, "stm32h755");
  assert.equal(architecture.board, "NUCLEO-H755ZI-Q");
  assert.equal(architecture.coreMode, "dual");
  assert.equal(architecture.cm7.present, true);
  assert.equal(architecture.cm4.present, true);
  assert.match(architecture.cm7.startupPath, /CM7/);
  assert.match(architecture.cm4.linkerScriptPath, /CM4/);
  assert.match(architecture.halPath, /STM32H7xx_HAL_Driver/);
  assert.match(architecture.cmsisDevicePath, /STM32H7xx/);
  assert.equal(architecture.openOcdTarget, "target/stm32h7x.cfg");
  assert.deepEqual(architecture.cm7.expectedFlags, ["-mcpu=cortex-m7", "-mthumb", "-mfpu=fpv5-d16", "-mfloat-abi=hard"]);
  assert.deepEqual(architecture.cm4.expectedFlags, ["-mcpu=cortex-m4", "-mthumb", "-mfpu=fpv4-sp-d16", "-mfloat-abi=hard"]);
});

test("distinguishes valid H755 CM7-only and CM4-only projects", (t) => {
  const cm7Root = fixture();
  const cm4Root = fixture();
  t.after(() => fs.rmSync(cm7Root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(cm4Root, { recursive: true, force: true }));
  for (const [root, core] of [[cm7Root, "CM7"], [cm4Root, "CM4"]]) {
    write(path.join(root, "CMakeLists.txt"), `project(H755_${core})\nadd_executable(firmware_${core} main.c startup_stm32h755xx_${core}.s)\ntarget_compile_definitions(firmware_${core} PRIVATE STM32H755xx CORE_${core})\n`);
    write(path.join(root, "main.c"));
    write(path.join(root, `startup_stm32h755xx_${core}.s`));
    write(path.join(root, `stm32h755xx_flash_${core}.ld`));
  }
  assert.equal(inspectStm32Project(cm7Root).architecture.coreMode, "cm7");
  assert.equal(inspectStm32Project(cm4Root).architecture.coreMode, "cm4");
});
