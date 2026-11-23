const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  REGIX_ENGINE_VERSION,
  calculateBits,
  calculateFieldValue,
  calculateGpioConfiguration,
  calculateMask,
  calculateRegisterAddress,
  assertValidRegisterDefinitions,
  defaultRegixPreferences,
  extractBits,
  formatAddress,
  formatUnsigned32,
  generateGpioCCode,
  getDatabaseMetadata,
  getBoardProfileCatalog,
  getRegixSchemas,
  getDeviceModel,
  getPackagePins,
  getRegister,
  getRegisterField,
  listRegisters,
  parseUnsigned32,
  validateRegisterAccess,
  validateRegixPreferences,
} = require("../out/regix");
const { parseWebviewMessage } = require("../out/dashboard/webviewMessages");
const { getDashboardHtml } = require("../out/dashboard/dashboardHtml");
const { defaultDashboardState } = require("../out/dashboard/dashboardState");
const { dashboardClient } = require("../out/dashboard/dashboardClient");
const extensionSource = fs.readFileSync(path.join(__dirname, "../src/extension.ts"), "utf8");

const pc13Request = { deviceId: "STM32F103CBT6", pinId: "PC13", modeId: "outputPushPull2MHz" };

test("REGIX has its independent version and versioned offline data", () => {
  assert.equal(REGIX_ENGINE_VERSION, "0.1.0");
  assert.equal(getDatabaseMetadata().schemaVersion, "1.0.0");
  assert.equal(getDatabaseMetadata().databaseVersion, "0.1.0");
  assert.ok(getDatabaseMetadata().sources.some((source) => source.document === "RM0008" && source.revision === "21"));
  assert.equal(getBoardProfileCatalog().schemaVersion, "1.0.0");
  assert.deepEqual(getBoardProfileCatalog().profiles, []);
  assert.equal(getRegixSchemas().database.$id, "urn:qc1:regix:database-schema:1.0.0");
  assert.equal(getRegixSchemas().gpioRecipe.$id, "urn:qc1:regix:gpio-recipe-schema:1.0.0");
  assert.equal(getRegixSchemas().database.$defs.packagePin.properties.remapRequired.type, "string");
  assert.doesNotThrow(() => assertValidRegisterDefinitions(listRegisters()));
});

test("STM32F103CBT6 and C8T6 stay distinct while sharing CMSIS class and LQFP48", () => {
  const cb = getDeviceModel("STM32F103CBT6");
  const c8 = getDeviceModel("STM32F103C8T6");
  assert.equal(cb.flashKiB, 128);
  assert.equal(c8.flashKiB, 64);
  assert.equal(cb.cmsisClass, "STM32F103xB");
  assert.equal(c8.cmsisClass, "STM32F103xB");
  assert.equal(cb.packageId, "LQFP48");
  assert.equal(getPackagePins(cb.id).find((pin) => pin.name === "PC13").physicalPin, 2);
});

test("PC13 through PC15 share the datasheet output limits and PD0/PD1 require remapping", () => {
  const pins = getPackagePins("STM32F103CBT6");
  for (const pinName of ["PC13", "PC14", "PC15"]) {
    const pin = pins.find((candidate) => candidate.name === pinName);
    assert.equal(pin.maxOutputMHz, 2);
    assert.equal(pin.maxLoadPf, 30);
    assert.equal(pin.maxSinkCurrentMilliamp, 3);
    assert.equal(pin.canSourceCurrent, false);
    assert.throws(() => calculateGpioConfiguration({ deviceId: "STM32F103CBT6", pinId: pinName, modeId: "outputPushPull10MHz" }), /limitée à 2 MHz/);
  }
  for (const pinName of ["PD0", "PD1"])
    assert.throws(() => calculateGpioConfiguration({ deviceId: "STM32F103CBT6", pinId: pinName, modeId: "outputPushPull2MHz" }), /AFIO_MAPR\.PD01_REMAP/);
});

