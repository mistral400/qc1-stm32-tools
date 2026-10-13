/** STM32 target classification shared by discovery, diagnostics and command routing. */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { CmakeInspection, inspectCmake } from "./cmakeInspection";
import { ProjectScan, readText } from "./filesystem";
import { resolvedTargetName } from "./coreBuild";
import { CubeIdeCoreProject, inspectCubeIdeProject } from "./cubeIdeProject";

export type Qc1McuFamily = "stm32f1" | "stm32h7" | "stm32h755" | "unknown";
export type Qc1Core = "cm7" | "cm4";
export type Qc1CoreMode = "single" | "cm7" | "cm4" | "dual" | "unknown";

export function isStm32H7Family(family: Qc1McuFamily): boolean {
  return family === "stm32h7" || family === "stm32h755";
}

export function isKnownDualCoreH7Device(device: string): boolean {
  return /^STM32H(?:745|747|755|757)/i.test(device);
}

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
  sources: string[];
  headers: string[];
  includeDirectories: string[];
  definitions: string[];
  compileOptions: string[];
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
  deviceHeaderPath: string;
  bspPath: string;
  cubeH7Root: string;
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

function cubeRootCandidates(root: string, files: string[], configuredRoot: string): string[] {
  const candidates = [configuredRoot, path.join(root, "Drivers")];
  for (const file of files) {
    const normalized = file.replace(/\\/g, "/");
    const index = normalized.toLowerCase().indexOf("/drivers/");
    if (index >= 0) candidates.push(normalized.slice(0, index));
  }
  const repository = path.join(os.homedir(), "STM32Cube", "Repository");
  try {
    for (const entry of fs.readdirSync(repository, { withFileTypes: true }).slice(0, 80)) {
      if (entry.isDirectory() && /^STM32Cube_FW_H7(?:_|$)/i.test(entry.name))
        candidates.push(path.join(repository, entry.name));
    }
  } catch { /* Optional STM32Cube installation location. */ }

  const roots: string[] = [];
  for (const candidate of candidates.filter(Boolean)) {
    let value = path.resolve(candidate);
    try { if (!fs.statSync(value).isDirectory()) continue; } catch { continue; }
    if (path.basename(value).toLowerCase() === "drivers") value = path.dirname(value);
    if (path.basename(value).toLowerCase() === "stm32h7xx_hal_driver") value = path.resolve(value, "../..");
    if (!roots.includes(value)) roots.push(value);
  }
  return roots;
}

function existingDirectory(candidates: string[]): string {
  return candidates.find((candidate) => {
    try { return fs.statSync(candidate).isDirectory(); } catch { return false; }
  }) || "";
}

function belongsToCore(file: string, core: Qc1Core): boolean {
  const normalized = file.replace(/\\/g, "/").toLowerCase();
  const marker = core === "cm7" ? /(?:^|[/_-])(?:cm7|cortex-m7|m7)(?:[/_.-]|$)/ : /(?:^|[/_-])(?:cm4|cortex-m4|m4)(?:[/_.-]|$)/;
  return marker.test(normalized);
}

function chooseCoreFile(root: string, candidates: string[], core: Qc1Core, referenced: string[]): { path: string; candidates: string[] } {
  const matches = candidates.filter((file) => belongsToCore(path.relative(root, file), core));
  const referencedMatches = matches.filter((file) => referenced.includes(file));
  return {
    path: referencedMatches.length === 1 ? referencedMatches[0] : matches.length === 1 ? matches[0] : "",
    candidates: matches,
  };
}

function cmakeProjectName(file: string): string {
  if (!file) return "";
  const name = inspectCmake(path.dirname(file), []).projectName;
  return resolvedTargetName(name) ? name : "";
}

