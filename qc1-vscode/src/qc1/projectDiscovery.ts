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
import { inspectTargetArchitecture, Qc1TargetArchitecture } from "./targetArchitecture";

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
  const layout: Qc1ProjectLayout = has(/^platformio\.ini$/i)
    ? "platformio"
    : nativeCmakePath
      ? "native-cmake"
      : has(/^\.cproject$/)
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
  const architecture = inspectTargetArchitecture(root, scan, cmake);
  if (startupCandidates.length > 1 && referencedStartup.length !== 1)
    findings.push(
      finding(
        "QC1-PRJ-006",
        "STARTUP_AMBIGUOUS",
        "Plusieurs startups: aucune sélection automatique sûre.",
        root,
      ),
    );
  if (linkerCandidates.length > 1 && referencedLinker.length !== 1)
    findings.push(
      finding(
        "QC1-PRJ-007",
        "LINKER_AMBIGUOUS",
        "Plusieurs scripts linker: utiliser la référence CMake explicite.",
        root,
      ),
    );
  const header = files.find((f) => /\.h$/i.test(f));
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
    projectName: cmake.executableTargets[0] || cmake.projectName,
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
  const roots = [...new Set(markers.map((f) => path.dirname(f)))].sort(
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