test("GPIOC_CRH resolves to 0x40011004 and PC13 occupies bits 23:20", () => {
  const register = getRegister("GPIOC_CRH");
  assert.equal(register.address, 0x40011004);
  assert.equal(calculateRegisterAddress(register.baseAddress, register.offset), 0x40011004);
  assert.equal(formatAddress(register.address), "0x40011004");
  const mode = getRegisterField(register, "MODE13");
  const cnf = getRegisterField(register, "CNF13");
  assert.equal(mode.lsb, 20);
  assert.equal(mode.width, 2);
  assert.equal(cnf.lsb, 22);
  assert.equal(calculateMask(4, 20), 0x00f00000);
  assert.equal(calculateMask(mode.width, mode.lsb) | calculateMask(cnf.width, cnf.lsb), 0x00f00000);
  assert.throws(() => calculateRegisterAddress(1, 0), /aligné 32 bits/);
  const malformed = { ...register, fields: register.fields.map((field, index) => index === 1 ? { ...field, lsb: 21 } : field) };
  assert.throws(() => assertValidRegisterDefinitions([malformed]), /chevauchants/);
  assert.throws(() => assertValidRegisterDefinitions([{ ...register, access: "unsupported" }]), /Métadonnées d'accès/);
});

test("PC13 push-pull 2 MHz configuration and GPIOC clock enable are exact", () => {
  const result = calculateGpioConfiguration(pc13Request);
  assert.equal(result.gpioRegister.id, "GPIOC_CRH");
  assert.equal(result.gpioRegister.address, 0x40011004);
  assert.equal(result.configShift, 20);
  assert.equal(result.configMask, 0x00f00000);
  assert.equal(result.configValue, 0x00200000);
  assert.equal(result.rccRegister.id, "RCC_APB2ENR");
  assert.equal(result.rccRegister.address, 0x40021018);
  assert.equal(result.rccMask, 0x10);
  assert.throws(() => calculateGpioConfiguration({ ...pc13Request, modeId: "outputPushPull10MHz" }), /limitée à 2 MHz/);
  assert.throws(() => calculateGpioConfiguration({ ...pc13Request, deviceId: "STM32F103C8T6", pinId: "PA13" }), /débogage/);
  const bare = generateGpioCCode(pc13Request, { ...defaultRegixPreferences, mode: "bare-metal" }).snippet;
  assert.ok(bare.indexOf("*regixRccApb2Enr |=") < bare.indexOf("(void)*regixRccApb2Enr;"));
  assert.ok(bare.indexOf("(void)*regixRccApb2Enr;") < bare.indexOf("*regixGPIOC_CRH ="));
  const cmsis = generateGpioCCode(pc13Request, { ...defaultRegixPreferences, mode: "cmsis" }).snippet;
  assert.ok(cmsis.indexOf("RCC->APB2ENR |=") < cmsis.indexOf("(void)RCC->APB2ENR;"));
  assert.ok(cmsis.indexOf("(void)RCC->APB2ENR;") < cmsis.indexOf("GPIOC->CRH ="));
});

test("field and bit calculations cover unsigned bit 31 and 32-bit masks", () => {
  assert.equal(calculateMask(32), 0xffff_ffff);
  assert.equal(calculateFieldValue(1, 1, 31), 0x8000_0000);
  assert.equal(extractBits(0x8000_0000, 31, 1), 1);
  assert.equal(calculateBits("not", 0, 0, 32), 0xffff_ffff);
  assert.throws(() => calculateMask(2, 31), /limites/);
  assert.throws(() => calculateFieldValue(4, 2, 0), /ne tient pas/);
});

test("HEX, BIN and DEC conversions are bounded to unsigned 32-bit values", () => {
  assert.equal(parseUnsigned32("0x40011004"), 0x40011004);
  assert.equal(parseUnsigned32("0b1010"), 10);
  assert.equal(parseUnsigned32("42"), 42);
  assert.deepEqual(formatUnsigned32(42), { hex: "0x0000002A", bin: `0b${"0".repeat(26)}101010`, dec: "42" });
  assert.equal(calculateBits("and", "0xF0", "0x3C"), 0x30);
  assert.equal(calculateBits("or", "0xF0", "0x0F"), 0xff);
  assert.equal(calculateBits("xor", "0xFF", "0x0F"), 0xf0);
  assert.equal(calculateBits("or", "0x10", "0x04", 1), 0x14);
  assert.equal(calculateBits("not", 0, 0, 1), 0xffff_ffff);
  assert.equal(calculateBits("not", 0, "", 1), 0xffff_ffff);
  assert.equal(calculateBits("readBits", "0x10", "", 1, 4), 1);
  assert.equal(calculateBits("readBits", "0x00F00000", 0, 4, 20), 0xf);
  assert.throws(() => parseUnsigned32("-1"), /entier décimal/);
  assert.throws(() => parseUnsigned32("0x100000000"), /dépasse 32 bits/);
});

test("register access validation respects RO, WO, read side effects and command writes", () => {
  const idr = getRegister("GPIOC_IDR");
  const bsrr = getRegister("GPIOC_BSRR");
  assert.equal(validateRegisterAccess(idr, "read").allowed, true);
  assert.equal(validateRegisterAccess(idr, "write").allowed, false);
  assert.equal(validateRegisterAccess(idr, "read-modify-write").allowed, false);
  assert.equal(validateRegisterAccess(bsrr, "read").allowed, false);
  assert.equal(validateRegisterAccess(bsrr, "write").allowed, true);
  assert.equal(validateRegisterAccess(bsrr, "read-modify-write").allowed, false);
  assert.equal(validateRegisterAccess({ access: "read-write", readSideEffects: true, writeSideEffects: false, writeSemantics: "normal" }, "read").allowed, false);
  assert.equal(validateRegisterAccess({ access: "read-write", readSideEffects: true, writeSideEffects: false, writeSemantics: "normal" }, "read", true).allowed, true);
  assert.equal(validateRegisterAccess({ access: "write-one-to-clear", readSideEffects: false, writeSideEffects: true, writeSemantics: "write-one-to-clear" }, "read-modify-write").allowed, false);
});

test("catalog covers GPIO registers and RCC APB2 fields with access metadata", () => {
  const ids = new Set(listRegisters().map((register) => register.id));
  for (const id of ["RCC_APB2ENR", "GPIOA_CRL", "GPIOA_CRH", "GPIOC_IDR", "GPIOC_ODR", "GPIOC_BSRR", "GPIOC_BRR"])
    assert.ok(ids.has(id), `${id} is in the catalog`);
  const clock = getRegister("RCC_APB2ENR");
  assert.equal(getRegisterField(clock, "IOPCEN").mask, 0x10);
  assert.equal(getRegister("GPIOC_BRR").writeSemantics, "command");
});

test("bare-metal and CMSIS generators produce deterministic snippets and separate files", () => {
  const bareMetal = generateGpioCCode(pc13Request, { ...defaultRegixPreferences, mode: "bare-metal", outputKind: "snippet" });
  assert.match(bareMetal.snippet, /volatile uint32_t/);
  assert.match(bareMetal.snippet, /0x40021018UL/);
  assert.match(bareMetal.snippet, /0x00F00000UL/);
  assert.match(bareMetal.snippet, /0x00200000UL/);
  assert.match(bareMetal.snippet, /regixRccApb2Enr \|=/);
  assert.equal(bareMetal.functionName, "REGIX_GPIOC_ConfigurerPC13");

  const cmsisFiles = generateGpioCCode(pc13Request, { ...defaultRegixPreferences, mode: "cmsis", outputKind: "files" });
  assert.match(cmsisFiles.header, /#include "stm32f1xx.h"/);
  assert.match(cmsisFiles.header, /#ifndef STM32F103xB/);
  assert.doesNotMatch(cmsisFiles.header, /#define STM32F103xB/);
  assert.match(cmsisFiles.source, /RCC->APB2ENR \|= RCC_APB2ENR_IOPCEN/);
  assert.match(cmsisFiles.source, /GPIOC->CRH/);
  assert.match(cmsisFiles.source, /#include "regix_pc13.h"/);
  assert.equal(cmsisFiles.headerFileName, "regix_pc13.h");
  assert.equal(cmsisFiles.sourceFileName, "regix_pc13.c");

  const noMacros = generateGpioCCode(pc13Request, { ...defaultRegixPreferences, emitDefines: false, comments: "none" });
  assert.match(noMacros.snippet, /static const uint32_t/);
  assert.doesNotMatch(noMacros.snippet, /\/\*/);
});

test("REGIX preferences validate the window options and normalize C prefixes", () => {
  const preferences = validateRegixPreferences({ ...defaultRegixPreferences, macroPrefix: "9 regix-tools", functionPrefix: "_Regix" });
  assert.equal(preferences.macroPrefix, "REGIX_TOOLS");
  assert.equal(preferences.functionPrefix, "Regix");
  assert.equal(validateRegixPreferences({ ...defaultRegixPreferences, macroPrefix: "MACRO_", functionPrefix: "Func_" }).macroPrefix, "MACRO");
  assert.equal(validateRegixPreferences({ ...defaultRegixPreferences, macroPrefix: "MACRO_", functionPrefix: "Func_" }).functionPrefix, "Func");
  assert.equal(preferences.previewRequired, true);
  assert.throws(() => validateRegixPreferences({ ...defaultRegixPreferences, boardProfileId: "TEP" }), /Profil de carte/);
  assert.throws(() => validateRegixPreferences({ ...defaultRegixPreferences, mode: "ai" }), /Mode REGIX/);
});

const cCompiler = ["arm-none-eabi-gcc", "gcc", "clang"].find((compiler) => childProcess.spawnSync(compiler, ["--version"], { encoding: "utf8" }).status === 0);

test("generated bare-metal and CMSIS C pass a C compiler", { skip: !cCompiler && "No C compiler is installed" }, () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "regix-c-"));
  const fakeCmsis = `#ifndef TEST_STM32F1XX_H\n#define TEST_STM32F1XX_H\n#include <stdint.h>\ntypedef struct { volatile uint32_t APB2ENR; } RCC_TypeDef;\ntypedef struct { volatile uint32_t CRL, CRH, IDR, ODR, BSRR, BRR; } GPIO_TypeDef;\n#define RCC ((RCC_TypeDef *)(uintptr_t)0x40021000UL)\n#define GPIOC ((GPIO_TypeDef *)(uintptr_t)0x40011000UL)\n#define RCC_APB2ENR_IOPCEN (0x10UL)\n#endif\n`;
  fs.writeFileSync(path.join(tempDirectory, "stm32f1xx.h"), fakeCmsis);
  try {
    const bareMetal = generateGpioCCode(pc13Request, { ...defaultRegixPreferences, mode: "bare-metal", outputKind: "snippet" });
    const barePath = path.join(tempDirectory, "regix_baremetal.c");
    fs.writeFileSync(barePath, bareMetal.snippet);
    let result = childProcess.spawnSync(cCompiler, ["-std=c11", "-Wall", "-Wextra", "-Werror", "-c", barePath, "-o", path.join(tempDirectory, "regix_baremetal.o")], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const bareMetalFiles = generateGpioCCode(pc13Request, { ...defaultRegixPreferences, mode: "bare-metal", outputKind: "files" });
    fs.writeFileSync(path.join(tempDirectory, bareMetalFiles.headerFileName), bareMetalFiles.header);
    const bareFilesPath = path.join(tempDirectory, bareMetalFiles.sourceFileName);
    fs.writeFileSync(bareFilesPath, bareMetalFiles.source);
    result = childProcess.spawnSync(cCompiler, ["-std=c11", "-Wall", "-Wextra", "-Werror", "-c", "-I", tempDirectory, bareFilesPath, "-o", path.join(tempDirectory, "regix_baremetal_files.o")], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const cmsisFiles = generateGpioCCode(pc13Request, { ...defaultRegixPreferences, mode: "cmsis", outputKind: "files" });
    fs.writeFileSync(path.join(tempDirectory, cmsisFiles.headerFileName), cmsisFiles.header);
    const cmsisPath = path.join(tempDirectory, cmsisFiles.sourceFileName);
    fs.writeFileSync(cmsisPath, cmsisFiles.source);
    result = childProcess.spawnSync(cCompiler, ["-std=c11", "-Wall", "-Wextra", "-Werror", "-DSTM32F103xB", "-c", "-I", tempDirectory, cmsisPath, "-o", path.join(tempDirectory, "regix_cmsis.o")], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    result = childProcess.spawnSync(cCompiler, ["-std=c11", "-DSTM32F103xB", "-DSTM32F103xE", "-c", "-I", tempDirectory, cmsisPath, "-o", path.join(tempDirectory, "regix_cmsis_conflict.o")], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /REGIX target conflicts/);

    const pa0 = generateGpioCCode({ deviceId: "STM32F103CBT6", pinId: "PA0", modeId: "outputPushPull2MHz" }, { ...defaultRegixPreferences, mode: "bare-metal", outputKind: "files", emitDefines: false });
    const pa1 = generateGpioCCode({ deviceId: "STM32F103CBT6", pinId: "PA1", modeId: "outputPushPull2MHz" }, { ...defaultRegixPreferences, mode: "bare-metal", outputKind: "files", emitDefines: false });
    fs.writeFileSync(path.join(tempDirectory, pa0.headerFileName), pa0.header);
    fs.writeFileSync(path.join(tempDirectory, pa1.headerFileName), pa1.header);
    const combinedHeadersPath = path.join(tempDirectory, "combined_regix_headers.c");
    fs.writeFileSync(combinedHeadersPath, `#include "${pa0.headerFileName}"\n#include "${pa1.headerFileName}"\n`);
    result = childProcess.spawnSync(cCompiler, ["-std=c11", "-Wall", "-Wextra", "-Werror", "-c", "-I", tempDirectory, combinedHeadersPath, "-o", path.join(tempDirectory, "combined_regix_headers.o")], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("REGIX WebView accepts only validated catalog IDs, preferences and operations", () => {
  assert.deepEqual(parseWebviewMessage({ type: "regixSelectRegister", registerId: "GPIOC_CRH" }), { type: "regixSelectRegister", registerId: "GPIOC_CRH" });
  assert.equal(parseWebviewMessage({ type: "regixSelectRegister", registerId: "<script>" }), undefined);
  assert.equal(parseWebviewMessage({ type: "regixGenerate", deviceId: "STM32F103CBT6", pinId: "PC13", modeId: "outputPushPull2MHz" }).type, "regixGenerate");
  assert.equal(parseWebviewMessage({ type: "regixGenerate", deviceId: "STM32F103CBT6", pinId: "PC0", modeId: "outputPushPull2MHz" }), undefined);
  assert.equal(parseWebviewMessage({ type: "regixOpenPreview", target: "javascript", deviceId: "STM32F103CBT6", pinId: "PC13", modeId: "outputPushPull2MHz" }), undefined);
  assert.equal(parseWebviewMessage({ type: "regixOpenPreview", target: ["snippet"], deviceId: "STM32F103CBT6", pinId: "PC13", modeId: "outputPushPull2MHz" }), undefined);
  assert.equal(parseWebviewMessage({ type: "regixCalculate", operation: "xor", left: "0x10", right: "0x02", offset: 0, width: 32 }).type, "regixCalculate");
  assert.equal(parseWebviewMessage({ type: "regixCalculate", operation: "exec", left: "1", right: "1", offset: 0, width: 1 }), undefined);
  assert.deepEqual(parseWebviewMessage({ type: "regixSavePreferences", preferences: { showHex: false } }), { type: "regixSavePreferences", preferences: { showHex: false } });
  assert.equal(parseWebviewMessage({ type: "regixSavePreferences", preferences: { unknownOption: true } }), undefined);
});

test("QC1 dashboard exposes REGIX as an accessible tab with explicit preview controls", () => {
  const html = getDashboardHtml(defaultDashboardState, "regixPanel");
  assert.match(html, /id="regixTab"[^>]*aria-controls="regixPanel"/);
  assert.match(html, /id="regixPanel"[^>]*aria-labelledby="regixTab"/);
  assert.match(html, /Register Engineering &amp; Generation Engine/);
  assert.match(html, /PC13/);
  assert.match(html, /Prévisualiser le code/);
  assert.match(html, /onglet C non enregistré/);
  assert.match(html, /data-remap-required="AFIO_MAPR\.PD01_REMAP"/);
  assert.match(html, /Décalage de champ \(Lire un champ seulement\)/);
  assert.match(dashboardClient, /msg\.type==='regixPreview'/);
  assert.match(dashboardClient, /msg\.type==='regixPreviewInvalidated'/);
  assert.match(dashboardClient, /if\(!window\.regixPreviewFiles\)setRegixPreviewTargets\(preferences\.outputKind\)/);
  assert.match(dashboardClient, /const options=outputKind==='files'/);
  assert.match(dashboardClient, /const options=outputKind==='files'/);
  assert.match(dashboardClient, /preferences:\{\[key\]:preferences\[key\]\}/);
  assert.match(extensionSource, /lastRegixPreviews = new Map<vscode\.Webview/);
  assert.match(extensionSource, /lastRegixPreviews\.get\(webview\)/);
  assert.match(dashboardClient, /\.textContent=code/);
});
