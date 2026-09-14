/**
 * RÉSUMÉ DU FICHIER — CONTRÔLEUR PRINCIPAL DE L'EXTENSION QC1
 *
 * Ce fichier relie VS Code, le projet STM32, les outils système et l'interface.
 * C'est le meilleur point d'entrée pour comprendre « où vont » les actions :
 *
 *   bouton Webview
 *     -> `onDidReceiveMessage()`
 *     -> `runCommand()` / une action spécialisée
 *     -> détection + commande CMake/OpenOCD
 *     -> mise à jour de `dashboardState`
 *     -> `refreshDashboard()` ou `webview.postMessage()`
 *     -> affichage dans dashboardHtml.ts
 *
 * Grandes sections du fichier :
 * 1. découverte des outils et du projet;
 * 2. diagnostics et construction des commandes;
 * 3. rapport de diagnostic partageable;
 * 4. synchronisation de l'état avec la Webview;
 * 5. classe `QC1PanelProvider` qui reçoit les clics;
 * 6. `activate()` qui enregistre vues et commandes VS Code.
 *
 * BARRE DE PROGRESSION RÉELLE
 * - `spawn()` transmet stdout pendant que CMake/Ninja travaille;
 * - `ProgressManager` transforme `[14/37]` en 38 %;
 * - un message `progress` actualise la Webview sans reconstruire son HTML;
 * - `ensureToolsInstalled()` peut télécharger CMake/Ninja/GCC, mais ce téléchargement
 *   appartient à Embedded Build Tools et QC1 ne reçoit pas son nombre d'octets;
 * - le dessin de la barre se trouve dans dashboard/dashboardHtml.ts;
 * - les règles d'état se trouvent dans dashboard/dashboardState.ts.
 *
 * Modifier les fichiers `src/`, puis lancer `npm run compile`. Les fichiers `out/`
 * sont générés automatiquement et ne doivent normalement pas être édités à la main.
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { executableExists, resolveExecutable, collectTools, runProcess } from "./qc1/processTools";
import { inside, resolveUserPath } from "./qc1/filesystem";
import { inspectProjectDetails } from "./qc1/projectDiagnostics";
import { inspectSystem, inspectDevices } from "./qc1/systemInspection";
import { readFileApi } from "./qc1/cmakeFileApi";
import { completeExtensionInventory } from "./qc1/extensionInventory";
import {
  DashboardState,
  defaultDashboardState,
  getOsLabel,
  finishProgress
} from "./dashboard/dashboardState";
import { getDashboardHtml } from "./dashboard/dashboardHtml";
import { ProgressManager, Qc1ProgressUpdate } from "./dashboard/progressManager";
import { parseQc1Output } from "./qc1/qc1Parser";
import {
  findStm32Project,
  inspectStm32Project,
  Qc1ProjectLayout,
  Qc1ProjectInspection,
  resolveConfiguredProjectPath
} from "./qc1/projectDiscovery";
import {
  getOpenOcdProgramArgs,
  getOpenOcdServerArgs,
  getStFlashWriteArgs,
  readStlinkProbeStatus
} from "./qc1/hardware";
import {
  buildDiagnosticReport,
  DiagnosticToolReport
} from "./qc1/diagnosticReport";

// État partagé entre le contrôleur et la Webview QC1.
let dashboardState: DashboardState = defaultDashboardState;
let dashboardPanel: vscode.WebviewView | undefined;
let outputChannel: vscode.OutputChannel | undefined;
let stlinkProbeStatus: "OK" | "non détecté" | "non testé" = "non testé";
let embeddedCmakePath = "";
let embeddedGccPath = "";
let embeddedNinjaPath = "";
const projectCache = new Map<string, { time: number; value: Qc1ProjectInspection | null }>();
function discoverProject(root: string): Qc1ProjectInspection | null {
  const cached = projectCache.get(root);
  if (cached && Date.now() - cached.time < 1500) return cached.value;
  const value = findStm32Project(root);
  if (projectCache.size > 20) projectCache.clear();
  projectCache.set(root, { time: Date.now(), value });
  return value;
}

type EmbeddedBuildToolsApi = {
  ensureToolsInstalled(): Promise<boolean>;
  getCmakePath(): Promise<string | undefined>;
  getGccPath(): Promise<string | undefined>;
  getNinjaPath(): Promise<string | undefined>;
};

/**
 * Active la dépendance Embedded Build Tools et récupère ses exécutables.
 * `ensureToolsInstalled()` peut afficher/télécharger les outils de son côté. Son API
 * renvoie seulement terminé/échoué : elle n'expose pas une progression en octets à QC1.
 */
async function initializeEmbeddedBuildTools(): Promise<void> {
  if (!vscode.workspace.isTrusted) return;
  const extension = vscode.extensions.getExtension<EmbeddedBuildToolsApi>("mylonics.embedded-build-tools");
  if (!extension) {
    return;
  }

  try {
    const api = await extension.activate();
    if (!await api.ensureToolsInstalled()) {
      return;
    }

    embeddedCmakePath = await api.getCmakePath() || "";
    embeddedGccPath = await api.getGccPath() || "";
    embeddedNinjaPath = await api.getNinjaPath() || "";
  } catch (error) {
    outputChannel?.appendLine(`[QC1] Outils embarqués indisponibles: ${(error as Error).message}`);
  }
}

// === AIDES FICHIERS, WORKSPACE ET PATH ======================================

function fileExists(filePath: string): boolean {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function getWorkspaceRoot(): string | undefined {
  const active = vscode.window.activeTextEditor?.document.uri;
  const activeRoot = active ? vscode.workspace.getWorkspaceFolder(active)?.uri.fsPath : undefined;
  const roots = [...new Set([activeRoot, ...(vscode.workspace.workspaceFolders || []).filter(folder => folder.uri.scheme === "file").map(folder => folder.uri.fsPath)].filter((root): root is string => Boolean(root)))];
  return roots.find(root => vscode.workspace.getConfiguration("qc1", vscode.Uri.file(root)).get<string>("projectPath", "").trim() || discoverProject(root)) || roots[0];
}

function qc1Configuration(root = getWorkspaceRoot()): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("qc1", root ? vscode.Uri.file(root) : undefined);
}


/** Cherche un exécutable dans le PATH courant, avec PATHEXT sous Windows. */
function findExecutable(name: string): string | null {
  return resolveExecutable(name) || null;
}

function getExistingSettingPath(config: vscode.WorkspaceConfiguration, key: string): string {
  const configuredPath = (config.get<string>(key) || "").trim();
  if (!configuredPath) return "";
  const resolved = resolveUserPath(configuredPath, getWorkspaceRoot() || process.cwd());
  return executableExists(resolved) ? resolved : resolveExecutable(configuredPath);
}

function getExecutableSettingPath(
  config: vscode.WorkspaceConfiguration,
  key: string,
  fallbackName: string
): string {
  const configured = (config.get<string>(key) || "").trim();
  if (configured) {
    const resolved = resolveUserPath(configured, getWorkspaceRoot() || process.cwd());
    if (executableExists(resolved)) return resolved;
    const configuredFromPath = findExecutable(configured);
    if (configuredFromPath) return configuredFromPath;
  }

  return findExecutable(fallbackName) || "";
}

/** Détecte un port série plausible lorsque qc1.serialPort est vide. */
function findSerialPort(configuredPort: string): string {
  if (configuredPort) return configuredPort;
  if (os.platform() === "win32") return "";

  const patterns = os.platform() === "darwin"
    ? [/^cu\.usb/i, /^tty\.usb/i]
    : [/^ttyACM\d+$/i, /^ttyUSB\d+$/i];

  try {
    const device = fs.readdirSync("/dev").sort().find((name) => patterns.some((pattern) => pattern.test(name)));
    return device ? path.join("/dev", device) : "";
  } catch {
    return "";
  }
}

// === PHOTOGRAPHIE COMPLÈTE DE L'ÉTAT QC1 ===================================

// Toutes les informations calculées pour l'interface, les validations et le rapport.
type Qc1Status = {
  projectPath: string;
  projectLayout: Qc1ProjectLayout;
  projectName: string;
  cmakeSourcePath: string;
  buildPath: string;
  elfPath: string;
  binPath: string;
  corePath: string;
  driversPath: string;
  sourcePath: string;
  startupPath: string;
  linkerScriptPath: string;
  projectOk: boolean;
  projectComplete: boolean;
  cmakeProjectReady: boolean;
  nativeCmakeOk: boolean;
  bundledCmakeReady: boolean;
  coreOk: boolean;
  driversOk: boolean;
  sourceOk: boolean;
  startupOk: boolean;
  linkerScriptOk: boolean;
  cmakePath: string;
  cmakeOk: boolean;
  cmakeSource: string;
  ninjaPath: string;
  ninjaOk: boolean;
  ninjaSource: string;
  compilerPath: string;
  compilerOk: boolean;
  compilerSource: string;
  openocdPath: string;
  openocdOk: boolean;
  openocdSource: string;
  stFlashPath: string;
  stFlashOk: boolean;
  stFlashSource: string;
  stlinkPath: string;
  stlinkToolOk: boolean;
  serialPort: string;
  baudRate: number;
  stlinkProbeStatus: "OK" | "non détecté" | "non testé";
  stlinkProbeOk: boolean;
};

// Diagnostic court présenté dans la carte principale du Dashboard.
type Qc1DiagnosticInfo = {
  code: string;
  title: string;
  message: string;
  cause: string;
  checkedPath: string;
  level: "success" | "warning" | "error" | "info" | "idle";
};

// Erreur normalisée : toutes les sources d'erreur finissent dans ce même format.
type Qc1Error = {
  code: string;
  title: string;
  message: string;
  cause?: string;
  command?: string;
  cwd?: string;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  path?: string;
};

/** Fournit des valeurs par défaut afin que l'interface reçoive toujours une erreur complète. */
function createQc1Error(input: Partial<Qc1Error>): Qc1Error {
  return {
    code: input.code || "QC1-EXT-001",
    title: input.title || "Erreur interne extension",
    message: input.message || "Une erreur inattendue est survenue.",
    cause: input.cause,
    command: input.command,
    cwd: input.cwd,
    exitCode: input.exitCode,
    stdout: input.stdout,
    stderr: input.stderr,
    path: input.path
  };
}

function getExitCode(error: unknown): number | null {
  const code = (error as { code?: unknown })?.code;
  return typeof code === "number" ? code : null;
}

function isTimeoutError(error: unknown): boolean {
  const err = error as { killed?: boolean; signal?: string; message?: string };
  return Boolean(err?.killed && err.signal === "SIGTERM") || Boolean(err?.message?.toLowerCase().includes("timed out"));
}

/** Liste blanche des commandes acceptées depuis la Webview. */
function isAllowedQc1Command(command: string): boolean {
  return [
    "build",
    "clean",
    "rebuild",
    "tsmake",
    "flash",
    "run",
    "health",
    "status",
    "error",
    "serial",
    "dev"
  ].includes(command);
}

