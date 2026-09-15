"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.QC1PanelProvider = void 0;
exports.getQc1Status = getQc1Status;
exports.getProjectDiagnostics = getProjectDiagnostics;
exports.buildProcessInvocations = buildProcessInvocations;
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
const fs = require("fs");
const os = require("os");
const path = require("path");
const processTools_1 = require("./qc1/processTools");
const filesystem_1 = require("./qc1/filesystem");
const projectDiagnostics_1 = require("./qc1/projectDiagnostics");
const systemInspection_1 = require("./qc1/systemInspection");
const cmakeFileApi_1 = require("./qc1/cmakeFileApi");
const extensionInventory_1 = require("./qc1/extensionInventory");
const dashboardState_1 = require("./dashboard/dashboardState");
const dashboardHtml_1 = require("./dashboard/dashboardHtml");
const progressManager_1 = require("./dashboard/progressManager");
const qc1Parser_1 = require("./qc1/qc1Parser");
const projectDiscovery_1 = require("./qc1/projectDiscovery");
const hardware_1 = require("./qc1/hardware");
const cmakePresets_1 = require("./qc1/cmakePresets");
const targetArchitecture_1 = require("./qc1/targetArchitecture");
const diagnosticReport_1 = require("./qc1/diagnosticReport");
// État partagé entre le contrôleur et la Webview QC1.
let dashboardState = dashboardState_1.defaultDashboardState;
let dashboardPanel;
let outputChannel;
let stlinkProbeStatus = "non testé";
let stlinkProbeModel = "unknown";
let embeddedCmakePath = "";
let embeddedGccPath = "";
let embeddedNinjaPath = "";
const projectCache = new Map();
function discoverProject(root) {
    const cached = projectCache.get(root);
    if (cached && Date.now() - cached.time < 1500)
        return cached.value;
    const value = (0, projectDiscovery_1.findStm32Project)(root);
    if (projectCache.size > 20)
        projectCache.clear();
    projectCache.set(root, { time: Date.now(), value });
    return value;
}
/**
 * Active la dépendance Embedded Build Tools et récupère ses exécutables.
 * `ensureToolsInstalled()` peut afficher/télécharger les outils de son côté. Son API
 * renvoie seulement terminé/échoué : elle n'expose pas une progression en octets à QC1.
 */
