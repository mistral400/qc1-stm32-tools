import { isStm32H7Family, Qc1Core, Qc1McuFamily } from "./targetArchitecture";
import { runProcess } from "./processTools";
import { isValidStlinkSerial, redactStlinkSerials } from "./probeSelection";

export type StlinkProbeStatus = "OK" | "non détecté" | "non testé";

export function readStlinkProbeStatus(output: string): StlinkProbeStatus {
  const lower = output.toLowerCase();
  if (/permission denied|access denied|libusb.*(?:error|access)|failed|error|cannot open/.test(lower)) return "non testé";
  if (/\bst[- ]?link\s+v[23]j\d+.*(?:vid:pid|api v)/i.test(output)) return "OK";

  if (
    lower.includes("found 0 stlink") ||
    lower.includes("no device found") ||
    lower.includes("no st-link") ||
    lower.includes("st-link not found") ||
    lower.includes("stlink not found") ||
    lower.includes("unable to connect")
  ) {
    return "non détecté";
  }

  if (
    /found\s+[1-9]\d*\s+stlink/.test(lower) ||
    lower.includes("device connected")
  ) {
    return "OK";
  }

  return "non testé";
}

export function readStlinkProbeModel(output: string): string {
  if (/ST[- ]?LINK[-_ ]?V3E/i.test(output)) return "STLINK-V3E";
  if (/\bV3J\d+|ST[- ]?LINK[-_ ]?V3\b|stlinkv3/i.test(output)) return "ST-LINK V3 (variante exacte non confirmée)";
  if (/\bV2J\d+|ST[- ]?LINK[-_ ]?V2\b|stlinkv2/i.test(output)) return "ST-LINK V2";
  return "unknown";
}

/** OpenOCD target names provide family evidence beyond detecting the adapter itself. */
export function readOpenOcdTargetFamily(output: string): Qc1McuFamily | undefined {
  const f1 = /\bstm32f1x\.cpu\b/i.test(output);
  const h7 = /\bstm32h7x\.cpu[01]\b/i.test(output);
  if (f1 === h7) return undefined;
  return h7 ? "stm32h7" : "stm32f1";
}

export function getOpenOcdServerArgs(
  family: Qc1McuFamily = "stm32f1",
  dualCore = false,
  serialNumber?: string,
): string[] {
  const h7 = isStm32H7Family(family);
  const args = ["-f", h7 ? "interface/stlink-dap.cfg" : "interface/stlink.cfg"];
  if (serialNumber) {
    if (!isValidStlinkSerial(serialNumber)) throw new Error("Numéro de série ST-Link invalide.");
    args.push("-c", `adapter serial ${serialNumber}`);
  }
  if (h7) args.push("-c", "transport select dapdirect_swd");
  if (h7 && dualCore) args.push("-c", "set DUAL_CORE 1", "-c", "set DUAL_BANK 1");
  args.push("-f", h7 ? "target/stm32h7x.cfg" : "target/stm32f1x.cfg");
  return args;
}

export function getOpenOcdProgramArgs(
  elfPath: string,
  family: Qc1McuFamily = "stm32f1",
  dualCore = false,
  core?: Qc1Core,
  serialNumber?: string,
  selectCoreTarget = false,
): string[] {
  // Tcl has its own quoting rules even when spawn(shell:false) is used.
  const normalized = elfPath.replace(/\\/g, "/");
  if (/[{}\r\n\u0000]/.test(normalized)) throw new Error("Chemin ELF non représentable dans la commande Tcl OpenOCD.");
  const dualTarget = isStm32H7Family(family) && (dualCore || core === "cm4" || selectCoreTarget || family === "stm32h755");
  const selectTarget = dualTarget && core
    ? `${core === "cm4" ? "targets stm32h7x.cpu1; " : "targets stm32h7x.cpu0; "}`
    : "";
  return [...getOpenOcdServerArgs(family, dualCore || (isStm32H7Family(family) && core === "cm4"), serialNumber), "-c", `${selectTarget}program {${normalized}} verify reset exit`];
}

/** Program and verify both H7 images before resetting the dual-core target once. */
export function getOpenOcdMultiProgramArgs(
  artifacts: Array<{ core: Qc1Core; elfPath: string }>,
  family: Qc1McuFamily,
  serialNumber?: string,
): string[] {
  if (!isStm32H7Family(family) || artifacts.length !== 2 || new Set(artifacts.map(item => item.core)).size !== 2 ||
    !artifacts.some(item => item.core === "cm7") || !artifacts.some(item => item.core === "cm4"))
    throw new Error("Le flash dual-core STM32H7 exige un ELF CM7 et un ELF CM4.");
  const ordered = [...artifacts].sort((left, right) => left.core === "cm7" ? -1 : right.core === "cm7" ? 1 : 0);
  const commands = ordered.map((artifact, index) => {
    const normalized = artifact.elfPath.replace(/\\/g, "/");
    if (!normalized || /[{}\r\n\u0000]/.test(normalized)) throw new Error("Chemin ELF non représentable dans la commande Tcl OpenOCD.");
    const cpu = artifact.core === "cm7" ? 0 : 1;
    const finish = index === ordered.length - 1 ? " reset exit" : "";
    return `targets stm32h7x.cpu${cpu}; program {${normalized}} verify${finish}`;
  });
  return [...getOpenOcdServerArgs(family, true, serialNumber), "-c", commands.join("; ")];
}