/**
 * Fonction centrale de détection.
 * Elle ne lance pas de build : elle inspecte les réglages, le projet, les fichiers,
 * les artefacts et les outils, puis retourne une photographie cohérente.
 */
export function getQc1Status(context: vscode.ExtensionContext): Qc1Status {
  const workspaceRoot = getWorkspaceRoot() || "";
  const config = vscode.workspace.getConfiguration("qc1", workspaceRoot ? vscode.Uri.file(workspaceRoot) : undefined);

  const configuredProjectPath = (config.get<string>("projectPath") || "").trim();
  const autoDetectProject = config.get<boolean>("autoDetectProject", true);
  const configuredCmakePath = getExistingSettingPath(config, "cmakePath");
  const compilerPathSetting = getExistingSettingPath(config, "compilerPath");
  const openocdPathSetting = getExistingSettingPath(config, "openocdPath");
  const requestedProjectPath = workspaceRoot
    ? resolveConfiguredProjectPath(configuredProjectPath, workspaceRoot)
    : configuredProjectPath;
  const workspaceRoots = [...new Set([requestedProjectPath, ...(vscode.workspace.workspaceFolders || []).map(f => f.uri.fsPath)].filter(Boolean))];
  const detectedProject = !configuredProjectPath && autoDetectProject
    ? workspaceRoots.map(root => discoverProject(root)).find(Boolean)
    : null;
  const projectInspection = detectedProject || (requestedProjectPath
    ? inspectStm32Project(requestedProjectPath)
    : inspectStm32Project(""));
  const projectPath = projectInspection.root;
  const projectOk = Boolean(projectPath) && fileExists(projectPath) && projectInspection.layout !== "unknown";
  const corePath = projectInspection.corePath;
  const driversPath = projectInspection.driversPath;
  const sourcePath = projectInspection.srcPath;
  const startupPath = projectInspection.startupPath;
  const linkerScriptPath = projectInspection.linkerScriptPath;
  const coreOk = Boolean(corePath) && fileExists(corePath);
  const driversOk = Boolean(driversPath) && fileExists(driversPath);
  const sourceOk = Boolean(sourcePath) && fileExists(sourcePath);
  const startupOk = Boolean(startupPath) && fileExists(startupPath);
  const linkerScriptOk = Boolean(linkerScriptPath) && fileExists(linkerScriptPath);
  const bundledCmakeSourcePath = path.join(context.extensionPath, "resources", "cmake");
  const nativeCmakeOk = Boolean(projectInspection.nativeCmakePath) && fileExists(projectInspection.nativeCmakePath);
  const bundledCmakeReady = fileExists(path.join(bundledCmakeSourcePath, "CMakeLists.txt")) &&
    fileExists(path.join(bundledCmakeSourcePath, "arm-none-eabi-toolchain.cmake"));
  const cmakeSourcePath = nativeCmakeOk ? projectPath : bundledCmakeSourcePath;
  const cmakeProjectReady = nativeCmakeOk || bundledCmakeReady;
  const buildDirectory = config.get<string>("buildDirectory", "build/qc1").trim() || "build/qc1";
  const buildPath = projectPath
    ? (path.isAbsolute(buildDirectory) ? buildDirectory : path.join(projectPath, buildDirectory))
    : "";
  const outputName = nativeCmakeOk ? projectInspection.projectName : "firmware";
  const fileApi = nativeCmakeOk ? readFileApi(buildPath, projectPath) : undefined;
  const targets = fileApi?.targets.filter(t => t.type === "EXECUTABLE" && (!t.configuration || t.configuration === config.get<string>("buildType", "Debug"))) || [];
  const configuredElf = config.get<string>("elfPath", "");
  const elfPath = configuredElf ? resolveUserPath(configuredElf, projectPath) : targets.length === 1 && targets[0].artifacts.length === 1 ? targets[0].artifacts[0] : buildPath ? path.join(buildPath, `${outputName}.elf`) : "";
  const binPath = buildPath ? path.join(buildPath, `${outputName}.bin`) : "";
  const pathCmake = findExecutable(os.platform() === "win32" ? "cmake.exe" : "cmake");
  const cmakePath = configuredCmakePath || embeddedCmakePath || pathCmake || "";
  const cmakeSource = configuredCmakePath ? "setting" : embeddedCmakePath ? "extension" : pathCmake ? "PATH" : "introuvable";
  const pathNinja = findExecutable(os.platform() === "win32" ? "ninja.exe" : "ninja");
  const ninjaPath = embeddedNinjaPath || pathNinja || "";
  const ninjaSource = embeddedNinjaPath ? "extension" : pathNinja ? "PATH" : "introuvable";

  const autoCompilerPath = findExecutable(os.platform() === "win32" ? "arm-none-eabi-gcc.exe" : "arm-none-eabi-gcc");
  const compilerPath = compilerPathSetting || embeddedGccPath || autoCompilerPath || "";
  const compilerSource = compilerPathSetting ? "setting" : embeddedGccPath ? "extension" : autoCompilerPath ? "PATH" : "introuvable";

  const autoOpenocdPath = findExecutable(os.platform() === "win32" ? "openocd.exe" : "openocd");
  const openocdPath = openocdPathSetting || autoOpenocdPath || "";
  const openocdSource = openocdPathSetting ? "setting" : autoOpenocdPath ? "PATH" : "introuvable";

  const autoStFlashPath = findExecutable(os.platform() === "win32" ? "st-flash.exe" : "st-flash");
  const stFlashPath = autoStFlashPath || "";
  const stFlashSource = autoStFlashPath ? "PATH" : "introuvable";
  const stlinkPath = getExecutableSettingPath(config, "stlinkPath", os.platform() === "win32" ? "st-info.exe" : "st-info");
  const serialPort = findSerialPort((config.get<string>("serialPort") || "").trim());
  const baudRate = config.get<number>("baudRate", 19200);
  const projectComplete = projectOk && cmakeProjectReady && (nativeCmakeOk || (sourceOk && startupOk && linkerScriptOk));

  return {
    projectPath,
    projectLayout: projectInspection.layout,
    projectName: projectInspection.projectName,
    cmakeSourcePath,
    buildPath,
    elfPath,
    binPath,
    corePath,
    driversPath,
    sourcePath,
    startupPath,
    linkerScriptPath,
    projectOk,
    projectComplete,
    cmakeProjectReady,
    nativeCmakeOk,
    bundledCmakeReady,
    coreOk,
    driversOk,
    sourceOk,
    startupOk,
    linkerScriptOk,
    cmakePath: cmakePath || "Not found",
    cmakeOk: Boolean(cmakePath),
    cmakeSource,
    ninjaPath: ninjaPath || "Not found",
    ninjaOk: Boolean(ninjaPath),
    ninjaSource,
    compilerPath: compilerPath || "Not found",
    compilerOk: Boolean(compilerPath),
    compilerSource,
    openocdPath: openocdPath || "Not found",
    openocdOk: Boolean(openocdPath),
    openocdSource,
    stFlashPath: stFlashPath || "Not found",
    stFlashOk: Boolean(stFlashPath),
    stFlashSource,
    stlinkPath: stlinkPath || "Not found",
    stlinkToolOk: Boolean(stlinkPath),
    serialPort,
    baudRate,
    stlinkProbeStatus,
    stlinkProbeOk: stlinkProbeStatus === "OK"
  };
}

// === DIAGNOSTICS LISIBLES PAR L'UTILISATEUR ================================

/** Transforme l'état complet en texte copiable dans les journaux. */
function formatDiagnostic(status: Qc1Status): string {
  const projectDiagnostics = getProjectDiagnostics(status);
  const diagnosticLines = projectDiagnostics.length > 0
    ? projectDiagnostics.map((diagnostic) =>
        `${diagnostic.code} [${diagnostic.level}] ${diagnostic.message} — ${diagnostic.checkedPath}`)
    : ["QC1-OK-001 [success] Projet OK"];
  const lines = [
    "Status outils QC1",
    "",
    "Diagnostics projet",
    ...diagnosticLines,
    "",
    `Project Folder      ${status.projectOk ? "OK" : "Missing"}`,
    `Structure           ${status.projectLayout}`,
    `CMake utilisé       ${status.nativeCmakeOk ? "projet natif" : status.bundledCmakeReady ? "QC1 intégré" : "Introuvable"}`,
    `Sources             ${status.sourceOk ? "OK" : "Introuvable"}`,
    `Core                ${status.coreOk ? "OK" : "optionnel/absent"}`,
    `Drivers             ${status.driversOk ? "OK" : "optionnel/absent"}`,
    `Startup STM32F103   ${status.startupOk ? "OK" : "Introuvable"}`,
    `Linker script       ${status.linkerScriptOk ? "OK" : "Introuvable"}`,
    `CMake               ${status.cmakeOk ? `OK ${status.cmakeSource}` : "Introuvable"}`,
    `Ninja               ${status.ninjaOk ? `OK ${status.ninjaSource}` : "Introuvable"}`,
    `ARM GCC             ${status.compilerOk ? `OK ${status.compilerSource}` : "Missing"}`,
    `OpenOCD             ${status.openocdOk ? `OK ${status.openocdSource}` : "Missing"}`,
    `st-flash installé  ${status.stFlashOk ? `OK ${status.stFlashSource}` : "Missing"}`,
    `st-info             ${status.stlinkToolOk ? "OK" : "Missing"}`,
    `Probe ST-Link       ${status.stlinkProbeStatus}`,
    `Port série          ${status.serialPort || "Non configuré/détecté"}`,
    "",
    "Project folder:",
    status.projectPath || "Not found",
    "",
    "CMake source intégré:",
    status.cmakeSourcePath || "Not found",
    "",
    "CMake build:",
    status.buildPath || "Not found",
    "",
    "Firmware ELF:",
    status.elfPath || "Not found",
    "",
    "Sources:",
    status.sourcePath || "Not found",
    "",
    "Core folder:",
    status.corePath || "Not found",
    "",
    "Drivers folder:",
    status.driversPath || "Not found",
    "",
    "Startup:",
    status.startupPath || "Not found",
    "",
    "Linker script:",
    status.linkerScriptPath || "Not found",
    "",
    "CMake:",
    status.cmakePath || "Not found",
    "",
    "Ninja:",
    status.ninjaPath || "Not found",
    "",
    "Compiler:",
    status.compilerPath || "Not found",
    "",
    "OpenOCD:",
    status.openocdPath || "Not found",
    "",
    "st-flash:",
    status.stFlashPath || "Not found",
    "",
    "st-info:",
    status.stlinkPath || "Not found"
  ];

  return lines.join("\n");
}

