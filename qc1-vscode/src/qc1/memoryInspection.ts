/** Static, read-only inspection of ARM ELF sections and linker memory regions. */
import * as fs from "fs/promises";
import * as path from "path";
import { ProcessResult, executableExists, processSucceeded, resolveExecutable, runProcess } from "./processTools";

export type MemoryRegionKind = "flash" | "ram" | "other";
export type MemorySectionKind = "text" | "data" | "bss" | "other";

export interface MemoryRegion {
  name: string;
  origin?: number;
  length?: number;
  kind: MemoryRegionKind;
}

export interface MemorySection {
  name: string;
  sizeBytes: number;
  vma: number;
  lma: number;
  flags: string[];
  kind: MemorySectionKind;
  flashRegion?: string;
  ramRegion?: string;
  runtimeReservation: boolean;
}

export interface MemoryRegionUsage extends MemoryRegion {
  usedBytes?: number;
  utilizationPercent?: number;
  overflow: boolean | null;
}

export interface MemoryImageReport {
  core: "STM32" | "CM7" | "CM4" | "Inconnu";
  status: "available" | "unavailable" | "error";
  artifactPath: string;
  modifiedAt?: string;
  message: string;
  linkerPath?: string;
  mapPath?: string;
  regionSource?: "carte linker" | "script linker";
  flashLoadBytes?: number;
  staticRamBytes?: number;
  textBytes?: number;
  dataBytes?: number;
  bssBytes?: number;
  otherRamBytes?: number;
  runtimeReservationBytes?: number;
  sections: MemorySection[];
  regions: MemoryRegionUsage[];
  warnings: string[];
}

export interface MemoryInspectionReport {
  status: "idle" | "available" | "partial" | "unavailable";
  message: string;
  images: MemoryImageReport[];
}

export interface MemoryInspectionInput {
  artifactPath: string;
  core: MemoryImageReport["core"];
  linkerPath?: string;
  mapPath?: string;
  objdumpPath?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  trusted?: boolean;
  signal?: AbortSignal;
}

export type MemoryInspectionRunner = (
  executable: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs: number; maxBytes: number; signal?: AbortSignal },
) => Promise<ProcessResult>;

const inspectionCache = new Map<string, MemoryImageReport>();

interface ParsedSection {
  name: string;
  sizeBytes: number;
  vma: number;
  lma: number;
  flags: string[];
}

function classifyRegion(name: string): MemoryRegionKind {
  if (/(?:flash|rom|irom|qspi|ospi|xip)/i.test(name)) return "flash";
  if (/(?:ram|sram|dtcm|itcm|ccm|sdram|axi)/i.test(name)) return "ram";
  return "other";
}

function parseInteger(value: string): number | undefined {
  const normalized = value.trim().replace(/[()]/g, "");
  const match = normalized.match(/^(0x[\da-f]+|\d+)([kmg])?$/i);
  if (!match) return undefined;
  const base = /^0x/i.test(match[1]) ? Number.parseInt(match[1].slice(2), 16) : Number.parseInt(match[1], 10);
  const multiplier = match[2]?.toLowerCase() === "k" ? 1024
    : match[2]?.toLowerCase() === "m" ? 1024 ** 2
      : match[2]?.toLowerCase() === "g" ? 1024 ** 3 : 1;
  const result = base * multiplier;
  return Number.isSafeInteger(result) ? result : undefined;
}

function makeRegion(name: string, originText: string, lengthText: string): MemoryRegion {
  return { name, origin: parseInteger(originText), length: parseInteger(lengthText), kind: classifyRegion(name) };
}

export function parseLinkerMemoryRegions(text: string): MemoryRegion[] {
  const uncommented = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const block = uncommented.match(/\bMEMORY\s*\{([\s\S]*?)\}/i)?.[1] || "";
  return [...block.matchAll(/([A-Za-z_][\w.-]*)\s*(?:\([^)]*\))?\s*:\s*ORIGIN\s*=\s*([^,\n]+),\s*LENGTH\s*=\s*([^\n}]+)/gi)]
    .map(match => makeRegion(match[1], match[2], match[3]));
}

