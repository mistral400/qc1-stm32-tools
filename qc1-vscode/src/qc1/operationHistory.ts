import * as path from "path";
import type {
  QC1BuildStatus,
  QC1FlashStatus,
  QC1OperationName,
  QC1OperationResult,
  QC1OperationStates,
} from "../dashboard/dashboardState";

export interface QC1ProjectOperationSnapshot {
  build: QC1BuildStatus;
  flash: QC1FlashStatus;
  operations: QC1OperationStates;
}

export function setOperationResult(
  operations: QC1OperationStates,
  name: QC1OperationName,
  result: QC1OperationResult,
): QC1OperationStates {
  return { ...operations, [name]: { ...result } };
}

/** A completed process alone is never enough to claim a verified flash. */
export function isFlashFullyConfirmed(operations: QC1OperationStates): boolean {
  return operations.artifactValidation.status === "success" &&
    operations.programming.status === "success" &&
    operations.verification.status === "success" &&
    operations.reset.status === "success";
}

export function cloneProjectOperationSnapshot(snapshot: QC1ProjectOperationSnapshot): QC1ProjectOperationSnapshot {
  const operations = Object.fromEntries(
    Object.entries(snapshot.operations).map(([name, result]) => [name, { ...result }]),
  ) as QC1OperationStates;
  return {
    build: { ...snapshot.build },
    flash: { ...snapshot.flash },
    operations,
  };
}

export function projectOperationKey(projectPath: string, platform: NodeJS.Platform = process.platform): string {
  if (!projectPath.trim()) return "";
  const paths = platform === "win32" ? path.win32 : path;
  const normalized = paths.normalize(paths.resolve(projectPath));
  return platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}

/** Historique de session borné, indexé par projet sans persister les chemins. */
export class ProjectOperationHistory {
  private readonly entries = new Map<string, QC1ProjectOperationSnapshot>();

  constructor(private readonly maximumProjects = 20, private readonly platform: NodeJS.Platform = process.platform) {}

  get(projectPath: string): QC1ProjectOperationSnapshot | undefined {
    const key = projectOperationKey(projectPath, this.platform);
    const snapshot = this.entries.get(key);
    return snapshot ? cloneProjectOperationSnapshot(snapshot) : undefined;
  }

  set(projectPath: string, snapshot: QC1ProjectOperationSnapshot): void {
    const key = projectOperationKey(projectPath, this.platform);
    if (!key) return;
    this.entries.delete(key);
    this.entries.set(key, cloneProjectOperationSnapshot(snapshot));
    while (this.entries.size > Math.max(1, this.maximumProjects)) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}