/** Retourne toutes les anomalies de structure du projet, pas seulement la première. */
export function getProjectDiagnostics(status: Qc1Status): Qc1DiagnosticInfo[] {
  const diagnostics: Qc1DiagnosticInfo[] = [];

  if (!status.projectOk) {
    diagnostics.push({
      code: "QC1-PATH-001",
      level: "error",
      title: "CHEMIN_PROJET_INVALIDE",
      message: "Projet STM32 introuvable",
      cause: "Le chemin ne contient pas un projet STM32 reconnu et l'auto-détection n'a rien trouvé",
      checkedPath: status.projectPath || "--"
    });
    return diagnostics;
  }

  if (!status.cmakeProjectReady) {
    diagnostics.push({
      code: "QC1-PRJ-001",
      level: "error",
      title: "CMAKE_QC1_INTROUVABLE",
      message: "Projet CMake introuvable",
      cause: "Ni CMakeLists.txt natif ni projet CMake QC1 intégré utilisable",
      checkedPath: status.cmakeSourcePath || "--"
    });
  }

  if (!status.sourceOk && !status.nativeCmakeOk) {
    diagnostics.push({
      code: "QC1-PRJ-002",
      level: "error",
      title: "SOURCES_INTROUVABLES",
      message: "Dossier de sources introuvable",
      cause: "Aucune source C/C++ trouvée dans les limites du scan",
      checkedPath: status.sourcePath || status.projectPath
    });
  }

  if (status.projectLayout === "cubemx" && !status.driversOk) {
    diagnostics.push({
      code: "QC1-PRJ-003",
      level: "warning",
      title: "DRIVERS_INTROUVABLE",
      message: "Dossier Drivers introuvable",
      cause: "Drivers est attendu pour un projet CubeMX, mais reste optionnel en bare-metal",
      checkedPath: status.driversPath || (status.projectPath ? path.join(status.projectPath, "Drivers") : "--")
    });
  }

  if (!status.startupOk) {
    diagnostics.push({
      code: "QC1-PRJ-004",
      level: status.nativeCmakeOk ? "warning" : "error",
      title: "STARTUP_INTROUVABLE",
      message: "Startup non résolu ou ambigu",
      cause: "Startup générique/personnalisé accepté; CMake peut le générer ou le fournir via une bibliothèque",
      checkedPath: status.projectPath
    });
  }

  if (!status.linkerScriptOk) {
    diagnostics.push({
      code: "QC1-PRJ-005",
      level: status.nativeCmakeOk ? "warning" : "error",
      title: "LINKER_SCRIPT_INTROUVABLE",
      message: "Linker script introuvable",
      cause: "Le projet doit contenir un fichier .ld",
      checkedPath: status.projectPath
    });
  }

  return diagnostics;
}

/** Sélectionne l'anomalie principale affichée dans la carte Diagnostic. */
function getProjectDiagnostic(status: Qc1Status): Qc1DiagnosticInfo {
  const diagnostics = getProjectDiagnostics(status);
  if (diagnostics.length > 0) return diagnostics[0];
  return {
    code: "QC1-OK-001",
    level: "success",
    title: "PROJET_OK",
    message: "Projet OK",
    cause: `Projet ${status.projectLayout}, sources, startup et linker valides`,
    checkedPath: status.projectPath
  };
}

/** Vérifie si les outils nécessaires à une commande précise sont disponibles. */
function getToolDiagnostic(status: Qc1Status, command: string): Qc1DiagnosticInfo | undefined {
  if (!status.cmakeOk && ["build", "clean", "rebuild", "tsmake", "flash", "run", "health", "status"].includes(command)) {
    return {
      code: "QC1-TOOL-001",
      level: "error",
      title: "CMAKE_INTROUVABLE",
      message: "CMake introuvable",
      cause: "La commande nécessite CMake; configure qc1.cmakePath si CMake n'est pas dans le PATH",
      checkedPath: status.cmakePath || "PATH"
    };
  }

  if (!status.nativeCmakeOk && !status.ninjaOk && ["build", "clean", "rebuild", "tsmake", "flash", "run"].includes(command)) {
    return {
      code: "QC1-TOOL-004",
      level: "error",
      title: "NINJA_INTROUVABLE",
      message: "Ninja introuvable",
      cause: "La chaîne CMake autonome nécessite Ninja fourni par Embedded Build Tools",
      checkedPath: status.ninjaPath || "PATH"
    };
  }

  if (!status.nativeCmakeOk && !status.compilerOk && ["build", "rebuild", "tsmake", "flash", "run"].includes(command)) {
    return {
      code: "QC1-TOOL-002",
      level: "error",
      title: "GCC_ARM_INTROUVABLE",
      message: "arm-none-eabi-gcc introuvable",
      cause: "La commande nécessite le compilateur ARM GCC",
      checkedPath: status.compilerPath || "PATH"
    };
  }

  if (!status.openocdOk && !status.stFlashOk && ["flash", "run"].includes(command)) {
    return {
      code: "QC1-TOOL-003",
      level: "error",
      title: "FLASHER_INTROUVABLE",
      message: "OpenOCD et st-flash introuvables",
      cause: "La commande flash nécessite OpenOCD ou st-flash",
      checkedPath: "PATH"
    };
  }

  return undefined;
}

// Convertit les erreurs de validation et de processus vers le format UI commun.
function createQc1ErrorFromDiagnostic(
  diagnostic: Qc1DiagnosticInfo,
  command: string,
  cwd: string
): Qc1Error {
  return createQc1Error({
    code: diagnostic.code,
    title: diagnostic.title,
    message: diagnostic.message,
    cause: diagnostic.cause,
    command,
    cwd,
    path: diagnostic.checkedPath
  });
}

function createQc1ErrorFromProcess(
  error: unknown,
  command: string,
  cwd: string,
  stdout: string,
  stderr: string
): Qc1Error {
  if (isTimeoutError(error)) {
    return createQc1Error({
      code: "QC1-CMD-002",
      title: "COMMANDE_EXPIREE",
      message: "Commande expiree",
      cause: (error as Error)?.message || "La commande a depasse le delai permis",
      command,
      cwd,
      exitCode: getExitCode(error),
      stdout,
      stderr
    });
  }

  if (error) {
    return createQc1Error({
      code: "QC1-CMD-001",
      title: "COMMANDE_ECHOUEE",
      message: "Commande échouée",
      cause: stderr.trim() || (error as Error)?.message || "La commande QC1 a retourné une erreur",
      command,
      cwd,
      exitCode: getExitCode(error),
      stdout,
      stderr
    });
  }

  return createQc1Error({
    code: "QC1-EXT-001",
    title: "ERREUR_INTERNE_EXTENSION",
    message: "Erreur interne extension",
    cause: "La commande a produit un résultat invalide sans erreur système",
    command,
    cwd,
    stdout,
    stderr
  });
}

// === CONSTRUCTION ET EXÉCUTION SÉCURISÉE DES COMMANDES =====================

/** Representation for logs only; never reuse this display string for execution. */
function quoteArg(arg: string): string {
  return `"${arg.replace(/"/g, '\\"')}"`;
}

/** Ajoute les dossiers des outils détectés devant le PATH sans supprimer le PATH existant. */
function getExecutionEnv(status: Qc1Status): NodeJS.ProcessEnv {
  const toolDirectories = [
    status.cmakeOk ? path.dirname(status.cmakePath) : "",
    status.ninjaOk ? path.dirname(status.ninjaPath) : "",
    status.compilerOk ? path.dirname(status.compilerPath) : "",
    status.openocdOk ? path.dirname(status.openocdPath) : "",
    status.stFlashOk ? path.dirname(status.stFlashPath) : "",
    status.stlinkToolOk ? path.dirname(status.stlinkPath) : ""
  ].filter(Boolean);
  const environment = { ...process.env };
  const pathKey = Object.keys(environment).find(key => os.platform() === "win32" ? key.toUpperCase() === "PATH" : key === "PATH") || "PATH";
  const currentPath = environment[pathKey] || "";
  delete environment[pathKey];
  return {
    ...environment,
    PATH: [...new Set(toolDirectories), currentPath].filter(Boolean).join(path.delimiter)
  };
}

// === COLLECTE DU RAPPORT DE DIAGNOSTIC =====================================

type DiagnosticProcessResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

/** Exécute une petite commande de lecture avec timeout; ne rejette jamais la Promise. */
function runDiagnosticProcess(executable: string, args: string[], cwd?: string, env?: NodeJS.ProcessEnv): Promise<DiagnosticProcessResult> {
  if (!vscode.workspace.isTrusted) return Promise.resolve({ exitCode: null, stdout: "", stderr: "Non exécuté: workspace non approuvé." });
  return runProcess(executable, args, { cwd, env, timeoutMs: 8000 }).then(result => ({
    ...result, stderr: [result.error, result.stderr].filter(Boolean).join("\n")
  }));
}

async function collectDiagnosticToolReports(status: Qc1Status): Promise<DiagnosticToolReport[]> {
  const configured: Record<string, string> = {};
  const sources: Record<string, string> = {};
  for (const [name, file, source, ok] of [
    ["cmake", status.cmakePath, status.cmakeSource, status.cmakeOk],
    ["ninja", status.ninjaPath, status.ninjaSource, status.ninjaOk],
    ["arm-none-eabi-gcc", status.compilerPath, status.compilerSource, status.compilerOk],
    ["openocd", status.openocdPath, status.openocdSource, status.openocdOk],
    ["st-info", status.stlinkPath, "configuration/PATH", status.stlinkToolOk]
  ] as const) if (ok) { configured[name] = file; sources[name] = source; }
  const scope = status.projectPath ? vscode.Uri.file(status.projectPath) : undefined;
  for (const [name, value] of Object.entries(vscode.workspace.getConfiguration("qc1", scope).get<Record<string, string>>("toolPaths", {}))) {
    if (typeof value === "string" && value.trim()) { configured[name] = resolveUserPath(value, status.projectPath || process.cwd()); sources[name] = "configuration QC1 toolPaths"; }
  }
  const cmakeTool = vscode.workspace.getConfiguration("cmake", scope).get<string>("cmakePath");
  if (!configured.cmake && cmakeTool) { configured.cmake = cmakeTool; sources.cmake = "CMake Tools setting"; }
  const cortex = vscode.workspace.getConfiguration("cortex-debug", scope).get<string>("armToolchainPath");
  const dirs = [status.compilerOk ? path.dirname(status.compilerPath) : "", cortex || "", ...Object.values(configured).filter(path.isAbsolute).map(file => path.dirname(file))].filter(Boolean);
  return collectTools({ configured, sources, directories: dirs, env: getExecutionEnv(status), trusted: vscode.workspace.isTrusted });
}

function isPathInside(candidate: string, root: string): boolean {
  return Boolean(candidate && root) && inside(root, candidate);
}