export function parseMapMemoryRegions(text: string): MemoryRegion[] {
  const marker = text.match(/Memory Configuration\s*\n/i);
  if (!marker || marker.index === undefined) return [];
  const start = marker.index + marker[0].length;
  const stop = text.slice(start).search(/\n\s*\n|Linker script and memory map/i);
  const table = stop >= 0 ? text.slice(start, start + stop) : text.slice(start, start + 64 * 1024);
  const regions: MemoryRegion[] = [];
  for (const line of table.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][\w.-]*)\s+(0x[\da-f]+|\d+)\s+(0x[\da-f]+|\d+)(?:\s+\S+)?\s*$/i);
    if (match) regions.push(makeRegion(match[1], match[2], match[3]));
  }
  return regions;
}

export function parseObjdumpSections(text: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  let current: ParsedSection | undefined;
  for (const line of text.split(/\r?\n/)) {
    const header = line.match(/^\s*\d+\s+(\S+)\s+([\da-f]+)\s+([\da-f]+)\s+([\da-f]+)\s+[\da-f]+\s+2\*\*\d+/i);
    if (header) {
      if (current) sections.push(current);
      current = {
        name: header[1], sizeBytes: Number.parseInt(header[2], 16),
        vma: Number.parseInt(header[3], 16), lma: Number.parseInt(header[4], 16), flags: [],
      };
      continue;
    }
    if (current && /\b(?:CONTENTS|ALLOC|LOAD|READONLY|DATA|CODE|DEBUGGING)\b/.test(line)) {
      current.flags = line.split(",").map(flag => flag.trim().toUpperCase()).filter(Boolean);
    }
  }
  if (current) sections.push(current);
  return sections.filter(section => Number.isSafeInteger(section.sizeBytes) && section.sizeBytes >= 0 &&
    Number.isSafeInteger(section.vma) && Number.isSafeInteger(section.lma));
}

function sectionKind(name: string): MemorySectionKind {
  if (/^\.(?:text|isr_vector|init|fini)(?:$|[.$])/i.test(name)) return "text";
  if (/^\.(?:sdata|data)(?:$|[.$])/i.test(name)) return "data";
  if (/^\.(?:sbss|bss|noinit|scommon)(?:$|[.$])/i.test(name)) return "bss";
  return "other";
}

function contains(region: MemoryRegion, address: number): boolean {
  return region.origin !== undefined && region.length !== undefined && address >= region.origin && address < region.origin + region.length;
}

function findRegion(regions: MemoryRegion[], address: number, kind: MemoryRegionKind): MemoryRegion | undefined {
  return regions.filter(region => region.kind === kind && contains(region, address))
    .sort((left, right) => (left.length || Number.MAX_SAFE_INTEGER) - (right.length || Number.MAX_SAFE_INTEGER))[0];
}

function emptyImage(input: MemoryInspectionInput, status: MemoryImageReport["status"], message: string): MemoryImageReport {
  return { core: input.core, status, artifactPath: input.artifactPath, message, sections: [], regions: [], warnings: [] };
}

