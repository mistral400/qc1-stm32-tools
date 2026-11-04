/**
 * RÉSUMÉ DU FICHIER — ÉTAT DU TABLEAU DE BORD QC1
 *
 * Ce fichier décrit toutes les données affichées par l'interface QC1 : diagnostic,
 * progression, build, flash, projet et outils. Il ne crée aucun élément visuel.
 * `extension.ts` modifie cet état, puis `dashboardHtml.ts` le transforme en HTML.
 *
 * Flux principal :
 *   commande VS Code -> extension.ts -> DashboardState -> dashboardHtml.ts -> Webview
 *
 * Barre de progression : `ProgressManager` lit maintenant les compteurs `[x/y]`
 * de Ninja. Cet état conserve x, y, le pourcentage réel, la phase et la durée.
 *
 * À modifier ici : forme de l'état, valeurs initiales et règles de progression.
 * À modifier dans dashboardHtml.ts : apparence visuelle de ces données.
 */

import type { Qc1ProgressPhase } from "./progressManager";
import type { ProjectUiState } from "./projectUiState";
import type { RecentProject } from "../qc1/recentProjectsController";
import type { ToolUiState, ArtifactUiState } from "./managerUiState";
import type { Qc1OperationTimelineEntry } from "../qc1/operationTimeline";

// Valeurs de couleur/gravité utilisées pour choisir le style d'un diagnostic.
export type QC1StatusLevel =
  | "success"
  | "info"
  | "warning"
  | "error"
  | "idle";

export interface QC1Diagnostic {
  code: string;
  level: QC1StatusLevel;
  title: string;
  message: string;
  cause: string;
  checkedPath: string;
}

// État logique de la barre : activité, pourcentage, durée et étape courante.
export interface QC1TaskProgress {
  active: boolean;
  taskName: string;
  phase: Qc1ProgressPhase;
  runtimeSeconds: number;
  progressPercent: number;
  completedSteps: number;
  totalSteps: number;
  measured: boolean;
  currentStep: string;
  startedAt?: number;
}

// Résumé du dernier build montré dans la carte « Build ».
export interface QC1BuildStatus {
  lastBuildTime: string;
  lastBuildSuccess: boolean;

  buildRuntimeMs: number;

  errors: number;
  warnings: number;

  flashUsage?: string;
  ramUsage?: string;

  elfGenerated: boolean;
  binGenerated: boolean;
}

// Résumé du dernier flash montré dans la carte « Flash ».
export interface QC1FlashStatus {
  lastFlashTime: string;
  lastFlashSuccess: boolean;

  flashRuntimeMs: number;

  method: string;
  targetMCU: string;
}

/** Résultat propre à une étape QC1, sans assimiler le processus entier au build. */
export type QC1OperationStatus = "not-run" | "running" | "success" | "failed" | "skipped" | "unknown";
export type QC1OperationName = "build" | "artifactValidation" | "programming" | "verification" | "reset" | "debugSession" | "execution";

export interface QC1OperationResult {
  status: QC1OperationStatus;
  command?: string;
  message?: string;
  startedAt?: number;
  completedAt?: number;
  runtimeMs?: number;
}

export type QC1OperationStates = Record<QC1OperationName, QC1OperationResult>;

export function createInitialOperationStates(): QC1OperationStates {
  const initial = (): QC1OperationResult => ({ status: "not-run" });
  return {
    build: initial(),
    artifactValidation: initial(),
    programming: initial(),
    verification: initial(),
    reset: initial(),
    debugSession: initial(),
    execution: initial(),
  };
}

// Résultat de la détection des dossiers et artefacts du projet STM32.
export interface QC1ProjectStatus {
  workspaceOpened: boolean;

  projectDetected: boolean;
  projectStatus: "OK" | "PARTIEL" | "ERREUR";

  cmakeProjectReady: boolean;
  targetFamily: string;
  targetDevice: string;
  coreMode: string;
  cm7Present: boolean;
  cm4Present: boolean;
  cm7ElfFound: boolean;
  cm4ElfFound: boolean;
  cm7StartupFound: boolean;
  cm4StartupFound: boolean;
  cm7LinkerFound: boolean;
  cm4LinkerFound: boolean;

  coreFolderFound: boolean;
  driversFolderFound: boolean;
  startupFound: boolean;
  linkerScriptFound: boolean;
  buildFolderFound: boolean;

  elfFound: boolean;
  binFound: boolean;

  workspacePath: string;
  cmakeSourcePath: string;
  corePath: string;
  driversPath: string;
  startupPath: string;
  linkerScriptPath: string;
}

// Outils trouvés sur la machine ou fournis par une extension dépendante.
export interface QC1EnvironmentStatus {
  os: string;
  osRaw: NodeJS.Platform;

  extensionVersion: string;
  cmakePath: string;
  cmakeSourcePath: string;
  buildPath: string;
  offlinePortable: boolean;

  gccDetected: boolean;
  gdbDetected: boolean;
  openocdDetected: boolean;
  debuggerDetected: boolean;
  stlinkDetected: boolean;
  stFlashInstalled: boolean;
  stlinkProbeStatus: "OK" | "non détecté" | "non testé";
  stlinkModel?: string;
  stlinkSelectedProbe?: string;
  stlinkCheckedAt?: string;
  cmakeDetected: boolean;
  serialPort: string;
  baudRate: number;
}

