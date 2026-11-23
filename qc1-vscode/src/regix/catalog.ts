import * as stm32f103Database from "./database/stm32f103.json";
import * as boardProfiles from "./database/board-profiles.json";
import * as databaseSchema from "./database/regix-database.schema.json";
import * as boardProfileSchema from "./database/board-profiles.schema.json";
import * as gpioRecipeSchema from "./recipes/gpio-output.schema.json";
import { calculateMask } from "./bitMath";
import type { DatabaseSource, DeviceModel, PackagePin, RegisterAccess, RegisterDefinition, RegisterField, WriteSemantics } from "./types";

type DatabaseField = RegisterField;
interface RegisterTemplate {
  name: string;
  offset: number;
  width: 32;
  access: RegisterAccess;
  readSideEffects: boolean;
  writeSideEffects: boolean;
  writeSemantics: WriteSemantics;
  fieldLayout?: string;
  sourceIds: string[];
  fields?: DatabaseField[];
}
interface DeviceDatabase {
  schemaVersion: string;
  databaseVersion: string;
  sources: DatabaseSource[];
  core: string;
  cmsis: { deviceHeader: string; deviceHeaderVersion: string; deviceDefine: string; sourceId: string };
  deviceModels: DeviceModel[];
  packages: Array<{ id: string; name: string; pinCount: number; sourceId: string; pins: PackagePin[] }>;
  peripheralBases: Record<string, string>;
  registers: { RCC: RegisterTemplate[]; GPIO: RegisterTemplate[] };
}

const database = stm32f103Database as unknown as DeviceDatabase;

function addressNumber(value: string): number {
  if (!/^0x[0-9A-Fa-f]{8}$/.test(value)) throw new Error("Adresse de catalogue invalide.");
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 0xFFFF_FFFF) throw new Error("Adresse de catalogue invalide.");
  return parsed;
}

export function getDatabaseMetadata() {
  return {
    schemaVersion: database.schemaVersion,
    databaseVersion: database.databaseVersion,
    core: database.core,
    cmsis: database.cmsis,
    sources: database.sources.map((source) => ({ ...source })),
  };
}

export function getBoardProfileCatalog() {
  return boardProfiles;
}

export function getRegixSchemas() {
  return { database: databaseSchema, boardProfiles: boardProfileSchema, gpioRecipe: gpioRecipeSchema };
}

const fieldLayouts = new Set(["gpioConfigLow", "gpioConfigHigh", "gpioInputBits", "gpioOutputBits", "gpioSetResetBits", "gpioResetBits"]);

export function assertValidRegisterDefinitions(registers: RegisterDefinition[]): void {
  const ids = new Set<string>();
  const addresses = new Set<number>();
  const sourceIds = new Set(database.sources.map((source) => source.id));
  const registerAccess = new Set<RegisterAccess>(["read-only", "read-write", "write-only", "write-one-to-clear"]);
  const writeSemantics = new Set<WriteSemantics>(["normal", "command", "write-one-to-clear"]);
  for (const register of registers) {
    if (ids.has(register.id)) throw new Error(`Identifiant de registre dupliqué : ${register.id}.`);
    ids.add(register.id);
    if (register.width !== 32 || calculateRegisterAddress(register.baseAddress, register.offset) !== register.address)
      throw new Error(`Adresse ou largeur invalide pour ${register.id}.`);
    if (!registerAccess.has(register.access) || !writeSemantics.has(register.writeSemantics) ||
        typeof register.readSideEffects !== "boolean" || typeof register.writeSideEffects !== "boolean")
      throw new Error(`Métadonnées d'accès invalides pour ${register.id}.`);
    if (addresses.has(register.address)) throw new Error(`Adresse de registre dupliquée : ${formatAddress(register.address)}.`);
    addresses.add(register.address);
    if (register.sourceIds.length === 0 || register.sourceIds.some((sourceId) => !sourceIds.has(sourceId)))
      throw new Error(`Provenance invalide pour ${register.id}.`);
    const names = new Set<string>();
    let usedMask = 0;
    for (const field of register.fields) {
      if (!field.name || !registerAccess.has(field.access)) throw new Error(`Métadonnées de champ invalides dans ${register.id}.`);
      if (names.has(field.name)) throw new Error(`Champ dupliqué dans ${register.id} : ${field.name}.`);
      names.add(field.name);
      const mask = calculateMask(field.width, field.lsb, register.width);
      if ((usedMask & mask) !== 0) throw new Error(`Champs chevauchants dans ${register.id}.`);
      usedMask = (usedMask | mask) >>> 0;
    }
  }
}

export function listDeviceModels(): DeviceModel[] {
  return database.deviceModels.map((device) => ({ ...device }));
}

export function getDeviceModel(deviceId: string): DeviceModel {
  const device = database.deviceModels.find((candidate) => candidate.id === deviceId);
  if (!device) throw new Error("Le modèle de microcontrôleur n'est pas dans le catalogue REGIX.");
  return { ...device };
}

