import { createHash } from "crypto";
import * as os from "os";
import * as path from "path";
import { isStm32H7Family, Qc1McuFamily } from "./targetArchitecture";

export const PROBE_SELECTION_STORAGE_KEY = "qc1.stlinkProbeByProject";
const PROJECT_KEY_PATTERN = /^[\da-f]{64}$/i;

export interface StlinkProbe {
  serialNumber: string;
  firmware?: string;
  chipId?: string;
  description?: string;
}

/** st-info emits one `serial:` record per adapter; `hla-serial:` is a duplicate. */
export function readStlinkProbeInventory(output: string): StlinkProbe[] {
  const probes: StlinkProbe[] = [];
  let pending: Omit<StlinkProbe, "serialNumber"> = {};
  let current: StlinkProbe | undefined;

  for (const line of output.split(/\r?\n/)) {
    const serial = line.match(/^\s*serial\s*:\s*([\da-f]{8,64})\s*$/i);
    if (serial) {
      if (current) probes.push(current);
      current = { ...pending, serialNumber: serial[1].toUpperCase() };
      pending = {};
      continue;
    }

    const firmware = line.match(/^\s*version\s*:\s*(\S+)\s*$/i)?.[1];
    const chipId = line.match(/^\s*chipid\s*:\s*(0x[\da-f]+)\s*$/i)?.[1];
    const description = line.match(/^\s*(?:descr|dev-type)\s*:\s*(.+?)\s*$/i)?.[1];
    const fields = {
      ...(firmware ? { firmware } : {}),
      ...(chipId ? { chipId: chipId.toLowerCase() } : {}),
      ...(description ? { description } : {}),
    };
    if (current) Object.assign(current, fields);
    else Object.assign(pending, fields);
  }

  if (current) probes.push(current);
  const unique = new Map<string, StlinkProbe>();
  for (const probe of probes) if (!unique.has(probe.serialNumber)) unique.set(probe.serialNumber, probe);
  return [...unique.values()];
}

export function isValidStlinkSerial(serialNumber: string): boolean {
  return /^[\da-f]{8,64}$/i.test(serialNumber);
}

/** Persisted workspace state can be stale or malformed after an extension upgrade. */
export function normalizeStlinkProbeAssignments(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key, serial]) => PROJECT_KEY_PATTERN.test(key) && typeof serial === "string" && isValidStlinkSerial(serial))
    .map(([key, serial]) => [key, (serial as string).toUpperCase()]));
}

/** A workspace-local key avoids persisting the user's absolute project path. */
export function projectProbeSelectionKey(projectPath: string): string {
  const normalized = path.resolve(projectPath);
  const key = os.platform() === "win32" ? normalized.toLowerCase() : normalized;
  return createHash("sha256").update(key).digest("hex");
}

/** Prevents a delayed probe choice from being used after the active project changes. */
export function probeSelectionMatchesProject(
  expectedProjectPath: string,
  currentProjectPath: string,
  selectedSerial: string,
  currentSerial: string,
): boolean {
  return Boolean(expectedProjectPath && currentProjectPath && isValidStlinkSerial(selectedSerial) && isValidStlinkSerial(currentSerial))
    && projectProbeSelectionKey(expectedProjectPath) === projectProbeSelectionKey(currentProjectPath)
    && selectedSerial.toUpperCase() === currentSerial.toUpperCase();
}

export function stlinkSerialLabel(serialNumber: string): string {
  return serialNumber ? `ST-LINK …${serialNumber.slice(-4).toUpperCase()}` : "Non sélectionnée";
}

/** Keep serials out of command logs and report snippets. */
export function redactStlinkSerials(text: string): string {
  return text
    .replace(/(\b(?:hla[-_ ]?serial|serial)\s*:\s*)[\da-f]{8,64}/gi, "$1<redacted>")
    .replace(/^(\s*openocd\s*:\s*).+$/gim, "$1<redacted>")
    .replace(/(["']?--serial["']?)(=|\s+)(["']?)([\da-f]{8,64})\3/gi,
      (_match, option: string, separator: string, quote: string) => `${option}${separator}${quote}<redacted>${quote}`)
    .replace(/(\badapter\s+serial\s+)[\da-f]{8,64}/gi, "$1<redacted>");
}

/** Best-effort family guard when OpenOCD is unavailable for a read-only probe check. */
export function probeMatchesFamily(probe: StlinkProbe, family: Qc1McuFamily): boolean {
  const evidence = `${probe.description || ""} ${probe.chipId || ""}`.toLowerCase();
  if (family === "stm32h755") return /stm32h755|h755/.test((probe.description || "").toLowerCase());
  if (isStm32H7Family(family)) return /stm32h7|h745|h747|h755|h757|0x450\b/.test(evidence);
  return /stm32f1|\bf1\b|0x410\b|0x414\b|0x418\b|0x420\b|0x428\b/.test(evidence);
}
