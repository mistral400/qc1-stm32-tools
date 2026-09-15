const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  analyzeProject,
  discoverProjects
} = require("../out/qc1/projectScanner");

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "qc1-scanner-test-"));
}

function write(filePath, content = "") {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function f103Linker() {
  return "MEMORY { FLASH (rx) : ORIGIN = 0x08000000, LENGTH = 128K\nRAM (xrw) : ORIGIN = 0x20000000, LENGTH = 20K }\n";
}

function assertF103(candidate, buildSystem) {
  assert.ok(candidate);
  assert.equal(candidate.family, "STM32F1");
  assert.equal(candidate.mcu, "STM32F103xB");
  assert.equal(candidate.architecture, "single-core");
  assert.equal(candidate.cores[0].name, "Cortex-M3");
  assert.equal(candidate.buildSystem, buildSystem);
  assert.ok(candidate.confidence >= 90);
  assert.ok(candidate.evidence.some((item) => item.type === "mcu-define"));
}

test("analyzes an F103 Makefile project without CubeMX, HAL, or CMSIS", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(path.join(root, "Makefile"), [
    "TARGET = Lab_GPIO",
    "CPU = -mcpu=cortex-m3 -mthumb",
    "DEFS = -DSTM32F103xB",
    "LDSCRIPT = stm32f103xb_flash.ld",
    "SOURCES = main.c startup_stm32f103xb.S"
  ].join("\n"));
  write(path.join(root, "main.c"), "int main(void) { return 0; }\n");
  write(path.join(root, "startup_stm32f103xb.S"));
  write(path.join(root, "stm32f103xb_flash.ld"), f103Linker());

  const candidate = await analyzeProject(root);
  assertF103(candidate, "make");
  assert.equal(candidate.name, "Lab_GPIO");
  assert.deepEqual(candidate.missingComponents, []);
  assert.ok(candidate.evidence.some((item) => item.type === "linker-memory" && item.weight === 0));
});

test("analyzes an F103 CMake project without an ioc file", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(path.join(root, "CMakeLists.txt"), [
    "project(F103_CMake C ASM)",
    "add_executable(firmware main.c startup_stm32f103xb.s)",
    "target_compile_definitions(firmware PRIVATE STM32F103xB)",
    "target_compile_options(firmware PRIVATE -mcpu=cortex-m3)",
    "target_link_options(firmware PRIVATE -Tstm32f103xb_flash.ld)"
  ].join("\n"));
  write(path.join(root, "main.c"));
  write(path.join(root, "startup_stm32f103xb.s"));
  write(path.join(root, "stm32f103xb_flash.ld"), f103Linker());

  const candidate = await analyzeProject(root);
  assertF103(candidate, "cmake");
  assert.equal(candidate.name, "F103_CMake");
});

test("does not require HAL when a register-only F103 project never references it", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(path.join(root, "Makefile"), "CFLAGS=-DSTM32F103CB -mcpu=cortex-m3\n");
  write(path.join(root, "main.c"), "#define RCC_BASE 0x40021000u\n");
  const candidate = await analyzeProject(root);

  assert.ok(candidate);
  assert.equal(candidate.mcu, "STM32F103CB");
  assert.equal(candidate.missingComponents.some((item) => item.component === "HAL"), false);
  assert.equal(candidate.missingComponents.some((item) => item.component === "CMSIS"), false);
});

test("reports HAL only when it is referenced and absent", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(path.join(root, "Makefile"), "CFLAGS=-DSTM32F103xB -DUSE_HAL_DRIVER -mcpu=cortex-m3\n");
  write(path.join(root, "main.c"), "#include \"stm32f1xx_hal.h\"\n");
  const candidate = await analyzeProject(root);

  assert.ok(candidate);
  assert.equal(candidate.missingComponents.filter((item) => item.component === "HAL").length, 1);
  assert.equal(candidate.missingComponents.find((item) => item.component === "HAL").severity, "error");
});

