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

export function getOpenOcdServerArgs(): string[] {
  return ["-f", "interface/stlink.cfg", "-f", "target/stm32f1x.cfg"];
}

export function getOpenOcdProgramArgs(elfPath: string): string[] {
  // Tcl has its own quoting rules even when spawn(shell:false) is used.
  const normalized = elfPath.replace(/\\/g, "/");
  if (/[{}\r\n\u0000]/.test(normalized)) throw new Error("Chemin ELF non représentable dans la commande Tcl OpenOCD.");
  return [...getOpenOcdServerArgs(), "-c", `program {${normalized}} verify reset exit`];
}

export function getStFlashWriteArgs(binPath: string): string[] {
  return ["--reset", "write", binPath, "0x08000000"];
}
