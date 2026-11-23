import { calculateGpioConfiguration } from "./recipes/gpioConfiguration";
import { formatAddress } from "./catalog";
import { formatUnsigned32 } from "./bitMath";
import type { GeneratedCode, GenerationPreferences, GpioConfigurationRequest, GpioConfigurationResult } from "./types";

interface GeneratedIdentifiers {
  macroPrefix: string;
  functionName: string;
  clockAddress: string;
  clockMask: string;
  gpioAddress: string;
  configMask: string;
  configValue: string;
  odrAddress: string;
  odrMask: string;
  odrValue: string;
}

function makeIdentifiers(result: GpioConfigurationResult, preferences: GenerationPreferences): GeneratedIdentifiers {
  const macroPrefix = preferences.macroPrefix.toUpperCase();
  const pinToken = result.pin.name;
  return {
    macroPrefix,
    functionName: `${preferences.functionPrefix}_${result.gpioRegister.peripheral}_Configurer${pinToken}`,
    clockAddress: `${macroPrefix}_RCC_APB2ENR_ADDRESS`,
    clockMask: `${macroPrefix}_RCC_APB2ENR_IOP${result.pin.port}EN_MASK`,
    gpioAddress: `${macroPrefix}_${result.gpioRegister.name}_ADDRESS`,
    configMask: `${macroPrefix}_${result.gpioRegister.name}_${pinToken}_MASK`,
    configValue: `${macroPrefix}_${result.gpioRegister.name}_${pinToken}_CONFIG`,
    odrAddress: `${macroPrefix}_${result.gpioRegister.peripheral}_ODR_ADDRESS`,
    odrMask: `${macroPrefix}_${result.gpioRegister.peripheral}_ODR_${pinToken}_MASK`,
    odrValue: `${macroPrefix}_${result.gpioRegister.peripheral}_ODR_${pinToken}_VALUE`,
  };
}

function literal(value: number, width = 8): string {
  return `0x${value.toString(16).toUpperCase().padStart(width, "0")}UL`;
}

function cConstant(name: string, value: number, preferences: GenerationPreferences): string {
  if (preferences.emitDefines) return `#define ${name} (${literal(value)})`;
  const variable = name.toLowerCase().replace(/_([a-z0-9])/g, (_match, character: string) => character.toUpperCase());
  return `static const uint32_t ${variable} = UINT32_C(0x${value.toString(16).toUpperCase().padStart(8, "0")});`;
}

function cReference(name: string, preferences: GenerationPreferences): string {
  if (preferences.emitDefines) return name;
  return name.toLowerCase().replace(/_([a-z0-9])/g, (_match, character: string) => character.toUpperCase());
}

function constantLines(result: GpioConfigurationResult, preferences: GenerationPreferences, ids: GeneratedIdentifiers): string[] {
  const lines: string[] = [];
  if (preferences.mode === "bare-metal") {
    lines.push(cConstant(ids.clockAddress, result.rccRegister.address, preferences));
    lines.push(cConstant(ids.clockMask, result.rccMask, preferences));
    lines.push(cConstant(ids.gpioAddress, result.gpioRegister.address, preferences));
  }
  lines.push(cConstant(ids.configMask, result.configMask, preferences));
  lines.push(cConstant(ids.configValue, result.configValue, preferences));
  if (result.odrMask !== undefined && result.odrValue !== undefined) {
    if (preferences.mode === "bare-metal") lines.push(cConstant(ids.odrAddress, result.gpioRegister.baseAddress + 12, preferences));
    lines.push(cConstant(ids.odrMask, result.odrMask, preferences));
    lines.push(cConstant(ids.odrValue, result.odrValue, preferences));
  }
  return lines;
}

function selectedValues(values: Record<string, number>, preferences: GenerationPreferences): string[] {
  const rows: string[] = [];
  for (const [name, value] of Object.entries(values)) {
    const bases = formatUnsigned32(value);
    const selected = [
      preferences.showHex ? `HEX ${bases.hex}` : "",
      preferences.showBin ? `BIN ${bases.bin}` : "",
      preferences.showDec ? `DEC ${bases.dec}` : "",
    ].filter(Boolean);
    rows.push(`${name}: ${selected.join(" · ")}`);
  }
  return rows;
}

