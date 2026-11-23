import * as gpioOutputRecipe from "./gpio-output.json";
import { calculateFieldValue, calculateMask } from "../bitMath";
import { getDeviceModel, getPackagePins, getRegister } from "../catalog";
import { validateRegisterAccess } from "../access";
import type { GpioConfigurationRequest, GpioConfigurationResult, GpioModeId } from "../types";

interface GpioMode {
  id: GpioModeId;
  labelFr: string;
  labelEn: string;
  mode: number;
  cnf: number;
  output: boolean;
  speedMHz?: number;
  odr?: number;
}
interface GpioRecipe {
  schemaVersion: string;
  recipeVersion: string;
  id: string;
  supportedPeripherals: string[];
  modes: GpioMode[];
}

const recipe = gpioOutputRecipe as unknown as GpioRecipe;

export function listGpioModes(): GpioMode[] {
  return recipe.modes.map((mode) => ({ ...mode }));
}

export function getGpioMode(modeId: string): GpioMode {
  const mode = recipe.modes.find((candidate) => candidate.id === modeId);
  if (!mode) throw new Error("Le mode GPIO n'est pas défini dans la recette REGIX.");
  return { ...mode };
}

export function calculateGpioConfiguration(request: GpioConfigurationRequest): GpioConfigurationResult {
  const device = getDeviceModel(request.deviceId);
  const pin = getPackagePins(device.id).find((candidate) => candidate.name === request.pinId);
  if (!pin) throw new Error("Cette broche n'est pas indiquée pour le boîtier sélectionné.");
  const mode = getGpioMode(request.modeId);
  if (pin.remapRequired)
    throw new Error(`${pin.name} nécessite ${pin.remapRequired}; REGIX v0.1 ne configure pas ce remappage.`);
  if (pin.defaultFunction && /(?:SWDIO|SWCLK|JTDI|JTDO|NJTRST)/.test(pin.defaultFunction))
    throw new Error("REGIX v0.1 ne modifie pas AFIO_MAPR; choisissez une broche sans fonction de débogage par défaut.");
  if (mode.output && pin.maxOutputMHz !== undefined && (mode.speedMHz ?? 0) > pin.maxOutputMHz)
    throw new Error(`${pin.name} est limitée à ${pin.maxOutputMHz} MHz en sortie selon la fiche technique.`);

  const registerName = `GPIO${pin.port}_${pin.index < 8 ? "CRL" : "CRH"}`;
  const gpioRegister = getRegister(registerName);
  const rccRegister = getRegister("RCC_APB2ENR");
  const requireSafeReadModifyWrite = (register: ReturnType<typeof getRegister>): void => {
    const validation = validateRegisterAccess(register, "read-modify-write");
    if (!validation.allowed) throw new Error(`${register.id} ne peut pas être modifié par lecture-modification-écriture : ${validation.reason}`);
  };
  requireSafeReadModifyWrite(gpioRegister);
  requireSafeReadModifyWrite(rccRegister);
  if (mode.odr !== undefined) requireSafeReadModifyWrite(getRegister(`GPIO${pin.port}_ODR`));
  for (const fieldName of [`MODE${pin.index}`, `CNF${pin.index}`]) {
    const field = gpioRegister.fields.find((candidate) => candidate.name === fieldName);
    if (!field || field.access !== "read-write") throw new Error(`${gpioRegister.id}.${fieldName} n'est pas un champ RW pris en charge.`);
  }
  const configShift = (pin.index % 8) * 4;
  const configMask = calculateMask(4, configShift);
  const configNibble = mode.cnf * 4 + mode.mode;
  const configValue = calculateFieldValue(configNibble, 4, configShift);
  const portClockBit = pin.port.charCodeAt(0) - "A".charCodeAt(0) + 2;
  const rccMask = calculateMask(1, portClockBit);
  const odrMask = mode.odr === undefined ? undefined : calculateMask(1, pin.index);
  const odrValue = mode.odr === undefined ? undefined : calculateFieldValue(mode.odr, 1, pin.index);
  const explanations = [
    `${pin.name} se configure dans ${gpioRegister.name}, registre à ${gpioRegister.address.toString(16).toUpperCase().padStart(8, "0")}.`,
    `Le quartet de ${pin.name} commence au bit ${configShift}; son masque vaut 0x${configMask.toString(16).toUpperCase().padStart(8, "0")}.`,
    `CNF=${mode.cnf.toString(2).padStart(2, "0")} et MODE=${mode.mode.toString(2).padStart(2, "0")}; le quartet inscrit vaut 0x${configNibble.toString(16).toUpperCase()}.`,
    `L'horloge ${pin.port} est activée dans RCC_APB2ENR avec le bit ${portClockBit} (masque 0x${rccMask.toString(16).toUpperCase().padStart(8, "0")}).`,
  ];
  if (odrMask !== undefined) explanations.push(`ODR_${pin.name} est préparé ${mode.odr ? "à 1 (pull-up)" : "à 0 (pull-down)"} avant le changement de mode.`);
  const warnings: string[] = [];
  if (pin.electricalNote) warnings.push(pin.electricalNote);
  if (pin.defaultFunction) warnings.push(`${pin.name} a aussi la fonction par défaut ${pin.defaultFunction}; vérifier l'utilisation de la broche sur le montage visé.`);
  return {
    device,
    pin,
    modeId: request.modeId,
    modeLabelFr: mode.labelFr,
    modeLabelEn: mode.labelEn,
    gpioRegister,
    rccRegister,
    configShift,
    configMask,
    configValue,
    rccMask,
    odrMask,
    odrValue,
    explanations,
    warnings,
  };
}