export function createMemoryImageReport(input: {
  artifactPath: string;
  core: MemoryImageReport["core"];
  modifiedAt?: string;
  sections: ParsedSection[];
  regions: MemoryRegion[];
  regionSource?: MemoryImageReport["regionSource"];
  linkerPath?: string;
  mapPath?: string;
  warnings?: string[];
}): MemoryImageReport {
  const warnings = [...(input.warnings || [])];
  if (!input.regions.length) warnings.push("Aucune région MEMORY exploitable : les capacités et le taux d'utilisation restent inconnus.");
  const regions = input.regions.map(region => ({
    ...region,
    usedBytes: region.origin !== undefined && region.length !== undefined && region.kind !== "other" ? 0 : undefined,
    utilizationPercent: undefined as number | undefined,
    overflow: region.origin !== undefined && region.length !== undefined && region.kind !== "other" ? false as boolean | null : null,
  }));
  let flashBytes = 0;
  let staticRamBytes = 0;
  let otherRamBytes = 0;
  let runtimeReservationBytes: number | undefined;
  let unmappedLoad = false;
  let unmappedAllocated = false;
  const addressRanges: Array<{ region: string; start: number; end: number; section: string }> = [];
  const addAddressRange = (region: MemoryRegion | undefined, start: number, size: number, section: string): void => {
    if (region && size > 0) addressRanges.push({ region: region.name, start, end: start + size, section });
  };
  const sectionReports: MemorySection[] = input.sections.filter(section => section.flags.includes("ALLOC") && section.sizeBytes > 0).map(section => {
    const kind = sectionKind(section.name);
    const runtimeReservation = /heap|stack/i.test(section.name);
    if (runtimeReservation) runtimeReservationBytes = (runtimeReservationBytes || 0) + section.sizeBytes;
    let flashRegion: MemoryRegion | undefined;
    const hasLoadImage = section.flags.includes("LOAD");
    if (hasLoadImage) {
      flashRegion = findRegion(input.regions, section.lma, "flash");
      if (flashRegion) {
        addAddressRange(flashRegion, section.lma, section.sizeBytes, section.name);
        const usage = regions.find(region => region.name === flashRegion!.name);
        if (usage) {
          usage.usedBytes = (usage.usedBytes || 0) + section.sizeBytes;
          if (flashRegion.length !== undefined && section.lma + section.sizeBytes > flashRegion.origin! + flashRegion.length) usage.overflow = true;
        }
        flashBytes += section.sizeBytes;
      } else unmappedLoad = true;
    }
    const ramRegion = findRegion(input.regions, section.vma, "ram");
    const runFlashRegion = findRegion(input.regions, section.vma, "flash");
    if (runFlashRegion && (runFlashRegion.name !== flashRegion?.name || section.vma !== section.lma))
      addAddressRange(runFlashRegion, section.vma, section.sizeBytes, section.name);
    if (ramRegion) {
      addAddressRange(ramRegion, section.vma, section.sizeBytes, section.name);
      const usage = regions.find(region => region.name === ramRegion!.name);
      if (usage && ramRegion.name !== flashRegion?.name) {
        usage.usedBytes = (usage.usedBytes || 0) + section.sizeBytes;
        if (ramRegion.length !== undefined && section.vma + section.sizeBytes > ramRegion.origin! + ramRegion.length) usage.overflow = true;
      }
      if (!runtimeReservation) {
        staticRamBytes += section.sizeBytes;
        if (kind === "other") otherRamBytes += section.sizeBytes;
      }
    } else if (!findRegion(input.regions, section.vma, "flash") && input.regions.length) unmappedAllocated = true;
    return { ...section, kind, flashRegion: flashRegion?.name, ramRegion: ramRegion?.name, runtimeReservation };
  });

  if (unmappedLoad) warnings.push("Au moins une section chargée ne correspond à aucune région Flash déclarée; l'estimation Flash peut être incomplète.");
  if (unmappedAllocated) warnings.push("Au moins une section allouée ne correspond à aucune région RAM/Flash connue; la répartition reste partielle.");
  if (regions.some(region => region.overflow)) warnings.push("Une section dépasse une région MEMORY déclarée; vérifier le script et la carte linker.");
  if (input.regions.some(region => region.origin === undefined || region.length === undefined)) warnings.push("Certaines expressions ORIGIN/LENGTH ne sont pas numériques; leur capacité n'est pas estimée.");
  if (input.regions.some(region => region.kind === "other")) warnings.push("Certaines régions déclarées ne sont pas classées automatiquement; leur occupation reste inconnue.");
  const orderedRanges = [...addressRanges].sort((left, right) => left.region.localeCompare(right.region) || left.start - right.start);
  for (let index = 1; index < orderedRanges.length; index++) {
    const previous = orderedRanges[index - 1];
    const current = orderedRanges[index];
    if (previous.region === current.region && current.start < previous.end && previous.section !== current.section) {
      warnings.push(`Sections ELF potentiellement superposées dans ${current.region} : ${previous.section} et ${current.section}.`);
      break;
    }
  }
  const ambiguousRegions = new Set<string>();
  for (let left = 0; left < regions.length; left++) {
    const first = regions[left];
    if (first.origin === undefined || first.length === undefined || first.kind === "other") continue;
    for (let right = left + 1; right < regions.length; right++) {
      const second = regions[right];
      if (first.kind === second.kind && second.origin !== undefined && second.length !== undefined &&
        first.origin < second.origin + second.length && second.origin < first.origin + first.length) {
        ambiguousRegions.add(first.name);
        ambiguousRegions.add(second.name);
      }
    }
  }
  if (ambiguousRegions.size) {
    warnings.push(`Régions linker superposées (${[...ambiguousRegions].join(", ")}); leur occupation individuelle est ambiguë.`);
    for (const region of regions) if (ambiguousRegions.has(region.name)) {
      region.usedBytes = undefined;
      region.utilizationPercent = undefined;
      region.overflow = null;
    }
  }

  for (const region of regions) {
    if (region.length !== undefined && region.origin !== undefined && region.usedBytes !== undefined)
      region.utilizationPercent = Number((((region.usedBytes || 0) / region.length) * 100).toFixed(1));
    if (region.usedBytes === 0) region.usedBytes = 0;
  }
  const completeFlash = input.regions.some(region => region.kind === "flash" && region.length !== undefined) &&
    !input.regions.some(region => region.kind === "flash" && (region.origin === undefined || region.length === undefined)) && !unmappedLoad;
  const completeRam = input.regions.some(region => region.kind === "ram" && region.length !== undefined) &&
    !input.regions.some(region => region.kind === "ram" && (region.origin === undefined || region.length === undefined)) && !unmappedAllocated;
  return {
    core: input.core, status: "available", artifactPath: input.artifactPath, modifiedAt: input.modifiedAt,
    message: "Sections statiques lues dans l'ELF; aucune mesure à l'exécution.",
    linkerPath: input.linkerPath, mapPath: input.mapPath,
    regionSource: input.regionSource,
    flashLoadBytes: completeFlash ? flashBytes : undefined,
    staticRamBytes: completeRam ? staticRamBytes : undefined,
    textBytes: sectionReports.filter(section => section.kind === "text").reduce((total, section) => total + section.sizeBytes, 0),
    dataBytes: sectionReports.filter(section => section.kind === "data").reduce((total, section) => total + section.sizeBytes, 0),
    bssBytes: sectionReports.filter(section => section.kind === "bss").reduce((total, section) => total + section.sizeBytes, 0),
    otherRamBytes: completeRam ? otherRamBytes : undefined,
    runtimeReservationBytes, sections: sectionReports, regions, warnings,
  };
}

