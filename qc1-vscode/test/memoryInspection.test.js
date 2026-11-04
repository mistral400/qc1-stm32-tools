const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  createMemoryImageReport,
  inspectMemoryArtifact,
  parseLinkerMemoryRegions,
  parseMapMemoryRegions,
  parseObjdumpSections,
  summarizeMemoryInspection,
} = require("../out/qc1/memoryInspection");

const linker = `/* link */
MEMORY {
  FLASH (rx) : ORIGIN = 0x08000000, LENGTH = 128K
  RAM (xrw) : ORIGIN = 0x20000000, LENGTH = 20K
}`;
const map = `Memory Configuration

Name             Origin             Length             Attributes
FLASH            0x0000000008000000 0x0000000000020000 xr
RAM              0x0000000020000000 0x0000000000005000 xrw

Linker script and memory map
`;
const objdump = `Sections:
Idx Name          Size      VMA       LMA       File off  Algn
  0 .isr_vector   00000100  08000000  08000000  00001000  2**2
                  CONTENTS, ALLOC, LOAD, READONLY, DATA
  1 .text         00001000  08000100  08000100  00001100  2**2
                  CONTENTS, ALLOC, LOAD, READONLY, CODE
  2 .data         00000010  20000000  08001100  00002100  2**2
                  CONTENTS, ALLOC, LOAD, DATA
  3 .bss          00000080  20000010  20000010  00000000  2**2
                  ALLOC
  4 .heap          00000020  20000090  20000090  00000000  2**2
                  ALLOC
  5 .debug_info    00002000  00000000  00000000  00002200  2**0
                  CONTENTS, READONLY, DEBUGGING
`;

test("linker script and map regions parse capacities without inventing expression values", () => {
  const fromScript = parseLinkerMemoryRegions(linker);
  assert.deepEqual(fromScript.map(region => [region.name, region.origin, region.length, region.kind]), [
    ["FLASH", 0x08000000, 128 * 1024, "flash"],
    ["RAM", 0x20000000, 20 * 1024, "ram"],
  ]);
  assert.equal(parseLinkerMemoryRegions("MEMORY { FLASH : ORIGIN = ORIGIN(FLASH), LENGTH = LENGTH(FLASH) }")[0].length, undefined);
  const fromMap = parseMapMemoryRegions(map);
  assert.deepEqual(fromMap.map(region => [region.name, region.origin, region.length]), [
    ["FLASH", 0x08000000, 128 * 1024], ["RAM", 0x20000000, 20 * 1024],
  ]);
});

test("objdump parsing ignores non-alloc debug sections and accounts for ELF VMA/LMA separately", () => {
  const sections = parseObjdumpSections(objdump);
  assert.equal(sections.length, 6);
  assert.deepEqual(sections[2], {
    name: ".data", sizeBytes: 16, vma: 0x20000000, lma: 0x08001100,
    flags: ["CONTENTS", "ALLOC", "LOAD", "DATA"],
  });
  const report = createMemoryImageReport({
    artifactPath: "/tmp/f103.elf", core: "STM32", sections,
    regions: parseMapMemoryRegions(map), regionSource: "carte linker", mapPath: "/tmp/f103.map",
  });
  assert.equal(report.flashLoadBytes, 0x1110);
  assert.equal(report.staticRamBytes, 0x90);
  assert.equal(report.textBytes, 0x1100);
  assert.equal(report.dataBytes, 0x10);
  assert.equal(report.bssBytes, 0x80);
  assert.equal(report.otherRamBytes, 0);
  assert.equal(report.runtimeReservationBytes, 0x20);
  assert.equal(report.regions.find(region => region.name === "RAM").usedBytes, 0xb0);
  assert.equal(report.sections.some(section => section.name === ".debug_info"), false);
});

test("separate H7 images retain their own core and linker-region attribution", () => {
  const sections = parseObjdumpSections(objdump);
  const regions7 = parseMapMemoryRegions(map).map(region => region.name === "FLASH" ? { ...region, origin: 0x08000000 } : region);
  const regions4 = parseMapMemoryRegions(map).map(region => region.name === "FLASH" ? { ...region, origin: 0x08100000 } : region);
  const cm7 = createMemoryImageReport({ artifactPath: "/tmp/CM7.elf", core: "CM7", sections, regions: regions7 });
  const cm4 = createMemoryImageReport({ artifactPath: "/tmp/CM4.elf", core: "CM4", sections, regions: regions4 });
  assert.equal(cm7.core, "CM7");
  assert.equal(cm4.core, "CM4");
  assert.equal(cm7.flashLoadBytes, 0x1110);
  assert.equal(cm4.flashLoadBytes, undefined);
  assert.match(cm4.warnings.join(" "), /section chargée/i);
});

