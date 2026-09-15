const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { resolveExecutable, runProcess } = require("../out/qc1/processTools");

test("bundled STM32F1 CMake performs a real ARM build", async (t) => {
  const cmake = resolveExecutable("cmake");
  const gcc = resolveExecutable("arm-none-eabi-gcc");
  if (!cmake || !gcc) { t.skip("CMake or Arm GNU Toolchain not installed"); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qc1-f1-build-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "Src");
  const build = path.join(root, "build");
  fs.mkdirSync(source, { recursive: true });
  const startup = path.join(source, "startup_stm32f103xb.s");
  const linker = path.join(root, "stm32f103xb_flash.ld");
  fs.writeFileSync(path.join(source, "main.c"), "int main(void) { for (;;) {} }\n");
  fs.writeFileSync(startup, [
    ".syntax unified", ".cpu cortex-m3", ".thumb", ".global g_pfnVectors", ".global Reset_Handler",
    '.section .isr_vector,"a",%progbits', "g_pfnVectors:", ".word 0x20005000", ".word Reset_Handler",
    '.section .text.Reset_Handler,"ax",%progbits', ".thumb_func", "Reset_Handler:", "bl main", "b .", ""
  ].join("\n"));
  fs.writeFileSync(linker, "ENTRY(Reset_Handler)\nMEMORY { FLASH (rx) : ORIGIN = 0x08000000, LENGTH = 128K\nRAM (rwx) : ORIGIN = 0x20000000, LENGTH = 20K }\nSECTIONS { .isr_vector : { KEEP(*(.isr_vector)) } > FLASH\n.text : { *(.text*) *(.rodata*) } > FLASH\n.data : { *(.data*) } > RAM AT > FLASH\n.bss : { *(.bss*) *(COMMON) } > RAM }\n");
  const resource = path.resolve(__dirname, "..", "resources", "cmake");
  const configure = await runProcess(cmake, [
    "-S", resource, "-B", build,
    `-DCMAKE_TOOLCHAIN_FILE=${path.join(resource, "arm-none-eabi-toolchain.cmake")}`,
    `-DQC1_PROJECT_ROOT=${root}`,
    `-DQC1_SOURCE_DIR=${source}`,
    `-DQC1_STARTUP=${startup}`,
    `-DQC1_LINKER_SCRIPT=${linker}`,
    `-DQC1_ARM_GCC=${gcc}`
  ], { timeoutMs: 60000 });
  assert.equal(configure.exitCode, 0, configure.stderr || configure.error);
  const compilation = await runProcess(cmake, ["--build", build, "--parallel"], { timeoutMs: 60000 });
  assert.equal(compilation.exitCode, 0, compilation.stderr || compilation.error);
  for (const extension of ["elf", "bin", "hex", "map"]) assert.ok(fs.existsSync(path.join(build, `firmware.${extension}`)), extension);
});