export interface QC1HardwareSession {
  owner: string;
  kind: "programming" | "debug" | "openocd-server";
  probe: string;
  project: string;
}

// Objet central transmis au générateur HTML à chaque rafraîchissement complet.
export interface DashboardState {
  currentAction: string;
  projectName: string;
  lastCommand: string;

  diagnostic: QC1Diagnostic;

  progress: QC1TaskProgress;

  build: QC1BuildStatus;

  flash: QC1FlashStatus;

  operations: QC1OperationStates;

  project: QC1ProjectStatus;

  environment: QC1EnvironmentStatus;
  hardwareSessions: QC1HardwareSession[];

  projectDiscovery: ProjectUiState;
  recentProjects: RecentProject[];
  tools: ToolUiState[];
  diagnostics: QC1Diagnostic[];
  artifacts: ArtifactUiState[];
  operationHistory: Qc1OperationTimelineEntry[];
}

/** Convertit le nom technique de Node.js en libellé lisible dans l'interface. */
export function getOsLabel(platform: NodeJS.Platform): string {
  switch (platform) {
    case "darwin":
      return "macOS";
    case "win32":
      return "Windows";
    case "linux":
      return "Linux";
    default:
      return platform;
  }
}

// Premier état affiché avant la détection du projet ou le lancement d'une commande.
export const defaultDashboardState: DashboardState = {
  recentProjects: [],
  tools: [],
  diagnostics: [],
  artifacts: [],
  operationHistory: [],
  hardwareSessions: [],
  currentAction: "Idle",
  projectName: "--",
  lastCommand: "--",

  diagnostic: {
    code: "QC1-IDLE-001",
    level: "idle",
    title: "IDLE",
    message: "Aucune tâche active",
    cause: "--",
    checkedPath: "--"
  },

  progress: {
    active: false,
    taskName: "",
    phase: "idle",
    runtimeSeconds: 0,
    progressPercent: 0,
    completedSteps: 0,
    totalSteps: 0,
    measured: false,
    currentStep: ""
  },

  build: {
    lastBuildTime: "Jamais",
    lastBuildSuccess: false,

    buildRuntimeMs: 0,

    errors: 0,
    warnings: 0,

    flashUsage: "--",
    ramUsage: "--",

    elfGenerated: false,
    binGenerated: false
  },

  flash: {
    lastFlashTime: "Jamais",
    lastFlashSuccess: false,

    flashRuntimeMs: 0,

    method: "--",
    targetMCU: "--"
  },

  operations: createInitialOperationStates(),

  project: {
    workspaceOpened: false,

    projectDetected: false,
    projectStatus: "ERREUR",

    cmakeProjectReady: false,
    targetFamily: "unknown",
    targetDevice: "unknown",
    coreMode: "unknown",
    cm7Present: false,
    cm4Present: false,
    cm7ElfFound: false,
    cm4ElfFound: false,
    cm7StartupFound: false,
    cm4StartupFound: false,
    cm7LinkerFound: false,
    cm4LinkerFound: false,

    coreFolderFound: false,
    driversFolderFound: false,
    startupFound: false,
    linkerScriptFound: false,
    buildFolderFound: false,

    elfFound: false,
    binFound: false,

    workspacePath: "--",
    cmakeSourcePath: "--",
    corePath: "--",
    driversPath: "--",
    startupPath: "--",
    linkerScriptPath: "--"
  },

  environment: {
    os: getOsLabel(process.platform),
    osRaw: process.platform,

    extensionVersion: "0.3.1",
    cmakePath: "--",
    cmakeSourcePath: "--",
    buildPath: "--",
    offlinePortable: true,

    gccDetected: false,
    gdbDetected: false,
    openocdDetected: false,
    debuggerDetected: false,
    stlinkDetected: false,
    stFlashInstalled: false,
    stlinkProbeStatus: "non testé",
    stlinkSelectedProbe: "Non sélectionnée",
    cmakeDetected: false,
    serialPort: "",
    baudRate: 19200
  },

  projectDiscovery: {
    status: "idle",
    message: "",
    candidates: [],
    selectedPath: ""
  }
};

/**
 * Ferme la progression et remplace aussi le diagnostic principal.
 * En cas d'erreur, la barre reste au dernier jalon atteint pour montrer où ça a bloqué.
 */
export function finishProgress(
  state: DashboardState,
  success: boolean,
  successCode: string,
  errorCode: string,
  successTitle: string,
  errorTitle: string,
  message: string,
  cause = success ? "Commande terminée" : "Commande échouée",
  checkedPath = "--"
): DashboardState {
  const runtimeSeconds = state.progress.startedAt
    ? Math.floor((Date.now() - state.progress.startedAt) / 1000)
    : state.progress.runtimeSeconds;

  return {
    ...state,
    currentAction: success ? "Terminé" : "Erreur",
    progress: {
      ...state.progress,
      active: false,
      runtimeSeconds,
      progressPercent: success ? 100 : state.progress.progressPercent,
      currentStep: message
    },
    diagnostic: {
      code: success ? successCode : errorCode,
      level: success ? "success" : "error",
      title: success ? successTitle : errorTitle,
      message,
      cause,
      checkedPath
    }
  };
}