function coreInspection(
  root: string,
  files: string[],
  cmake: CmakeInspection,
  core: Qc1Core,
  present: boolean,
  device: string,
  cubeIde?: CubeIdeCoreProject,
): Qc1CoreInspection {
  const directoryName = core.toUpperCase();
  const directory = directoryBySegments(root, files, [directoryName]);
  const cmakePath = files.find((file) => path.basename(file) === "CMakeLists.txt" && belongsToCore(path.relative(root, file), core)) || "";
  const startups = files.filter((file) => /^startup(?:_.*)?\.(s|asm)$/i.test(path.basename(file)));
  const linkers = files.filter((file) => /\.ld$/i.test(file));
  const startup = cubeIde?.startupCandidates.length === 1
    ? { path: cubeIde.startupCandidates[0], candidates: cubeIde.startupCandidates }
    : chooseCoreFile(root, startups, core, cmake.sources);
  const flashLinkers = linkers.filter(file => /(?:^|[_-])flash(?:[_.-]|$)/i.test(path.basename(file)));
  const linkerCandidates = cubeIde?.linkerCandidates || [];
  const linker = linkerCandidates.length === 1
    ? { path: linkerCandidates[0], candidates: linkerCandidates }
    : chooseCoreFile(root, flashLinkers.some(file => belongsToCore(path.relative(root, file), core)) ? flashLinkers : linkers.filter(file => !/sram|(?:^|[_-])ram/i.test(path.basename(file))), core, cmake.linkerScripts);
  const matchingTargets = cmake.executableTargets.filter((target) => resolvedTargetName(target) && belongsToCore(target, core));
  const targetName = matchingTargets.length === 1 ? matchingTargets[0] : cmakeProjectName(cmakePath) ||
    (cubeIde ? "firmware_" + core : "");
  const expectedFpu = core === "cm7" ? "fpv5-d16" : "fpv4-sp-d16";
  const fpu = cubeIde?.fpu || expectedFpu;
  const floatAbi = cubeIde?.floatAbi || "hard";
  const expectedFlags = [
    "-mcpu=cortex-m" + core.slice(-1),
    "-mthumb",
    "-mfpu=" + fpu,
    "-mfloat-abi=" + floatAbi,
  ];
  const deviceNumber = device.match(/^STM32H(\d{3})/i)?.[1];
  const deviceDefine = deviceNumber ? "STM32H" + deviceNumber + "xx" : "STM32H7xx";
  const expectedDefines = [core === "cm7" ? "CORE_CM7" : "CORE_CM4", deviceDefine, "USE_HAL_DRIVER"];
  const compileOptions = [
    ...expectedFlags,
  ];
  const coreText = files.filter((file) => belongsToCore(path.relative(root, file), core) && /(?:CMakeLists\.txt|\.cmake|\.cproject)$/i.test(path.basename(file)))
    .map((file) => readText(file, 256 * 1024)).join("\n");
  const coreCmake = cmakePath ? inspectCmake(path.dirname(cmakePath), files) : cmake;
  const settingsText = `${coreText}\n${coreCmake.flags.join(" ")}\n${coreCmake.definitions.join(" ")}`;
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
    sources: cubeIde?.sources || [],
    headers: cubeIde?.headers || [],
    includeDirectories: cubeIde?.resolvedIncludePaths || [],
    definitions: cubeIde?.definitions || [],
    compileOptions,
    missingFlags: cubeIde?.fpu && cubeIde.floatAbi ? [] : expectedFlags.filter((flag) => !settingsText.includes(flag)),
    missingDefines: expectedDefines.filter((define) => define !== "USE_HAL_DRIVER" && !new RegExp(`\\b${define.replace(/x/g, "[xX]")}\\b`).test(settingsText)),
  };
}