function collectVsCodeProblems(projectRoot: string): string[] {
  const severityLabels: Record<number, string> = {
    [vscode.DiagnosticSeverity.Error]: "Erreur",
    [vscode.DiagnosticSeverity.Warning]: "Avertissement",
    [vscode.DiagnosticSeverity.Information]: "Information",
    [vscode.DiagnosticSeverity.Hint]: "Conseil"
  };
  const problems: string[] = [];
  let total = 0;

  for (const [uri, diagnostics] of vscode.languages.getDiagnostics()) {
    if (uri.scheme !== "file" || (projectRoot && !isPathInside(uri.fsPath, projectRoot))) continue;

    for (const diagnostic of diagnostics) {
      total += 1;
      if (problems.length >= 100) continue;
      const code = typeof diagnostic.code === "object" ? diagnostic.code.value : diagnostic.code;
      const location = `${uri.fsPath}:${diagnostic.range.start.line + 1}:${diagnostic.range.start.character + 1}`;
      const origin = [diagnostic.source, code].filter((value) => value !== undefined && value !== "").join("/");
      const message = diagnostic.message.replace(/\s+/g, " ").trim();
      problems.push(`[${severityLabels[diagnostic.severity]}] ${location}${origin ? ` (${origin})` : ""} — ${message}`);
    }
  }

  if (total > problems.length) problems.push(`... ${total - problems.length} problème(s) supplémentaire(s) omis`);
  return problems;
}

/** Capture le commit et les changements Git du projet, sans URL de dépôt. */
async function collectGitSnapshot(projectRoot: string): Promise<string> {
  if (!projectRoot) return "Projet introuvable; état Git non disponible.";

  const inside = await runDiagnosticProcess("git", ["rev-parse", "--is-inside-work-tree"], projectRoot);
  if (inside.exitCode !== 0 || inside.stdout.trim() !== "true") {
    return "Dépôt Git non détecté pour ce projet.";
  }

  const [head, status] = await Promise.all([
    runDiagnosticProcess("git", ["log", "-1", "--format=commit: %H%nsubject: %s%nauthor-date: %aI"], projectRoot),
    runDiagnosticProcess("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--short", "--branch", "--untracked-files=normal", "--", "."], projectRoot)
  ]);

  return [
    head.stdout.trim() || "Commit indisponible.",
    "",
    status.exitCode === 0 ? status.stdout.trim() || "Arbre de travail propre." : `État Git indisponible: ${status.stderr}`
  ].join("\n");
}

function artifactSnapshot(filePath: string): Record<string, unknown> {
  if (!filePath || !fileExists(filePath)) {
    return { path: filePath || "--", exists: false };
  }

  try {
    const stats = fs.statSync(filePath);
    return {
      path: filePath,
      exists: true,
      sizeBytes: stats.size,
      modifiedAt: stats.mtime.toISOString()
    };
  } catch (error) {
    return { path: filePath, exists: true, inspectionError: (error as Error).message };
  }
}

// === TERMINAUX EXTERNES ET COMMANDE CMAKE ==================================

/** Ouvre un vrai terminal VS Code pour le port série; la sortie n'est pas dans la Webview. */
function openSerialTerminal(context: vscode.ExtensionContext): void {
  if (!vscode.workspace.isTrusted) { void vscode.window.showWarningMessage("Approuve le workspace avant d'ouvrir un outil externe."); return; }
  const status = getQc1Status(context);
  if (!status.serialPort) {
    vscode.window.showErrorMessage("Aucun port série détecté. Configure qc1.serialPort puis réessaie.");
    return;
  }

  let terminal: vscode.Terminal;
  if (os.platform() === "win32") {
    if (!/^COM\d+$/i.test(status.serialPort) || !Number.isInteger(status.baudRate) || status.baudRate <= 0) { void vscode.window.showErrorMessage("Port COM ou baud rate invalide."); return; }
    terminal = vscode.window.createTerminal({ name: "QC1 Serial", shellPath: resolveExecutable("cmd.exe") || "cmd.exe", shellArgs: ["/d", "/c", `mode ${status.serialPort} BAUD=${status.baudRate} PARITY=n DATA=8 STOP=1 && type ${status.serialPort}`], env: getExecutionEnv(status) });
  } else {
    const screenPath = findExecutable("screen");
    if (!screenPath) {
      vscode.window.showErrorMessage("La commande screen est introuvable; installe-la ou utilise un moniteur série VS Code.");
      return;
    }
    terminal = vscode.window.createTerminal({ name: "QC1 Serial", shellPath: screenPath, shellArgs: [status.serialPort, String(status.baudRate)], env: getExecutionEnv(status) });
  }
  terminal.show();
}

/** Ouvre OpenOCD en mode serveur dans un terminal indépendant. */
function startOpenOcdTerminal(context: vscode.ExtensionContext): void {
  if (!vscode.workspace.isTrusted) { void vscode.window.showWarningMessage("Approuve le workspace avant d'ouvrir un outil externe."); return; }
  const status = getQc1Status(context);
  if (!status.openocdOk) {
    vscode.window.showErrorMessage("OpenOCD est introuvable. Configure qc1.openocdPath puis réessaie.");
    return;
  }

  const terminal = vscode.window.createTerminal({
    name: "QC1 OpenOCD",
    shellPath: status.openocdPath,
    shellArgs: getOpenOcdServerArgs(),
    env: getExecutionEnv(status)
  });
  terminal.show();
}

type ProcessInvocation = {
  phase: "configuring" | "cleaning" | "building" | "flashing";
  label: string;
  executable: string;
  args: string[];
  tracksNinja?: boolean;
};

type SpawnedProcessResult = DiagnosticProcessResult & {
  command: string;
  error?: unknown;
  timedOut: boolean;
};

function cmakeDefinition(name: string, value: string): string {
  return `-D${name}=${value}`;
}

/** Affichage uniquement : les arguments sont passés séparément à spawn(), sans shell. */
function formatInvocation(executable: string, args: string[]): string {
  return [quoteArg(executable), ...args.map(quoteArg)].join(" ");
}

/**
 * Décompose Build/Clean/Flash en vrais processus successifs. Ainsi stdout reste
 * disponible pendant l'exécution et le ProgressManager peut lire chaque `[x/y]`.
 */
export function buildProcessInvocations(status: Qc1Status, command: string): ProcessInvocation[] {
  const config = qc1Configuration();
  const buildType = config.get<string>("buildType", "Debug");
  const configureArgs = [
    "-S", status.cmakeSourcePath,
    "-B", status.buildPath,
    cmakeDefinition("CMAKE_BUILD_TYPE", buildType)
  ];

  if (!status.nativeCmakeOk) {
    const toolchainPath = path.join(status.cmakeSourcePath, "arm-none-eabi-toolchain.cmake");
    configureArgs.push(
      "-G", "Ninja",
      cmakeDefinition("CMAKE_MAKE_PROGRAM", status.ninjaPath),
      cmakeDefinition("CMAKE_TOOLCHAIN_FILE", toolchainPath),
      cmakeDefinition("QC1_PROJECT_ROOT", status.projectPath),
      cmakeDefinition("QC1_STARTUP", status.startupPath),
      cmakeDefinition("QC1_LINKER_SCRIPT", status.linkerScriptPath),
      cmakeDefinition("QC1_SOURCE_DIR", status.sourcePath)
    );

    if (status.compilerOk) {
      configureArgs.push(cmakeDefinition("QC1_ARM_GCC", status.compilerPath));
    }
  }

  const invocations: ProcessInvocation[] = [{
    phase: "configuring",
    label: "Configuration CMake",
    executable: status.cmakePath,
    args: configureArgs
  }];
  const buildArgs = ["--build", status.buildPath, "--config", buildType, "--parallel"];

  if (["clean", "rebuild"].includes(command)) {
    invocations.push({
      phase: "cleaning",
      label: "Nettoyage de la cible",
      executable: status.cmakePath,
      args: ["--build", status.buildPath, "--config", buildType, "--target", "clean"]
    });
  }

  if (["build", "rebuild", "tsmake", "flash", "run"].includes(command)) {
    invocations.push({
      phase: "building",
      label: "Compilation CMake",
      executable: status.cmakePath,
      args: buildArgs,
      tracksNinja: true
    });
  }

  if (!["flash", "run"].includes(command)) return invocations;

  const objcopyName = os.platform() === "win32" ? "arm-none-eabi-objcopy.exe" : "arm-none-eabi-objcopy";
  const objcopyPath = status.compilerOk ? path.join(path.dirname(status.compilerPath), objcopyName) : "";

  if (status.openocdOk) {
    invocations.push({
      phase: "flashing",
      label: "Flash avec OpenOCD",
      executable: status.openocdPath,
      args: getOpenOcdProgramArgs(status.elfPath)
    });
    return invocations;
  }

  if (fileExists(objcopyPath)) {
    invocations.push({
      phase: "flashing",
      label: "Création du firmware binaire",
      executable: objcopyPath,
      args: ["-O", "binary", "-S", status.elfPath, status.binPath]
    });
  }
  invocations.push({
    phase: "flashing",
    label: "Flash avec st-flash",
    executable: status.stFlashPath,
    args: getStFlashWriteArgs(status.binPath)
  });
  return invocations;
}

/** Lance un processus sans shell et retransmet stdout/stderr dès leur arrivée. */
function runSpawnedProcess(
  invocation: ProcessInvocation, cwd: string, env: NodeJS.ProcessEnv,
  onStdout: (chunk: string) => void, onStderr: (chunk: string) => void
): Promise<SpawnedProcessResult> {
  const command = formatInvocation(invocation.executable, invocation.args);
  if (!vscode.workspace.isTrusted) return Promise.resolve({ exitCode: null, stdout: "", stderr: "Workspace non approuvé", command, timedOut: false, error: new Error("Workspace non approuvé") });
  return runProcess(invocation.executable, invocation.args, { cwd, env, timeoutMs: 120000, maxBytes: 512 * 1024, onStdout, onStderr }).then(result => ({
    ...result, command, error: result.exitCode === 0 && !result.error ? undefined : Object.assign(new Error(result.error || result.stderr || "Processus échoué"), { code: result.exitCode, killed: result.timedOut })
  }));
}

// === SYNCHRONISATION DE LA BARRE ET DU DASHBOARD ===========================

/** Remplace le HTML complet par un nouveau rendu du `dashboardState`. */
function refreshDashboard() {
  if (dashboardPanel) {
    dashboardPanel.webview.html = getDashboardHtml(dashboardState);
  }
}

/**
 * Recopie la photographie technique `Qc1Status` vers le modèle simplifié du Dashboard.
 * Ajouter un nouveau champ visuel exige généralement : type + état ici + HTML correspondant.
 */