async function readPrefix(file: string, maxBytes: number): Promise<{ text: string; modifiedAt: number } | undefined> {
  try {
    const handle = await fs.open(file, "r");
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) return undefined;
      const buffer = Buffer.alloc(Math.min(stat.size, maxBytes));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      return { text: buffer.toString("utf8", 0, bytesRead), modifiedAt: stat.mtimeMs };
    } finally { await handle.close(); }
  } catch { return undefined; }
}

export async function inspectMemoryArtifact(
  input: MemoryInspectionInput,
  runner: MemoryInspectionRunner = runProcess,
): Promise<MemoryImageReport> {
  if (!input.artifactPath || !/\.elf$/i.test(input.artifactPath)) return emptyImage(input, "unavailable", "Aucun ELF sélectionné pour l'inspection.");
  if (!input.trusted) return emptyImage(input, "unavailable", "Inspection désactivée : le workspace n'est pas approuvé.");
  let artifactStat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    artifactStat = await fs.stat(input.artifactPath);
    if (!artifactStat.isFile() || artifactStat.size <= 0) return emptyImage(input, "unavailable", "L'ELF est absent ou vide.");
  } catch { return emptyImage(input, "unavailable", "L'ELF est absent ou inaccessible."); }
  const base = emptyImage(input, "unavailable", "");
  base.modifiedAt = artifactStat.mtime.toISOString();
  const linker = input.linkerPath ? await readPrefix(input.linkerPath, 1024 * 1024) : undefined;
  let map = input.mapPath ? await readPrefix(input.mapPath, 2 * 1024 * 1024) : undefined;
  const mapWasReadable = Boolean(map);
  const cacheKey = JSON.stringify([
    path.resolve(input.artifactPath), artifactStat.size, artifactStat.mtimeMs,
    input.linkerPath || "", linker?.modifiedAt || 0, input.mapPath || "", map?.modifiedAt || 0,
    input.objdumpPath, input.core,
  ]);
  const cached = inspectionCache.get(cacheKey);
  if (cached) return structuredClone(cached);
  const warnings: string[] = [];
  if (map && Math.abs(map.modifiedAt - artifactStat.mtimeMs) > 10 * 60 * 1000) {
    warnings.push("La date de la carte linker diffère de plus de 10 minutes de celle de l'ELF; la carte est ignorée comme potentiellement obsolète.");
    map = undefined;
  }
  let regions = map ? parseMapMemoryRegions(map.text) : [];
  let regionSource: MemoryImageReport["regionSource"] = regions.length ? "carte linker" : undefined;
  const scriptRegions = linker ? parseLinkerMemoryRegions(linker.text) : [];
  if (regions.length && scriptRegions.length) {
    const scriptByName = new Map(scriptRegions.map(region => [region.name.toLowerCase(), region]));
    for (const region of regions) {
      const scriptRegion = scriptByName.get(region.name.toLowerCase());
      if (scriptRegion && region.origin !== undefined && region.length !== undefined &&
        scriptRegion.origin !== undefined && scriptRegion.length !== undefined &&
        (region.origin !== scriptRegion.origin || region.length !== scriptRegion.length)) {
        warnings.push(`La région ${region.name} de la carte linker diffère du script actuel; la carte est conservée comme preuve du lien ELF.`);
      }
    }
  }
  if (!regions.length && linker && linker.modifiedAt <= artifactStat.mtimeMs + 1000) {
    regions = scriptRegions;
    if (regions.length) regionSource = "script linker";
  } else if (!regions.length && linker && linker.modifiedAt > artifactStat.mtimeMs + 1000) {
    warnings.push("Le script linker a été modifié après l'ELF; ses régions ne sont pas utilisées pour éviter une comparaison trompeuse.");
  }
  if (!map && input.mapPath) warnings.push("Carte linker absente, illisible ou potentiellement obsolète; les régions proviennent du script s'il est cohérent avec l'ELF.");
  base.regions = regions.map(region => ({ ...region, usedBytes: undefined, utilizationPercent: undefined, overflow: null }));
  base.regionSource = regionSource;
  base.linkerPath = linker ? input.linkerPath : undefined;
  base.mapPath = mapWasReadable ? input.mapPath : undefined;
  base.warnings = warnings;
  if (!input.objdumpPath) {
    base.message = "arm-none-eabi-objdump est introuvable; seules les régions déclarées sont affichées.";
    return base;
  }

  let result: ProcessResult;
  try {
    result = await runner(input.objdumpPath, ["-h", input.artifactPath], {
      cwd: input.cwd, env: input.env, timeoutMs: 8000, maxBytes: 512 * 1024, signal: input.signal,
    });
  } catch (error) {
    base.status = "error";
    base.message = `Échec de lancement de objdump : ${error instanceof Error ? error.message : String(error)}`;
    return base;
  }
  if (!processSucceeded(result)) {
    base.status = result.timedOut ? "error" : "unavailable";
    base.message = result.timedOut ? "Timeout pendant la lecture de l'ELF." : `Lecture ELF indisponible${result.exitCode === null ? "" : ` (code ${result.exitCode})`}.`;
    return base;
  }
  if (result.truncated) {
    base.status = "error";
    base.message = "Sortie objdump trop volumineuse; l'inspection est ignorée pour éviter un total partiel trompeur.";
    return base;
  }
  const sections = parseObjdumpSections(result.stdout);
  if (!sections.length) {
    base.status = "error";
    base.message = "La sortie de objdump ne contient aucune section ELF reconnue.";
    return base;
  }
  const report = createMemoryImageReport({
    artifactPath: input.artifactPath, core: input.core, modifiedAt: artifactStat.mtime.toISOString(),
    sections, regions, regionSource, linkerPath: linker ? input.linkerPath : undefined,
    mapPath: mapWasReadable ? input.mapPath : undefined, warnings,
  });
  inspectionCache.set(cacheKey, structuredClone(report));
  if (inspectionCache.size > 32) inspectionCache.delete(inspectionCache.keys().next().value!);
  return report;
}

export function summarizeMemoryInspection(images: MemoryImageReport[]): MemoryInspectionReport {
  if (!images.length) return { status: "unavailable", message: "Aucun ELF connu à inspecter.", images: [] };
  const available = images.filter(image => image.status === "available").length;
  if (available === images.length && images.every(image => image.warnings.length === 0))
    return { status: "available", message: "Inspection statique disponible pour les ELF listés.", images };
  if (available === images.length)
    return { status: "partial", message: "Inspection partielle : une région ou un total est accompagné d'un avertissement.", images };
  if (available) return { status: "partial", message: "Inspection partielle : au moins un ELF n'a pas pu être analysé.", images };
  return { status: "unavailable", message: "Aucune inspection ELF complète n'est disponible.", images };
}

export function memoryToolPath(compilerPath: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string {
  const name = platform === "win32" ? "arm-none-eabi-objdump.exe" : "arm-none-eabi-objdump";
  const sibling = compilerPath ? path.join(path.dirname(compilerPath), name) : "";
  if (sibling && executableExists(sibling)) return sibling;
  return resolveExecutable(name, env);
}
