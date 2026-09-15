const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { resolveExecutable, runProcess } = require("../out/qc1/processTools");
const { inspectStm32Project } = require("../out/qc1/projectDiscovery");
const { readFileApi } = require("../out/qc1/cmakeFileApi");

function startup(cpu) {
  return [
    ".syntax unified", `.cpu ${cpu}`, ".thumb", ".global g_pfnVectors", ".global Reset_Handler",
    '.section .isr_vector,"a",%progbits', "g_pfnVectors:", ".word 0x24080000", ".word Reset_Handler",
    '.section .text.Reset_Handler,"ax",%progbits', ".thumb_func", "Reset_Handler:", "bl main", "b .", ""
  ].join("\n");
}

function linker(origin) {
  return `ENTRY(Reset_Handler)\nMEMORY { FLASH (rx) : ORIGIN = ${origin}, LENGTH = 1024K\nRAM (rwx) : ORIGIN = 0x24000000, LENGTH = 512K }\nSECTIONS { .isr_vector : { KEEP(*(.isr_vector)) } > FLASH\n.text : { *(.text*) *(.rodata*) } > FLASH\n.data : { *(.data*) } > RAM AT > FLASH\n.bss : { *(.bss*) *(COMMON) } > RAM }\n`;
}

test("representative STM32H755 CMake builds distinct CM7 and CM4 ELF files", async (t) => {
  const cmake = resolveExecutable("cmake");
  const gcc = resolveExecutable("arm-none-eabi-gcc");
  if (!cmake || !gcc) { t.skip("CMake or Arm GNU Toolchain not installed"); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qc1-h755-build-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const build = path.join(root, "build-output");
  for (const core of ["CM7", "CM4"]) fs.mkdirSync(path.join(root, core), { recursive: true });
  fs.mkdirSync(path.join(root, "Drivers", "STM32H7xx_HAL_Driver", "Inc"), { recursive: true });
  fs.mkdirSync(path.join(root, "Drivers", "CMSIS", "Device", "ST", "STM32H7xx", "Include"), { recursive: true });
  fs.writeFileSync(path.join(root, "Drivers", "STM32H7xx_HAL_Driver", "Inc", "stm32h7xx_hal.h"), "");
  fs.writeFileSync(path.join(root, "Drivers", "CMSIS", "core_cm7.h"), "");
  fs.writeFileSync(path.join(root, "Drivers", "CMSIS", "Device", "ST", "STM32H7xx", "Include", "stm32h755xx.h"), "");
  fs.writeFileSync(path.join(root, "board.ioc"), "Mcu.Name=STM32H755ZITx\nboard=NUCLEO-H755ZI-Q\n");
  fs.writeFileSync(path.join(root, "CM7", "main.c"), "#ifndef CORE_CM7\n#error CORE_CM7 missing\n#endif\nint main(void){for(;;){}}\n");
  fs.writeFileSync(path.join(root, "CM4", "main.c"), "#ifndef CORE_CM4\n#error CORE_CM4 missing\n#endif\nint main(void){for(;;){}}\n");
  fs.writeFileSync(path.join(root, "CM7", "startup_stm32h755xx_CM7.s"), startup("cortex-m7"));
  fs.writeFileSync(path.join(root, "CM4", "startup_stm32h755xx_CM4.s"), startup("cortex-m4"));
  fs.writeFileSync(path.join(root, "CM7", "stm32h755xx_flash_CM7.ld"), linker("0x08000000"));
  fs.writeFileSync(path.join(root, "CM4", "stm32h755xx_flash_CM4.ld"), linker("0x08100000"));
  fs.writeFileSync(path.join(root, "CM7", "CMakeLists.txt"), "project(firmware_CM7 C ASM)\nadd_executable(firmware_CM7 main.c startup_stm32h755xx_CM7.s)\ntarget_compile_definitions(firmware_CM7 PRIVATE CORE_CM7 STM32H755xx USE_HAL_DRIVER)\ntarget_compile_options(firmware_CM7 PRIVATE -mcpu=cortex-m7 -mthumb -mfpu=fpv5-d16 -mfloat-abi=hard)\ntarget_link_options(firmware_CM7 PRIVATE -mcpu=cortex-m7 -mthumb -mfpu=fpv5-d16 -mfloat-abi=hard -nostartfiles -T${CMAKE_CURRENT_SOURCE_DIR}/stm32h755xx_flash_CM7.ld)\nset_target_properties(firmware_CM7 PROPERTIES SUFFIX .elf)\n");
  fs.writeFileSync(path.join(root, "CM4", "CMakeLists.txt"), "project(firmware_CM4 C ASM)\nadd_executable(firmware_CM4 main.c startup_stm32h755xx_CM4.s)\ntarget_compile_definitions(firmware_CM4 PRIVATE CORE_CM4 STM32H755xx USE_HAL_DRIVER)\ntarget_compile_options(firmware_CM4 PRIVATE -mcpu=cortex-m4 -mthumb -mfpu=fpv4-sp-d16 -mfloat-abi=hard)\ntarget_link_options(firmware_CM4 PRIVATE -mcpu=cortex-m4 -mthumb -mfpu=fpv4-sp-d16 -mfloat-abi=hard -nostartfiles -T${CMAKE_CURRENT_SOURCE_DIR}/stm32h755xx_flash_CM4.ld)\nset_target_properties(firmware_CM4 PROPERTIES SUFFIX .elf)\n");
  fs.writeFileSync(path.join(root, "CMakeLists.txt"), "cmake_minimum_required(VERSION 3.20)\nproject(NUCLEO_H755ZI_Q C ASM)\nadd_subdirectory(CM7)\nadd_subdirectory(CM4)\n");
  const query = path.join(build, ".cmake", "api", "v1", "query", "client-qc1");
  fs.mkdirSync(query, { recursive: true });
  fs.writeFileSync(path.join(query, "codemodel-v2"), "");
  fs.writeFileSync(path.join(query, "toolchains-v1"), "");
  const toolchain = path.resolve(__dirname, "..", "resources", "cmake", "arm-none-eabi-toolchain.cmake");
  const configure = await runProcess(cmake, ["-S", root, "-B", build, `-DCMAKE_TOOLCHAIN_FILE=${toolchain}`, `-DQC1_ARM_GCC=${gcc}`], { timeoutMs: 60000 });
  assert.equal(configure.exitCode, 0, configure.stderr || configure.error);
  const compilation = await runProcess(cmake, ["--build", build, "--parallel"], { timeoutMs: 60000 });
  assert.equal(compilation.exitCode, 0, compilation.stderr || compilation.error);
  assert.ok(fs.existsSync(path.join(build, "CM7", "firmware_CM7.elf")));
  assert.ok(fs.existsSync(path.join(build, "CM4", "firmware_CM4.elf")));
  const inspection = inspectStm32Project(root, build);
  assert.equal(inspection.architecture.coreMode, "dual");
  assert.deepEqual(inspection.architecture.cm7.missingFlags, []);
  assert.deepEqual(inspection.architecture.cm4.missingFlags, []);
  const configured = readFileApi(build, root);
  assert.ok(configured.targets.some((target) => target.name === "firmware_CM7" && target.definitions.includes("CORE_CM7")));
  assert.ok(configured.targets.some((target) => target.name === "firmware_CM4" && target.definitions.includes("CORE_CM4")));
});
