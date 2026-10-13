/** Project discovery independent of CubeMX naming; evidence shared with diagnostics. */
import * as fs from "fs";
import * as path from "path";
import { inspectCmake, CmakeInspection, parseCmake } from "./cmakeInspection";
import {
  finding,
  Finding,
  readText,
  resolveUserPath,
  scanProject,
  ProjectScan,
  inside,
} from "./filesystem";
import { applyCoreBuildMetadata, readCoreBuildMetadata, configuredCoreTarget } from "./coreBuild";
import { inspectTargetArchitecture, isStm32H7Family, Qc1TargetArchitecture } from "./targetArchitecture";

export type Qc1ProjectLayout =
  | "native-cmake"
  | "cubemx"
  | "bare-metal"
  | "makefile"
  | "platformio"
  | "stm32cubeide"
  | "unknown";
export interface Qc1ProjectInspection {
  root: string;
  layout: Qc1ProjectLayout;
  nativeCmakePath: string;
  corePath: string;
  driversPath: string;
  srcPath: string;
  incPath: string;
  startupPath: string;
  linkerScriptPath: string;
  projectName: string;
  score: number;
  sources: string[];
  startupCandidates: string[];
  linkerCandidates: string[];
  markers: string[];
  cmake: CmakeInspection;
  scan: ProjectScan;
  findings: Finding[];
  architecture: Qc1TargetArchitecture;
}
export function readCmakeProjectName(file: string): string {
  return (
    parseCmake(readText(file)).commands.find((c) => c.name === "project")
      ?.args[0] || "firmware"
  );
}
export function inspectStm32Project(
  root: string,
  buildDirectory?: string,
  configuredCubeH7Root = "",
): Qc1ProjectInspection {
  const scan = root
    ? scanProject(root)
    : { files: [], directories: 0, bytes: 0, truncated: false, findings: [] };
  const files = scan.files;
  const cmake = inspectCmake(root, files, buildDirectory);
  const nativeCmakePath =
    root && files.includes(path.join(root, "CMakeLists.txt"))
      ? path.join(root, "CMakeLists.txt")
      : "";
  const sourceFiles = files.filter((f) => /\.(c|cc|cxx|cpp)$/i.test(f));
  const sources = [
    ...new Set([
      ...cmake.sources.filter(
        (f) => /\.(c|cc|cxx|cpp)$/i.test(f) && fs.existsSync(f),
      ),
      ...sourceFiles,
    ]),
  ];
  const assembly = cmake.sources.filter(
    (f) => /\.(s|asm)$/i.test(f) && fs.existsSync(f),
  );
  const startupCandidates = [
    ...new Set([
      ...assembly.filter((f) =>
        /^startup(?:_.*)?\.(s|asm)$/i.test(path.basename(f)),
      ),
      ...files.filter((f) =>
        /^startup(?:_.*)?\.(s|asm)$/i.test(path.basename(f)),
      ),
    ]),
  ];
  for (const file of assembly)
    if (
      !startupCandidates.includes(file) &&
      /\b(?:Reset_Handler|__Vectors|g_pfnVectors|isr_vector)\b/.test(
        readText(file, 128 * 1024),
      )
    )
      startupCandidates.unshift(file);
  const linkerCandidates = [
    ...new Set([
      ...cmake.linkerScripts.filter((f) => fs.existsSync(f)),
      ...files.filter((f) => /\.ld$/i.test(f)),
    ]),
  ];
  const referencedStartup = startupCandidates.filter((f) =>
    cmake.sources.includes(f),
  );
  const referencedLinker = linkerCandidates.filter((f) =>
    cmake.linkerScripts.includes(f),
  );
  const pick = (referenced: string[], all: string[]): string =>
    referenced.length === 1 ? referenced[0] : all.length === 1 ? all[0] : "";
  const markers = files.filter(
    (f) =>
      path.dirname(f) === root &&
      /(?:\.ioc$|^\.cproject$|^\.project$|^platformio\.ini$|^Makefile$|^CMakeLists\.txt$)/i.test(
        path.basename(f),
      ),
  );
  const has = (pattern: RegExp): boolean =>
    markers.some((f) => pattern.test(path.basename(f)));
  const hasCubeIdeProject = files.some((file) => path.basename(file).toLowerCase() === ".cproject");
  const layout: Qc1ProjectLayout = has(/^platformio\.ini$/i)
    ? "platformio"
    : nativeCmakePath
      ? "native-cmake"
      : has(/^\.cproject$/) || hasCubeIdeProject
        ? "stm32cubeide"
        : has(/\.ioc$/i)
          ? "cubemx"
          : has(/^makefile$/i)
            ? "makefile"
            : sources.length
              ? fs.existsSync(path.join(root, "Core"))
                ? "cubemx"
                : "bare-metal"
              : "unknown";
  const findings = [...scan.findings, ...cmake.findings];
  const architecture = inspectTargetArchitecture(root, scan, cmake, configuredCubeH7Root);
  if (buildDirectory && isStm32H7Family(architecture.family)) {
    const metadata = readCoreBuildMetadata(root, buildDirectory, cmake.cache.CMAKE_BUILD_TYPE || "Debug");
    applyCoreBuildMetadata(architecture, metadata);
    if (metadata.buildTargets.length && metadata.buildTargets.some(target => configuredCoreTarget(metadata.buildTargets, "cm7") === target.name || configuredCoreTarget(metadata.buildTargets, "cm4") === target.name)) {
      const unknown = findings.find(item => item.title === "TARGET_UNKNOWN");
      if (unknown) {
        unknown.title = "TARGET_STATIC_UNRESOLVED";
        unknown.message = "La cible n'est pas déduite du texte CMake; la File API confirme les cibles configurées.";
      }
    }
  }
  const dualStartupsResolved = architecture.coreMode === "dual" && Boolean(architecture.cm7.startupPath && architecture.cm4.startupPath);
  const dualLinkersResolved = architecture.coreMode === "dual" && Boolean(architecture.cm7.linkerScriptPath && architecture.cm4.linkerScriptPath);
  if (startupCandidates.length > 1 && referencedStartup.length !== 1 && !dualStartupsResolved)
    findings.push(
      finding(
        "QC1-PRJ-006",
        "STARTUP_AMBIGUOUS",
        "Plusieurs startups: aucune sélection automatique sûre.",
        root,
      ),
    );
  if (linkerCandidates.length > 1 && referencedLinker.length !== 1 && !dualLinkersResolved)
    findings.push(
      finding(
        "QC1-PRJ-007",
        "LINKER_AMBIGUOUS",
        "Plusieurs scripts linker: utiliser la référence CMake explicite.",
        root,
      ),
    );
  const header = files.find((f) => /\.h$/i.test(f));
  const cubeIdeProjectNames = files.filter((file) => path.basename(file) === ".project" && /(?:^|[/\\])STM32CubeIDE[/\\]CM[47][/\\]/i.test(file))
    .map((file) => readText(file, 128 * 1024).match(/<name>\s*([^<]+?)\s*<\/name>/i)?.[1]?.trim() || "")
    .filter(Boolean);
  const cubeIdeProjectName = cubeIdeProjectNames[0]?.replace(/_(?:CM7|CM4)$/i, "") || "";
  return {
    root,
    layout,
    nativeCmakePath,
    corePath: root ? path.join(root, "Core") : "",
    driversPath: root ? path.join(root, "Drivers") : "",
    srcPath: sources[0] ? path.dirname(sources[0]) : "",
    incPath: header ? path.dirname(header) : "",
    startupPath: pick(referencedStartup, startupCandidates),
    linkerScriptPath: pick(referencedLinker, linkerCandidates),
    projectName: cmake.executableTargets[0] || (cmake.projectName !== "firmware" ? cmake.projectName : cubeIdeProjectName || cmake.projectName),
    sources,
    startupCandidates,
    linkerCandidates,
    markers,
    cmake,
    architecture,
    scan,
    findings,
    score:
      (nativeCmakePath ? 100 : 0) +
      (sources.length ? 40 : 0) +
      (startupCandidates.length ? 30 : 0) +
      (linkerCandidates.length ? 20 : 0) +
      (markers.length ? 10 : 0),
  };
}
export function isUsableStm32Project(
  inspection: Qc1ProjectInspection,
): boolean {
  if (inspection.nativeCmakePath) return true;
  if (inspection.architecture.coreMode === "dual") {
    return ["cm7", "cm4"].every((core) => {
      const item = inspection.architecture[core as "cm7" | "cm4"];
      return item.present && item.sources.length > 0 && Boolean(item.startupPath && item.linkerScriptPath);
    });
  }
  return (
    inspection.layout !== "unknown" &&
    Boolean(
      inspection.startupPath &&
      inspection.linkerScriptPath &&
      inspection.srcPath,
    )
  );
}
export function findStm32Project(
  root: string,
  maxDepth = 8,
): Qc1ProjectInspection | null {
  const scan = scanProject(root, maxDepth, 6000);
  const markers = scan.files.filter(
    (f) =>
      /^(CMakeLists\.txt|Makefile|platformio\.ini|\.cproject)$/.test(
        path.basename(f),
      ) || /\.ioc$/i.test(f),
  );
  const markerRoot = (file: string): string => {
    const coreDirectory = path.dirname(file);
    const ideDirectory = path.dirname(coreDirectory);
    if (path.basename(file).toLowerCase() === ".cproject" &&
      /^cm[47]$/i.test(path.basename(coreDirectory)) &&
      path.basename(ideDirectory).toLowerCase() === "stm32cubeide") {
      return path.dirname(ideDirectory);
    }
    return path.dirname(file);
  };
  const roots = [...new Set(markers.map(markerRoot))].sort(
    (a, b) => a.length - b.length,
  );
  const candidates = roots
    .filter(
      (candidate, index) =>
        !roots.slice(0, index).some((parent) => inside(parent, candidate)),
    )
    .slice(0, 20)
    .map((candidate) => inspectStm32Project(candidate));
  if (!candidates.length) {
    const project = inspectStm32Project(root);
    return project.layout !== "unknown" ? project : null;
  }
  return (
    candidates.sort(
      (a, b) => b.score - a.score || a.root.localeCompare(b.root),
    )[0] || null
  );
}
export function resolveConfiguredProjectPath(
  configuredPath: string,
  workspaceRoot: string,
): string {
  return resolveUserPath(configuredPath, workspaceRoot);
}