export function inspectTargetArchitecture(
  root: string,
  scan: ProjectScan,
  cmake: CmakeInspection,
  configuredCubeH7Root = "",
): Qc1TargetArchitecture {
  const files = scan.files;
  const evidence: string[] = [];
  const evidenceFiles = files.filter((file) =>
    /(?:CMakeLists\.txt|\.cmake|\.ioc|\.cproject|\.project|\.ld|startup.*\.(?:s|asm)|stm32.*\.h)$/i.test(path.basename(file)),
  ).slice(0, 160);
  const evidenceText = evidenceFiles.map((file) => `${path.relative(root, file)}\n${readText(file, 128 * 1024)}`).join("\n");
  const searchable = `${root}\n${evidenceText}\n${cmake.definitions.join(" ")}\n${cmake.flags.join(" ")}`;

  const h7Matches = searchable.match(/(?:NUCLEO[-_ ]?H(?:745|747|755|757)ZI[-_ ]?Q|STM32H7\d{2}[A-Z0-9x]*)/gi) || [];
  const h755Matches = h7Matches.filter((match) => /H755/i.test(match));
  const f1Matches = searchable.match(/STM32F(?:1|103)[A-Z0-9x]*/gi) || [];
  const cubeIde = inspectCubeIdeProject(root, files);
  if (h7Matches.length) evidence.push(...h7Matches.slice(0, 12).map((match) => match.toUpperCase()));
  if (f1Matches.length) evidence.push(...f1Matches.slice(0, 12).map((match) => match.toUpperCase()));
  const family: Qc1McuFamily = h755Matches.length ? "stm32h755" : h7Matches.length ? "stm32h7" : f1Matches.length ? "stm32f1" : "unknown";
  const boardMatch = searchable.match(/NUCLEO[-_ ]?H(?:745|747|755|757)ZI[-_ ]?Q/i);
  const board = boardMatch?.[0].replace(/[_ ]/g, "-").toUpperCase() || "unknown";
  const deviceMatch = searchable.match(/STM32H7\d{2}[A-Z0-9x]*/i);
  const cubeMcu = cubeIde.cm7?.mcu || cubeIde.cm4?.mcu || "";
  const device = isStm32H7Family(family) ? (cubeMcu || deviceMatch?.[0].toUpperCase() || (family === "stm32h755" ? "STM32H755" : "STM32H7"))
    : family === "stm32f1" ? (f1Matches[0]?.toUpperCase() || "STM32F1") : "unknown";

  const hasCm7 = isStm32H7Family(family) && (cubeIde.cm7 !== undefined || files.some((file) => belongsToCore(path.relative(root, file), "cm7")) || /\bCORE_CM7\b/i.test(searchable));
  const hasCm4 = isStm32H7Family(family) && (cubeIde.cm4 !== undefined || files.some((file) => belongsToCore(path.relative(root, file), "cm4")) || /\bCORE_CM4\b/i.test(searchable));
  const dualDevice = /^STM32H(?:745|747|755|757)/i.test(device);
  const coreMode: Qc1CoreMode = family === "stm32f1" ? "single"
    : hasCm7 && hasCm4 ? "dual"
      : hasCm7 ? (dualDevice ? "cm7" : "single")
        : hasCm4 && dualDevice ? "cm4" : "unknown";
  const iocPath = files.find((file) => /\.ioc$/i.test(file)) || "";
  const cubeRootOptions = cubeRootCandidates(root, files, configuredCubeH7Root);
  const cubeH7Root = cubeRootOptions.find((candidate) =>
    fs.existsSync(path.join(candidate, "Drivers", "STM32H7xx_HAL_Driver")) ||
    fs.existsSync(path.join(candidate, "Drivers", "CMSIS", "Device", "ST", "STM32H7xx")),
  ) || (configuredCubeH7Root ? path.resolve(configuredCubeH7Root) : "");
  const component = (segments: string[]): string => directoryBySegments(root, files, segments) ||
    (cubeH7Root ? existingDirectory([path.join(cubeH7Root, ...segments)]) : "");
  const halPath = component(["Drivers", "STM32H7xx_HAL_Driver"]);
  const cmsisPath = component(["Drivers", "CMSIS"]);
  const cmsisDevicePath = component(["Drivers", "CMSIS", "Device", "ST", "STM32H7xx"]);
  const bspPath = component(["Drivers", "BSP", "STM32H7xx_Nucleo"]);
  const deviceNumber = device.match(/^STM32H(7\d{2})/i)?.[1];
  const deviceHeaderPath = cmsisDevicePath && deviceNumber
    ? path.join(cmsisDevicePath, "Include", "stm32h" + deviceNumber.toLowerCase() + "xx.h")
    : "";
  const bspUsageText = files.filter((file) => /\.(?:c|cc|cpp|h|hpp)$/i.test(file) && !file.includes(`${path.sep}Drivers${path.sep}BSP${path.sep}`))
    .slice(0, 200).map((file) => readText(file, 64 * 1024)).join("\n");
  const bspRequired = /stm32h7xx_nucleo(?:_conf)?\.h|BSP_[A-Za-z0-9_]+\s*\(/i.test(bspUsageText);
  const cm7 = coreInspection(root, files, cmake, "cm7", hasCm7, device, cubeIde.cm7);
  const cm4 = coreInspection(root, files, cmake, "cm4", hasCm4, device, cubeIde.cm4);
  const rootCmake = fileByBasename(files.filter((file) => path.dirname(file) === root), "CMakeLists.txt");
  if (hasCm7 && !hasCm4 && !cm7.cmakePath) cm7.cmakePath = rootCmake;
  if (hasCm4 && !hasCm7 && !cm4.cmakePath) cm4.cmakePath = rootCmake;

  return {
    family,
    device,
    board,
    coreMode,
    openOcdTarget: isStm32H7Family(family) ? "target/stm32h7x.cfg" : "target/stm32f1x.cfg",
    evidence: [...new Set(evidence)],
    iocPath,
    halPath,
    cmsisPath,
    cmsisDevicePath,
    deviceHeaderPath,
    bspPath,
    cubeH7Root,
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
