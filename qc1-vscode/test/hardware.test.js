const assert = require("node:assert/strict");
const test = require("node:test");

const {
  getOpenOcdProgramArgs,
  getOpenOcdMultiProgramArgs,
  getOpenOcdServerArgs,
  getStFlashWriteArgs,
  getStFlashReadArgs,
  getStFlashResetArgs,
  getCortexDebugConfiguration,
  readFlashOrigin,
  readStlinkProbeModel,
  readStlinkProbeStatus,
  readOpenOcdTargetFamily
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

test("OpenOCD reset profiles are explicit, ordered before programming and never interpolate raw commands", () => {
  const software = getOpenOcdProgramArgs("/tmp/f103.elf", "stm32f1", false, undefined, undefined, false, { mode: "software" });
  assert.deepEqual(software.slice(4), ["-c", "reset_config signals none srst_nogate", "-c", "cortex_m reset_config sysresetreq", "-c", "program {/tmp/f103.elf} verify; reset run; shutdown"]);
  assert.match(software.at(-1), /reset run; shutdown/);
  assert.doesNotMatch(software.join(" "), /soft_reset_halt/);

  const hardware = getOpenOcdProgramArgs("/tmp/f103.elf", "stm32f1", false, undefined, undefined, false, {
    mode: "hardware-nrst", adapterSpeedKHz: 800, srstPulseWidthMs: 20, srstDelayMs: 150,
  });
  assert.deepEqual(hardware.slice(4, 12), [
    "-c", "adapter speed 800", "-c", "adapter srst pulse_width 20", "-c", "adapter srst delay 150", "-c", "reset_config srst_only srst_nogate",
  ]);
  assert.match(hardware.at(-1), /program \{\/tmp\/f103\.elf\} verify; reset run; shutdown/);
  assert.throws(() => getOpenOcdProgramArgs("/tmp/a} ; reset; {b.elf"), /Tcl OpenOCD/);

  const underReset = getOpenOcdProgramArgs("/tmp/f103.elf", "stm32f1", false, undefined, undefined, false, { mode: "connect-under-reset" });
  assert.ok(underReset.includes("reset_config srst_only srst_nogate connect_assert_srst"));
});

test("OpenOCD reset profiles apply once after both H7 images and configure Cortex-Debug", () => {
  const profile = { mode: "connect-under-reset", srstDelayMs: 100 };
  const args = getOpenOcdMultiProgramArgs([
    { core: "cm7", elfPath: "/build/cm7.elf" }, { core: "cm4", elfPath: "/build/cm4.elf" },
  ], "stm32h755", undefined, profile);
  assert.ok(args.includes("reset_config srst_only srst_nogate connect_assert_srst"));
  assert.match(args.at(-1), /program \{\/build\/cm4\.elf\} verify; reset run; shutdown$/);
  assert.equal((args.at(-1).match(/reset run/g) || []).length, 1);
  const debug = getCortexDebugConfiguration("/f103", "/f103/build/main.elf", "stm32f1", undefined, false, undefined, "STM32F103", profile);
  assert.deepEqual(debug.openOCDLaunchCommands, ["adapter srst delay 100", "reset_config srst_only srst_nogate connect_assert_srst"]);
});

test("routes OpenOCD, st-flash, and Cortex-Debug to an explicitly selected ST-Link", () => {
  const serial = "303030303030303030303030";
  assert.deepEqual(getOpenOcdServerArgs("stm32f1", false, serial), [
    "-f", "interface/stlink.cfg", "-c", `adapter serial ${serial}`, "-f", "target/stm32f1x.cfg"
  ]);
  assert.deepEqual(getOpenOcdServerArgs("stm32h755", true, serial), [
    "-f", "interface/stlink-dap.cfg", "-c", `adapter serial ${serial}`, "-c", "transport select dapdirect_swd",
    "-c", "set DUAL_CORE 1", "-c", "set DUAL_BANK 1", "-f", "target/stm32h7x.cfg"
  ]);
  assert.deepEqual(getStFlashWriteArgs("firmware.bin", "0x08000000", serial), ["--serial", serial, "write", "firmware.bin", "0x08000000"]);
  assert.deepEqual(getStFlashReadArgs("readback.bin", "0x08000000", 1024, serial), ["--serial", serial, "read", "readback.bin", "0x08000000", "0x400"]);
  assert.deepEqual(getStFlashResetArgs(serial), ["--serial", serial, "reset"]);
  assert.equal(getCortexDebugConfiguration("/project", "/build/app.elf", "stm32f1", undefined, false, serial).serialNumber, serial);
  assert.throws(() => getStFlashWriteArgs("firmware.bin", "0x08000000", "not-a-serial"), /série ST-Link invalide/);
  assert.throws(() => getOpenOcdServerArgs("stm32f1", false, "not-a-serial"), /série ST-Link invalide/);
});

test("st-flash write, independent read and reset are separate commands", () => {
  assert.deepEqual(getStFlashWriteArgs("firmware.bin"), ["write", "firmware.bin", "0x08000000"]);
  assert.deepEqual(getStFlashReadArgs("readback.bin", "0x08000000", 0x100), ["read", "readback.bin", "0x08000000", "0x100"]);
  assert.deepEqual(getStFlashResetArgs(), ["reset"]);
  assert.throws(() => getStFlashReadArgs("readback.bin", "0x08000000", 0), /Taille/);
  assert.throws(() => getStFlashReadArgs("readback.bin", "0xnot-hex", 4), /Adresse/);
});

test("selects STM32H7 OpenOCD and the requested core", () => {
  assert.deepEqual(getOpenOcdServerArgs("stm32h755", true), [
    "-f", "interface/stlink-dap.cfg", "-c", "transport select dapdirect_swd", "-c", "set DUAL_CORE 1", "-c", "set DUAL_BANK 1", "-f", "target/stm32h7x.cfg"
  ]);
  assert.deepEqual(getOpenOcdProgramArgs("CM4 firmware.elf", "stm32h755", true, "cm4"), [
    "-f", "interface/stlink-dap.cfg", "-c", "transport select dapdirect_swd", "-c", "set DUAL_CORE 1", "-c", "set DUAL_BANK 1", "-f", "target/stm32h7x.cfg",
    "-c", "targets stm32h7x.cpu1; program {CM4 firmware.elf} verify reset exit"
  ]);
});

test("derives st-flash addresses from linker MEMORY instead of core assumptions", () => {
  const linker = "MEMORY\n{\n  FLASH (rx) : ORIGIN = 0x08100000, LENGTH = 1024K\n  RAM (xrw) : ORIGIN = 0x24000000, LENGTH = 512K\n}\n";
  assert.equal(readFlashOrigin(linker), "0x08100000");
  assert.deepEqual(getStFlashWriteArgs("cm4.bin", "0x08100000"), ["write", "cm4.bin", "0x08100000"]);
});

test("creates separate Cortex-Debug launch configurations for H755 cores", () => {
  const cm7 = getCortexDebugConfiguration("/project", "/build/cm7.elf", "stm32h755", "cm7", true);
  const cm4 = getCortexDebugConfiguration("/project", "/build/cm4.elf", "stm32h755", "cm4", true);
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

test("H755 CM7 uses cpu0 and single-core/F103 never enable dual banks", () => {
  assert.match(getOpenOcdProgramArgs("/build folder/App_CM7.elf", "stm32h755", true, "cm7").at(-1), /^targets stm32h7x.cpu0; program \{/);
  for (const family of ["stm32f1", "stm32h755"]) {
    assert.ok(!getOpenOcdServerArgs(family, false).join(" ").includes("DUAL_"));
    const debug = getCortexDebugConfiguration("/project", "/build/app.elf", family, "cm7", false);
    assert.equal(debug.openOCDPreConfigLaunchCommands, undefined);
  }
  assert.ok(!getOpenOcdServerArgs("stm32f1", true).join(" ").includes("DUAL_"));
  const cm4Only = getOpenOcdProgramArgs("/build/App_CM4.elf", "stm32h755", false, "cm4");
  assert.ok(cm4Only.includes("set DUAL_CORE 1"));
  assert.ok(cm4Only.includes("set DUAL_BANK 1"));
  assert.match(cm4Only.at(-1), /^targets stm32h7x.cpu1;/);
});

test("a named STLINK is not a successful probe when target examination fails", () => {
  assert.equal(readStlinkProbeStatus("Info : STLINK V3J5M2 (API v3) VID:PID 0483:374E\nError: target examination failed"), "non testé");
});

test("OpenOCD target-family evidence comes from runtime target names", () => {
  assert.equal(readOpenOcdTargetFamily("Info : [stm32f1x.cpu] Cortex-M3 processor detected"), "stm32f1");
  assert.equal(readOpenOcdTargetFamily("Info : [stm32h7x.cpu0] Cortex-M7 processor detected"), "stm32h7");
  assert.equal(readOpenOcdTargetFamily("Info : STLINK V3J5M2 (API v3)"), undefined);
  assert.equal(readOpenOcdTargetFamily("stm32f1x.cpu stm32h7x.cpu0"), undefined);
});

test("routes generic H7 targets through the dual-core OpenOCD transport and preserves the exact device for Cortex-Debug", () => {
  const { getOpenOcdServerArgs, getOpenOcdProgramArgs, getCortexDebugConfiguration } = require("../out/qc1/hardware");
  const args = getOpenOcdServerArgs("stm32h7", true);
  assert.ok(args.includes("interface/stlink-dap.cfg"));
  assert.ok(args.includes("target/stm32h7x.cfg"));
  assert.ok(args.includes("set DUAL_CORE 1"));
  assert.ok(args.includes("set DUAL_BANK 1"));
  assert.match(getOpenOcdProgramArgs("/build/CM4.elf", "stm32h7", true, "cm4").at(-1), /^targets stm32h7x.cpu1;/);
  const debug = getCortexDebugConfiguration("/project", "/build/CM7.elf", "stm32h7", "cm7", true, undefined, "STM32H745ZI");
  assert.equal(debug.device, "STM32H745ZI");
  assert.deepEqual(debug.configFiles, ["interface/stlink-dap.cfg", "target/stm32h7x.cfg"]);
});

test("programs and verifies both H7 cores before issuing one final reset", () => {
  const args = getOpenOcdMultiProgramArgs([
    { core: "cm4", elfPath: "/build/CM4 firmware.elf" },
    { core: "cm7", elfPath: "/build/CM7 firmware.elf" },
  ], "stm32h7");
  const script = args.at(-1);
  assert.match(script, /^targets stm32h7x\.cpu0; program \{\/build\/CM7 firmware\.elf\} verify; targets stm32h7x\.cpu1; program \{\/build\/CM4 firmware\.elf\} verify reset exit$/);
  assert.equal((script.match(/\breset\b/g) || []).length, 1);
  assert.throws(() => getOpenOcdMultiProgramArgs([{ core: "cm7", elfPath: "/build/CM7.elf" }], "stm32h7"), /CM7 et un ELF CM4/);
});

test("H755 probe uses OpenOCD first, bounded and without mutating firmware", async () => {
  const { probeStlink } = require("../out/qc1/hardware");
  const calls = [];
  const result = await probeStlink({ family: "stm32h755", dualCore: true, openocd: "/tools/openocd", stInfo: "/tools/st-info" }, async (exe, args, opts) => {
    calls.push({ exe, args, opts });
    return { exitCode: 0, stdout: "", stderr: "Info : STLINK V3J5M2 (API v3) VID:PID 0483:374E\nTarget voltage: 3.28", timedOut: false, truncated: false };
  });
  assert.equal(result.status, "OK");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].exe, "/tools/openocd");
  assert.equal(calls[0].opts.timeoutMs, 8000);
  assert.equal(calls[0].args.at(-1), "init; targets; shutdown");
  assert.doesNotMatch(calls[0].args.join(" "), /\b(?:program|erase|reset|halt)\b/);
});

test("selected-probe OpenOCD preflight uses one serial and redacts it from returned logs", async () => {
  const { probeStlink } = require("../out/qc1/hardware");
  const serial = "303030303030303030303030";
  let called;
  const result = await probeStlink({ family: "stm32f1", dualCore: false, openocd: "openocd", serialNumber: serial }, async (exe, args) => {
    called = { exe, args };
    return { exitCode: 0, stdout: `Info : STLINK V3J5M2 (API v3) VID:PID 0483:374E serial: ${serial}\nInfo : [stm32f1x.cpu] Cortex-M3 processor detected`, stderr: "", timedOut: false, truncated: false };
  });
  assert.equal(result.status, "OK");
  assert.equal(result.targetFamily, "stm32f1");
  assert.ok(called.args.includes(`adapter serial ${serial}`));
  assert.doesNotMatch(result.stdout, new RegExp(serial));
});

test("st-info timeout cannot hide an adapter detected by the fallback OpenOCD", async () => {
  const { probeStlink } = require("../out/qc1/hardware");
  const calls = [];
  const result = await probeStlink({ family: "stm32f1", dualCore: false, openocd: "openocd", stInfo: "st-info" }, async exe => {
    calls.push(exe);
    return exe === "st-info"
      ? { exitCode: null, stdout: "", stderr: "", timedOut: true, error: "Process timeout", truncated: false }
      : { exitCode: 0, stdout: "STLINK V3J5M2 (API v3) VID:PID 0483:374E", stderr: "", timedOut: false, truncated: false };
  });
  assert.deepEqual(calls, ["st-info", "openocd"]);
  assert.equal(result.status, "OK");
});

test("st-info remains a fallback when OpenOCD cannot detect the H755 adapter", async () => {
  const { probeStlink } = require("../out/qc1/hardware");
  const calls = [];
  const result = await probeStlink({ family: "stm32h755", dualCore: true, openocd: "openocd", stInfo: "st-info" }, async exe => {
    calls.push(exe);
    return { exitCode: exe === "st-info" ? 0 : 1, stdout: exe === "st-info" ? "Found 1 stlink programmers" : "", stderr: "", timedOut: false, truncated: false };
  });
  assert.deepEqual(calls, ["openocd", "st-info"]);
  assert.equal(result.status, "OK");
  assert.match(result.warning, /OpenOCD a échoué/);
});

test("OpenOCD target failure and timeout cannot be reported as successful detection", async () => {
  const { probeStlink } = require("../out/qc1/hardware");
  const result = await probeStlink({ family: "stm32h755", dualCore: true, openocd: "openocd" }, async () => ({
    exitCode: 1, stdout: "Info : STLINK V3J5M2 (API v3) VID:PID 0483:374E", stderr: "Error: target examination failed", timedOut: false, truncated: false
  }));
  assert.equal(result.status, "non testé");
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /OpenOCD a échoué/);
  const timedOut = await probeStlink({ family: "stm32h755", dualCore: true, openocd: "openocd" }, async () => ({
    exitCode: null, stdout: "Info : STLINK V3J5M2 (API v3)", stderr: "", timedOut: true, truncated: false
  }));
  assert.equal(timedOut.status, "non testé");
});
