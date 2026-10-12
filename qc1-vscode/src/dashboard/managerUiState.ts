export interface ToolUiState {
  name: string;
  status: "OK" | "Manquant" | "Inconnu" | "Erreur";
  path: string;
  source: string;
  version?: string;
}
export interface ArtifactUiState {
  id: string;
  kind: "ELF" | "BIN" | "HEX" | "MAP";
  core?: "CM7" | "CM4";
  path: string;
  sizeBytes: number;
}
interface ToolSnapshot {
  compilerOk: boolean; compilerPath: string; compilerSource: string;
  gdbOk: boolean; gdbPath: string;
  cmakeOk: boolean; cmakePath: string; cmakeSource: string;
  ninjaOk: boolean; ninjaPath: string; ninjaSource: string;
  makeOk: boolean; makePath: string; makeGenerator: string;
  openocdOk: boolean; openocdPath: string; openocdSource: string;
  stlinkToolOk: boolean; stlinkPath: string;
  debuggerOk: boolean;
}
export function normalizeTools(status: ToolSnapshot, cortexVersion?: string): ToolUiState[] {
  const tool = (name: string, detected: boolean, file: string, source: string): ToolUiState => ({
    name, status: detected ? "OK" : "Manquant", path: file || "—", source,
  });
  return [
    tool("ARM GCC", status.compilerOk, status.compilerPath, status.compilerSource),
    tool("GDB", status.gdbOk, status.gdbPath, "toolchain / PATH"),
    tool("CMake", status.cmakeOk, status.cmakePath, status.cmakeSource),
    tool("Ninja", status.ninjaOk, status.ninjaPath, status.ninjaSource),
    tool("Make", status.makeOk, status.makePath, status.makeGenerator || "PATH"),
    tool("OpenOCD", status.openocdOk, status.openocdPath, status.openocdSource),
    tool("ST-Link CLI", status.stlinkToolOk, status.stlinkPath, "configuration / PATH"),
    { name: "Cortex-Debug", status: status.debuggerOk ? "OK" : "Manquant", path: "extension VS Code", source: "registre des extensions", version: cortexVersion },
  ];
}
