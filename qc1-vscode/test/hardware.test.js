const assert = require("node:assert/strict");
const test = require("node:test");

const {
  getOpenOcdProgramArgs,
  getOpenOcdServerArgs,
  getStFlashWriteArgs,
  getCortexDebugConfiguration,
  readFlashOrigin,
  readStlinkProbeModel,
  readStlinkProbeStatus
} = require("../out/qc1/hardware");

test("parses real st-info probe counts", () => {
  assert.equal(readStlinkProbeStatus("Found 1 stlink programmers"), "OK");
  assert.equal(readStlinkProbeStatus("Found 0 stlink programmers"), "non détecté");
  assert.equal(readStlinkProbeStatus("unrelated output"), "non testé");
  assert.equal(readStlinkProbeModel("version: V3J15M7"), "ST-LINK V3 (variante exacte non confirmée)");
  assert.equal(readStlinkProbeModel("probe: STLINK-V3E"), "STLINK-V3E");
});

test("builds configured OpenOCD STM32F1 arguments", () => {
  assert.deepEqual(getOpenOcdServerArgs(), [
    "-f", "interface/stlink.cfg", "-f", "target/stm32f1x.cfg"
  ]);
  assert.deepEqual(getOpenOcdProgramArgs("/tmp/firmware.elf"), [
    "-f", "interface/stlink.cfg", "-f", "target/stm32f1x.cfg",
    "-c", "program {/tmp/firmware.elf} verify reset exit"
  ]);
});

test("requests a reset from the st-flash fallback", () => {
  assert.deepEqual(getStFlashWriteArgs("firmware.bin"), [
    "--reset", "write", "firmware.bin", "0x08000000"
  ]);
});

test("selects STM32H7 OpenOCD and the requested core", () => {
  assert.deepEqual(getOpenOcdServerArgs("stm32h755", true), [
    "-f", "interface/stlink-dap.cfg", "-c", "set DUAL_CORE 1", "-f", "target/stm32h7x.cfg"
  ]);
  assert.deepEqual(getOpenOcdProgramArgs("CM4 firmware.elf", "stm32h755", true, "cm4"), [
    "-f", "interface/stlink-dap.cfg", "-c", "set DUAL_CORE 1", "-f", "target/stm32h7x.cfg",
    "-c", "targets stm32h7x.cpu1; program {CM4 firmware.elf} verify reset exit"
  ]);
});

test("derives st-flash addresses from linker MEMORY instead of core assumptions", () => {
  const linker = "MEMORY\n{\n  FLASH (rx) : ORIGIN = 0x08100000, LENGTH = 1024K\n  RAM (xrw) : ORIGIN = 0x24000000, LENGTH = 512K\n}\n";
  assert.equal(readFlashOrigin(linker), "0x08100000");
  assert.deepEqual(getStFlashWriteArgs("cm4.bin", "0x08100000"), ["--reset", "write", "cm4.bin", "0x08100000"]);
});

test("creates separate Cortex-Debug launch configurations for H755 cores", () => {
  const cm7 = getCortexDebugConfiguration("/project", "/build/cm7.elf", "stm32h755", "cm7");
  const cm4 = getCortexDebugConfiguration("/project", "/build/cm4.elf", "stm32h755", "cm4");
  assert.equal(cm7.targetProcessor, 0);
  assert.equal(cm4.targetProcessor, 1);
  assert.equal(cm7.numberOfProcessors, 2);
  assert.deepEqual(cm4.configFiles, ["interface/stlink-dap.cfg", "target/stm32h7x.cfg"]);
});

test("keeps an STM32F1 Cortex-Debug configuration", () => {
  const f1 = getCortexDebugConfiguration("/project", "/build/f1.elf", "stm32f1");
  assert.deepEqual(f1.configFiles, ["interface/stlink.cfg", "target/stm32f1x.cfg"]);
  assert.equal(f1.device, "STM32F103");
  assert.equal(f1.targetProcessor, undefined);
});
