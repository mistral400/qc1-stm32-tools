import { createHash } from "crypto";
import * as path from "path";

export const resetModes = ["backend-default", "software", "hardware-nrst", "connect-under-reset"] as const;
export type ResetMode = typeof resetModes[number];

export interface ResetProfile {
  mode: ResetMode;
  adapterSpeedKHz?: number;
  srstPulseWidthMs?: number;
  srstDelayMs?: number;
}

export const defaultResetProfile: ResetProfile = Object.freeze({ mode: "backend-default" });

export function validateResetProfile(value: unknown): ResetProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Profil de reset invalide.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["mode", "adapterSpeedKHz", "srstPulseWidthMs", "srstDelayMs"].includes(key)))
    throw new Error("Le profil de reset contient un réglage inconnu.");
  const mode = input.mode === undefined ? defaultResetProfile.mode : input.mode;
  if (typeof mode !== "string" || !resetModes.includes(mode as ResetMode)) throw new Error("Mode de reset invalide.");
  const result: ResetProfile = { mode: mode as ResetMode };
  for (const [key, minimum, maximum] of [
    ["adapterSpeedKHz", 1, 10000],
    ["srstPulseWidthMs", 1, 1000],
    ["srstDelayMs", 0, 10000],
  ] as const) {
    const candidate = input[key];
    if (candidate === undefined || candidate === null || candidate === "") continue;
    if (typeof candidate !== "number" || !Number.isInteger(candidate) || candidate < minimum || candidate > maximum)
      throw new Error(`${key} doit être un entier entre ${minimum} et ${maximum}.`);
    result[key] = candidate;
  }
  return result;
}

export function normalizeStoredResetProfile(value: unknown): ResetProfile {
  try { return validateResetProfile(value); }
  catch { return { ...defaultResetProfile }; }
}

export function resetProfileStorageKey(projectPath: string, platform: NodeJS.Platform = process.platform): string {
  const trimmed = projectPath.trim();
  if (!trimmed) return "";
  const normalized = platform === "win32"
    ? path.win32.normalize(trimmed).replace(/\\/g, "/").toLowerCase()
    : path.resolve(trimmed).replace(/\\/g, "/");
  return `qc1.resetProfile.${createHash("sha256").update(normalized).digest("hex")}`;
}

export interface ResetProfileStoragePort {
  get(key: string): unknown;
  update(key: string, value: ResetProfile): PromiseLike<void>;
}

/** Persist only a profile under a project-path hash; the path itself is never stored. */
export class ProjectResetProfileStore {
  private pending: Promise<void> = Promise.resolve();
  constructor(private readonly storage: ResetProfileStoragePort, private readonly platform: NodeJS.Platform = process.platform) {}

  get(projectPath: string): ResetProfile {
    const key = resetProfileStorageKey(projectPath, this.platform);
    if (!key) return { ...defaultResetProfile };
    return normalizeStoredResetProfile(this.storage.get(key));
  }

  async update(projectPath: string, value: unknown): Promise<void> {
    const key = resetProfileStorageKey(projectPath, this.platform);
    if (!key) throw new Error("Un projet actif est requis pour enregistrer le profil de reset.");
    const profile = validateResetProfile(value);
    const operation = this.pending.catch(() => undefined).then(async () => await this.storage.update(key, profile));
    this.pending = operation;
    await operation;
  }
}

export function isResetProfileSupportedByStFlash(profile: ResetProfile): boolean {
  return profile.mode === "backend-default" && profile.adapterSpeedKHz === undefined &&
    profile.srstPulseWidthMs === undefined && profile.srstDelayMs === undefined;
}