function generatedComments(result: GpioConfigurationResult, preferences: GenerationPreferences, values: Record<string, number>): string[] {
  if (preferences.comments === "none") return [];
  const french = preferences.commentsLanguage === "fr";
  const lines = [
    french
      ? `/* Configure ${result.pin.name} en ${result.modeLabelFr.toLowerCase()}. */`
      : `/* Configure ${result.pin.name} as ${result.modeLabelEn.toLowerCase()}. */`,
  ];
  if (preferences.comments === "detailed" && preferences.explainOffsetsAndMasks) {
    lines.push("/*");
    if (french) {
      lines.push(` * ${result.gpioRegister.name} : base ${formatAddress(result.gpioRegister.baseAddress)} + offset ${formatAddress(result.gpioRegister.offset)} = ${formatAddress(result.gpioRegister.address)}.`);
      lines.push(` * Décalage du champ ${result.configShift}; masque ${formatUnsigned32(result.configMask).hex}; valeur ${formatUnsigned32(result.configValue).hex}.`);
      lines.push(` * RCC_APB2ENR : activation de GPIO${result.pin.port}, masque ${formatUnsigned32(result.rccMask).hex}.`);
    } else {
      lines.push(` * ${result.gpioRegister.name}: base ${formatAddress(result.gpioRegister.baseAddress)} + offset ${formatAddress(result.gpioRegister.offset)} = ${formatAddress(result.gpioRegister.address)}.`);
      lines.push(` * Field shift ${result.configShift}; mask ${formatUnsigned32(result.configMask).hex}; value ${formatUnsigned32(result.configValue).hex}.`);
      lines.push(` * RCC_APB2ENR: enable GPIO${result.pin.port}, mask ${formatUnsigned32(result.rccMask).hex}.`);
    }
    for (const row of selectedValues(values, preferences)) lines.push(` * ${row}`);
    lines.push(" */");
  }
  return lines;
}

function cmsisIncludes(deviceClass: string): string[] {
  const conflictingDefines = [
    "STM32F100xB", "STM32F100xE", "STM32F101x6", "STM32F101xB", "STM32F101xE", "STM32F101xG",
    "STM32F102x6", "STM32F102xB", "STM32F103x6", "STM32F103xE", "STM32F103xG", "STM32F105xC", "STM32F107xC",
  ];
  return [
    `#if ${conflictingDefines.map((define) => `defined(${define})`).join(" || \\\n    ")}`,
    `#error "REGIX target conflicts with ${deviceClass}; remove the other STM32F1 device define."`,
    "#endif",
    `#ifndef ${deviceClass}`,
    `#error "Define ${deviceClass} in the project before including STM32 CMSIS headers."`,
    "#endif",
    '#include "stm32f1xx.h"',
  ];
}

function headerGuard(result: GpioConfigurationResult, ids: GeneratedIdentifiers): string {
  return `${ids.macroPrefix}_${result.gpioRegister.peripheral}_${result.pin.name}_H`;
}

function bodyLines(result: GpioConfigurationResult, preferences: GenerationPreferences, ids: GeneratedIdentifiers): string[] {
  const gpioName = result.gpioRegister.peripheral;
  const configRegister = result.gpioRegister.name.slice(gpioName.length + 1);
  const gpioTarget = preferences.mode === "cmsis" ? `${gpioName}->${configRegister}` : `*regix${result.gpioRegister.name}`;
  const clockTarget = preferences.mode === "cmsis" ? "RCC->APB2ENR" : "*regixRccApb2Enr";
  const lines = generatedComments(result, preferences, {
    [result.gpioRegister.name]: result.gpioRegister.address,
    [`${result.pin.name}_MASK`]: result.configMask,
    [`${result.pin.name}_CONFIG`]: result.configValue,
    RCC_APB2ENR: result.rccMask,
  });
  lines.push(`void ${ids.functionName}(void)`);
  lines.push("{");
  lines.push(`    ${clockTarget} |= ${preferences.mode === "cmsis" ? `RCC_APB2ENR_IOP${result.pin.port}EN` : cReference(ids.clockMask, preferences)};`);
  lines.push(`    ${preferences.mode === "cmsis" ? "(void)RCC->APB2ENR;" : "(void)*regixRccApb2Enr;"}`);
  if (result.odrMask !== undefined && result.odrValue !== undefined) {
    const odrTarget = preferences.mode === "cmsis" ? `${gpioName}->ODR` : `*regix${gpioName}_ODR`;
    const mask = cReference(ids.odrMask, preferences);
    lines.push(`    ${odrTarget} = (${odrTarget} & ~${mask}) | ${cReference(ids.odrValue, preferences)};`);
  }
  lines.push(`    ${gpioTarget} = (${gpioTarget} & ~${cReference(ids.configMask, preferences)}) | ${cReference(ids.configValue, preferences)};`);
  lines.push("}");
  return lines;
}