async function initializeEmbeddedBuildTools() {
    if (!vscode.workspace.isTrusted)
        return;
    const extension = vscode.extensions.getExtension("mylonics.embedded-build-tools");
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
    }
    catch (error) {
        outputChannel?.appendLine(`[QC1] Outils embarqués indisponibles: ${error.message}`);
    }
}
// === AIDES FICHIERS, WORKSPACE ET PATH ======================================
function fileExists(filePath) {
    try {
        return fs.existsSync(filePath);
    }
    catch {
        return false;
    }
}
function getWorkspaceRoot() {
    const active = vscode.window.activeTextEditor?.document.uri;
    const activeRoot = active ? vscode.workspace.getWorkspaceFolder(active)?.uri.fsPath : undefined;
    const roots = [...new Set([activeRoot, ...(vscode.workspace.workspaceFolders || []).filter(folder => folder.uri.scheme === "file").map(folder => folder.uri.fsPath)].filter((root) => Boolean(root)))];
    return roots.find(root => vscode.workspace.getConfiguration("qc1", vscode.Uri.file(root)).get("projectPath", "").trim() || discoverProject(root)) || roots[0];
}
function qc1Configuration(root = getWorkspaceRoot()) {
    return vscode.workspace.getConfiguration("qc1", root ? vscode.Uri.file(root) : undefined);
}
/** Cherche un exécutable dans le PATH courant, avec PATHEXT sous Windows. */
function findExecutable(name) {
    return (0, processTools_1.resolveExecutable)(name) || null;
}
function getExistingSettingPath(config, key) {
    const configuredPath = (config.get(key) || "").trim();
    if (!configuredPath)
        return "";
    const resolved = (0, filesystem_1.resolveUserPath)(configuredPath, getWorkspaceRoot() || process.cwd());
    return (0, processTools_1.executableExists)(resolved) ? resolved : (0, processTools_1.resolveExecutable)(configuredPath);
}
function getExecutableSettingPath(config, key, fallbackName) {
    const configured = (config.get(key) || "").trim();
    if (configured) {
        const resolved = (0, filesystem_1.resolveUserPath)(configured, getWorkspaceRoot() || process.cwd());
        if ((0, processTools_1.executableExists)(resolved))
            return resolved;
        const configuredFromPath = findExecutable(configured);
        if (configuredFromPath)
            return configuredFromPath;
    }
    return findExecutable(fallbackName) || "";
}
/** Détecte un port série plausible lorsque qc1.serialPort est vide. */
function findSerialPort(configuredPort) {
    if (configuredPort)
        return configuredPort;
    if (os.platform() === "win32")
        return "";
    const patterns = os.platform() === "darwin"
        ? [/^cu\.usb/i, /^tty\.usb/i]
        : [/^ttyACM\d+$/i, /^ttyUSB\d+$/i];
    try {
        const device = fs.readdirSync("/dev").sort().find((name) => patterns.some((pattern) => pattern.test(name)));
        return device ? path.join("/dev", device) : "";
    }
    catch {
        return "";
    }
}
function targetMatchesCore(target, core) {
    const marker = core === "cm7" ? /(?:CORE_CM7|(?:^|[\\/_\-.])CM7(?:[\\/_\-.]|$))/i : /(?:CORE_CM4|(?:^|[\\/_\-.])CM4(?:[\\/_\-.]|$))/i;
    return marker.test([target.name, ...target.definitions, ...target.sources, ...target.artifacts].join(" "));
}
function configuredCoreArtifact(targets, architecture, core) {
    if (!architecture[core].present)
        return "";
    const executables = targets.filter((target) => target.type === "EXECUTABLE" && target.artifacts.length > 0);
    const matches = executables.filter((target) => targetMatchesCore(target, core));
    const candidates = matches.length ? matches : architecture.coreMode === core && executables.length === 1 ? executables : [];
    const artifacts = candidates.flatMap((target) => target.artifacts).filter((file) => fileExists(file));
    return artifacts.length === 1 ? artifacts[0] : "";
}
function binaryForElf(elfPath, buildPath, fallbackName) {
    if (!elfPath)
        return buildPath ? path.join(buildPath, `${fallbackName}.bin`) : "";
    const extension = path.extname(elfPath);
    return extension ? elfPath.slice(0, -extension.length) + ".bin" : elfPath + ".bin";
}
function objcopyPathForStatus(status) {
    const name = os.platform() === "win32" ? "arm-none-eabi-objcopy.exe" : "arm-none-eabi-objcopy";
    return status.compilerOk ? path.join(path.dirname(status.compilerPath), name) : "";
}
/** Fournit des valeurs par défaut afin que l'interface reçoive toujours une erreur complète. */
function createQc1Error(input) {
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
function getExitCode(error) {
    const code = error?.code;
    return typeof code === "number" ? code : null;
}
function isTimeoutError(error) {
    const err = error;
    return Boolean(err?.killed && err.signal === "SIGTERM") || Boolean(err?.message?.toLowerCase().includes("timed out"));
}
/** Liste blanche des commandes acceptées depuis la Webview. */
function isAllowedQc1Command(command) {
    return [
        "build",
        "clean",
        "rebuild",
        "tsmake",
        "flash",
        "debug",
        "build-cm7",
        "build-cm4",
        "flash-cm7",
        "flash-cm4",
        "debug-cm7",
        "debug-cm4",
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
function getQc1Status(context) {
    const workspaceRoot = getWorkspaceRoot() || "";
    const config = vscode.workspace.getConfiguration("qc1", workspaceRoot ? vscode.Uri.file(workspaceRoot) : undefined);
    const configuredProjectPath = (config.get("projectPath") || "").trim();
    const autoDetectProject = config.get("autoDetectProject", true);
    const configuredCmakePath = getExistingSettingPath(config, "cmakePath");
    const compilerPathSetting = getExistingSettingPath(config, "compilerPath");
    const openocdPathSetting = getExistingSettingPath(config, "openocdPath");
    const requestedProjectPath = workspaceRoot
        ? (0, projectDiscovery_1.resolveConfiguredProjectPath)(configuredProjectPath, workspaceRoot)
        : configuredProjectPath;
    const workspaceRoots = [...new Set([requestedProjectPath, ...(vscode.workspace.workspaceFolders || []).map(f => f.uri.fsPath)].filter(Boolean))];
    const detectedProject = !configuredProjectPath && autoDetectProject
        ? workspaceRoots.map(root => discoverProject(root)).find(Boolean)
        : null;
    const projectInspection = detectedProject || (requestedProjectPath
        ? (0, projectDiscovery_1.inspectStm32Project)(requestedProjectPath)
        : (0, projectDiscovery_1.inspectStm32Project)(""));
    const projectPath = projectInspection.root;
    const architecture = projectInspection.architecture;
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
    const buildType = config.get("buildType", "Debug");
    const preset = nativeCmakeOk ? (0, cmakePresets_1.inspectCmakePresets)(projectPath, buildType, config.get("cmakePreset", "")) : undefined;
    const buildDirectory = config.get("buildDirectory", "build/qc1").trim() || "build/qc1";
    const configuredBuildPath = projectPath
        ? (path.isAbsolute(buildDirectory) ? buildDirectory : path.join(projectPath, buildDirectory))
        : "";
    const buildPath = preset?.binaryDir || configuredBuildPath;
    const outputName = nativeCmakeOk ? projectInspection.projectName : "firmware";
    const fileApi = nativeCmakeOk ? (0, cmakeFileApi_1.readFileApi)(buildPath, projectPath) : undefined;
    const targets = fileApi?.targets.filter(t => t.type === "EXECUTABLE" && (!t.configuration || t.configuration === buildType)) || [];
    const configuredElf = config.get("elfPath", "");
    const configuredCm7Elf = config.get("cm7ElfPath", "");
    const configuredCm4Elf = config.get("cm4ElfPath", "");
    const cm7ElfPath = configuredCm7Elf ? (0, filesystem_1.resolveUserPath)(configuredCm7Elf, projectPath) : configuredCoreArtifact(targets, architecture, "cm7");
    const cm4ElfPath = configuredCm4Elf ? (0, filesystem_1.resolveUserPath)(configuredCm4Elf, projectPath) : configuredCoreArtifact(targets, architecture, "cm4");
    const defaultElfPath = targets.length === 1 && targets[0].artifacts.length === 1 ? targets[0].artifacts[0] : buildPath ? path.join(buildPath, `${outputName}.elf`) : "";
    const elfPath = configuredElf ? (0, filesystem_1.resolveUserPath)(configuredElf, projectPath) : architecture.family === "stm32h755" ? (cm7ElfPath || cm4ElfPath) : defaultElfPath;
    const binPath = binaryForElf(elfPath, buildPath, outputName);
    const cm7TargetName = targets.find((target) => targetMatchesCore(target, "cm7"))?.name || architecture.cm7.targetName;
    const cm4TargetName = targets.find((target) => targetMatchesCore(target, "cm4"))?.name || architecture.cm4.targetName;
    const cm7BinPath = binaryForElf(cm7ElfPath, buildPath, cm7TargetName || "firmware_CM7");
    const cm4BinPath = binaryForElf(cm4ElfPath, buildPath, cm4TargetName || "firmware_CM4");
    const pathCmake = findExecutable(os.platform() === "win32" ? "cmake.exe" : "cmake");
    const cmakePath = configuredCmakePath || embeddedCmakePath || pathCmake || "";
    const cmakeSource = configuredCmakePath ? "setting" : embeddedCmakePath ? "extension" : pathCmake ? "PATH" : "introuvable";
    const pathNinja = findExecutable(os.platform() === "win32" ? "ninja.exe" : "ninja");
    const ninjaPath = embeddedNinjaPath || pathNinja || "";
    const ninjaSource = embeddedNinjaPath ? "extension" : pathNinja ? "PATH" : "introuvable";
    const autoCompilerPath = findExecutable(os.platform() === "win32" ? "arm-none-eabi-gcc.exe" : "arm-none-eabi-gcc");
    const compilerPath = compilerPathSetting || embeddedGccPath || autoCompilerPath || "";
    const compilerSource = compilerPathSetting ? "setting" : embeddedGccPath ? "extension" : autoCompilerPath ? "PATH" : "introuvable";
    const gdbName = os.platform() === "win32" ? "arm-none-eabi-gdb.exe" : "arm-none-eabi-gdb";
    const gdbNextToCompiler = compilerPath ? path.join(path.dirname(compilerPath), gdbName) : "";
    const gdbPath = (gdbNextToCompiler && (0, processTools_1.executableExists)(gdbNextToCompiler) ? gdbNextToCompiler : findExecutable(gdbName)) || "";
    const autoOpenocdPath = findExecutable(os.platform() === "win32" ? "openocd.exe" : "openocd");
    const openocdPath = openocdPathSetting || autoOpenocdPath || "";
    const openocdSource = openocdPathSetting ? "setting" : autoOpenocdPath ? "PATH" : "introuvable";
    const autoStFlashPath = findExecutable(os.platform() === "win32" ? "st-flash.exe" : "st-flash");
    const stFlashPath = autoStFlashPath || "";
    const stFlashSource = autoStFlashPath ? "PATH" : "introuvable";
    const stlinkPath = getExecutableSettingPath(config, "stlinkPath", os.platform() === "win32" ? "st-info.exe" : "st-info");
    const debuggerOk = Boolean(vscode.extensions.getExtension("marus25.cortex-debug"));
    const serialPort = findSerialPort((config.get("serialPort") || "").trim());
    const baudRate = config.get("baudRate", 19200);
    const h755Cores = [architecture.cm7, architecture.cm4].filter((core) => core.present);
    const h755Complete = architecture.family === "stm32h755" && h755Cores.length > 0 && h755Cores.every((core) => Boolean(core.cmakePath && core.startupPath && core.linkerScriptPath)) && Boolean(architecture.halPath && architecture.cmsisPath && architecture.cmsisDevicePath);
    const projectComplete = projectOk && cmakeProjectReady && (architecture.family === "stm32h755"
        ? nativeCmakeOk && h755Complete
        : nativeCmakeOk || (sourceOk && startupOk && linkerScriptOk));
    return {
        projectPath,
        projectLayout: projectInspection.layout,
        projectName: projectInspection.projectName,
        cmakeSourcePath,
        buildPath,
        elfPath,
        binPath,
        cm7ElfPath,
        cm4ElfPath,
        cm7BinPath,
        cm4BinPath,
        cm7TargetName,
        cm4TargetName,
        cmakeConfigurePreset: preset?.configurePreset || "",
        cmakeBuildPreset: preset?.buildPreset || "",
        architecture,
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
        gdbPath: gdbPath || "Not found",
        gdbOk: Boolean(gdbPath),
        openocdPath: openocdPath || "Not found",
        openocdOk: Boolean(openocdPath),
        openocdSource,
        stFlashPath: stFlashPath || "Not found",
        stFlashOk: Boolean(stFlashPath),
        stFlashSource,
        stlinkPath: stlinkPath || "Not found",
        stlinkToolOk: Boolean(stlinkPath),
        debuggerOk,
        serialPort,
        baudRate,
        stlinkProbeStatus,
        stlinkProbeModel,
        stlinkProbeOk: stlinkProbeStatus === "OK"
    };
}
// === DIAGNOSTICS LISIBLES PAR L'UTILISATEUR ================================
/** Transforme l'état complet en texte copiable dans les journaux. */
function formatDiagnostic(status) {
    const projectDiagnostics = getProjectDiagnostics(status);
    const diagnosticLines = projectDiagnostics.length > 0
        ? projectDiagnostics.map((diagnostic) => `${diagnostic.code} [${diagnostic.level}] ${diagnostic.message} — ${diagnostic.checkedPath}`)
        : ["QC1-OK-001 [success] Projet OK"];
    const lines = [
        "Status outils QC1",
        "",
        "Diagnostics projet",
        ...diagnosticLines,
        "",
        `Project Folder      ${status.projectOk ? "OK" : "Missing"}`,
        `Structure           ${status.projectLayout}`,
        `Cible               ${status.architecture.device}`,
        `Architecture        ${status.architecture.coreMode}`,
        `CMake utilisé       ${status.nativeCmakeOk ? "projet natif" : status.bundledCmakeReady ? "QC1 intégré" : "Introuvable"}`,
        `Sources             ${status.sourceOk ? "OK" : "Introuvable"}`,
        `Core                ${status.coreOk ? "OK" : "optionnel/absent"}`,
        `Drivers             ${status.driversOk ? "OK" : "optionnel/absent"}`,
        `Startup             ${status.architecture.family === "stm32h755" ? [status.architecture.cm7, status.architecture.cm4].filter(core => core.present).map(core => `${core.core.toUpperCase()}:${core.startupPath ? "OK" : "absent"}`).join(" ") : status.startupOk ? "OK" : "Introuvable"}`,
        `Linker script       ${status.linkerScriptOk ? "OK" : "Introuvable"}`,
        `CMake               ${status.cmakeOk ? `OK ${status.cmakeSource}` : "Introuvable"}`,
        `Ninja               ${status.ninjaOk ? `OK ${status.ninjaSource}` : "Introuvable"}`,
        `ARM GCC             ${status.compilerOk ? `OK ${status.compilerSource}` : "Missing"}`,
        `ARM GDB             ${status.gdbOk ? "OK" : "Missing"}`,
        `OpenOCD             ${status.openocdOk ? `OK ${status.openocdSource}` : "Missing"}`,
        `st-flash installé  ${status.stFlashOk ? `OK ${status.stFlashSource}` : "Missing"}`,
        `st-info             ${status.stlinkToolOk ? "OK" : "Missing"}`,
        `Probe ST-Link       ${status.stlinkProbeStatus}`,
        `Modèle ST-Link      ${status.stlinkProbeModel}`,
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
function getProjectDiagnostics(status) {
    const diagnostics = [];
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
    if (status.architecture.family === "stm32h755") {
        if (status.architecture.coreMode === "unknown")
            diagnostics.push({
                code: "QC1-H755-001", level: "error", title: "COEUR_H755_INTROUVABLE",
                message: "Aucun firmware CM7 ou CM4 reconnu", cause: "QC1 attend des indices concordants: dossier, CORE_CM7/CORE_CM4, startup ou linker",
                checkedPath: status.projectPath
            });
        for (const core of [status.architecture.cm7, status.architecture.cm4]) {
            if (!core.present)
                continue;
            const label = core.core.toUpperCase();
            if (!core.cmakePath)
                diagnostics.push({ code: `QC1-H755-${core.core === "cm7" ? "002" : "003"}`, level: "error", title: `CMAKE_${label}_INTROUVABLE`, message: `CMake ${label} introuvable`, cause: `Le firmware ${label} doit rester une cible CubeMX distincte`, checkedPath: core.directory || status.projectPath });
            if (!core.startupPath)
                diagnostics.push({ code: `QC1-H755-${core.core === "cm7" ? "004" : "005"}`, level: "error", title: `STARTUP_${label}_INTROUVABLE`, message: `Startup ${label} absent ou ambigu`, cause: `Aucun startup H755 attribuable sans ambiguïté à ${label}`, checkedPath: core.directory || status.projectPath });
            if (!core.linkerScriptPath)
                diagnostics.push({ code: `QC1-H755-${core.core === "cm7" ? "006" : "007"}`, level: "error", title: `LINKER_${label}_INTROUVABLE`, message: `Linker ${label} absent ou ambigu`, cause: `Les memory maps CubeMX ${label} doivent rester distinctes`, checkedPath: core.directory || status.projectPath });
            if (!core.targetName)
                diagnostics.push({ code: `QC1-H755-${core.core === "cm7" ? "008" : "009"}`, level: "warning", title: `TARGET_${label}_NON_RESOLUE`, message: `Nom de cible CMake ${label} non résolu`, cause: "Le build global reste disponible; configure le projet une fois pour alimenter la CMake File API", checkedPath: core.cmakePath || status.projectPath });
            if (core.missingFlags.length)
                diagnostics.push({ code: `QC1-H755-${core.core === "cm7" ? "016" : "017"}`, level: "warning", title: `FLAGS_${label}_NON_CONFIRMES`, message: `Flags ${label} non confirmés: ${core.missingFlags.join(" ")}`, cause: "QC1 respecte CMake et signale seulement ce que l'analyse statique ne confirme pas", checkedPath: core.cmakePath || status.projectPath });
            if (core.missingDefines.length)
                diagnostics.push({ code: `QC1-H755-${core.core === "cm7" ? "018" : "019"}`, level: "warning", title: `DEFINES_${label}_NON_CONFIRMES`, message: `Defines ${label} non confirmés: ${core.missingDefines.join(" ")}`, cause: "CORE_CMx et STM32H755xx doivent provenir du CMake CubeMX", checkedPath: core.cmakePath || status.projectPath });
        }
        for (const [code, title, message, checked] of [
            ["QC1-H755-010", "HAL_H7_INTROUVABLE", "HAL STM32H7 absent", status.architecture.halPath || path.join(status.driversPath, "STM32H7xx_HAL_Driver")],
            ["QC1-H755-011", "CMSIS_INTROUVABLE", "CMSIS absent", status.architecture.cmsisPath || path.join(status.driversPath, "CMSIS")],
            ["QC1-H755-012", "CMSIS_DEVICE_H7_INTROUVABLE", "CMSIS Device STM32H7 absent", status.architecture.cmsisDevicePath || path.join(status.driversPath, "CMSIS", "Device", "ST", "STM32H7xx")]
        ])
            if (!fileExists(checked))
                diagnostics.push({ code, level: "error", title, message, cause: "Composant requis par le projet CubeMX H755", checkedPath: checked });
        if (status.architecture.bspRequired && !status.architecture.bspPath)
            diagnostics.push({
                code: "QC1-H755-013", level: "warning", title: "BSP_NUCLEO_H7_INTROUVABLE", message: "BSP NUCLEO H7 référencé mais absent",
                cause: "Le BSP est optionnel pour un H755 générique et requis seulement lorsqu'il est utilisé", checkedPath: path.join(status.driversPath, "BSP", "STM32H7xx_Nucleo")
            });
        if (!status.compilerOk)
            diagnostics.push({ code: "QC1-H755-020", level: "warning", title: "GCC_ARM_INTROUVABLE", message: "GNU Arm Embedded Toolchain non détecté par QC1", cause: "Le CMake natif peut encore fournir sa propre toolchain; le debug exige aussi GDB", checkedPath: status.compilerPath });
        if (!status.ninjaOk)
            diagnostics.push({ code: "QC1-H755-021", level: "warning", title: "NINJA_INTROUVABLE", message: "Ninja non détecté par QC1", cause: "Un preset CubeMX Ninja nécessite un exécutable accessible", checkedPath: status.ninjaPath });
        if (!status.openocdOk)
            diagnostics.push({ code: "QC1-H755-022", level: "warning", title: "OPENOCD_INTROUVABLE", message: "OpenOCD non détecté", cause: "Le build reste valide, mais flash ELF et debug SWD ne sont pas disponibles", checkedPath: status.openocdPath });
        if (!status.debuggerOk)
            diagnostics.push({ code: "QC1-H755-023", level: "warning", title: "CORTEX_DEBUG_INTROUVABLE", message: "Cortex-Debug non détecté", cause: "Le build et le flash restent disponibles; le debug VS Code nécessite marus25.cortex-debug", checkedPath: "marus25.cortex-debug" });
        return diagnostics;
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
function getProjectDiagnostic(status) {
    const diagnostics = getProjectDiagnostics(status);
    if (diagnostics.length > 0)
        return diagnostics[0];
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
function getToolDiagnostic(status, command) {
    const action = command.split("-")[0];
    if (!status.cmakeOk && ["build", "clean", "rebuild", "tsmake", "flash", "debug", "run", "health", "status"].includes(action)) {
        return {
            code: "QC1-TOOL-001",
            level: "error",
            title: "CMAKE_INTROUVABLE",
            message: "CMake introuvable",
            cause: "La commande nécessite CMake; configure qc1.cmakePath si CMake n'est pas dans le PATH",
            checkedPath: status.cmakePath || "PATH"
        };
    }
    if (!status.nativeCmakeOk && !status.ninjaOk && ["build", "clean", "rebuild", "tsmake", "flash", "debug", "run"].includes(action)) {
        return {
            code: "QC1-TOOL-004",
            level: "error",
            title: "NINJA_INTROUVABLE",
            message: "Ninja introuvable",
            cause: "La chaîne CMake autonome nécessite Ninja fourni par Embedded Build Tools",
            checkedPath: status.ninjaPath || "PATH"
        };
    }
    if (!status.nativeCmakeOk && !status.compilerOk && ["build", "rebuild", "tsmake", "flash", "debug", "run"].includes(action)) {
        return {
            code: "QC1-TOOL-002",
            level: "error",
            title: "GCC_ARM_INTROUVABLE",
            message: "arm-none-eabi-gcc introuvable",
            cause: "La commande nécessite le compilateur ARM GCC",
            checkedPath: status.compilerPath || "PATH"
        };
    }
    if (!status.openocdOk && !status.stFlashOk && ["flash", "run"].includes(action)) {
        return {
            code: "QC1-TOOL-003",
            level: "error",
            title: "FLASHER_INTROUVABLE",
            message: "OpenOCD et st-flash introuvables",
            cause: "La commande flash nécessite OpenOCD ou st-flash",
            checkedPath: "PATH"
        };
    }
    if (action === "debug" && !status.openocdOk)
        return {
            code: "QC1-TOOL-005", level: "error", title: "OPENOCD_INTROUVABLE",
            message: "OpenOCD introuvable pour le debug", cause: "Le debug Cortex-Debug QC1 utilise le backend OpenOCD",
            checkedPath: status.openocdPath || "PATH"
        };
    if (action === "debug" && !status.debuggerOk)
        return {
            code: "QC1-TOOL-006", level: "error", title: "CORTEX_DEBUG_INTROUVABLE",
            message: "Extension Cortex-Debug introuvable", cause: "Installe marus25.cortex-debug pour lancer GDB/SWD depuis QC1",
            checkedPath: "marus25.cortex-debug"
        };
    if (action === "debug" && !status.gdbOk)
        return {
            code: "QC1-TOOL-007", level: "error", title: "GDB_ARM_INTROUVABLE",
            message: "arm-none-eabi-gdb introuvable", cause: "Cortex-Debug nécessite GDB en plus du compilateur GCC",
            checkedPath: status.gdbPath || "PATH"
        };
    const core = (0, targetArchitecture_1.coreFromCommand)(command);
    if (action === "debug" && !core && status.architecture.coreMode === "dual")
        return {
            code: "QC1-H755-024", level: "error", title: "COEUR_DEBUG_REQUIS", message: "Choisis Debug CM7 ou Debug CM4",
            cause: "QC1 ne lance pas un debug simultané dual-core non validé", checkedPath: status.projectPath
        };
    if (core && status.architecture.family !== "stm32h755")
        return {
            code: "QC1-H755-014", level: "error", title: "COEUR_NON_DISPONIBLE", message: `${core.toUpperCase()} n'est pas disponible dans ce projet`,
            cause: "Les commandes par cœur sont réservées aux projets STM32H755 reconnus", checkedPath: status.projectPath
        };
    if (core && !status.architecture[core].present)
        return {
            code: "QC1-H755-014", level: "error", title: "COEUR_NON_DISPONIBLE", message: `${core.toUpperCase()} n'est pas présent`,
            cause: "Ce projet H755 est valide sans l'autre cœur, mais la commande demandée cible un firmware absent", checkedPath: status.projectPath
        };
    if (core && !(core === "cm7" ? status.cm7TargetName : status.cm4TargetName))
        return {
            code: "QC1-H755-015", level: "error", title: "TARGET_CMAKE_NON_RESOLUE", message: `Cible CMake ${core.toUpperCase()} non résolue`,
            cause: "QC1 refuse de remplacer silencieusement un build par cœur par un build global; configure le preset/CMake ou précise une cible identifiable",
            checkedPath: status.architecture[core].cmakePath || status.projectPath
        };
    return undefined;
}
// Convertit les erreurs de validation et de processus vers le format UI commun.
function createQc1ErrorFromDiagnostic(diagnostic, command, cwd) {
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
function createQc1ErrorFromProcess(error, command, cwd, stdout, stderr) {
    if (isTimeoutError(error)) {
        return createQc1Error({
            code: "QC1-CMD-002",
            title: "COMMANDE_EXPIREE",
            message: "Commande expiree",
            cause: error?.message || "La commande a depasse le delai permis",
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
            cause: stderr.trim() || error?.message || "La commande QC1 a retourné une erreur",
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
function quoteArg(arg) {
    return `"${arg.replace(/"/g, '\\"')}"`;
}
/** Ajoute les dossiers des outils détectés devant le PATH sans supprimer le PATH existant. */
function getExecutionEnv(status) {
    const toolDirectories = [
        status.cmakeOk ? path.dirname(status.cmakePath) : "",
        status.ninjaOk ? path.dirname(status.ninjaPath) : "",
        status.compilerOk ? path.dirname(status.compilerPath) : "",
        status.gdbOk ? path.dirname(status.gdbPath) : "",
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
/** Exécute une petite commande de lecture avec timeout; ne rejette jamais la Promise. */
function runDiagnosticProcess(executable, args, cwd, env) {
    if (!vscode.workspace.isTrusted)
        return Promise.resolve({ exitCode: null, stdout: "", stderr: "Non exécuté: workspace non approuvé." });
    return (0, processTools_1.runProcess)(executable, args, { cwd, env, timeoutMs: 8000 }).then(result => ({
        ...result, stderr: [result.error, result.stderr].filter(Boolean).join("\n")
    }));
}
async function collectDiagnosticToolReports(status) {
    const configured = {};
    const sources = {};
    for (const [name, file, source, ok] of [
        ["cmake", status.cmakePath, status.cmakeSource, status.cmakeOk],
        ["ninja", status.ninjaPath, status.ninjaSource, status.ninjaOk],
        ["arm-none-eabi-gcc", status.compilerPath, status.compilerSource, status.compilerOk],
        ["arm-none-eabi-gdb", status.gdbPath, "toolchain/PATH", status.gdbOk],
        ["openocd", status.openocdPath, status.openocdSource, status.openocdOk],
        ["st-info", status.stlinkPath, "configuration/PATH", status.stlinkToolOk]
    ])
        if (ok) {
            configured[name] = file;
            sources[name] = source;
        }
    const scope = status.projectPath ? vscode.Uri.file(status.projectPath) : undefined;
    for (const [name, value] of Object.entries(vscode.workspace.getConfiguration("qc1", scope).get("toolPaths", {}))) {
        if (typeof value === "string" && value.trim()) {
            configured[name] = (0, filesystem_1.resolveUserPath)(value, status.projectPath || process.cwd());
            sources[name] = "configuration QC1 toolPaths";
        }
    }
    const cmakeTool = vscode.workspace.getConfiguration("cmake", scope).get("cmakePath");
    if (!configured.cmake && cmakeTool) {
        configured.cmake = cmakeTool;
        sources.cmake = "CMake Tools setting";
    }
    const cortex = vscode.workspace.getConfiguration("cortex-debug", scope).get("armToolchainPath");
    const dirs = [status.compilerOk ? path.dirname(status.compilerPath) : "", cortex || "", ...Object.values(configured).filter(path.isAbsolute).map(file => path.dirname(file))].filter(Boolean);
    return (0, processTools_1.collectTools)({ configured, sources, directories: dirs, env: getExecutionEnv(status), trusted: vscode.workspace.isTrusted });
}
function isPathInside(candidate, root) {
    return Boolean(candidate && root) && (0, filesystem_1.inside)(root, candidate);
}
function collectVsCodeProblems(projectRoot) {
    const severityLabels = {
        [vscode.DiagnosticSeverity.Error]: "Erreur",
        [vscode.DiagnosticSeverity.Warning]: "Avertissement",
        [vscode.DiagnosticSeverity.Information]: "Information",
        [vscode.DiagnosticSeverity.Hint]: "Conseil"
    };
    const problems = [];
    let total = 0;
    for (const [uri, diagnostics] of vscode.languages.getDiagnostics()) {
        if (uri.scheme !== "file" || (projectRoot && !isPathInside(uri.fsPath, projectRoot)))
            continue;
        for (const diagnostic of diagnostics) {
            total += 1;
            if (problems.length >= 100)
                continue;
            const code = typeof diagnostic.code === "object" ? diagnostic.code.value : diagnostic.code;
            const location = `${uri.fsPath}:${diagnostic.range.start.line + 1}:${diagnostic.range.start.character + 1}`;
            const origin = [diagnostic.source, code].filter((value) => value !== undefined && value !== "").join("/");
            const message = diagnostic.message.replace(/\s+/g, " ").trim();
            problems.push(`[${severityLabels[diagnostic.severity]}] ${location}${origin ? ` (${origin})` : ""} — ${message}`);
        }
    }
    if (total > problems.length)
        problems.push(`... ${total - problems.length} problème(s) supplémentaire(s) omis`);
    return problems;
}
/** Capture le commit et les changements Git du projet, sans URL de dépôt. */
async function collectGitSnapshot(projectRoot) {
    if (!projectRoot)
        return "Projet introuvable; état Git non disponible.";
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
function artifactSnapshot(filePath) {
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
    }
    catch (error) {
        return { path: filePath, exists: true, inspectionError: error.message };
    }
}
// === TERMINAUX EXTERNES ET COMMANDE CMAKE ==================================
/** Ouvre un vrai terminal VS Code pour le port série; la sortie n'est pas dans la Webview. */
function openSerialTerminal(context) {
    if (!vscode.workspace.isTrusted) {
        void vscode.window.showWarningMessage("Approuve le workspace avant d'ouvrir un outil externe.");
        return;
    }
    const status = getQc1Status(context);
    if (!status.serialPort) {
        vscode.window.showErrorMessage("Aucun port série détecté. Configure qc1.serialPort puis réessaie.");
        return;
    }
    let terminal;
    if (os.platform() === "win32") {
        if (!/^COM\d+$/i.test(status.serialPort) || !Number.isInteger(status.baudRate) || status.baudRate <= 0) {
            void vscode.window.showErrorMessage("Port COM ou baud rate invalide.");
            return;
        }
        terminal = vscode.window.createTerminal({ name: "QC1 Serial", shellPath: (0, processTools_1.resolveExecutable)("cmd.exe") || "cmd.exe", shellArgs: ["/d", "/c", `mode ${status.serialPort} BAUD=${status.baudRate} PARITY=n DATA=8 STOP=1 && type ${status.serialPort}`], env: getExecutionEnv(status) });
    }
    else {
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
function startOpenOcdTerminal(context) {
    if (!vscode.workspace.isTrusted) {
        void vscode.window.showWarningMessage("Approuve le workspace avant d'ouvrir un outil externe.");
        return;
    }
    const status = getQc1Status(context);
    if (!status.openocdOk) {
        vscode.window.showErrorMessage("OpenOCD est introuvable. Configure qc1.openocdPath puis réessaie.");
        return;
    }
    const terminal = vscode.window.createTerminal({
        name: "QC1 OpenOCD",
        shellPath: status.openocdPath,
        shellArgs: (0, hardware_1.getOpenOcdServerArgs)(status.architecture.family, status.architecture.coreMode === "dual"),
        env: getExecutionEnv(status)
    });
    terminal.show();
}
function cmakeDefinition(name, value) {
    return `-D${name}=${value}`;
}
/** Affichage uniquement : les arguments sont passés séparément à spawn(), sans shell. */
function formatInvocation(executable, args) {
    return [quoteArg(executable), ...args.map(quoteArg)].join(" ");
}
/**
 * Décompose Build/Clean/Flash en vrais processus successifs. Ainsi stdout reste
 * disponible pendant l'exécution et le ProgressManager peut lire chaque `[x/y]`.
 */
function buildProcessInvocations(status, command) {
    const config = qc1Configuration();
    const buildType = config.get("buildType", "Debug");
    const action = command.split("-")[0];
    const core = (0, targetArchitecture_1.coreFromCommand)(command);
    const configureArgs = status.cmakeConfigurePreset
        ? ["--preset", status.cmakeConfigurePreset]
        : ["-S", status.cmakeSourcePath, "-B", status.buildPath, cmakeDefinition("CMAKE_BUILD_TYPE", buildType)];
    if (!status.nativeCmakeOk) {
        const toolchainPath = path.join(status.cmakeSourcePath, "arm-none-eabi-toolchain.cmake");
        configureArgs.push("-G", "Ninja", cmakeDefinition("CMAKE_MAKE_PROGRAM", status.ninjaPath), cmakeDefinition("CMAKE_TOOLCHAIN_FILE", toolchainPath), cmakeDefinition("QC1_PROJECT_ROOT", status.projectPath), cmakeDefinition("QC1_STARTUP", status.startupPath), cmakeDefinition("QC1_LINKER_SCRIPT", status.linkerScriptPath), cmakeDefinition("QC1_SOURCE_DIR", status.sourcePath));
        if (status.compilerOk) {
            configureArgs.push(cmakeDefinition("QC1_ARM_GCC", status.compilerPath));
        }
    }
    const invocations = [{
            phase: "configuring",
            label: "Configuration CMake",
            executable: status.cmakePath,
            args: configureArgs
        }];
    const buildArgs = status.cmakeBuildPreset
        ? ["--build", "--preset", status.cmakeBuildPreset, "--parallel"]
        : ["--build", status.buildPath, "--config", buildType, "--parallel"];
    const coreTarget = core ? (core === "cm7" ? status.cm7TargetName : status.cm4TargetName) : "";
    if (core && coreTarget)
        buildArgs.push("--target", coreTarget);
    if (["clean", "rebuild"].includes(action)) {
        invocations.push({
            phase: "cleaning",
            label: "Nettoyage de la cible",
            executable: status.cmakePath,
            args: status.cmakeBuildPreset
                ? ["--build", "--preset", status.cmakeBuildPreset, "--target", "clean"]
                : ["--build", status.buildPath, "--config", buildType, "--target", "clean"]
        });
    }
    if (["build", "rebuild", "tsmake", "flash", "debug", "run"].includes(action)) {
        invocations.push({
            phase: "building",
            label: "Compilation CMake",
            executable: status.cmakePath,
            args: buildArgs,
            tracksNinja: true
        });
    }
    if (!["flash", "run"].includes(action))
        return invocations;
    const objcopyPath = objcopyPathForStatus(status);
    const cores = status.architecture.family === "stm32h755"
        ? core ? [core] : [status.architecture.cm7.present ? "cm7" : undefined, status.architecture.cm4.present ? "cm4" : undefined].filter((value) => Boolean(value))
        : [undefined];
    if (status.openocdOk) {
        for (const targetCore of cores) {
            const elf = targetCore === "cm7" ? status.cm7ElfPath : targetCore === "cm4" ? status.cm4ElfPath : status.elfPath;
            invocations.push({
                phase: "flashing",
                label: `Flash ${targetCore?.toUpperCase() || "STM32"} avec OpenOCD`,
                executable: status.openocdPath,
                args: (0, hardware_1.getOpenOcdProgramArgs)(elf, status.architecture.family, status.architecture.coreMode === "dual", targetCore),
                core: targetCore,
                inputArtifact: "elf"
            });
        }
        return invocations;
    }
    for (const targetCore of cores) {
        const elf = targetCore === "cm7" ? status.cm7ElfPath : targetCore === "cm4" ? status.cm4ElfPath : status.elfPath;
        const bin = targetCore === "cm7" ? status.cm7BinPath : targetCore === "cm4" ? status.cm4BinPath : status.binPath;
        const linker = targetCore ? status.architecture[targetCore].linkerScriptPath : status.linkerScriptPath;
        const flashOrigin = (0, hardware_1.readFlashOrigin)((0, filesystem_1.readText)(linker));
        if (!flashOrigin)
            throw new Error(`Adresse de flash non résolue dans le linker ${targetCore?.toUpperCase() || "STM32"}; utilise OpenOCD avec l'ELF.`);
        if (fileExists(objcopyPath)) {
            invocations.push({
                phase: "flashing",
                label: `Création du binaire ${targetCore?.toUpperCase() || "STM32"}`,
                executable: objcopyPath,
                args: ["-O", "binary", "-S", elf, bin],
                core: targetCore,
                inputArtifact: "elf"
            });
        }
        invocations.push({
            phase: "flashing",
            label: `Flash ${targetCore?.toUpperCase() || "STM32"} avec st-flash`,
            executable: status.stFlashPath,
            args: (0, hardware_1.getStFlashWriteArgs)(bin, flashOrigin),
            core: targetCore,
            inputArtifact: "bin"
        });
    }
    return invocations;
}
/** Lance un processus sans shell et retransmet stdout/stderr dès leur arrivée. */
function runSpawnedProcess(invocation, cwd, env, onStdout, onStderr) {
    const command = formatInvocation(invocation.executable, invocation.args);
    if (!vscode.workspace.isTrusted)
        return Promise.resolve({ exitCode: null, stdout: "", stderr: "Workspace non approuvé", command, timedOut: false, error: new Error("Workspace non approuvé") });
    return (0, processTools_1.runProcess)(invocation.executable, invocation.args, { cwd, env, timeoutMs: 120000, maxBytes: 512 * 1024, onStdout, onStderr }).then(result => ({
        ...result, command, error: result.exitCode === 0 && !result.error ? undefined : Object.assign(new Error(result.error || result.stderr || "Processus échoué"), { code: result.exitCode, killed: result.timedOut })
    }));
}
// === SYNCHRONISATION DE LA BARRE ET DU DASHBOARD ===========================
/** Remplace le HTML complet par un nouveau rendu du `dashboardState`. */
function refreshDashboard() {
    if (dashboardPanel) {
        dashboardPanel.webview.html = (0, dashboardHtml_1.getDashboardHtml)(dashboardState);
    }
}
/**
 * Recopie la photographie technique `Qc1Status` vers le modèle simplifié du Dashboard.
 * Ajouter un nouveau champ visuel exige généralement : type + état ici + HTML correspondant.
 */
function syncDashboardState(context) {
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
            targetFamily: status.architecture.family,
            targetDevice: status.architecture.device,
            coreMode: status.architecture.coreMode,
            cm7Present: status.architecture.cm7.present,
            cm4Present: status.architecture.cm4.present,
            cm7ElfFound: Boolean(status.cm7ElfPath) && fileExists(status.cm7ElfPath),
            cm4ElfFound: Boolean(status.cm4ElfPath) && fileExists(status.cm4ElfPath),
            cm7StartupFound: Boolean(status.architecture.cm7.startupPath),
            cm4StartupFound: Boolean(status.architecture.cm4.startupPath),
            cm7LinkerFound: Boolean(status.architecture.cm7.linkerScriptPath),
            cm4LinkerFound: Boolean(status.architecture.cm4.linkerScriptPath),
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
            os: (0, dashboardState_1.getOsLabel)(process.platform),
            osRaw: process.platform,
            extensionVersion: context.extension.packageJSON.version || dashboardState_1.defaultDashboardState.environment.extensionVersion,
            cmakePath: status.cmakePath || "--",
            cmakeSourcePath: status.cmakeSourcePath || "--",
            buildPath: status.buildPath || "--",
            offlinePortable: status.cmakeProjectReady,
            gccDetected: status.compilerOk,
            gdbDetected: status.gdbOk,
            openocdDetected: status.openocdOk,
            debuggerDetected: status.debuggerOk,
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
class QC1PanelProvider {
    constructor(extensionUri, context) {
        this.extensionUri = extensionUri;
        this.context = context;
        this.buildRunning = false;
        this.reportRunning = false;
        this.outputLines = [];
    }
    /** Appelé par VS Code lorsque la barre latérale QC1 doit être créée. */
    resolveWebviewView(webviewView) {
        this.view = webviewView;
        dashboardPanel = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };
        webviewView.webview.html = (0, dashboardHtml_1.getDashboardHtml)(dashboardState);
        // Routeur Webview -> extension. Chaque `msg.type` provient d'un postMessage du HTML.
        webviewView.webview.onDidReceiveMessage(async (message) => {
            if (!message || typeof message !== "object")
                return;
            const raw = message;
            if (typeof raw.type !== "string")
                return;
            const msg = { type: raw.type, command: typeof raw.command === "string" ? raw.command : "" };
            try {
                switch (msg.type) {
                    case "command":
                        if (msg.command === "openLogs") {
                            outputChannel?.show(true);
                        }
                        else {
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
                        await vscode.commands.executeCommand("workbench.action.openSettings", "@ext:Mistral400.QC1-STM32-Tools");
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
            }
            catch (error) {
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
    getConfig() {
        const config = qc1Configuration();
        const status = getQc1Status(this.context);
        return {
            os: (0, dashboardState_1.getOsLabel)(process.platform),
            osRaw: process.platform,
            extensionVersion: this.context.extension.packageJSON.version || dashboardState_1.defaultDashboardState.environment.extensionVersion,
            projectPath: config.get("projectPath", ""),
            cmakePath: config.get("cmakePath", ""),
            buildDirectory: config.get("buildDirectory", "build/qc1"),
            buildType: config.get("buildType", "Debug"),
            compilerPath: config.get("compilerPath", ""),
            openocdPath: config.get("openocdPath", ""),
            serialPort: config.get("serialPort", ""),
            baudRate: config.get("baudRate", 19200),
            stlinkPath: config.get("stlinkPath", "st-info"),
            autoDetectProject: config.get("autoDetectProject", true),
            autoClearOutput: config.get("autoClearOutput", false),
            showTimestamps: config.get("showTimestamps", true),
            outputMaxLines: config.get("outputMaxLines", 500),
            compactMode: config.get("compactMode", false),
            cmakeSource: status.cmakeSource,
            cmakeMode: status.nativeCmakeOk ? "projet natif" : "intégré au VSIX",
            detectedCmakePath: status.cmakePath || "--",
            cmakeSourcePath: status.cmakeSourcePath,
            buildPath: status.buildPath,
            offlinePortable: status.cmakeProjectReady
        };
    }
    /** Écrit les chemins auto-détectés dans les réglages du workspace. */
    async autoDetectPaths() {
        const config = qc1Configuration();
        const status = getQc1Status(this.context);
        const updates = [];
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
    async saveLog() {
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
    async createDiagnosticReport() {
        if (this.reportRunning)
            return;
        this.reportRunning = true;
        try {
            const issueDescription = await vscode.window.showInputBox({
                title: "Rapport de diagnostic QC1",
                prompt: "Décris brièvement l'erreur et ce que tu faisais lorsqu'elle est apparue.",
                placeHolder: "Exemple : le build échoue après avoir ajouté un nouveau fichier C (facultatif)",
                ignoreFocusOut: true
            });
            if (issueDescription === undefined)
                return;
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
                    const collectionErrors = [];
                    const collect = async (name, task, fallback) => {
                        try {
                            return await task();
                        }
                        catch (error) {
                            collectionErrors.push(`${name}: ${String(error)}`);
                            return fallback;
                        }
                    };
                    const probePromise = status.stlinkToolOk
                        ? runDiagnosticProcess(status.stlinkPath, ["--probe"], projectRoot || undefined, executionEnvironment)
                        : Promise.resolve({ exitCode: null, stdout: "", stderr: "st-info introuvable" });
                    const [tools, gitSnapshot, probe, system, devices] = await Promise.all([
                        collect("tools", () => collectDiagnosticToolReports(status), []),
                        collect("git", () => collectGitSnapshot(projectRoot), "unknown"),
                        probePromise,
                        collect("system", () => (0, systemInspection_1.inspectSystem)(), { status: "unknown" }),
                        collect("devices", () => (0, systemInspection_1.inspectDevices)(vscode.workspace.isTrusted), { usb: [], serial: [], permissions: {}, errors: ["Collection unavailable"] })
                    ]);
                    progress.report({ message: "Création et anonymisation du rapport" });
                    const relevantExtension = (id) => {
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
                    const details = (0, projectDiagnostics_1.inspectProjectDetails)((0, projectDiscovery_1.inspectStm32Project)(projectRoot, status.buildPath), config.get("targetMcu", ""), status.buildPath);
                    const installedExtensions = (0, extensionInventory_1.completeExtensionInventory)(vscode.extensions.all.map(extension => ({
                        id: extension.id, name: String(extension.packageJSON.displayName || extension.packageJSON.name || extension.id),
                        version: String(extension.packageJSON.version || "unknown"), active: extension.isActive,
                        enabled: "unknown (public API lists visible extensions, not disabled inventory)",
                        kind: (0, filesystem_1.inside)(vscode.env.appRoot, extension.extensionPath) ? "system" : "user",
                        path: extension.extensionPath, relevant: /cmake|cortex|embedded|platformio|stm32|clang|cpptools|serial|gitlens|arm|openocd|stlink/i.test(extension.id)
                    })));
                    const reportInput = {
                        system, installedExtensions, devices,
                        structure: details.structure, mcu: details.mcu, cmake: details.cmake,
                        findings: [...collectionErrors.map(message => ({ code: "QC1-COLLECT-001", level: "warning", category: "environment", title: "COLLECTION_FAILED", message, cause: message, evidence: message, path: "", suggestion: "Vérifier l'accès aux outils et fichiers.", correction: "Relancer le rapport après correction." })), ...details.findings, ...projectDiagnostics.map(d => ({
                                code: d.code, level: d.level === "error" ? "error" : "warning", category: "project", title: d.title,
                                message: d.message, cause: d.cause, evidence: d.checkedPath, path: d.checkedPath,
                                suggestion: "Vérifier le projet et les références CMake.", correction: "Corriger la configuration après vérification."
                            })), ...tools.filter(t => t.detected && t.exitCode !== 0).map(t => ({
                                code: "QC1-TOOL-010", level: "warning", category: "toolchain", title: "TOOL_PROBE_FAILED",
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
                            architecture: status.architecture,
                            diagnostics: projectDiagnostics
                        },
                        configuration: {
                            projectPath: config.get("projectPath", ""),
                            buildDirectory: config.get("buildDirectory", "build/qc1"),
                            buildType: config.get("buildType", "Debug"),
                            cmakePreset: config.get("cmakePreset", ""),
                            selectedConfigurePreset: status.cmakeConfigurePreset,
                            selectedBuildPreset: status.cmakeBuildPreset,
                            cmakePath: config.get("cmakePath", ""),
                            compilerPath: config.get("compilerPath", ""),
                            openocdPath: config.get("openocdPath", ""),
                            cm7ElfPath: config.get("cm7ElfPath", ""),
                            cm4ElfPath: config.get("cm4ElfPath", ""),
                            stlinkPath: config.get("stlinkPath", "st-info"),
                            serialPort: config.get("serialPort", ""),
                            baudRate: config.get("baudRate", 19200),
                            autoDetectProject: config.get("autoDetectProject", true),
                            autoClearOutput: config.get("autoClearOutput", false),
                            showTimestamps: config.get("showTimestamps", true),
                            outputMaxLines: config.get("outputMaxLines", 500)
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
                            bin: artifactSnapshot(status.binPath),
                            cm7Elf: artifactSnapshot(status.cm7ElfPath),
                            cm4Elf: artifactSnapshot(status.cm4ElfPath),
                            cm7Bin: artifactSnapshot(status.cm7BinPath),
                            cm4Bin: artifactSnapshot(status.cm4BinPath)
                        },
                        hardware: {
                            serialPort: status.serialPort || "non configuré/détecté",
                            baudRate: status.baudRate,
                            previousStlinkState: status.stlinkProbeStatus,
                            stlinkModel: status.stlinkProbeModel,
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
                        { value: os.homedir(), replacement: "<HOME>" },
                        { value: os.hostname(), replacement: "<HOSTNAME>" },
                        ...installedExtensions.map(extension => ({ value: String(extension.path || ""), replacement: `<EXTENSION:${String(extension.id)}>` }))
                    ];
                    return (0, diagnosticReport_1.buildDiagnosticReport)(reportInput, redactions);
                });
                const preview = await vscode.workspace.openTextDocument({ content: report, language: "markdown" });
                await vscode.window.showTextDocument(preview, { preview: true });
                const action = await vscode.window.showInformationMessage("Rapport QC1 généré et prévisualisé. Vérifie-le avant de l'envoyer.", "Enregistrer le rapport", "Copier le rapport");
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
            }
            catch (error) {
                const message = `Impossible de générer le rapport QC1 : ${error.message}`;
                outputChannel?.appendLine(`[QC1] ${message}`);
                vscode.window.showErrorMessage(message);
                this.postStatus("Échec du rapport", "error");
            }
        }
        finally {
            this.reportRunning = false;
        }
    }
    /**
     * Route les noms de commandes internes vers status, matériel, terminal ou build.
     * C'est ici qu'il faut enregistrer une nouvelle action envoyée par un bouton.
     */
    runCommand(command) {
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
        if (this.buildRunning) {
            this.postStatus("Une opération QC1 est déjà en cours", "running");
            return;
        }
        this.buildRunning = true;
        void this.runQC1(command).catch(error => {
            this.appendOutput(error instanceof Error ? error.message : String(error), "error");
            this.postStatus("Opération QC1 échouée", "error");
        }).finally(() => { this.buildRunning = false; });
    }
    detectStlink() {
        this.runStatus("detect-stlink");
    }
    openSerial() {
        openSerialTerminal(this.context);
    }
    startOpenOcd() {
        startOpenOcdTerminal(this.context);
    }
    /** Exécute un diagnostic et un probe ST-Link sans compiler le firmware. */
    runStatus(command) {
        const status = getQc1Status(this.context);
        const config = this.getConfig();
        const cwd = status.projectPath || getWorkspaceRoot() || "--";
        if (config.autoClearOutput)
            this.clearOutput();
        this.appendOutput(`$ qc1 ${command}`, "command");
        this.appendOutput(`CWD: ${cwd}`, "command");
        dashboardState = {
            ...dashboardState,
            lastCommand: command,
            currentAction: command === "detect-stlink" ? "Détection ST-Link" : "Diagnostic"
        };
        const finish = (probeOutput, probeError) => {
            if (status.stlinkToolOk) {
                const detected = (0, hardware_1.readStlinkProbeStatus)(probeOutput);
                stlinkProbeStatus = detected;
                stlinkProbeModel = (0, hardware_1.readStlinkProbeModel)(probeOutput);
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
            }
            else {
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
    async runQC1(command) {
        if (!vscode.workspace.isTrusted) {
            this.postStatus("Workspace non approuvé", "error");
            return;
        }
        const root = getWorkspaceRoot();
        const config = this.getConfig();
        const toolStatus = getQc1Status(this.context);
        const action = command.split("-")[0];
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
        const progressManager = new progressManager_1.ProgressManager((progress) => this.applyProgressUpdate(progress));
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
        const stdoutParts = [];
        const stderrParts = [];
        const appendBounded = (parts, chunk) => {
            parts.push(chunk.slice(-128 * 1024));
            while (parts.length > 128)
                parts.shift();
        };
        const executedCommands = [];
        let failedResult;
        try {
            if (toolStatus.nativeCmakeOk) {
                const query = path.join(toolStatus.buildPath, ".cmake", "api", "v1", "query", "client-qc1");
                await fs.promises.mkdir(query, { recursive: true });
                for (const name of ["codemodel-v2", "toolchains-v1"]) {
                    try {
                        await fs.promises.writeFile(path.join(query, name), "", { flag: "wx" });
                    }
                    catch (error) {
                        if (error.code !== "EEXIST")
                            throw error;
                    }
                }
            }
            for (const invocation of invocations) {
                if (invocation.phase === "flashing") {
                    const refreshed = getQc1Status(this.context);
                    const refreshedElf = invocation.core === "cm7" ? refreshed.cm7ElfPath : invocation.core === "cm4" ? refreshed.cm4ElfPath : refreshed.elfPath;
                    const refreshedBin = invocation.core === "cm7" ? refreshed.cm7BinPath : invocation.core === "cm4" ? refreshed.cm4BinPath : refreshed.binPath;
                    if (invocation.inputArtifact === "elf" && !fileExists(refreshedElf))
                        throw new Error(`ELF ${invocation.core?.toUpperCase() || "STM32"} introuvable: configure le projet pour alimenter la CMake File API ou règle qc1.${invocation.core ? `${invocation.core}ElfPath` : "elfPath"}.`);
                    if (invocation.executable === toolStatus.openocdPath) {
                        invocation.args = (0, hardware_1.getOpenOcdProgramArgs)(refreshedElf, refreshed.architecture.family, refreshed.architecture.coreMode === "dual", invocation.core);
                    }
                    else if (invocation.executable === objcopyPathForStatus(toolStatus)) {
                        invocation.args[3] = refreshedElf;
                        invocation.args[4] = refreshedBin;
                    }
                    else if (invocation.inputArtifact === "bin") {
                        if (!fileExists(refreshedBin))
                            throw new Error(`BIN ${invocation.core?.toUpperCase() || "STM32"} introuvable après objcopy/build.`);
                        invocation.args[2] = refreshedBin;
                    }
                }
                progressManager.setPhase(invocation.phase, invocation.label);
                const displayedInvocation = formatInvocation(invocation.executable, invocation.args);
                executedCommands.push(displayedInvocation);
                this.appendOutput(`$ ${displayedInvocation}`, "command");
                const result = await runSpawnedProcess(invocation, projectDir, environment, (chunk) => {
                    appendBounded(stdoutParts, chunk);
                    if (invocation.tracksNinja)
                        progressManager.consumeOutput(chunk);
                    this.appendOutput(chunk, "stdout");
                }, (chunk) => {
                    appendBounded(stderrParts, chunk);
                    if (invocation.tracksNinja)
                        progressManager.consumeOutput(chunk);
                    this.appendOutput(chunk, "stderr");
                });
                if (result.error || result.exitCode !== 0) {
                    failedResult = result;
                    break;
                }
            }
            if (!failedResult && action === "debug") {
                const requestedCore = (0, targetArchitecture_1.coreFromCommand)(command);
                const core = requestedCore || (toolStatus.architecture.coreMode === "cm7" ? "cm7" : toolStatus.architecture.coreMode === "cm4" ? "cm4" : undefined);
                const refreshed = getQc1Status(this.context);
                const executable = core === "cm7" ? refreshed.cm7ElfPath : core === "cm4" ? refreshed.cm4ElfPath : refreshed.elfPath;
                const label = core?.toUpperCase() || "STM32F1";
                if (!fileExists(executable))
                    throw new Error(`ELF ${label} introuvable après le build.`);
                const debugConfiguration = (0, hardware_1.getCortexDebugConfiguration)(projectDir, executable, refreshed.architecture.family, core);
                debugConfiguration.serverpath = refreshed.openocdPath;
                debugConfiguration.gdbPath = refreshed.gdbPath;
                const started = await vscode.debug.startDebugging(vscode.workspace.getWorkspaceFolder(vscode.Uri.file(projectDir)), debugConfiguration);
                if (!started)
                    throw new Error(`Cortex-Debug n'a pas démarré la session ${label}.`);
                this.appendOutput(`[QC1] Session Cortex-Debug ${label} lancée`, "stdout");
            }
        }
        catch (error) {
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
        const parsed = (0, qc1Parser_1.parseQc1Output)(fullOutput);
        const detectedProbeStatus = (0, hardware_1.readStlinkProbeStatus)(fullOutput);
        if (detectedProbeStatus !== "non testé")
            stlinkProbeStatus = detectedProbeStatus;
        const success = !failedResult &&
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
        if (["build", "rebuild", "tsmake", "flash", "debug", "run"].includes(action)) {
            dashboardState = {
                ...dashboardState,
                build: {
                    ...dashboardState.build,
                    lastBuildTime: new Date().toLocaleString(),
                    lastBuildSuccess: success || (["flash", "run"].includes(action) && !parsed.hasBuildFailed && parsed.errors === 0),
                    buildRuntimeMs: runtimeMs
                }
            };
        }
        if (["flash", "run"].includes(action)) {
            dashboardState = {
                ...dashboardState,
                flash: {
                    ...dashboardState.flash,
                    lastFlashTime: new Date().toLocaleString(),
                    lastFlashSuccess: success,
                    flashRuntimeMs: runtimeMs,
                    method: fullOutput.toLowerCase().includes("openocd") ? "OpenOCD" : "st-flash",
                    targetMCU: toolStatus.architecture.device
                }
            };
        }
        const failureCause = parsed.explanation || (failedResult?.error instanceof Error
            ? failedResult.error.message
            : "La commande QC1 a retourné un résultat invalide");
        const commandError = success
            ? undefined
            : failedResult
                ? createQc1ErrorFromProcess(failedResult.error || Object.assign(new Error("Commande échouée"), { code: failedResult.exitCode }), failedResult.command, projectDir, failedResult.stdout, failedResult.stderr)
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
        dashboardState = (0, dashboardState_1.finishProgress)(dashboardState, success, "QC1-CMD-OK", commandError?.code || "QC1-CMD-001", ["build", "rebuild", "tsmake", "flash", "debug", "run"].includes(action) ? "BUILD_SUCCESS" : "COMMAND_DONE", commandError?.title || "COMMANDE_ECHOUEE", resultMessage, success ? "Commande terminée sans erreur détectée" : failureCause, projectDir);
        syncDashboardState(this.context);
        if (commandError) {
            this.applyQc1Error(commandError);
            this.appendQc1Error(commandError, "commande");
        }
        else {
            this.appendOutput(`[QC1] ${command} terminé avec succès`, "stdout");
        }
        this.sendDashboardState();
        this.sendAnalysis(parsed);
        this.sendTerminalMeta();
        this.postStatus(success ? `Terminé : ${command}` : `Échec : ${command}`, success ? "success" : "error");
        this.appendOutput("--- terminé ---", "separator");
    }
    /** Applique et transmet une mesure du ProgressManager sans recréer la Webview. */
    applyProgressUpdate(progress) {
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
    applyQc1Error(qc1Error, level = "error") {
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
    appendQc1Error(qc1Error, kind) {
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
        void vscode.window.showErrorMessage(`[${qc1Error.code}] ${qc1Error.message}`, "Créer un rapport").then((action) => {
            if (action === "Créer un rapport") {
                void this.createDiagnosticReport();
            }
        });
    }
    appendQc1CommandResult(command, cwd, exitCode, stdout, stderr) {
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
    sendQc1ErrorAnalysis(qc1Error, level = "error") {
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
    appendOutput(text, kind = "stdout") {
        // Logging must not trigger a project scan for every compiler output chunk.
        const config = qc1Configuration();
        const timestamp = config.get("showTimestamps", true)
            ? `[${new Date().toLocaleTimeString()}] `
            : "";
        const lines = text.slice(-128 * 1024)
            .toString()
            .split(/\r\n|\n|\r/)
            .filter((line) => line.length > 0).slice(-2000)
            .map((line) => `${timestamp}${line}`);
        this.outputLines.push(...lines);
        outputChannel?.appendLine(lines.join("\n"));
        const limit = Math.min(5000, Math.max(1, Number(config.get("outputMaxLines", 500)) || 500));
        if (this.outputLines.length > limit) {
            this.outputLines = this.outputLines.slice(-limit);
        }
        this.view?.webview.postMessage({
            type: "output",
            kind,
            lines
        });
    }
    clearOutput() {
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
    sendDashboardState() {
        this.view?.webview.postMessage({
            type: "dashboardState",
            state: dashboardState
        });
    }
    postStatus(text, state) {
        this.view?.webview.postMessage({
            type: "status",
            text,
            state
        });
    }
    sendSettings() {
        this.view?.webview.postMessage({
            type: "settings",
            settings: this.getConfig()
        });
    }
    sendToolsStatus() {
        this.view?.webview.postMessage({
            type: "toolsStatus",
            tools: getQc1Status(this.context)
        });
    }
    sendTerminalMeta() {
        this.view?.webview.postMessage({
            type: "terminalMeta",
            meta: {
                projectName: dashboardState.projectName,
                lastCommand: dashboardState.lastCommand
            }
        });
    }
    sendAnalysis(parsed) {
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
exports.QC1PanelProvider = QC1PanelProvider;
QC1PanelProvider.viewType = "qc1.panel";
// === POINT D'ENTRÉE DE L'EXTENSION =========================================
/**
 * VS Code appelle `activate()` une fois lorsqu'une vue/commande QC1 est demandée.
 * On initialise les outils, crée les deux Webviews et relie les commandes du
 * package.json aux méthodes du provider.
 */
async function activate(context) {
    outputChannel = vscode.window.createOutputChannel("QC1 STM32 Tools");
    context.subscriptions.push(outputChannel);
    // Tool installation may take a long time; keep the views and commands responsive.
    void initializeEmbeddedBuildTools().then(() => { syncDashboardState(context); refreshDashboard(); }).catch(error => outputChannel?.appendLine(String(error)));
    syncDashboardState(context);
    const provider = new QC1PanelProvider(context.extensionUri, context);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(QC1PanelProvider.viewType, provider));
    // Les identifiants doivent rester identiques à `contributes.commands` dans package.json.
    context.subscriptions.push(vscode.commands.registerCommand("qc1.build", () => {
        provider.runCommand("build");
    }));
    context.subscriptions.push(vscode.commands.registerCommand("qc1.buildCm7", () => {
        provider.runCommand("build-cm7");
    }));
    context.subscriptions.push(vscode.commands.registerCommand("qc1.buildCm4", () => {
        provider.runCommand("build-cm4");
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
    context.subscriptions.push(vscode.commands.registerCommand("qc1.debug", () => {
        provider.runCommand("debug");
    }));
    context.subscriptions.push(vscode.commands.registerCommand("qc1.flashCm7", () => {
        provider.runCommand("flash-cm7");
    }));
    context.subscriptions.push(vscode.commands.registerCommand("qc1.flashCm4", () => {
        provider.runCommand("flash-cm4");
    }));
    context.subscriptions.push(vscode.commands.registerCommand("qc1.debugCm7", () => {
        provider.runCommand("debug-cm7");
    }));
    context.subscriptions.push(vscode.commands.registerCommand("qc1.debugCm4", () => {
        provider.runCommand("debug-cm4");
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
function deactivate() { }
//# sourceMappingURL=extension.js.map