export function getPackagePins(deviceId: string): PackagePin[] {
  const device = getDeviceModel(deviceId);
  const pkg = database.packages.find((candidate) => candidate.id === device.packageId);
  if (!pkg) throw new Error("Le boîtier du modèle n'est pas dans le catalogue REGIX.");
  return pkg.pins.map((pin) => ({ ...pin }));
}

function createPinFields(firstPin: number, count: number, access: RegisterAccess, prefix: string): RegisterField[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `${prefix}${firstPin + index}`,
    lsb: firstPin + index,
    width: 1,
    access,
  }));
}

function layoutFields(layout: string | undefined): RegisterField[] {
  if (layout === "gpioConfigLow" || layout === "gpioConfigHigh") {
    const firstPin = layout === "gpioConfigLow" ? 0 : 8;
    return Array.from({ length: 8 }, (_, index) => {
      const pin = firstPin + index;
      const lsb = index * 4;
      return [
        { name: `MODE${pin}`, lsb, width: 2, access: "read-write" as const },
        { name: `CNF${pin}`, lsb: lsb + 2, width: 2, access: "read-write" as const },
      ];
    }).flat();
  }
  if (layout === "gpioInputBits") return createPinFields(0, 16, "read-only", "IDR");
  if (layout === "gpioOutputBits") return createPinFields(0, 16, "read-write", "ODR");
  if (layout === "gpioSetResetBits") return [
    ...createPinFields(0, 16, "write-only", "BS").map((field) => ({ ...field, lsb: field.lsb })),
    ...createPinFields(0, 16, "write-only", "BR").map((field) => ({ ...field, lsb: field.lsb + 16 })),
  ];
  if (layout === "gpioResetBits") return createPinFields(0, 16, "write-only", "BR");
  return [];
}

function toRegister(peripheral: string, baseAddress: number, template: RegisterTemplate): RegisterDefinition {
  const name = `${peripheral}_${template.name}`;
  if (template.fieldLayout && !fieldLayouts.has(template.fieldLayout)) throw new Error(`Disposition de champs inconnue pour ${name}.`);
  return {
    id: name,
    name,
    peripheral,
    address: calculateRegisterAddress(baseAddress, template.offset),
    baseAddress,
    offset: template.offset,
    width: 32,
    access: template.access,
    readSideEffects: template.readSideEffects,
    writeSideEffects: template.writeSideEffects,
    writeSemantics: template.writeSemantics,
    sourceIds: [...template.sourceIds],
    fields: template.fields ? template.fields.map((field) => ({ ...field })) : layoutFields(template.fieldLayout),
  };
}

export function listRegisters(): RegisterDefinition[] {
  const rccBase = addressNumber(database.peripheralBases.RCC);
  const rcc = database.registers.RCC.map((template) => toRegister("RCC", rccBase, template));
  const gpio = Object.entries(database.peripheralBases)
    .filter(([peripheral]) => peripheral.startsWith("GPIO"))
    .flatMap(([peripheral, base]) => database.registers.GPIO.map((template) => toRegister(peripheral, addressNumber(base), template)));
  const registers = [...rcc, ...gpio];
  assertValidRegisterDefinitions(registers);
  return registers;
}

export function getRegister(registerId: string): RegisterDefinition {
  const register = listRegisters().find((candidate) => candidate.id === registerId);
  if (!register) throw new Error("Le registre n'est pas dans le catalogue REGIX.");
  return register;
}

export function getRegisterField(register: RegisterDefinition, fieldName: string): RegisterField & { mask: number } {
  const field = register.fields.find((candidate) => candidate.name === fieldName);
  if (!field) throw new Error("Le champ n'existe pas dans ce registre.");
  return { ...field, mask: calculateMask(field.width, field.lsb, register.width) };
}

export function formatAddress(address: number): string {
  if (!Number.isInteger(address) || address < 0 || address > 0xFFFF_FFFF) throw new Error("Adresse de registre invalide.");
  return `0x${address.toString(16).toUpperCase().padStart(8, "0")}`;
}

export function getRegisterSources(register: RegisterDefinition): DatabaseSource[] {
  return register.sourceIds.map((sourceId) => {
    const source = database.sources.find((candidate) => candidate.id === sourceId);
    if (!source) throw new Error(`Source de données manquante : ${sourceId}.`);
    return { ...source };
  });
}

export function calculateRegisterAddress(baseAddress: number, offset: number): number {
  if (!Number.isInteger(baseAddress) || !Number.isInteger(offset) || baseAddress < 0 || offset < 0 ||
      baseAddress > 0xFFFF_FFFF || offset > 0xFFFF_FFFF || baseAddress + offset > 0xFFFF_FFFF ||
      (baseAddress & 0x3) !== 0 || (offset & 0x3) !== 0)
    throw new Error("Base ou offset de registre invalide (mot aligné 32 bits requis).");
  return baseAddress + offset;
}

