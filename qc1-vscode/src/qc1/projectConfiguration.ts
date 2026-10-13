/** Window-wide projectPath; other QC1 settings retain their existing scopes. */
export type ConfigurationWriteTarget = "workspace" | "global";
export interface ProjectSettingsInput {
  projectPath: string;
  buildType?: string;
  cmakePreset?: string;
  buildDirectory?: string;
  serialPort?: string;
  baudRate?: number;
  autoDiscoverProjects?: boolean;
  discoveryRoots?: string[];
}

export interface ProjectConfigurationPort {
  hasWorkspace(): boolean;
  update(key: string, value: unknown, target: ConfigurationWriteTarget): PromiseLike<void>;
}

export function projectWriteTarget(hasWorkspace: boolean): ConfigurationWriteTarget {
  // An external project still belongs to this VS Code window's workflow. A workspace
  // value is valid outside its folders and avoids a global value being shadowed.
  return hasWorkspace ? "workspace" : "global";
}

export function assertOperationConfiguration(initial: string, current: string): void {
  if (initial !== current) throw new Error("Projet ou configuration modifié pendant l'opération; étapes restantes annulées.");
}

export function validateProjectSettings(input: ProjectSettingsInput): void {
  if (input.buildType !== undefined && !["Debug", "Release", "RelWithDebInfo", "MinSizeRel"].includes(input.buildType))
    throw new Error("Configuration CMake invalide.");
  if (input.baudRate !== undefined && (!Number.isInteger(input.baudRate) || input.baudRate <= 0 || input.baudRate > 4000000))
    throw new Error("Baud rate invalide.");
  if (input.discoveryRoots && (input.discoveryRoots.length > 16 || input.discoveryRoots.some((root) => typeof root !== "string" || root.length > 4096 || root.includes("\0"))))
    throw new Error("Au maximum 16 racines de recherche sont autorisées.");
  for (const value of Object.values(input))
    if (typeof value === "string" && (value.length > 4096 || value.includes("\0")))
      throw new Error("Réglage QC1 invalide.");
}

export class ProjectConfigurationController {
  private pending: Promise<void> = Promise.resolve();
  constructor(private readonly port: ProjectConfigurationPort) {}

  update(input: ProjectSettingsInput): Promise<void> {
    validateProjectSettings(input);
    const operation = this.pending.catch(() => undefined).then(async () => {
      const target = projectWriteTarget(this.port.hasWorkspace());
      // Write the one canonical key without a resource/folder override.
      await this.port.update("projectPath", input.projectPath.trim(), target);
      for (const key of ["buildType", "cmakePreset", "buildDirectory", "serialPort", "baudRate", "autoDiscoverProjects", "discoveryRoots"] as const) {
        const value = input[key];
        if (value !== undefined)
          await this.port.update(key, typeof value === "string" ? value.trim() : value, target);
      }
    });
    this.pending = operation;
    return operation;
  }
}