async function makeH755Core(root, core) {
  const cpu = core === "CM7" ? "cortex-m7" : "cortex-m4";
  const fpu = core === "CM7" ? "fpv5-d16" : "fpv4-sp-d16";
  write(path.join(root, "CMakeLists.txt"), [
    `project(H755_${core} C ASM)`,
    `add_executable(firmware main.c startup_stm32h755xx_${core}.s)`,
    `target_compile_definitions(firmware PRIVATE STM32H755xx CORE_${core})`,
    `target_compile_options(firmware PRIVATE -mcpu=${cpu} -mfpu=${fpu})`,
    `target_link_options(firmware PRIVATE -Tstm32h755xx_flash_${core}.ld)`
  ].join("\n"));
  write(path.join(root, "main.c"));
  write(path.join(root, `startup_stm32h755xx_${core}.s`));
  write(path.join(root, `stm32h755xx_flash_${core}.ld`), "MEMORY { FLASH (rx) : ORIGIN = 0x08000000, LENGTH = 1M }\n");
  return analyzeProject(root);
}

test("distinguishes an H755 CM7-only project", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const candidate = await makeH755Core(root, "CM7");

  assert.ok(candidate);
  assert.equal(candidate.family, "STM32H7");
  assert.equal(candidate.mcu, "STM32H755xx");
  assert.equal(candidate.architecture, "single-core");
  assert.deepEqual(candidate.cores.map((core) => core.id), ["cm7"]);
  assert.equal(candidate.missingComponents.some((item) => item.component === "CM4"), false);
});

test("distinguishes an H755 CM4-only project", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const candidate = await makeH755Core(root, "CM4");

  assert.ok(candidate);
  assert.equal(candidate.architecture, "single-core");
  assert.deepEqual(candidate.cores.map((core) => core.id), ["cm4"]);
  assert.equal(candidate.missingComponents.some((item) => item.component === "CM7"), false);
});

test("detects H755 dual-core without CM7/CM4 directories or ioc", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(path.join(root, "CMakeLists.txt"), [
    "project(H755_Dual C ASM)",
    "add_executable(firmware_cm7 main_cm7.c startup_stm32h755xx_CM7.s)",
    "add_executable(firmware_cm4 main_cm4.c startup_stm32h755xx_CM4.s)",
    "target_compile_definitions(firmware_cm7 PRIVATE STM32H755xx CORE_CM7)",
    "target_compile_definitions(firmware_cm4 PRIVATE STM32H755xx CORE_CM4)",
    "target_compile_options(firmware_cm7 PRIVATE -mcpu=cortex-m7 -mfpu=fpv5-d16)",
    "target_compile_options(firmware_cm4 PRIVATE -mcpu=cortex-m4 -mfpu=fpv4-sp-d16)",
    "target_link_options(firmware_cm7 PRIVATE -Tstm32h755xx_flash_CM7.ld)",
    "target_link_options(firmware_cm4 PRIVATE -Tstm32h755xx_flash_CM4.ld)"
  ].join("\n"));
  for (const core of ["CM7", "CM4"]) {
    write(path.join(root, `main_${core.toLowerCase()}.c`));
    write(path.join(root, `startup_stm32h755xx_${core}.s`));
    write(path.join(root, `stm32h755xx_flash_${core}.ld`));
  }
  const candidate = await analyzeProject(root);

  assert.ok(candidate);
  assert.equal(candidate.architecture, "dual-core");
  assert.deepEqual(candidate.cores.map((core) => core.id).sort(), ["cm4", "cm7"]);
  assert.equal(candidate.confidence, 100);
  assert.deepEqual(candidate.missingComponents, []);
});

test("uses ioc as strong bonus evidence and detects an explicit NUCLEO board", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(path.join(root, "Board.ioc"), [
    "Mcu.Name=STM32H755ZIT6",
    "Board=NUCLEO-H755ZI-Q",
    "ProjectManager.ProjectName=Board_Demo"
  ].join("\n"));
  write(path.join(root, "CMakeLists.txt"), "project(Board_Demo)\ntarget_compile_definitions(app PRIVATE CORE_CM7)\n");
  const candidate = await analyzeProject(root);

  assert.ok(candidate);
  assert.equal(candidate.mcu, "STM32H755ZIT6");
  assert.equal(candidate.board, "NUCLEO-H755ZI-Q");
  assert.ok(candidate.evidence.some((item) => item.type === "ioc" && item.weight === 50));
});

