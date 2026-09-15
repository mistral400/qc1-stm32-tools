import { Qc1Core, Qc1McuFamily } from "./targetArchitecture";

export type StlinkProbeStatus = "OK" | "non détecté" | "non testé";

export function readStlinkProbeStatus(output: string): StlinkProbeStatus {
  const lower = output.toLowerCase();
  if (/permission denied|access denied|libusb.*(?:error|access)|failed|error|cannot open/.test(lower)) return "non testé";

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

export function getOpenOcdServerArgs(
  family: Qc1McuFamily = "stm32f1",
  dualCore = false,
): string[] {
  const args = ["-f", family === "stm32h755" ? "interface/stlink-dap.cfg" : "interface/stlink.cfg"];
  if (family === "stm32h755" && dualCore) args.push("-c", "set DUAL_CORE 1");
  args.push("-f", family === "stm32h755" ? "target/stm32h7x.cfg" : "target/stm32f1x.cfg");
  return args;
}

export function getOpenOcdProgramArgs(
  elfPath: string,
  family: Qc1McuFamily = "stm32f1",
  dualCore = false,
  core?: Qc1Core,
): string[] {
  // Tcl has its own quoting rules even when spawn(shell:false) is used.
  const normalized = elfPath.replace(/\\/g, "/");
  if (/[{}\r\n\u0000]/.test(normalized)) throw new Error("Chemin ELF non représentable dans la commande Tcl OpenOCD.");
  const selectTarget = family === "stm32h755" && dualCore
    ? `${core === "cm4" ? "targets stm32h7x.cpu1; " : "targets stm32h7x.cpu0; "}`
    : "";
  return [...getOpenOcdServerArgs(family, dualCore), "-c", `${selectTarget}program {${normalized}} verify reset exit`];
}

export function getStFlashWriteArgs(binPath: string, address = "0x08000000"): string[] {
  if (!/^0x[0-9a-f]+$/i.test(address)) throw new Error("Adresse de flash invalide.");
  return ["--reset", "write", binPath, address];
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
): Record<string, unknown> {
  const h755 = family === "stm32h755";
  const configuration: Record<string, unknown> = {
    name: `QC1 Debug ${core?.toUpperCase() || (h755 ? "CM7" : "STM32F1")}`,
    type: "cortex-debug",
    request: "launch",
    cwd: projectRoot,
    executable,
    servertype: "openocd",
    interface: "swd",
    device: h755 ? "STM32H755ZI" : "STM32F103",
    configFiles: [h755 ? "interface/stlink-dap.cfg" : "interface/stlink.cfg", h755 ? "target/stm32h7x.cfg" : "target/stm32f1x.cfg"],
    runToEntryPoint: "main",
  };
  if (h755) {
    configuration.numberOfProcessors = 2;
    configuration.targetProcessor = core === "cm4" ? 1 : 0;
    configuration.openOCDPreConfigLaunchCommands = ["set DUAL_CORE 1"];
  }
  return configuration;
}