export function getStFlashWriteArgs(binPath: string, address = "0x08000000", serialNumber?: string): string[] {
  if (!/^0x[0-9a-f]+$/i.test(address)) throw new Error("Adresse de flash invalide.");
  if (serialNumber && !isValidStlinkSerial(serialNumber)) throw new Error("Numéro de série ST-Link invalide.");
  return [...(serialNumber ? ["--serial", serialNumber] : []), "--reset", "write", binPath, address];
}

/** Extract the first FLASH/ROM origin from a CubeMX linker script for BIN fallback only. */
export function readFlashOrigin(linkerText: string): string {
  const memory = linkerText.replace(/\/\*[\s\S]*?\*\//g, "").match(/\bMEMORY\s*\{([\s\S]*?)\}/i)?.[1] || "";
  for (const line of memory.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_]\w*)\s*(?:\([^)]*\))?\s*:\s*ORIGIN\s*=\s*(0x[0-9a-f]+)/i);
    if (match && /flash|rom/i.test(match[1])) return match[2];
  }
  return "";
}

export function getCortexDebugConfiguration(
  projectRoot: string,
  executable: string,
  family: Qc1McuFamily,
  core?: Qc1Core,
  dualCore = false,
  serialNumber?: string,
  targetDevice?: string,
): Record<string, unknown> {
  const h7 = isStm32H7Family(family);
  const h755 = family === "stm32h755";
  const configuration: Record<string, unknown> = {
    name: `QC1 Debug ${core?.toUpperCase() || (h7 ? "CM7" : "STM32F1")}`,
    type: "cortex-debug",
    request: "launch",
    cwd: projectRoot,
    executable,
    servertype: "openocd",
    interface: "swd",
    device: targetDevice || (h755 ? "STM32H755ZI" : h7 ? "STM32H7" : "STM32F103"),
    configFiles: [h7 ? "interface/stlink-dap.cfg" : "interface/stlink.cfg", h7 ? "target/stm32h7x.cfg" : "target/stm32f1x.cfg"],
    runToEntryPoint: "main",
  };
  if (serialNumber) {
    if (!isValidStlinkSerial(serialNumber)) throw new Error("Numéro de série ST-Link invalide.");
    configuration.serialNumber = serialNumber;
  }
  if (h7 && dualCore) {
    configuration.numberOfProcessors = 2;
    configuration.targetProcessor = core === "cm4" ? 1 : 0;
    configuration.openOCDPreConfigLaunchCommands = ["set DUAL_CORE 1", "set DUAL_BANK 1"];
  }
  return configuration;
}

/** Probe only: no program, erase, reset or halt command. Try adapters sequentially. */
export async function probeStlink(options: {
  family: Qc1McuFamily; dualCore: boolean; openocd?: string; stInfo?: string;
  cwd?: string; env?: NodeJS.ProcessEnv; serialNumber?: string;
}, runner: typeof runProcess = runProcess): Promise<{
  exitCode: number | null; stdout: string; stderr: string; status: StlinkProbeStatus; warning?: string; targetFamily?: Qc1McuFamily;
}> {
  const commands = [
    ...(options.openocd ? [{ executable: options.openocd, args: [...getOpenOcdServerArgs(options.family, options.dualCore, options.serialNumber), "-c", "init; targets; shutdown"] }] : []),
    ...(options.stInfo ? [{ executable: options.stInfo, args: ["--probe"] }] : []),
  ];
  if (!isStm32H7Family(options.family) && !options.serialNumber) commands.reverse();
  const logs: string[] = [];
  let status: StlinkProbeStatus = "non testé";
  let openOcdWarning = "";
  let targetFamily: Qc1McuFamily | undefined;
  let lastExitCode: number | null = null;
  for (const command of commands) {
    const result = await runner(command.executable, command.args, { cwd: options.cwd, env: options.env, timeoutMs: 8000 });
    lastExitCode = result.exitCode;
    const output = `${result.stdout}\n${result.stderr}`;
    if (command.executable === options.openocd) targetFamily = readOpenOcdTargetFamily(output);
    logs.push(`${redactStlinkSerials(`${command.executable} ${command.args.join(" ")}`)}\n${redactStlinkSerials(output)}\n${result.error || ""}`);
    const detected = readStlinkProbeStatus(output);
    if (command.executable === options.openocd && (result.timedOut || result.exitCode !== 0 || /\bError:/i.test(output)))
      openOcdWarning = `OpenOCD a échoué (${result.error || String(result.exitCode ?? "unknown")}); voir le journal.`;
    if (result.exitCode === 0 && !result.timedOut && detected === "OK")
      return { exitCode: result.exitCode, stdout: logs.join("\n"), stderr: "", status: "OK", warning: openOcdWarning || undefined, targetFamily };
    if (result.exitCode === 0 && !result.timedOut && detected === "non détecté") status = detected;
  }
  return { exitCode: lastExitCode, stdout: logs.join("\n"), stderr: openOcdWarning || (commands.length ? "Détection ST-Link non confirmée" : "st-info/OpenOCD introuvables"), status, targetFamily };
}
