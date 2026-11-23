import type { GenerationPreferences } from "./types";

export const REGIX_ENGINE_VERSION = "0.1.0";

export const defaultRegixPreferences: GenerationPreferences = {
  deviceId: "STM32F103CBT6",
  boardProfileId: "unconfirmed",
  mode: "bare-metal",
  comments: "detailed",
  commentsLanguage: "fr",
  showHex: true,
  showBin: true,
  showDec: true,
  explainOffsetsAndMasks: true,
  macroPrefix: "REGIX",
  functionPrefix: "REGIX",
  emitDefines: true,
  outputKind: "snippet",
  previewRequired: true,
  expertMode: false,
};

export function normalizePrefix(value: string, fallback: string): string {
  const normalized = value.trim()
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[^A-Za-z]+/, "")
    .replace(/_+$/, "");
  return (normalized || fallback).slice(0, 32);
}

export function validateRegixPreferences(value: unknown): GenerationPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Préférences REGIX invalides.");
  const input = value as Record<string, unknown>;
  const expectedKeys = Object.keys(defaultRegixPreferences);
  if (Object.keys(input).some((key) => !expectedKeys.includes(key)))
    throw new Error("Une préférence REGIX inconnue a été fournie.");

  const candidate = { ...defaultRegixPreferences, ...input };
  if (typeof candidate.deviceId !== "string" || !["STM32F103CBT6", "STM32F103C8T6"].includes(candidate.deviceId))
    throw new Error("Modèle REGIX non pris en charge.");
  if (candidate.boardProfileId !== "unconfirmed") throw new Error("Profil de carte non pris en charge.");
  if (candidate.mode !== "bare-metal" && candidate.mode !== "cmsis") throw new Error("Mode REGIX invalide.");
  if (candidate.comments !== "none" && candidate.comments !== "simple" && candidate.comments !== "detailed")
    throw new Error("Style de commentaires REGIX invalide.");
  if (candidate.commentsLanguage !== "fr" && candidate.commentsLanguage !== "en")
    throw new Error("Langue des commentaires REGIX invalide.");
  for (const key of ["showHex", "showBin", "showDec", "explainOffsetsAndMasks", "emitDefines", "previewRequired", "expertMode"] as const)
    if (typeof candidate[key] !== "boolean") throw new Error(`Préférence REGIX invalide : ${key}.`);
  if (candidate.outputKind !== "snippet" && candidate.outputKind !== "files")
    throw new Error("Format de sortie REGIX invalide.");
  if (typeof candidate.macroPrefix !== "string" || typeof candidate.functionPrefix !== "string" ||
      candidate.macroPrefix.length > 64 || candidate.functionPrefix.length > 64)
    throw new Error("Préfixe REGIX invalide.");

  return {
    ...candidate,
    macroPrefix: normalizePrefix(candidate.macroPrefix, "REGIX").toUpperCase(),
    functionPrefix: normalizePrefix(candidate.functionPrefix, "REGIX"),
  } as GenerationPreferences;
}
