/** STM32 target classification shared by discovery, diagnostics and command routing. */
import * as path from "path";
import { CmakeInspection, parseCmake } from "./cmakeInspection";
import { ProjectScan, readText } from "./filesystem";

export type Qc1McuFamily = "stm32f1" | "stm32h755" | "unknown";
export type Qc1Core = "cm7" | "cm4";
export type Qc1CoreMode = "single" | "cm7" | "cm4" | "dual" | "unknown";

export interface Qc1CoreInspection {
  core: Qc1Core;
  present: boolean;
  directory: string;
  cmakePath: string;
  targetName: string;
  startupPath: string;
  linkerScriptPath: string;
  startupCandidates: string[];
  linkerCandidates: string[];
  expectedFlags: string[];
  expectedDefines: string[];
  missingFlags: string[];
  missingDefines: string[];
}

export interface Qc1TargetArchitecture {
  family: Qc1McuFamily;
  device: string;
  board: string;
  coreMode: Qc1CoreMode;
  openOcdTarget: string;
  evidence: string[];
  iocPath: string;
  halPath: string;
  cmsisPath: string;
  cmsisDevicePath: string;
  bspPath: string;
  bspRequired: boolean;
  cm7: Qc1CoreInspection;
  cm4: Qc1CoreInspection;
}

function fileByBasename(files: string[], name: string): string {
  return files.find((file) => path.basename(file).toLowerCase() === name.toLowerCase()) || "";
}

function directoryBySegments(root: string, files: string[], segments: string[]): string {
  const wanted = segments.map((segment) => segment.toLowerCase());
  for (const file of files) {
    const actual = path.relative(root, file).split(path.sep);
    const relative = actual.map((segment) => segment.toLowerCase());
    for (let index = 0; index <= relative.length - wanted.length; index++) {
      if (wanted.every((segment, offset) => relative[index + offset] === segment)) {
        return path.join(root, ...actual.slice(0, index + wanted.length));
      }
    }
  }
  return "";
}

function belongsToCore(file: string, core: Qc1Core): boolean {
  const normalized = file.replace(/\\/g, "/").toLowerCase();
  const marker = core === "cm7" ? /(?:^|[/_-])(?:cm7|cortex-m7|m7)(?:[/_.-]|$)/ : /(?:^|[/_-])(?:cm4|cortex-m4|m4)(?:[/_.-]|$)/;
  return marker.test(normalized);
}

function chooseCoreFile(candidates: string[], core: Qc1Core, referenced: string[]): { path: string; candidates: string[] } {
  const matches = candidates.filter((file) => belongsToCore(file, core));
  const referencedMatches = matches.filter((file) => referenced.includes(file));
  return {
    path: referencedMatches.length === 1 ? referencedMatches[0] : matches.length === 1 ? matches[0] : "",
    candidates: matches,
  };
}

function cmakeProjectName(file: string): string {
  if (!file) return "";
  return parseCmake(readText(file)).commands.find((command) => command.name === "project")?.args[0] || "";
}

function coreInspection(
  root: string,
  files: string[],
  cmake: CmakeInspection,
  core: Qc1Core,
  present: boolean,
): Qc1CoreInspection {
  const directoryName = core.toUpperCase();
  const directory = directoryBySegments(root, files, [directoryName]);
  const cmakePath = files.find((file) => path.basename(file) === "CMakeLists.txt" && belongsToCore(file, core)) || "";
  const startups = files.filter((file) => /^startup(?:_.*)?\.(s|asm)$/i.test(path.basename(file)));
  const linkers = files.filter((file) => /\.ld$/i.test(file));
  const startup = chooseCoreFile(startups, core, cmake.sources);
  const linker = chooseCoreFile(linkers, core, cmake.linkerScripts);
  const matchingTargets = cmake.executableTargets.filter((target) => belongsToCore(target, core));
  const targetName = matchingTargets.length === 1 ? matchingTargets[0] : cmakeProjectName(cmakePath);
  const expectedFlags = core === "cm7"
    ? ["-mcpu=cortex-m7", "-mthumb", "-mfpu=fpv5-d16", "-mfloat-abi=hard"]
    : ["-mcpu=cortex-m4", "-mthumb", "-mfpu=fpv4-sp-d16", "-mfloat-abi=hard"];
  const expectedDefines = [core === "cm7" ? "CORE_CM7" : "CORE_CM4", "STM32H755xx", "USE_HAL_DRIVER"];
  const coreText = files.filter((file) => belongsToCore(file, core) && /(?:CMakeLists\.txt|\.cmake)$/i.test(path.basename(file)))
    .map((file) => readText(file, 256 * 1024)).join("\n");
  const settingsText = coreText || `${cmake.flags.join(" ")}\n${cmake.definitions.join(" ")}`;
  return {
    core,
    present,
    directory,
    cmakePath,
    targetName,
    startupPath: startup.path,
    linkerScriptPath: linker.path,
    startupCandidates: startup.candidates,
    linkerCandidates: linker.candidates,
    expectedFlags,
    expectedDefines,
    missingFlags: expectedFlags.filter((flag) => !settingsText.includes(flag)),
    missingDefines: expectedDefines.filter((define) => define !== "USE_HAL_DRIVER" && !new RegExp(`\\b${define.replace(/x/g, "[xX]")}\\b`).test(settingsText)),
  };
}