function syncDashboardState(context: vscode.ExtensionContext) {
  const status = getQc1Status(context);
  const diagnostic = getProjectDiagnostic(status);
  const projectRoot = status.projectPath || getWorkspaceRoot() || "";
  const buildDir = status.buildPath;
  const elfPath = status.elfPath;
  const binPath = status.binPath;

  dashboardState = {
    ...dashboardState,
    projectName: projectRoot ? path.basename(projectRoot) : "--",
    project: {
      workspaceOpened: status.projectOk,
      projectDetected: status.projectComplete,
      projectStatus: !status.projectOk ? "ERREUR" : status.projectComplete ? "OK" : "PARTIEL",
      cmakeProjectReady: status.cmakeProjectReady,
      coreFolderFound: status.coreOk,
      driversFolderFound: status.driversOk,
      startupFound: status.startupOk,
      linkerScriptFound: status.linkerScriptOk,
      buildFolderFound: Boolean(buildDir) && fileExists(buildDir),
      elfFound: Boolean(elfPath) && fileExists(elfPath),
      binFound: Boolean(binPath) && fileExists(binPath),
      workspacePath: status.projectPath || "--",
      cmakeSourcePath: status.cmakeSourcePath || "--",
      corePath: status.corePath || "--",
      driversPath: status.driversPath || "--",
      startupPath: status.startupPath || "--",
      linkerScriptPath: status.linkerScriptPath || "--"
    },
    environment: {
      ...dashboardState.environment,
      os: getOsLabel(process.platform),
      osRaw: process.platform,
      extensionVersion: context.extension.packageJSON.version || defaultDashboardState.environment.extensionVersion,
      cmakePath: status.cmakePath || "--",
      cmakeSourcePath: status.cmakeSourcePath || "--",
      buildPath: status.buildPath || "--",
      offlinePortable: status.cmakeProjectReady,
      gccDetected: status.compilerOk,
      openocdDetected: status.openocdOk,
      stlinkDetected: status.stlinkProbeOk,
      stFlashInstalled: status.stFlashOk,
      stlinkProbeStatus: status.stlinkProbeStatus,
      cmakeDetected: status.cmakeOk
    },
    diagnostic: {
      ...dashboardState.diagnostic,
      code: diagnostic.code,
      level: diagnostic.level,
      title: diagnostic.title,
      message: diagnostic.message,
      cause: diagnostic.cause,
      checkedPath: diagnostic.checkedPath
    }
  };
}

// === CONTRÔLEUR DE LA WEBVIEW QC1 ==========================================

/**
 * Propriétaire de la vue `qc1.panel`.
 * Il reçoit les messages envoyés par le JavaScript de dashboardHtml.ts et renvoie
 * les sorties, réglages, analyses et statuts avec `webview.postMessage()`.
 */
export class QC1PanelProvider implements vscode.WebviewViewProvider {
  private buildRunning = false;
  private reportRunning = false;
  public static readonly viewType = "qc1.panel";
  private view?: vscode.WebviewView;
  private outputLines: string[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly context: vscode.ExtensionContext
  ) {}