test("overflow, unmapped sections, and missing memory expressions remain explicit", () => {
  const sections = [
    { name: ".text", sizeBytes: 0x200, vma: 0x08000000, lma: 0x08000000, flags: ["ALLOC", "LOAD"] },
    { name: ".mystery", sizeBytes: 32, vma: 0x30000000, lma: 0x30000000, flags: ["ALLOC", "LOAD"] },
  ];
  const regions = [
    { name: "FLASH", origin: 0x08000000, length: 0x100, kind: "flash" },
    { name: "RAM", origin: undefined, length: undefined, kind: "ram" },
  ];
  const report = createMemoryImageReport({ artifactPath: "/tmp/f103.elf", core: "STM32", sections, regions });
  assert.equal(report.regions[0].overflow, true);
  assert.equal(report.flashLoadBytes, undefined);
  assert.equal(report.staticRamBytes, undefined);
  assert.ok(report.warnings.some(message => /dépasse/i.test(message)));
  assert.ok(report.warnings.some(message => /expressions/i.test(message)));
  const overlap = createMemoryImageReport({
    artifactPath: "/tmp/f103.elf", core: "STM32",
    sections: [
      { name: ".text", sizeBytes: 0x100, vma: 0x08000000, lma: 0x08000000, flags: ["ALLOC", "LOAD"] },
      { name: ".copy", sizeBytes: 0x80, vma: 0x08000080, lma: 0x08000080, flags: ["ALLOC", "LOAD"] },
    ], regions: [{ name: "FLASH", origin: 0x08000000, length: 0x1000, kind: "flash" }],
  });
  assert.ok(overlap.warnings.some(message => /superposées/i.test(message)));
  const aliased = createMemoryImageReport({
    artifactPath: "/tmp/h7.elf", core: "CM7", sections: [
      { name: ".bss", sizeBytes: 64, vma: 0x24000000, lma: 0x24000000, flags: ["ALLOC"] },
    ], regions: [
      { name: "RAM_D1", origin: 0x24000000, length: 0x1000, kind: "ram" },
      { name: "RAM_ALIAS", origin: 0x24000000, length: 0x800, kind: "ram" },
    ],
  });
  assert.equal(aliased.staticRamBytes, 64);
  assert.equal(aliased.regions[0].usedBytes, undefined);
  assert.ok(aliased.warnings.some(message => /occupation individuelle est ambiguë/i.test(message)));
});

test("inspection uses a mocked read-only objdump process and reports timeout, trust, and stale map cases", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qc1-memory-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const elfPath = path.join(root, "firmware.elf");
  const linkerPath = path.join(root, "memory.ld");
  const mapPath = path.join(root, "firmware.map");
  await fs.writeFile(elfPath, "mock ELF bytes");
  await fs.writeFile(linkerPath, linker);
  await fs.writeFile(mapPath, map);
  const calls = [];
  const runner = async (executable, args, options) => {
    calls.push({ executable, args, options });
    return { exitCode: 0, stdout: objdump, stderr: "", timedOut: false, truncated: false };
  };
  const report = await inspectMemoryArtifact({ artifactPath: elfPath, core: "STM32", linkerPath, mapPath, objdumpPath: "/tools/arm-none-eabi-objdump", trusted: true }, runner);
  assert.equal(report.status, "available");
  assert.equal(report.flashLoadBytes, 0x1110);
  assert.deepEqual(calls[0].args, ["-h", elfPath]);
  assert.equal(calls[0].options.timeoutMs, 8000);
  assert.equal(calls[0].options.maxBytes, 512 * 1024);

  let called = false;
  const untrusted = await inspectMemoryArtifact({ artifactPath: elfPath, core: "STM32", objdumpPath: "/tools/objdump", trusted: false }, async () => { called = true; throw new Error("must not run"); });
  assert.equal(untrusted.status, "unavailable");
  assert.equal(called, false);
  const noTool = await inspectMemoryArtifact({ artifactPath: elfPath, core: "STM32", linkerPath, mapPath, trusted: true });
  assert.equal(noTool.status, "unavailable");
  assert.equal(noTool.regions.find(region => region.name === "FLASH").usedBytes, undefined);
  assert.equal(noTool.regionSource, "carte linker");
  const timedOut = await inspectMemoryArtifact({ artifactPath: elfPath, core: "STM32", objdumpPath: "/tools/objdump", trusted: true }, async () => ({ exitCode: null, stdout: "", stderr: "", timedOut: true, truncated: false }));
  assert.equal(timedOut.status, "error");
  assert.match(timedOut.message, /Timeout/);
  assert.equal(summarizeMemoryInspection([report, timedOut]).status, "partial");
  const truncated = await inspectMemoryArtifact({ artifactPath: elfPath, core: "STM32", objdumpPath: "/tools/truncated-objdump", trusted: true }, async () => ({ exitCode: 0, stdout: objdump, stderr: "", timedOut: false, truncated: true }));
  assert.equal(truncated.status, "error");
  assert.match(truncated.message, /total partiel trompeur/);
  const controller = new AbortController();
  const cancelled = await inspectMemoryArtifact({ artifactPath: elfPath, core: "STM32", objdumpPath: "/tools/cancelled-objdump", trusted: true, signal: controller.signal }, async (_executable, _args, options) => {
    assert.equal(options.signal, controller.signal);
    return { exitCode: null, stdout: "", stderr: "", error: "Cancelled", timedOut: false, truncated: false };
  });
  assert.equal(cancelled.status, "unavailable");

  await fs.writeFile(linkerPath, linker.replace("LENGTH = 128K", "LENGTH = 64K"));
  const now = Date.now() / 1000;
  await fs.utimes(linkerPath, now, now);
  const inconsistent = await inspectMemoryArtifact({ artifactPath: elfPath, core: "STM32", linkerPath, mapPath, objdumpPath: "/tools/mismatch-objdump", trusted: true }, runner);
  assert.equal(inconsistent.regionSource, "carte linker");
  assert.match(inconsistent.warnings.join(" "), /diffère du script actuel/);

  await fs.utimes(linkerPath, now - 3600, now - 3600);
  await fs.utimes(mapPath, now - 1800, now - 1800);
  await fs.utimes(elfPath, now, now);
  const staleMap = await inspectMemoryArtifact({ artifactPath: elfPath, core: "STM32", linkerPath, mapPath, objdumpPath: "/tools/objdump", trusted: true }, runner);
  assert.equal(staleMap.regionSource, "script linker");
  assert.equal(staleMap.mapPath, mapPath);
  assert.match(staleMap.warnings.join(" "), /carte linker.*potentiellement obsolète/i);
});
