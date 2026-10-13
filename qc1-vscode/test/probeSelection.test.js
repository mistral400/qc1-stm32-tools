const assert = require("node:assert/strict");
const os = require("node:os");
const test = require("node:test");

const {
  readStlinkProbeInventory,
  isValidStlinkSerial,
  normalizeStlinkProbeAssignments,
  projectProbeSelectionKey,
  probeSelectionMatchesProject,
  stlinkSerialLabel,
  redactStlinkSerials,
  probeMatchesFamily,
} = require("../out/qc1/probeSelection");

test("parses separate probes without mistaking hla-serial for another device", () => {
  const probes = readStlinkProbeInventory(`Found 2 stlink programmers
serial: 303030303030303030303030
hla-serial: 303030303030303030303030
version: V3J15M7
chipid: 0x410
descr: Blue Pill ST-LINK
serial: abcdef1234567890
hla-serial: abcdef1234567890
version: V2J45S7
chipid: 0x450
descr: NUCLEO-H755ZI-Q ST-LINK`);
  assert.deepEqual(probes, [
    { serialNumber: "303030303030303030303030", firmware: "V3J15M7", chipId: "0x410", description: "Blue Pill ST-LINK" },
    { serialNumber: "ABCDEF1234567890", firmware: "V2J45S7", chipId: "0x450", description: "NUCLEO-H755ZI-Q ST-LINK" },
  ]);
  assert.deepEqual(readStlinkProbeInventory("Found 0 stlink programmers"), []);
});

test("validates serials, labels them without exposing the whole identifier, and redacts logs", () => {
  const serial = "303030303030303030303030";
  assert.equal(isValidStlinkSerial(serial), true);
  assert.equal(isValidStlinkSerial("device-serial"), false);
  assert.equal(stlinkSerialLabel(serial), "ST-LINK …3030");
  const output = redactStlinkSerials([
    `serial: ${serial}`,
    `Info : STLINK V3 serial: ${serial}`,
    `adapter serial ${serial}`,
    `openocd: ${serial}`,
    `st-flash --serial ${serial} write firmware.bin`,
  ].join("\n"));
  assert.doesNotMatch(output, new RegExp(serial));
  assert.match(output, /<redacted>/);

  const quotedStFlashInvocation = redactStlinkSerials(`"st-flash" "--serial" "${serial}" "--reset" "write" firmware.bin 0x08000000`);
  assert.doesNotMatch(quotedStFlashInvocation, new RegExp(serial));
  assert.ok(quotedStFlashInvocation.includes('"--serial" "<redacted>"'));

  const quotedEqualsInvocation = redactStlinkSerials(`"st-flash" "--serial=${serial}" "write" firmware.bin`);
  assert.doesNotMatch(quotedEqualsInvocation, new RegExp(serial));
});

test("keys project probe assignments without storing the project path", () => {
  const first = projectProbeSelectionKey("/Users/example/Code/firmware");
  assert.match(first, /^[\da-f]{64}$/);
  assert.notEqual(first, "/Users/example/Code/firmware");
  if (os.platform() === "win32") assert.equal(projectProbeSelectionKey("C:\\Code\\Firmware"), projectProbeSelectionKey("c:\\code\\firmware"));
});

test("a delayed OpenOCD probe choice remains bound to the original project and serial", () => {
  const f103 = "/work/BluePill-F103";
  const h755 = "/work/NUCLEO-H755ZI-Q";
  const serialA = "303030303030303030303030";
  const serialB = "abcdef1234567890";
  assert.equal(probeSelectionMatchesProject(f103, f103, serialA, serialA.toLowerCase()), true);
  assert.equal(probeSelectionMatchesProject(f103, h755, serialA, serialA), false);
  assert.equal(probeSelectionMatchesProject(f103, f103, serialA, serialB), false);
  assert.equal(probeSelectionMatchesProject(f103, f103, "invalid", serialA), false);
});

test("discards malformed persisted probe mappings before use", () => {
  const key = "a".repeat(64);
  assert.deepEqual(normalizeStlinkProbeAssignments({
    [key]: "abcdef1234567890",
    badKey: "3030303030303030",
    ["b".repeat(64)]: "not-a-serial",
  }), { [key]: "ABCDEF1234567890" });
  assert.deepEqual(normalizeStlinkProbeAssignments(null), {});
  assert.deepEqual(normalizeStlinkProbeAssignments(["3030303030303030"]), {});
});

test("uses chip and description evidence to reject a probe from another MCU family", () => {
  const f103 = { serialNumber: "303030303030303030303030", chipId: "0x410", description: "ST-LINK" };
  const h755 = { serialNumber: "abcdef1234567890", chipId: "0x450", description: "NUCLEO-H755ZI-Q" };
  assert.equal(probeMatchesFamily(f103, "stm32f1"), true);
  assert.equal(probeMatchesFamily(f103, "stm32h755"), false);
  assert.equal(probeMatchesFamily(h755, "stm32h755"), true);
  assert.equal(probeMatchesFamily(h755, "stm32f1"), false);
  const h745 = { serialNumber: "1111111122222222", chipId: "0x450", description: "NUCLEO-H745ZI-Q ST-LINK" };
  assert.equal(probeMatchesFamily(h745, "stm32h7"), true);
  assert.equal(probeMatchesFamily(h745, "stm32h755"), false, "a shared H7 chip ID does not identify the exact H755 model");
});