export function inspectTargetArchitecture(
  root: string,
  scan: ProjectScan,
  cmake: CmakeInspection,
): Qc1TargetArchitecture {
  const files = scan.files;
  const evidence: string[] = [];
  const evidenceFiles = files.filter((file) =>
    /(?:CMakeLists\.txt|\.cmake|\.ioc|\.ld|startup.*\.(?:s|asm)|stm32.*\.h)$/i.test(path.basename(file)),
  ).slice(0, 160);
  const evidenceText = evidenceFiles.map((file) => `${path.relative(root, file)}\n${readText(file, 128 * 1024)}`).join("\n");
  const searchable = `${root}\n${evidenceText}\n${cmake.definitions.join(" ")}\n${cmake.flags.join(" ")}`;

  const h755Matches = searchable.match(/(?:NUCLEO[-_ ]?H755ZI[-_ ]?Q|STM32H755(?:ZIT6|ZI|xx)?)/gi) || [];
  const f1Matches = searchable.match(/STM32F(?:1|103)[A-Z0-9x]*/gi) || [];
  if (h755Matches.length) evidence.push(...h755Matches.slice(0, 12).map((match) => match.toUpperCase()));
  if (f1Matches.length) evidence.push(...f1Matches.slice(0, 12).map((match) => match.toUpperCase()));
  const family: Qc1McuFamily = h755Matches.length ? "stm32h755" : f1Matches.length ? "stm32f1" : "unknown";
  const board = /NUCLEO[-_ ]?H755ZI[-_ ]?Q/i.test(searchable) ? "NUCLEO-H755ZI-Q" : "unknown";
  const deviceMatch = searchable.match(/STM32H755(?:ZIT6|ZI|xx)?/i);
  const device = family === "stm32h755" ? (deviceMatch?.[0].toUpperCase() || "STM32H755") : family === "stm32f1" ? (f1Matches[0]?.toUpperCase() || "STM32F1") : "unknown";

  const hasCm7 = family === "stm32h755" && (files.some((file) => belongsToCore(file, "cm7")) || /\bCORE_CM7\b/i.test(searchable));
  const hasCm4 = family === "stm32h755" && (files.some((file) => belongsToCore(file, "cm4")) || /\bCORE_CM4\b/i.test(searchable));
  const coreMode: Qc1CoreMode = family === "stm32f1" ? "single" : hasCm7 && hasCm4 ? "dual" : hasCm7 ? "cm7" : hasCm4 ? "cm4" : "unknown";
  const iocPath = files.find((file) => /\.ioc$/i.test(file)) || "";
  const halPath = directoryBySegments(root, files, ["Drivers", "STM32H7xx_HAL_Driver"]);
  const cmsisPath = directoryBySegments(root, files, ["Drivers", "CMSIS"]);
  const cmsisDevicePath = directoryBySegments(root, files, ["Drivers", "CMSIS", "Device", "ST", "STM32H7xx"]);
  const bspPath = directoryBySegments(root, files, ["Drivers", "BSP", "STM32H7xx_Nucleo"]);
  const bspUsageText = files.filter((file) => /\.(?:c|cc|cpp|h|hpp)$/i.test(file) && !file.includes(`${path.sep}Drivers${path.sep}BSP${path.sep}`))
    .slice(0, 200).map((file) => readText(file, 64 * 1024)).join("\n");
  const bspRequired = /stm32h7xx_nucleo(?:_conf)?\.h|BSP_[A-Za-z0-9_]+\s*\(/i.test(bspUsageText);
  const cm7 = coreInspection(root, files, cmake, "cm7", hasCm7);
  const cm4 = coreInspection(root, files, cmake, "cm4", hasCm4);
  const rootCmake = fileByBasename(files.filter((file) => path.dirname(file) === root), "CMakeLists.txt");
  if (hasCm7 && !hasCm4 && !cm7.cmakePath) cm7.cmakePath = rootCmake;
  if (hasCm4 && !hasCm7 && !cm4.cmakePath) cm4.cmakePath = rootCmake;

  return {
    family,
    device,
    board,
    coreMode,
    openOcdTarget: family === "stm32h755" ? "target/stm32h7x.cfg" : "target/stm32f1x.cfg",
    evidence: [...new Set(evidence)],
    iocPath,
    halPath,
    cmsisPath,
    cmsisDevicePath,
    bspPath,
    bspRequired,
    cm7,
    cm4,
  };
}

export function coreFromCommand(command: string): Qc1Core | undefined {
  if (/(?:^|-)cm7$/.test(command)) return "cm7";
  if (/(?:^|-)cm4$/.test(command)) return "cm4";
  return undefined;
}