test("rejects a non-STM32 project and a README-only false positive", async (t) => {
  const plain = fixture();
  const falsePositive = fixture();
  const commentedMake = fixture();
  t.after(() => fs.rmSync(plain, { recursive: true, force: true }));
  t.after(() => fs.rmSync(falsePositive, { recursive: true, force: true }));
  t.after(() => fs.rmSync(commentedMake, { recursive: true, force: true }));
  write(path.join(plain, "CMakeLists.txt"), "project(host_app)\nadd_executable(host main.c)\n");
  write(path.join(plain, "main.c"), "int main(void) { return 0; }\n");
  write(path.join(falsePositive, "README.md"), "This text merely mentions stm32 and STM32F103xB.\n");
  write(path.join(commentedMake, "Makefile"), "# Old example: -DSTM32F103xB -mcpu=cortex-m3\nall:\n\t@true\n");

  assert.equal(await analyzeProject(plain), undefined);
  assert.equal(await analyzeProject(falsePositive), undefined);
  assert.equal(await analyzeProject(commentedMake), undefined);
});

test("reports a referenced linker that is absent", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(path.join(root, "Makefile"), "CFLAGS=-DSTM32F103xB -mcpu=cortex-m3\nLDSCRIPT=missing/stm32f103xb_flash.ld\nLDFLAGS=-T$(LDSCRIPT)\n");
  write(path.join(root, "main.c"));
  const candidate = await analyzeProject(root);

  assert.ok(candidate);
  assert.ok(candidate.missingComponents.some((item) => item.component === "linker" && item.severity === "error"));
});

test("reports a referenced startup that is absent", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(path.join(root, "CMakeLists.txt"), [
    "project(Missing_Startup)",
    "add_executable(firmware main.c startup_stm32f103xb.s)",
    "target_compile_definitions(firmware PRIVATE STM32F103xB)",
    "target_compile_options(firmware PRIVATE -mcpu=cortex-m3)"
  ].join("\n"));
  write(path.join(root, "main.c"));
  const candidate = await analyzeProject(root);

  assert.ok(candidate);
  assert.ok(candidate.missingComponents.some((item) => item.component === "startup" && item.severity === "error"));
});

test("reports CMSIS only when a source references an absent CMSIS header", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(path.join(root, "Makefile"), "CFLAGS=-DSTM32F103CB -mcpu=cortex-m3\n");
  write(path.join(root, "main.c"), "#include \"stm32f103xb.h\"\n");
  const candidate = await analyzeProject(root);

  assert.ok(candidate);
  assert.ok(candidate.missingComponents.some((item) => item.component === "CMSIS"));
});

test("discovers multiple supplied projects and does not execute build scripts", async (t) => {
  const workspace = fixture();
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const makeProject = path.join(workspace, "make-project");
  const cmakeProject = path.join(workspace, "cmake-project");
  const executed = path.join(workspace, "executed.txt");
  write(path.join(makeProject, "Makefile"), `CFLAGS=-DSTM32F103xB -mcpu=cortex-m3\nEVIL=$(shell touch ${executed})\n`);
  write(path.join(makeProject, "main.c"));
  write(path.join(cmakeProject, "CMakeLists.txt"), `project(H755_Static)\nexecute_process(COMMAND touch ${executed})\ntarget_compile_definitions(app PRIVATE STM32H755xx CORE_CM7)\ntarget_compile_options(app PRIVATE -mcpu=cortex-m7)\n`);
  write(path.join(cmakeProject, "main.c"));

  const candidates = await discoverProjects({ roots: [workspace] });
  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates.map((candidate) => candidate.buildSystem).sort(), ["cmake", "make"]);
  assert.equal(fs.existsSync(executed), false);
});

test("supports cancellation through AbortSignal", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    analyzeProject(root, { signal: controller.signal }),
    (error) => error && error.name === "AbortError"
  );
});
