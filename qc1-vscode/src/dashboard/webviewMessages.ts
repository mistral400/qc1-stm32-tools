import type { ProjectSettingsInput } from "../qc1/projectConfiguration";

export const qc1Commands = [
  "build", "clean", "rebuild", "tsmake", "flash", "debug", "build-cm7", "build-cm4",
  "flash-cm7", "flash-cm4", "debug-cm7", "debug-cm4", "run", "health", "status", "error", "serial", "dev", "openLogs",
] as const;
export type Qc1Command = typeof qc1Commands[number];
const simpleActions = [
  "clear", "copyOutput", "saveLog", "createDiagnosticReport", "settings", "refreshSettings",
  "refreshTools", "autoDetectPaths", "discoverProjects", "rescanProjects", "cancelProjectScan",
  "chooseProjectFolder", "copyDiagnostic", "openExtensionFolder", "openProjectFolder", "detectStlink", "selectStlink", "openSerial", "startOpenOcd",
] as const;
export type WebviewMessage =
  | { type: "command" | "run" | "terminal"; command: Qc1Command }
  | { type: typeof simpleActions[number] }
  | { type: "useProject" | "useRecentProject" | "removeRecentProject"; projectPath: string }
  | ({ type: "updateProjectSettings" } & ProjectSettingsInput)
  | { type: "openArtifact"; id: string }
  | { type: "openDiagnosticFile"; index: number };

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
    return { type: "updateProjectSettings", ...result };
  }
}
