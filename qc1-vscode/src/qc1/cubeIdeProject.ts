import * as fs from "fs";
import * as path from "path";
import { readText } from "./filesystem";

export type CubeIdeCoreId = "cm7" | "cm4";

export interface CubeIdeCoreProject {
  core: CubeIdeCoreId;
  projectFile: string;
  mcu: string;
  board: string;
  fpu: string;
  floatAbi: string;
  includePaths: string[];
  resolvedIncludePaths: string[];
  definitions: string[];
  sources: string[];
  headers: string[];
  startupCandidates: string[];
  linkerCandidates: string[];
}

function decodeXml(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();
}

function attribute(tag: string, name: string): string {
  const match = tag.match(new RegExp("(?:^|\\s)" + name + "\\s*=\\s*\"([^\"]*)\"", "i"));
  return match ? decodeXml(match[1]) : "";
}

function optionBlocks(xml: string): Array<{ tag: string; body: string }> {
  const blocks: Array<{ tag: string; body: string }> = [];
  const pattern = /<option\b([^>]*?)(?:\/>|>([\s\S]*?)<\/option\s*>)/gi;
  for (const match of xml.matchAll(pattern)) blocks.push({ tag: match[1], body: match[2] || "" });
  return blocks;
}

function optionValues(xml: string, superClass: RegExp): string[] {
  const values: string[] = [];
  for (const block of optionBlocks(xml)) {
    if (!superClass.test(attribute(block.tag, "superClass"))) continue;
    const own = attribute(block.tag, "value");
    if (own) values.push(own);
    for (const match of block.body.matchAll(/<listOptionValue\b([^>]*?)\/?\s*>/gi)) {
      const value = attribute(match[1], "value");
      if (value) values.push(value);
    }
  }
  return [...new Set(values.map(decodeXml).filter(Boolean))];
}

function coreInPath(root: string, file: string): CubeIdeCoreId | undefined {
  const segments = path.relative(root, file).replace(/\\/g, "/").split("/");
  const has = (core: string): boolean => segments.some((segment) => segment.toLowerCase() === core);
  if (has("cm7")) return "cm7";
  if (has("cm4")) return "cm4";
  return undefined;
}

function resolveIncludePath(root: string, projectFile: string, value: string): string {
  if (path.isAbsolute(value)) return path.normalize(value);
  const projectDirectory = path.dirname(projectFile);
  const candidates = [
    path.resolve(projectDirectory, "Debug", value),
    path.resolve(projectDirectory, "Release", value),
    path.resolve(root, value),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) || candidates[0];
}

function coreProject(root: string, core: CubeIdeCoreId, projectFile: string, files: string[]): CubeIdeCoreProject {
  const xml = readText(projectFile, 2 * 1024 * 1024);
  const includes = optionValues(xml, /compiler\.option\.includepaths/i);
  const definitions = optionValues(xml, /compiler\.option\.definedsymbols/i)
    .map((value) => value.replace(/^-D/, "").trim()).filter(Boolean);
  const mcu = optionValues(xml, /target_mcu/i).find((value) => /^STM32H?\d/i.test(value)) ||
    xml.match(/STM32H(?:7\d{2}|755|757)[A-Z0-9x]*/i)?.[0] || "";
  const board = optionValues(xml, /target_board/i).find((value) => /NUCLEO/i.test(value)) ||
    xml.match(/NUCLEO[-_ ]?H\d{3}ZI[-_ ]?Q/i)?.[0] || "";
  const fpuValue = optionValues(xml, /target_fpu|\.fpu/i).join(" ");
  const abiValue = optionValues(xml, /floatabi|float_abi/i).join(" ");
  const fpu = fpuValue.match(/fpv(?:4-sp-d16|5-d16)/i)?.[0]?.toLowerCase() ||
    xml.match(/fpv(?:4-sp-d16|5-d16)/i)?.[0]?.toLowerCase() || "";
  const allOptionValues = optionBlocks(xml).map((block) => attribute(block.tag, "value")).join(" ");
  const floatAbi = abiValue.match(/(?:^|[. _-])(hard|softfp|soft)(?:$|[. _-])/i)?.[1]?.toLowerCase() ||
    allOptionValues.match(/(?:^|[. _-])(hard|softfp|soft)(?:$|[. _-])/i)?.[1]?.toLowerCase() || "";

  const candidates = files.filter((file) => /\.(?:c|cc|cpp|cxx|s|asm)$/i.test(file));
  const sources = candidates.filter((file) => {
    const relative = path.relative(root, file).replace(/\\/g, "/");
    const owner = coreInPath(root, file);
    if (/(?:^|\/)MDK-ARM(?:\/|$)/i.test(relative)) return false;
    return owner === core || /(?:^|\/)Common(?:\/|$)/i.test(relative);
  });
  const headers = files.filter((file) => {
    if (!/\.(?:h|hpp|hh)$/i.test(file)) return false;
    const relative = path.relative(root, file).replace(/\\/g, "/");
    const owner = coreInPath(root, file);
    return owner === core || /(?:^|\/)Common(?:\/|$)/i.test(relative);
  });
  const startupCandidates = candidates.filter((file) => /^startup(?:_.*)?\.(?:s|asm)$/i.test(path.basename(file)) && coreInPath(root, file) === core);
  const flashLinkers = files.filter((file) => /\.ld$/i.test(file) && coreInPath(root, file) === core && /flash/i.test(path.basename(file)) && !/sram|ram/i.test(path.basename(file)));
  const linkerCandidates = flashLinkers.length ? flashLinkers : files.filter((file) => /\.ld$/i.test(file) && coreInPath(root, file) === core && !/sram|ram/i.test(path.basename(file)));
  const resolvedIncludePaths = [...new Set(includes.map((value) => resolveIncludePath(root, projectFile, value)))];
  for (const directory of [path.join(root, core.toUpperCase(), "Inc"), path.join(root, "Common", "Inc")]) {
    if (fs.existsSync(directory) && !resolvedIncludePaths.includes(directory)) resolvedIncludePaths.push(directory);
  }
  return {
    core, projectFile, mcu, board, fpu, floatAbi, includePaths: includes,
    resolvedIncludePaths, definitions: [...new Set(definitions)], sources: [...new Set([...sources, ...startupCandidates])],
    headers, startupCandidates, linkerCandidates,
  };
}

/** Read CubeIDE's per-core project settings without requiring CubeIDE or changing the project. */
export function inspectCubeIdeProject(root: string, files: string[]): Partial<Record<CubeIdeCoreId, CubeIdeCoreProject>> {
  const result: Partial<Record<CubeIdeCoreId, CubeIdeCoreProject>> = {};
  for (const core of ["cm7", "cm4"] as const) {
    const projectFiles = files.filter((file) => path.basename(file).toLowerCase() === ".cproject" && coreInPath(root, file) === core);
    if (projectFiles.length !== 1) continue;
    result[core] = coreProject(root, core, projectFiles[0], files);
  }
  return result;
}