function renderTranslationUnit(result: GpioConfigurationResult, preferences: GenerationPreferences, ids: GeneratedIdentifiers, includeHeader: boolean): string {
  const lines = ["#include <stdint.h>"];
  if (preferences.mode === "cmsis") lines.push(...cmsisIncludes(result.device.cmsisClass));
  if (includeHeader) lines.push('#include "regix_gpio.h"');
  if (preferences.mode === "bare-metal") {
    if (!includeHeader) lines.push(...constantLines(result, preferences, ids));
    lines.push(`static volatile uint32_t * const regixRccApb2Enr = (volatile uint32_t *)(uintptr_t)${cReference(ids.clockAddress, preferences)};`);
    lines.push(`static volatile uint32_t * const regix${result.gpioRegister.name} = (volatile uint32_t *)(uintptr_t)${cReference(ids.gpioAddress, preferences)};`);
    if (result.odrMask !== undefined) lines.push(`static volatile uint32_t * const regix${result.gpioRegister.peripheral}_ODR = (volatile uint32_t *)(uintptr_t)${cReference(ids.odrAddress, preferences)};`);
  }
  if (!includeHeader && preferences.mode === "cmsis") lines.push(...constantLines(result, preferences, ids));
  lines.push(...bodyLines(result, preferences, ids));
  return `${lines.join("\n")}\n`;
}

function makeHeader(result: GpioConfigurationResult, preferences: GenerationPreferences, ids: GeneratedIdentifiers): string {
  const guard = headerGuard(result, ids);
  const lines = [`#ifndef ${guard}`, `#define ${guard}`, "", "#include <stdint.h>"];
  if (preferences.mode === "cmsis") lines.push(...cmsisIncludes(result.device.cmsisClass));
  lines.push("");
  lines.push(`void ${ids.functionName}(void);`);
  lines.push("", "#endif");
  return `${lines.join("\n")}\n`;
}

function makeSource(result: GpioConfigurationResult, preferences: GenerationPreferences, ids: GeneratedIdentifiers): string {
  const lines = [`#include "regix_${result.pin.name.toLowerCase()}.h"`, ""];
  lines.push(...constantLines(result, preferences, ids), "");
  if (preferences.mode === "bare-metal") {
    lines.push(`static volatile uint32_t * const regixRccApb2Enr = (volatile uint32_t *)(uintptr_t)${cReference(ids.clockAddress, preferences)};`);
    lines.push(`static volatile uint32_t * const regix${result.gpioRegister.name} = (volatile uint32_t *)(uintptr_t)${cReference(ids.gpioAddress, preferences)};`);
    if (result.odrMask !== undefined) lines.push(`static volatile uint32_t * const regix${result.gpioRegister.peripheral}_ODR = (volatile uint32_t *)(uintptr_t)${cReference(ids.odrAddress, preferences)};`);
    lines.push("");
  }
  lines.push(...bodyLines(result, preferences, ids));
  return `${lines.join("\n")}\n`;
}

export function generateGpioCCode(request: GpioConfigurationRequest, preferences: GenerationPreferences): GeneratedCode {
  const result = calculateGpioConfiguration(request);
  const ids = makeIdentifiers(result, preferences);
  const values: Record<string, number> = {
    gpioAddress: result.gpioRegister.address,
    gpioOffset: result.gpioRegister.offset,
    configShift: result.configShift,
    configMask: result.configMask,
    configValue: result.configValue,
    rccAddress: result.rccRegister.address,
    rccMask: result.rccMask,
  };
  if (result.odrMask !== undefined) values.odrMask = result.odrMask;
  const explanations = result.explanations.filter((_line, index) => preferences.explainOffsetsAndMasks || index === 0 || index >= 3);
  const output: GeneratedCode = {
    outputKind: preferences.outputKind,
    functionName: ids.functionName,
    explanations,
    warnings: [...result.warnings],
    values,
  };
  if (preferences.outputKind === "snippet") {
    output.snippet = renderTranslationUnit(result, preferences, ids, false);
  } else {
    output.headerFileName = `regix_${result.pin.name.toLowerCase()}.h`;
    output.sourceFileName = `regix_${result.pin.name.toLowerCase()}.c`;
    output.header = makeHeader(result, preferences, ids);
    output.source = makeSource(result, preferences, ids);
  }
  return output;
}