  /** Appelé par VS Code lorsque la barre latérale QC1 doit être créée. */
  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    dashboardPanel = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };

    webviewView.webview.html = getDashboardHtml(dashboardState);

    // Routeur Webview -> extension. Chaque `msg.type` provient d'un postMessage du HTML.
    webviewView.webview.onDidReceiveMessage(async (message: unknown) => {
      if (!message || typeof message !== "object") return;
      const raw = message as Record<string, unknown>;
      if (typeof raw.type !== "string") return;
      const msg = { type: raw.type, command: typeof raw.command === "string" ? raw.command : "" };
      try {
      switch (msg.type) {
        case "command":
          if (msg.command === "openLogs") {
            outputChannel?.show(true);
          } else {
            this.runCommand(msg.command);
          }
          break;

        case "run":
          this.runCommand(msg.command);
          break;

        case "terminal":
          this.runCommand(msg.command);
          break;

        case "clear":
          this.clearOutput();
          break;

        case "copyOutput":
          await vscode.env.clipboard.writeText(this.outputLines.join("\n"));
          this.postStatus("Output copied", "success");
          break;

        case "saveLog":
          await this.saveLog();
          break;

        case "createDiagnosticReport":
          await this.createDiagnosticReport();
          break;

        case "settings":
          await vscode.commands.executeCommand(
            "workbench.action.openSettings",
            "@ext:Mistral400.QC1-STM32-Tools"
          );
          break;

        case "refreshSettings":
          this.sendSettings();
          break;

        case "refreshTools":
          this.sendToolsStatus();
          break;

        case "autoDetectPaths":
          await this.autoDetectPaths();
          break;

        case "copyDiagnostic":
          await vscode.env.clipboard.writeText(formatDiagnostic(getQc1Status(this.context)));
          this.postStatus("Diagnostic copied", "success");
          break;

        case "openExtensionFolder":
          await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(this.context.extensionPath));
          break;

        case "openProjectFolder": {
          const root = getQc1Status(this.context).projectPath || getWorkspaceRoot();
          if (root) {
            await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(root));
          }
          break;
        }
      }
      } catch (error) {
        outputChannel?.appendLine(`[QC1] Action échouée: ${String(error)}`);
        this.postStatus("Action QC1 échouée", "error");
      }
    });

    this.sendSettings();
    this.sendToolsStatus();
    this.sendTerminalMeta();
    this.sendAnalysis({
      errors: dashboardState.build.errors,
      warnings: dashboardState.build.warnings,
      hasBuildFailed: false,
      hasFlashFailed: false,
      elfGenerated: dashboardState.build.elfGenerated,
      binGenerated: dashboardState.build.binGenerated,
      flashUsage: dashboardState.build.flashUsage || "--",
      ramUsage: dashboardState.build.ramUsage || "--",
      diagnostics: [],
      explanation: "Aucune erreur connue détectée."
    });
    syncDashboardState(this.context);
    refreshDashboard();
    this.postStatus("Ready", "idle");
  }

  /** Regroupe les réglages exposés à l'onglet Paramètres de la Webview. */
  private getConfig() {
    const config = qc1Configuration();
    const status = getQc1Status(this.context);

    return {
      os: getOsLabel(process.platform),
      osRaw: process.platform,
      extensionVersion: this.context.extension.packageJSON.version || defaultDashboardState.environment.extensionVersion,
      projectPath: config.get<string>("projectPath", ""),
      cmakePath: config.get<string>("cmakePath", ""),
      buildDirectory: config.get<string>("buildDirectory", "build/qc1"),
      buildType: config.get<string>("buildType", "Debug"),
      compilerPath: config.get<string>("compilerPath", ""),
      openocdPath: config.get<string>("openocdPath", ""),
      serialPort: config.get<string>("serialPort", ""),
      baudRate: config.get<number>("baudRate", 19200),
      stlinkPath: config.get<string>("stlinkPath", "st-info"),
      autoDetectProject: config.get<boolean>("autoDetectProject", true),
      autoClearOutput: config.get<boolean>("autoClearOutput", false),
      showTimestamps: config.get<boolean>("showTimestamps", true),
      outputMaxLines: config.get<number>("outputMaxLines", 500),
      compactMode: config.get<boolean>("compactMode", false),
      cmakeSource: status.cmakeSource,
      cmakeMode: status.nativeCmakeOk ? "projet natif" : "intégré au VSIX",
      detectedCmakePath: status.cmakePath || "--",
      cmakeSourcePath: status.cmakeSourcePath,
      buildPath: status.buildPath,
      offlinePortable: status.cmakeProjectReady
    };
  }

  /** Écrit les chemins auto-détectés dans les réglages du workspace. */
  private async autoDetectPaths() {
    const config = qc1Configuration();
    const status = getQc1Status(this.context);
    const updates: Thenable<void>[] = [];

    updates.push(config.update("projectPath", status.projectOk ? status.projectPath : "", vscode.ConfigurationTarget.Workspace));
    updates.push(config.update("cmakePath", status.cmakeOk && status.cmakeSource === "PATH" ? status.cmakePath : "", vscode.ConfigurationTarget.Workspace));
    updates.push(config.update("compilerPath", status.compilerOk && status.compilerSource === "PATH" ? status.compilerPath : "", vscode.ConfigurationTarget.Workspace));
    updates.push(config.update("openocdPath", status.openocdOk && status.openocdSource === "PATH" ? status.openocdPath : "", vscode.ConfigurationTarget.Workspace));
    updates.push(config.update("stlinkPath", status.stlinkToolOk ? status.stlinkPath : "st-info", vscode.ConfigurationTarget.Workspace));
    if (status.serialPort) {
      updates.push(config.update("serialPort", status.serialPort, vscode.ConfigurationTarget.Workspace));
    }

    await Promise.all(updates);
    this.sendSettings();
    this.sendToolsStatus();
    syncDashboardState(this.context);
    refreshDashboard();
    this.postStatus("Chemins détectés", "success");
  }

  /** Enregistre seulement le tampon du Terminal QC1 dans un fichier texte. */
  private async saveLog() {
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(getWorkspaceRoot() || this.context.extensionPath, "qc1-log.txt")),
      filters: {
        Text: ["txt", "log"]
      }
    });

    if (!uri) {
      return;
    }

    await fs.promises.writeFile(uri.fsPath, this.outputLines.join("\n"), "utf8");
    this.postStatus("Log saved", "success");
  }

  /**
   * Assemble le rapport complet, l'anonymise, ouvre sa prévisualisation puis propose
   * copie ou enregistrement. Cette progression utilise la notification native VS Code,
   * distincte de la barre colorée du Dashboard.
   */
  public async createDiagnosticReport(): Promise<void> {
    if (this.reportRunning) return;
    this.reportRunning = true;
    try {
    const issueDescription = await vscode.window.showInputBox({
      title: "Rapport de diagnostic QC1",
      prompt: "Décris brièvement l'erreur et ce que tu faisais lorsqu'elle est apparue.",
      placeHolder: "Exemple : le build échoue après avoir ajouté un nouveau fichier C (facultatif)",
      ignoreFocusOut: true
    });
    if (issueDescription === undefined) return;

    try {
      const report = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "QC1 : collecte du contexte de diagnostic",
        cancellable: false
      }, async (progress) => {
        progress.report({ message: "Projet, outils et problèmes VS Code" });
        const status = getQc1Status(this.context);
        const config = qc1Configuration();
        const workspaceFolders = vscode.workspace.workspaceFolders || [];
        const projectRoot = status.projectPath || getWorkspaceRoot() || "";
        const executionEnvironment = getExecutionEnv(status);
        const collectionErrors: string[] = [];
        const collect = async <T>(name: string, task: () => Promise<T>, fallback: T): Promise<T> => {
          try { return await task(); }
          catch (error) { collectionErrors.push(`${name}: ${String(error)}`); return fallback; }
        };
        const probePromise = status.stlinkToolOk
          ? runDiagnosticProcess(status.stlinkPath, ["--probe"], projectRoot || undefined, executionEnvironment)
          : Promise.resolve<DiagnosticProcessResult>({ exitCode: null, stdout: "", stderr: "st-info introuvable" });
        const [tools, gitSnapshot, probe, system, devices] = await Promise.all([
          collect("tools", () => collectDiagnosticToolReports(status), []),
          collect("git", () => collectGitSnapshot(projectRoot), "unknown"),
          probePromise,
          collect("system", () => inspectSystem(), { status: "unknown" }),
          collect("devices", () => inspectDevices(vscode.workspace.isTrusted), { usb: [], serial: [], permissions: {}, errors: ["Collection unavailable"] })
        ]);

        progress.report({ message: "Création et anonymisation du rapport" });
        const relevantExtension = (id: string): Record<string, unknown> => {
          const extension = vscode.extensions.getExtension(id);
          return {
            id,
            installed: Boolean(extension),
            version: extension?.packageJSON?.version || "--",
            active: extension?.isActive || false
          };
        };
        const openDocuments = vscode.workspace.textDocuments
          .filter((document) => document.uri.scheme === "file" && (!projectRoot || isPathInside(document.uri.fsPath, projectRoot)))
          .slice(0, 30)
          .map((document) => ({ path: document.uri.fsPath, dirty: document.isDirty, language: document.languageId }));
        const projectDiagnostics = getProjectDiagnostics(status);
        const details = inspectProjectDetails(inspectStm32Project(projectRoot, status.buildPath), config.get<string>("targetMcu", ""), status.buildPath);
        const installedExtensions = completeExtensionInventory(vscode.extensions.all.map(extension => ({
          id: extension.id, name: String(extension.packageJSON.displayName || extension.packageJSON.name || extension.id),
          version: String(extension.packageJSON.version || "unknown"), active: extension.isActive,
          enabled: "unknown (public API lists visible extensions, not disabled inventory)",
          kind: inside(vscode.env.appRoot, extension.extensionPath) ? "system" : "user",
          path: extension.extensionPath, relevant: /cmake|cortex|embedded|platformio|stm32|clang|cpptools|serial|gitlens|arm|openocd|stlink/i.test(extension.id)
        })));
        const reportInput = {
          system, installedExtensions, devices,
          structure: details.structure, mcu: details.mcu, cmake: details.cmake,
          findings: [...collectionErrors.map(message => ({ code: "QC1-COLLECT-001", level: "warning" as const, category: "environment", title: "COLLECTION_FAILED", message, cause: message, evidence: message, path: "", suggestion: "Vérifier l'accès aux outils et fichiers.", correction: "Relancer le rapport après correction." })), ...details.findings, ...projectDiagnostics.map(d => ({
            code: d.code, level: d.level === "error" ? "error" as const : "warning" as const, category: "project", title: d.title,
            message: d.message, cause: d.cause, evidence: d.checkedPath, path: d.checkedPath,
            suggestion: "Vérifier le projet et les références CMake.", correction: "Corriger la configuration après vérification."
          })), ...tools.filter(t => t.detected && t.exitCode !== 0).map(t => ({
            code: "QC1-TOOL-010", level: "warning" as const, category: "toolchain", title: "TOOL_PROBE_FAILED",
            message: `${t.name}: test de version échoué ou non exécuté`, cause: t.stderr || "unknown", evidence: t.probeStatus || "unknown",
            path: t.path, suggestion: "Vérifier architecture, permissions et chemin de l'outil.", correction: "Configurer qc1.toolPaths."
          }))],
          generatedAt: new Date().toISOString(),
          issueDescription,
          extension: {
            id: `${this.context.extension.packageJSON.publisher}.${this.context.extension.packageJSON.name}`,
            version: this.context.extension.packageJSON.version,
            dependencies: [
              relevantExtension("ms-vscode.cmake-tools"),
              relevantExtension("mylonics.embedded-build-tools")
            ]
          },
          runtime: {
            vscodeVersion: vscode.version,
            vscodeCommit: "unknown (not exposed by public API)",
            vscodeBuild: vscode.env.appName,
            vscodeApp: vscode.env.appName,
            vscodeLanguage: vscode.env.language,
            remoteName: vscode.env.remoteName || "local",
            uiKind: vscode.env.uiKind === vscode.UIKind.Desktop ? "desktop" : "web",
            nodeVersion: process.version,
            platform: process.platform,
            architecture: process.arch,
            osRelease: os.release()
          },
          workspace: {
            folders: workspaceFolders.map((folder) => ({ name: folder.name, path: folder.uri.fsPath })),
            trusted: vscode.workspace.isTrusted,
            openDocuments
          },
          project: {
            path: status.projectPath || "--",
            name: status.projectName,
            layout: status.projectLayout,
            complete: status.projectComplete,
            cmakeMode: status.nativeCmakeOk ? "native" : status.bundledCmakeReady ? "QC1 intégré" : "introuvable",
            cmakeSourcePath: status.cmakeSourcePath,
            sourcePath: status.sourcePath,
            corePath: status.corePath,
            driversPath: status.driversPath,
            startupPath: status.startupPath,
            linkerScriptPath: status.linkerScriptPath,
            diagnostics: projectDiagnostics
          },
          configuration: {
            projectPath: config.get<string>("projectPath", ""),
            buildDirectory: config.get<string>("buildDirectory", "build/qc1"),
            buildType: config.get<string>("buildType", "Debug"),
            cmakePath: config.get<string>("cmakePath", ""),
            compilerPath: config.get<string>("compilerPath", ""),
            openocdPath: config.get<string>("openocdPath", ""),
            stlinkPath: config.get<string>("stlinkPath", "st-info"),
            serialPort: config.get<string>("serialPort", ""),
            baudRate: config.get<number>("baudRate", 19200),
            autoDetectProject: config.get<boolean>("autoDetectProject", true),
            autoClearOutput: config.get<boolean>("autoClearOutput", false),
            showTimestamps: config.get<boolean>("showTimestamps", true),
            outputMaxLines: config.get<number>("outputMaxLines", 500)
          },
          dashboard: {
            currentAction: dashboardState.currentAction,
            lastCommand: dashboardState.lastCommand,
            diagnostic: dashboardState.diagnostic,
            progress: dashboardState.progress,
            build: dashboardState.build,
            flash: dashboardState.flash
          },
          artifacts: {
            buildDirectory: artifactSnapshot(status.buildPath),
            elf: artifactSnapshot(status.elfPath),
            bin: artifactSnapshot(status.binPath)
          },
          hardware: {
            serialPort: status.serialPort || "non configuré/détecté",
            baudRate: status.baudRate,
            previousStlinkState: status.stlinkProbeStatus,
            currentProbeExitCode: probe.exitCode,
            currentProbeOutput: `${probe.stdout}\n${probe.stderr}`.trim() || "--"
          },
          tools,
          vscodeProblems: collectVsCodeProblems(projectRoot),
          gitSnapshot,
          projectTree: details.tree,
          logs: this.outputLines.slice(-1000).join("\n") || "Aucun journal QC1 disponible."
        };
        const redactions = [
          { value: status.projectPath, replacement: "<PROJECT>" },
          ...workspaceFolders.map((folder) => ({ value: folder.uri.fsPath, replacement: "<WORKSPACE>" })),
          { value: this.context.extensionPath, replacement: "<EXTENSION>" },
          { value: os.homedir(), replacement: "<HOME>" }
          ,{ value: os.hostname(), replacement: "<HOSTNAME>" }
          ,...installedExtensions.map(extension => ({ value: String(extension.path || ""), replacement: `<EXTENSION:${String(extension.id)}>` }))
        ];

        return buildDiagnosticReport(reportInput, redactions);
      });

      const preview = await vscode.workspace.openTextDocument({ content: report, language: "markdown" });
      await vscode.window.showTextDocument(preview, { preview: true });
      const action = await vscode.window.showInformationMessage(
        "Rapport QC1 généré et prévisualisé. Vérifie-le avant de l'envoyer.",
        "Enregistrer le rapport",
        "Copier le rapport"
      );

      if (action === "Copier le rapport") {
        await vscode.env.clipboard.writeText(report);
        this.postStatus("Rapport copié", "success");
        return;
      }

      if (action === "Enregistrer le rapport") {
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const defaultRoot = getQc1Status(this.context).projectPath || getWorkspaceRoot() || this.context.extensionPath;
        const uri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(path.join(defaultRoot, `qc1-diagnostic-${timestamp}.md`)),
          filters: { Markdown: ["md"], Text: ["txt"] },
          saveLabel: "Enregistrer le rapport QC1"
        });
        if (uri) {
          await vscode.workspace.fs.writeFile(uri, Buffer.from(report, "utf8"));
          const savedDocument = await vscode.workspace.openTextDocument(uri);
          await vscode.window.showTextDocument(savedDocument, { preview: false });
          this.postStatus("Rapport enregistré", "success");
        }
      }
    } catch (error) {
      const message = `Impossible de générer le rapport QC1 : ${(error as Error).message}`;
      outputChannel?.appendLine(`[QC1] ${message}`);
      vscode.window.showErrorMessage(message);
      this.postStatus("Échec du rapport", "error");
    }
    } finally { this.reportRunning = false; }
  }

  /**
   * Route les noms de commandes internes vers status, matériel, terminal ou build.
   * C'est ici qu'il faut enregistrer une nouvelle action envoyée par un bouton.
   */
  public runCommand(command: string): void {
    if (command === "detect-stlink") {
      this.detectStlink();
      return;
    }
    if (command === "open-serial") {
      this.openSerial();
      return;
    }
    if (command === "start-openocd") {
      this.startOpenOcd();
      return;
    }
    if (["status", "health", "error", "dev"].includes(command)) {
      this.runStatus(command);
      return;
    }
    if (command === "serial") {
      openSerialTerminal(this.context);
      return;
    }
    if (this.buildRunning) { this.postStatus("Une opération QC1 est déjà en cours", "running"); return; }
    this.buildRunning = true;
    void this.runQC1(command).catch(error => {
      this.appendOutput(error instanceof Error ? error.message : String(error), "error");
      this.postStatus("Opération QC1 échouée", "error");
    }).finally(() => { this.buildRunning = false; });
  }

  public detectStlink(): void {
    this.runStatus("detect-stlink");
  }

  public openSerial(): void {
    openSerialTerminal(this.context);
  }

  public startOpenOcd(): void {
    startOpenOcdTerminal(this.context);
  }

  /** Exécute un diagnostic et un probe ST-Link sans compiler le firmware. */
  private runStatus(command: string): void {
    const status = getQc1Status(this.context);
    const config = this.getConfig();
    const cwd = status.projectPath || getWorkspaceRoot() || "--";
    if (config.autoClearOutput) this.clearOutput();

    this.appendOutput(`$ qc1 ${command}`, "command");
    this.appendOutput(`CWD: ${cwd}`, "command");
    dashboardState = {
      ...dashboardState,
      lastCommand: command,
      currentAction: command === "detect-stlink" ? "Détection ST-Link" : "Diagnostic"
    };

    const finish = (probeOutput: string, probeError?: unknown): void => {
      if (status.stlinkToolOk) {
        const detected = readStlinkProbeStatus(probeOutput);
        stlinkProbeStatus = detected;
      }

      syncDashboardState(this.context);
      this.appendOutput(formatDiagnostic(getQc1Status(this.context)), "stdout");
      if (status.stlinkToolOk) {
        this.appendOutput([
          "",
          "Probe ST-Link",
          `Commande: ${quoteArg(status.stlinkPath)} --probe`,
          `Exit    : ${probeError ? getExitCode(probeError) ?? 1 : 0}`,
          probeOutput.trim() || "--"
        ].join("\n"), probeError ? "error" : "stdout");
      } else {
        this.appendOutput("Probe ST-Link non exécuté: st-info introuvable", "error");
      }
      refreshDashboard();
      this.sendToolsStatus();
      this.sendTerminalMeta();
      this.postStatus(command === "detect-stlink" ? `ST-Link: ${stlinkProbeStatus}` : "Status terminé", probeError ? "error" : "success");
      this.appendOutput("--- terminé ---", "separator");
    };

    if (!status.stlinkToolOk) {
      finish("");
      return;
    }

    void runDiagnosticProcess(status.stlinkPath, ["--probe"], status.projectPath || getWorkspaceRoot(), getExecutionEnv(status))
      .then(result => finish(`${result.stdout}\n${result.stderr}`, result.exitCode === 0 ? undefined : new Error(result.stderr)));
  }

  /**
   * Pipeline principal Build/Clean/Flash/Run.
   * Chaque étape est lancée séparément; le build transmet stdout au ProgressManager.
   */
  private async runQC1(command: string): Promise<void> {
    if (!vscode.workspace.isTrusted) { this.postStatus("Workspace non approuvé", "error"); return; }
    const root = getWorkspaceRoot();
    const config = this.getConfig();
    const toolStatus = getQc1Status(this.context);

    if (!root) {
      const qc1Error = createQc1Error({
        code: "QC1-PATH-001",
        title: "CHEMIN_PROJET_INVALIDE",
        message: "Chemin projet invalide",
        cause: "Aucun workspace ouvert",
        command,
        cwd: "--",
        path: toolStatus.projectPath || "--"
      });
      this.applyQc1Error(qc1Error);
      this.appendQc1Error(qc1Error, "projet");
      this.sendDashboardState();
      this.postStatus("No workspace", "error");
      return;
    }

    if (config.autoClearOutput) {
      this.clearOutput();
    }

    const projectDir = toolStatus.projectPath || root;
    const displayedCommand = `qc1 ${command}`;

    this.postStatus(`Running: ${command}`, "running");
    this.appendOutput(`$ ${displayedCommand}`, "command");
    this.appendOutput(`CWD: ${projectDir}`, "command");
    syncDashboardState(this.context);
    dashboardState = {
      ...dashboardState,
      lastCommand: command
    };
    this.sendTerminalMeta();

    const progressManager = new ProgressManager((progress) => this.applyProgressUpdate(progress));
    progressManager.start(command, "Validation du projet et des outils");

    if (!isAllowedQc1Command(command)) {
      const qc1Error = createQc1Error({
        code: "QC1-CMD-003",
        title: "COMMANDE_NON_AUTORISEE",
        message: "Commande non autorisee",
        cause: `La commande '${command}' n'est pas autorisee par QC1 STM32 Tools`,
        command: displayedCommand,
        cwd: projectDir,
        path: toolStatus.cmakeSourcePath
      });
      progressManager.finish(false, qc1Error.message);
      this.applyQc1Error(qc1Error);
      this.appendQc1Error(qc1Error, "commande");
      this.sendQc1ErrorAnalysis(qc1Error);
      this.sendDashboardState();
      this.postStatus(qc1Error.message, "error");
      this.appendOutput("--- terminé ---", "separator");
      return;
    }

    const projectDiagnostic = getProjectDiagnostics(toolStatus).find((diagnostic) => diagnostic.level === "error");
    const toolDiagnostic = getToolDiagnostic(toolStatus, command);
    const blockingDiagnostic = projectDiagnostic || toolDiagnostic;

    if (blockingDiagnostic) {
      const qc1Error = createQc1ErrorFromDiagnostic(blockingDiagnostic, displayedCommand, projectDir);
      const blockingLevel = blockingDiagnostic.level === "warning" ? "warning" : "error";
      progressManager.finish(false, qc1Error.message);
      this.applyQc1Error(qc1Error, blockingLevel);
      this.appendQc1Error(qc1Error, blockingDiagnostic.code.startsWith("QC1-PRJ") ? "projet" : "outil");
      this.sendQc1ErrorAnalysis(qc1Error, blockingLevel);
      this.sendDashboardState();
      this.sendTerminalMeta();
      this.postStatus(qc1Error.message, "error");
      this.appendOutput("--- terminé ---", "separator");
      return;
    }

    const invocations = buildProcessInvocations(toolStatus, command);
    const environment = getExecutionEnv(toolStatus);
    const stdoutParts: string[] = [];
    const stderrParts: string[] = [];
    const appendBounded = (parts: string[], chunk: string): void => {
      parts.push(chunk.slice(-128 * 1024));
      while (parts.length > 128) parts.shift();
    };
    const executedCommands: string[] = [];
    let failedResult: SpawnedProcessResult | undefined;

    try {
      if (toolStatus.nativeCmakeOk) {
        const query = path.join(toolStatus.buildPath, ".cmake", "api", "v1", "query", "client-qc1");
        await fs.promises.mkdir(query, { recursive: true });
        for (const name of ["codemodel-v2", "toolchains-v1"]) {
          try { await fs.promises.writeFile(path.join(query, name), "", { flag: "wx" }); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
        }
      }
      for (const invocation of invocations) {
        if (invocation.phase === "flashing") {
          const refreshed = getQc1Status(this.context);
          if (!fileExists(refreshed.elfPath)) throw new Error("ELF introuvable: vérifier la cible CMake ou configurer qc1.elfPath.");
          invocation.args = invocation.executable === toolStatus.openocdPath
            ? getOpenOcdProgramArgs(refreshed.elfPath)
            : invocation.args.map(arg => arg === toolStatus.elfPath ? refreshed.elfPath : arg);
        }
        progressManager.setPhase(invocation.phase, invocation.label);
        const displayedInvocation = formatInvocation(invocation.executable, invocation.args);
        executedCommands.push(displayedInvocation);
        this.appendOutput(`$ ${displayedInvocation}`, "command");

        const result = await runSpawnedProcess(
          invocation,
          projectDir,
          environment,
          (chunk) => {
            appendBounded(stdoutParts, chunk);
            if (invocation.tracksNinja) progressManager.consumeOutput(chunk);
            this.appendOutput(chunk, "stdout");
          },
          (chunk) => {
            appendBounded(stderrParts, chunk);
            if (invocation.tracksNinja) progressManager.consumeOutput(chunk);
            this.appendOutput(chunk, "stderr");
          }
        );

        if (result.error || result.exitCode !== 0) {
          failedResult = result;
          break;
        }
      }
    } catch (error) {
      failedResult = {
        exitCode: getExitCode(error),
        stdout: stdoutParts.join(""),
        stderr: stderrParts.join(""),
        command: executedCommands.at(-1) || displayedCommand,
        error,
        timedOut: isTimeoutError(error)
      };
    }

    const stdoutText = stdoutParts.join("");
    const stderrText = stderrParts.join("");
    const fullOutput = `${stdoutText}\n${stderrText}`;
    const parsed = parseQc1Output(fullOutput);
    const detectedProbeStatus = readStlinkProbeStatus(fullOutput);
    if (detectedProbeStatus !== "non testé") stlinkProbeStatus = detectedProbeStatus;

    const success =
      !failedResult &&
      parsed.errors === 0 &&
      !parsed.hasBuildFailed &&
      !parsed.hasFlashFailed;
    const resultMessage = success ? `${command} terminé` : "Commande échouée";
    progressManager.finish(success, resultMessage);
    const runtimeMs = dashboardState.progress.runtimeSeconds * 1000;

    dashboardState = {
      ...dashboardState,
      build: {
        ...dashboardState.build,
        errors: parsed.errors,
        warnings: parsed.warnings,
        flashUsage: parsed.flashUsage,
        ramUsage: parsed.ramUsage,
        elfGenerated: parsed.elfGenerated,
        binGenerated: parsed.binGenerated
      }
    };

    if (["build", "rebuild", "tsmake", "flash", "run"].includes(command)) {
      dashboardState = {
        ...dashboardState,
        build: {
          ...dashboardState.build,
          lastBuildTime: new Date().toLocaleString(),
          lastBuildSuccess: success || (["flash", "run"].includes(command) && !parsed.hasBuildFailed && parsed.errors === 0),
          buildRuntimeMs: runtimeMs
        }
      };
    }

    if (["flash", "run"].includes(command)) {
      dashboardState = {
        ...dashboardState,
        flash: {
          ...dashboardState.flash,
          lastFlashTime: new Date().toLocaleString(),
          lastFlashSuccess: success,
          flashRuntimeMs: runtimeMs,
          method: fullOutput.toLowerCase().includes("openocd") ? "OpenOCD" : "st-flash",
          targetMCU: fullOutput.toLowerCase().includes("stm32f103") ? "STM32F103" : "--"
        }
      };
    }

    const failureCause = parsed.explanation || (
      failedResult?.error instanceof Error
        ? failedResult.error.message
        : "La commande QC1 a retourné un résultat invalide"
    );
    const commandError = success
      ? undefined
      : failedResult
        ? createQc1ErrorFromProcess(
            failedResult.error || Object.assign(new Error("Commande échouée"), { code: failedResult.exitCode }),
            failedResult.command,
            projectDir,
            failedResult.stdout,
            failedResult.stderr
          )
        : createQc1Error({
            code: "QC1-CMD-001",
            title: "COMMANDE_ECHOUEE",
            message: "Commande échouée",
            cause: failureCause,
            command: executedCommands.join("\n"),
            cwd: projectDir,
            exitCode: 0,
            stdout: stdoutText,
            stderr: stderrText
          });

    dashboardState = finishProgress(
      dashboardState,
      success,
      "QC1-CMD-OK",
      commandError?.code || "QC1-CMD-001",
      ["build", "rebuild", "tsmake", "flash", "run"].includes(command) ? "BUILD_SUCCESS" : "COMMAND_DONE",
      commandError?.title || "COMMANDE_ECHOUEE",
      resultMessage,
      success ? "Commande terminée sans erreur détectée" : failureCause,
      projectDir
    );

    syncDashboardState(this.context);
    if (commandError) {
      this.applyQc1Error(commandError);
      this.appendQc1Error(commandError, "commande");
    } else {
      this.appendOutput(`[QC1] ${command} terminé avec succès`, "stdout");
    }
    this.sendDashboardState();
    this.sendAnalysis(parsed);
    this.sendTerminalMeta();
    this.postStatus(success ? `Terminé : ${command}` : `Échec : ${command}`, success ? "success" : "error");
    this.appendOutput("--- terminé ---", "separator");
  }

  /** Applique et transmet une mesure du ProgressManager sans recréer la Webview. */
  private applyProgressUpdate(progress: Qc1ProgressUpdate): void {
    dashboardState = {
      ...dashboardState,
      currentAction: progress.active ? `${progress.taskName} en cours` : progress.phase === "error" ? "Erreur" : "Terminé",
      progress: {
        ...dashboardState.progress,
        ...progress
      }
    };
    this.view?.webview.postMessage({ type: "progress", progress });
  }

  /** Copie une erreur normalisée dans la carte Diagnostic du Dashboard. */
  private applyQc1Error(qc1Error: Qc1Error, level: "warning" | "error" = "error") {
    dashboardState = {
      ...dashboardState,
      currentAction: level === "error" ? "Erreur" : "Diagnostic projet",
      diagnostic: {
        code: qc1Error.code,
        level,
        title: qc1Error.title,
        message: qc1Error.message,
        cause: qc1Error.cause || "--",
        checkedPath: qc1Error.path || qc1Error.cwd || "--"
      }
    };
  }

  /** Ajoute une erreur au terminal QC1 et propose immédiatement de créer un rapport. */
  private appendQc1Error(qc1Error: Qc1Error, kind: "projet" | "outil" | "commande" | "extension") {
    const header = kind === "projet"
      ? "[QC1] Erreur projet"
      : kind === "outil"
        ? "[QC1] Erreur outil"
        : kind === "commande"
          ? "[QC1] Commande échouée"
          : "[QC1] Erreur extension";

    const lines = [
      header,
      `Code    : ${qc1Error.code}`,
      `Message : ${qc1Error.message}`
    ];

    if (qc1Error.command) {
      lines.push(`Commande: ${qc1Error.command}`);
    }

    if (qc1Error.cwd) {
      lines.push(`CWD     : ${qc1Error.cwd}`);
    }

    if (qc1Error.exitCode !== undefined) {
      lines.push(`Exit    : ${qc1Error.exitCode === null ? "--" : qc1Error.exitCode}`);
    }

    if (qc1Error.path) {
      lines.push(`Chemin  : ${qc1Error.path}`);
    }

    if (qc1Error.cause) {
      lines.push(`Cause   : ${qc1Error.cause}`);
    }

    if (qc1Error.stdout !== undefined || qc1Error.stderr !== undefined) {
      lines.push("", "--- stdout ---", qc1Error.stdout?.trim() || "--", "", "--- stderr ---", qc1Error.stderr?.trim() || "--");
    }

    this.appendOutput(lines.join("\n"), "error");
    void vscode.window.showErrorMessage(
      `[${qc1Error.code}] ${qc1Error.message}`,
      "Créer un rapport"
    ).then((action) => {
      if (action === "Créer un rapport") {
        void this.createDiagnosticReport();
      }
    });
  }

  private appendQc1CommandResult(
    command: string,
    cwd: string,
    exitCode: number | null,
    stdout: string,
    stderr: string
  ) {
    const lines = [
      "[QC1] Commande terminée",
      "Code    : QC1-CMD-OK",
      "Message : Commande terminée",
      `Commande: ${command}`,
      `CWD     : ${cwd}`,
      `Exit    : ${exitCode === null ? "--" : exitCode}`,
      "",
      "--- stdout ---",
      stdout.trim() || "--",
      "",
      "--- stderr ---",
      stderr.trim() || "--"
    ];

    this.appendOutput(lines.join("\n"), "stdout");
  }

  private sendQc1ErrorAnalysis(qc1Error: Qc1Error, level: "warning" | "error" = "error") {
    this.sendAnalysis({
      errors: level === "error" ? 1 : 0,
      warnings: level === "warning" ? 1 : 0,
      hasBuildFailed: false,
      hasFlashFailed: false,
      elfGenerated: dashboardState.build.elfGenerated,
      binGenerated: dashboardState.build.binGenerated,
      flashUsage: dashboardState.build.flashUsage || "--",
      ramUsage: dashboardState.build.ramUsage || "--",
      diagnostics: [{
        severity: level,
        message: qc1Error.message,
        raw: `${qc1Error.code} ${qc1Error.message}${qc1Error.path ? ` - Chemin: ${qc1Error.path}` : ""}`
      }],
        explanation: `${qc1Error.cause || qc1Error.message}${qc1Error.path ? `. Chemin vérifié: ${qc1Error.path}` : ""}`
    });
  }

  /**
   * Point unique d'écriture du Terminal QC1 : tampon mémoire, OutputChannel VS Code,
   * puis message `output` vers la Webview. Modifier ici pour filtrer/formater les logs.
   */
  private appendOutput(text: string, kind: string = "stdout") {
    // Logging must not trigger a project scan for every compiler output chunk.
    const config = qc1Configuration();
    const timestamp = config.get<boolean>("showTimestamps", true)
      ? `[${new Date().toLocaleTimeString()}] `
      : "";

    const lines = text.slice(-128 * 1024)
      .toString()
      .split(/\r\n|\n|\r/)
      .filter((line) => line.length > 0).slice(-2000)
      .map((line) => `${timestamp}${line}`);

    this.outputLines.push(...lines);
    outputChannel?.appendLine(lines.join("\n"));

    const limit = Math.min(5000, Math.max(1, Number(config.get<number>("outputMaxLines", 500)) || 500));
    if (this.outputLines.length > limit) {
      this.outputLines = this.outputLines.slice(-limit);
    }

    this.view?.webview.postMessage({
      type: "output",
      kind,
      lines
    });
  }

  public clearOutput() {
    this.outputLines = [];
    this.view?.webview.postMessage({ type: "clearOutput" });
    this.sendAnalysis({
      errors: 0,
      warnings: 0,
      hasBuildFailed: false,
      hasFlashFailed: false,
      elfGenerated: false,
      binGenerated: false,
      flashUsage: "--",
      ramUsage: "--",
      diagnostics: [],
      explanation: "Aucune erreur connue détectée."
    });
    this.postStatus("Output cleared", "idle");
  }

  // === MESSAGES EXTENSION -> JAVASCRIPT DE LA WEBVIEW ======================

  /** Met à jour les cartes finales sans effacer le terminal ou l'onglet actif. */
  private sendDashboardState() {
    this.view?.webview.postMessage({
      type: "dashboardState",
      state: dashboardState
    });
  }

  private postStatus(text: string, state: "idle" | "running" | "success" | "error") {
    this.view?.webview.postMessage({
      type: "status",
      text,
      state
    });
  }

  private sendSettings() {
    this.view?.webview.postMessage({
      type: "settings",
      settings: this.getConfig()
    });
  }

  private sendToolsStatus() {
    this.view?.webview.postMessage({
      type: "toolsStatus",
      tools: getQc1Status(this.context)
    });
  }

  private sendTerminalMeta() {
    this.view?.webview.postMessage({
      type: "terminalMeta",
      meta: {
        projectName: dashboardState.projectName,
        lastCommand: dashboardState.lastCommand
      }
    });
  }

  private sendAnalysis(parsed: ReturnType<typeof parseQc1Output>) {
    this.view?.webview.postMessage({
      type: "analysis",
      analysis: {
        errors: parsed.errors,
        warnings: parsed.warnings,
        explanation: parsed.explanation,
        diagnostics: parsed.diagnostics
      }
    });
  }

}

