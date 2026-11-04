import type { ProjectSettingsInput } from "../qc1/projectConfiguration";
import { validateResetProfile } from "../qc1/resetConfiguration";
import type { SerialConnectionOptions, SerialDisplayMode } from "../qc1/serialMonitor";

export const qc1Commands = [
  "build", "clean", "rebuild", "tsmake", "flash", "debug", "build-cm7", "build-cm4",
  "flash-cm7", "flash-cm4", "debug-cm7", "debug-cm4", "run", "health", "status", "error", "serial", "dev", "openLogs",
] as const;
export type Qc1Command = typeof qc1Commands[number];
const simpleActions = [
  "clear", "copyOutput", "saveLog", "createDiagnosticReport", "settings", "refreshSettings",
  "refreshTools", "autoDetectPaths", "discoverProjects", "rescanProjects", "cancelProjectScan",
  "chooseProjectFolder", "copyDiagnostic", "openExtensionFolder", "openProjectFolder", "detectStlink", "selectStlink", "openSerial", "startOpenOcd",
  "serialRefresh", "serialDisconnect", "serialClear", "serialSaveLog", "clearOperationHistory",
] as const;
export type WebviewMessage =
  | { type: "command" | "run" | "terminal"; command: Qc1Command }
  | { type: typeof simpleActions[number] }
  | { type: "useProject" | "useRecentProject" | "removeRecentProject"; projectPath: string }
  | ({ type: "updateProjectSettings" } & ProjectSettingsInput)
  | { type: "openArtifact"; id: string }
  | { type: "openDiagnosticFile"; index: number }
  | { type: "serialConnect"; options: SerialConnectionOptions }
  | { type: "serialSend"; text: string; mode: SerialDisplayMode; appendNewline: boolean }
  | { type: "serialDisplay"; mode: SerialDisplayMode; timestamps: boolean }
  | { type: "serialGraphControl"; action: "pause" | "resume" | "clear" | "exportCsv" };

/** Validate the bridge at runtime; project content cannot invent commands or paths. */
export function parseWebviewMessage(value: unknown): WebviewMessage | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const input = value as Record<string, unknown>;
  if (typeof input.type !== "string") return;
  if (["command", "run", "terminal"].includes(input.type))
    return typeof input.command === "string" && qc1Commands.includes(input.command as Qc1Command)
      ? { type: input.type as "command" | "run" | "terminal", command: input.command as Qc1Command } : undefined;
  if (simpleActions.includes(input.type as typeof simpleActions[number]))
    return { type: input.type as typeof simpleActions[number] };
  if (["useProject", "useRecentProject", "removeRecentProject"].includes(input.type))
    return typeof input.projectPath === "string" && input.projectPath.length <= 4096
      ? { type: input.type as "useProject" | "useRecentProject" | "removeRecentProject", projectPath: input.projectPath } : undefined;
  if (input.type === "openArtifact" && typeof input.id === "string") return { type: "openArtifact", id: input.id };
  if (input.type === "openDiagnosticFile" && Number.isInteger(input.index) && Number(input.index) >= 0)
    return { type: "openDiagnosticFile", index: Number(input.index) };
  if (input.type === "serialConnect") {
    const options = input.options;
    if (!options || typeof options !== "object" || Array.isArray(options)) return;
    const value = options as Record<string, unknown>;
    if (typeof value.path !== "string" || !value.path.trim() || value.path.length > 4096 ||
      typeof value.baudRate !== "number" || !Number.isInteger(value.baudRate) || value.baudRate < 50 || value.baudRate > 4_000_000 ||
      typeof value.dataBits !== "number" || ![5, 6, 7, 8].includes(value.dataBits) ||
      typeof value.parity !== "string" || !["none", "even", "odd", "mark", "space"].includes(value.parity) ||
      typeof value.stopBits !== "number" || ![1, 2].includes(value.stopBits)) return;
    for (const key of ["rtscts", "xon", "xoff", "xany"])
      if (value[key] !== undefined && typeof value[key] !== "boolean") return;
    return {
      type: "serialConnect",
      options: {
        path: value.path, baudRate: value.baudRate, dataBits: value.dataBits as SerialConnectionOptions["dataBits"],
        parity: value.parity as SerialConnectionOptions["parity"], stopBits: value.stopBits as SerialConnectionOptions["stopBits"],
        rtscts: value.rtscts as boolean | undefined, xon: value.xon as boolean | undefined,
        xoff: value.xoff as boolean | undefined, xany: value.xany as boolean | undefined,
      },
    };
  }
  if (input.type === "serialSend") {
    if (typeof input.text !== "string" || input.text.length > 12_300 ||
      (input.mode !== "ascii" && input.mode !== "hex") || typeof input.appendNewline !== "boolean") return;
    return { type: "serialSend", text: input.text, mode: input.mode, appendNewline: input.appendNewline };
  }
  if (input.type === "serialDisplay") {
    if ((input.mode !== "ascii" && input.mode !== "hex") || typeof input.timestamps !== "boolean") return;
    return { type: "serialDisplay", mode: input.mode as SerialDisplayMode, timestamps: input.timestamps };
  }
  if (input.type === "serialGraphControl" && ["pause", "resume", "clear", "exportCsv"].includes(String(input.action)))
    return { type: "serialGraphControl", action: input.action as "pause" | "resume" | "clear" | "exportCsv" };
  if (input.type === "updateProjectSettings") {
    if (typeof input.projectPath !== "string" || typeof input.buildType !== "string" || typeof input.cmakePreset !== "string") return;
    const result: ProjectSettingsInput = { projectPath: input.projectPath, buildType: input.buildType, cmakePreset: input.cmakePreset };
    for (const key of ["buildDirectory", "serialPort"] as const) {
      if (input[key] !== undefined && typeof input[key] !== "string") return;
      if (typeof input[key] === "string") result[key] = input[key];
    }
    if (input.baudRate !== undefined) {
      if (typeof input.baudRate !== "number") return;
      result.baudRate = input.baudRate;
    }
    if (input.autoDiscoverProjects !== undefined) {
      if (typeof input.autoDiscoverProjects !== "boolean") return;
      result.autoDiscoverProjects = input.autoDiscoverProjects;
    }
    if (input.discoveryRoots !== undefined) {
      if (!Array.isArray(input.discoveryRoots) || input.discoveryRoots.some((root) => typeof root !== "string")) return;
      result.discoveryRoots = input.discoveryRoots;
    }
    if (input.resetProfile !== undefined) {
      try { result.resetProfile = validateResetProfile(input.resetProfile); }
      catch { return; }
    }
    return { type: "updateProjectSettings", ...result };
  }
}
