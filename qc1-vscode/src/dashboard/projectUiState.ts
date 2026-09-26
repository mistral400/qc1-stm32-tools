import * as path from "path";
import * as os from "os";
import { resolveUserPath } from "../qc1/filesystem";
import type { DiscoveryStatus } from "../qc1/projectDiscoveryController";
import type {
  DiscoverProjectsOptions,
  ProjectCandidate,
} from "../qc1/projectScanner";

export type ProjectScanStatus = DiscoveryStatus;

export interface ProjectUiCandidate {
  candidate: ProjectCandidate;
  confidenceLabel: "élevée" | "bonne" | "moyenne";
}

export interface ProjectUiState {
  status: ProjectScanStatus;
  message: string;
  candidates: ProjectUiCandidate[];
  selectedPath: string;
  activeCandidate?: ProjectCandidate;
  roots?: string[];
  stale?: boolean;
  lastScanAt?: number;
}

export const defaultProjectUiState: ProjectUiState = {
  status: "idle",
  message: "",
  candidates: [],
  selectedPath: "",
};

export function mapProjectCandidate(candidate: ProjectCandidate): ProjectUiCandidate {
  const confidenceLabel =
    candidate.confidence >= 90 ? "élevée" :
      candidate.confidence >= 70 ? "bonne" : "moyenne";
  return { candidate, confidenceLabel };
}

export function mapProjectCandidates(candidates: ProjectCandidate[]): ProjectUiCandidate[] {
  return candidates.map(mapProjectCandidate);
}

export function buildDiscoveryRoots(
  workspaceRoots: string[],
  configuredProjectPath: string,
  recentProjectPaths: string[],
  customRoots: string[] = [],
): string[] {
  const roots: string[] = [];
  const add = (value: string): void => {
    const resolved = value.trim() ? resolveUserPath(value, process.cwd()) : "";
    if (resolved === path.parse(resolved).root || resolved === os.homedir()) return;
    if (resolved && !roots.includes(resolved)) roots.push(resolved);
  };
  workspaceRoots.forEach(add);
  add(configuredProjectPath);
  recentProjectPaths.forEach(add);
  customRoots.forEach(add);
  return roots.slice(0, 24);
}

export function rememberRecentProject(paths: string[], projectPath: string, limit = 8): string[] {
  const resolved = path.resolve(projectPath);
  return [resolved, ...paths.map((value) => path.resolve(value)).filter((value) => value !== resolved)]
    .slice(0, limit);
}

export function discoveryOptions(roots: string[], signal: AbortSignal): DiscoverProjectsOptions {
  return {
    roots,
    maxDepth: 10,
    maxFiles: 4000,
    maxAnalyzedFiles: 300,
    maxProjects: 20,
    minConfidence: 40,
    signal,
  };
}