// === POINT D'ENTRÉE DE L'EXTENSION =========================================

/**
 * VS Code appelle `activate()` une fois lorsqu'une vue/commande QC1 est demandée.
 * On initialise les outils, crée les deux Webviews et relie les commandes du
 * package.json aux méthodes du provider.
 */
export async function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel("QC1 STM32 Tools");
  context.subscriptions.push(outputChannel);
  // Tool installation may take a long time; keep the views and commands responsive.
  void initializeEmbeddedBuildTools().then(() => { syncDashboardState(context); refreshDashboard(); }).catch(error => outputChannel?.appendLine(String(error)));
  syncDashboardState(context);

  const provider = new QC1PanelProvider(context.extensionUri, context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(QC1PanelProvider.viewType, provider)
  );

  // Les identifiants doivent rester identiques à `contributes.commands` dans package.json.
  context.subscriptions.push(vscode.commands.registerCommand("qc1.build", () => {
    provider.runCommand("build");
  }));
  context.subscriptions.push(vscode.commands.registerCommand("qc1.clean", () => {
    provider.runCommand("clean");
  }));
  context.subscriptions.push(vscode.commands.registerCommand("qc1.rebuild", () => {
    provider.runCommand("rebuild");
  }));
  context.subscriptions.push(vscode.commands.registerCommand("qc1.tsmake", () => {
    provider.runCommand("tsmake");
  }));
  context.subscriptions.push(vscode.commands.registerCommand("qc1.flash", () => {
    provider.runCommand("flash");
  }));
  context.subscriptions.push(vscode.commands.registerCommand("qc1.run", () => {
    provider.runCommand("run");
  }));
  context.subscriptions.push(vscode.commands.registerCommand("qc1.health", () => {
    provider.runCommand("health");
  }));
  context.subscriptions.push(vscode.commands.registerCommand("qc1.status", () => {
    provider.runCommand("status");
  }));
  context.subscriptions.push(vscode.commands.registerCommand("qc1.error", () => {
    provider.runCommand("error");
  }));
  context.subscriptions.push(vscode.commands.registerCommand("qc1.detectStlink", () => {
    provider.detectStlink();
  }));
  context.subscriptions.push(vscode.commands.registerCommand("qc1.openSerial", () => {
    provider.openSerial();
  }));
  context.subscriptions.push(vscode.commands.registerCommand("qc1.startOpenOcd", () => {
    provider.startOpenOcd();
  }));
  context.subscriptions.push(vscode.commands.registerCommand("qc1.configure", () => {
    vscode.commands.executeCommand("workbench.action.openSettings", "@ext:Mistral400.QC1-STM32-Tools qc1");
  }));
  context.subscriptions.push(vscode.commands.registerCommand("qc1.createDiagnosticReport", () => {
    return provider.createDiagnosticReport();
  }));
  context.subscriptions.push(vscode.commands.registerCommand("qc1.refresh", () => {
    provider.clearOutput();
  }));
  context.subscriptions.push(vscode.commands.registerCommand("qc1.dev", () => {
    provider.runCommand("dev");
  }));
  context.subscriptions.push(vscode.commands.registerCommand("qc1.openSettings", () => {
    vscode.commands.executeCommand("workbench.action.openSettings", "@ext:Mistral400.QC1-STM32-Tools");
  }));
}

// Les ressources enregistrées dans `context.subscriptions` sont libérées par VS Code.
export function deactivate() {}
