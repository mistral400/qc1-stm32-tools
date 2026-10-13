/** Resolve core builds from generated CMake metadata, never from unevaluated CMake expressions. */
import * as fs from "fs";
import * as path from "path";
import { ConfiguredTarget, readFileApi } from "./cmakeFileApi";
import { inside, readText } from "./filesystem";
import type { Qc1Core, Qc1TargetArchitecture } from "./targetArchitecture";

export function resolvedTargetName(name: string): boolean {
  return Boolean(name.trim()) && !/[$<>\r\n\u0000]/.test(name);
}

export function pathMatchesCore(value: string, core: Qc1Core): boolean {
  return new RegExp(`(?:^|[\\\\/_ .-])${core}(?:[\\\\/_ .-]|$)`, "i").test(value);
}

function artifactMatchesCore(file: string, core: Qc1Core): boolean {
  // Ignore arbitrary project ancestors (a workspace can itself be named CM4).
  return file.replace(/\\/g, "/").split("/").slice(-3).some(segment => pathMatchesCore(segment, core));
}

export function targetMatchesCore(target: ConfiguredTarget, core: Qc1Core): boolean {
  const other = core === "cm7" ? "cm4" : "cm7";
  // A CPU define must not override contradictory target/artifact ownership.
  if (pathMatchesCore(target.name, other) || target.artifacts.some(file => artifactMatchesCore(file, other))) return false;
  const settings = [...target.definitions, ...target.fragments].join(" ");
  const explicit = (which: Qc1Core): boolean => new RegExp(`\\bCORE_${which}\\b|\\bcortex-m${which.slice(-1)}\\b`, "i").test(settings);
  if (explicit(other)) return false;
  if (explicit(core)) return true;
  return pathMatchesCore(target.name, core) || target.artifacts.some(file => artifactMatchesCore(file, core)) ||
    (target.sources.some(value => artifactMatchesCore(value, core)) && !target.sources.some(value => artifactMatchesCore(value, other)));
}

export function configuredCoreTarget(targets: ConfiguredTarget[], core: Qc1Core): string {
  const names = [...new Set(targets.filter(target =>
    ["EXECUTABLE", "UTILITY"].includes(target.type) && resolvedTargetName(target.name) && targetMatchesCore(target, core)
  ).map(target => target.name))];
  const exact = names.filter(name => new RegExp(`(?:^|[_ .-])${core}$`, "i").test(name));
  const candidates = exact.length ? exact : names;
  return candidates.length === 1 ? candidates[0] : "";
}

export function coreBuildArguments(args: string[], targets: ConfiguredTarget[], core: Qc1Core): string[] {
  const target = configuredCoreTarget(targets, core);
  if (!target) throw new Error(`Cible CMake ${core.toUpperCase()} absente ou ambiguë après configuration.`);
  const result = [...args];
  const index = result.indexOf("--target");
  if (index >= 0) result.splice(index, 2);
  return [...result, "--target", target];
}

function cacheValues(build: string): Record<string, string> {
  return Object.fromEntries(readText(path.join(build, "CMakeCache.txt"), 2 * 1024 * 1024)
    .split(/\r?\n/).flatMap(line => {
      const match = line.match(/^([^/#][^:]*):[^=]+=(.*)$/);
      return match ? [[match[1], match[2]]] : [];
    }));
}

/** Bounded fallback for nested ExternalProject caches; source trees and symlinks are not followed. */
function nestedCaches(roots: string[]): string[] {
  const builds = new Set<string>();
  let remaining = 1600;
  const seen = new Set<string>();
  const walk = (directory: string, depth: number): void => {
    if (!directory || depth > 6 || remaining <= 0 || seen.has(directory)) return;
    seen.add(directory);
    try {
      if (fs.existsSync(path.join(directory, "CMakeCache.txt"))) builds.add(directory);
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (--remaining <= 0) break;
        if (entry.isDirectory() && !/^(?:\.git|\.cmake|CMakeFiles|node_modules|Drivers|Middlewares|Core)$/i.test(entry.name)) walk(path.join(directory, entry.name), depth + 1);
      }
    } catch { /* Not configured yet. */ }
  };
  for (const root of roots) walk(root, 0);
  return [...builds];
}

export interface CoreBuildMetadata {
  buildTargets: ConfiguredTarget[];
  artifactTargets: ConfiguredTarget[];
  compileCommands: Record<Qc1Core, string[]>;
}

export function readCoreBuildMetadata(root: string, build: string, configuration: string): CoreBuildMetadata {
  const active = (target: ConfiguredTarget): boolean => !target.configuration || target.configuration === configuration;
  const buildTargets = readFileApi(build, root).targets.filter(active);
  const result: CoreBuildMetadata = { buildTargets, artifactTargets: [...buildTargets], compileCommands: { cm7: [], cm4: [] } };
  const rootCache = cacheValues(build);
  const cacheArtifacts: string[] = [];
  const cacheTargets: ConfiguredTarget[] = [];
  const fallbackTargets: ConfiguredTarget[] = [];
  if (path.resolve(rootCache.CMAKE_HOME_DIRECTORY || ".") === path.resolve(root) && (!rootCache.CMAKE_BUILD_TYPE || rootCache.CMAKE_BUILD_TYPE === configuration)) {
    for (const core of ["cm7", "cm4"] as const) {
      // CubeMX exports these paths independently of project name and BINARY_DIR.
      const artifact = rootCache[`ST_DUAL_CORE_${core.toUpperCase()}_PROJECT_BUILD_TARGET`];
      if (artifact && path.isAbsolute(artifact) && /\.elf$/i.test(artifact)) {
        cacheArtifacts.push(artifact);
        cacheTargets.push({ name: path.basename(artifact, ".elf"), configuration, type: "EXECUTABLE", artifacts: [artifact], sources: [], includes: [], definitions: [`CORE_${core.toUpperCase()}`], fragments: [] });
      }
    }
  }
  const builds = new Set([build, ...cacheArtifacts.map(file => path.dirname(file)), ...nestedCaches([build, root])]);
  for (const directory of builds) {
    const cache = cacheValues(directory);
    const source = cache.CMAKE_HOME_DIRECTORY;
    if (!source || !inside(root, source) || (cache.CMAKE_BUILD_TYPE && cache.CMAKE_BUILD_TYPE !== configuration)) continue;
    if (directory !== build) result.artifactTargets.push(...readFileApi(directory, source).targets.filter(active));
    try {
      const commands: unknown = JSON.parse(readText(path.join(directory, "compile_commands.json"), 8 * 1024 * 1024));
      if (!Array.isArray(commands)) continue;
      for (const command of commands.slice(0, 4000)) {
        const text = Array.isArray(command.arguments) ? command.arguments.join(" ") : command.command;
        if (typeof text !== "string") continue;
        for (const core of ["cm7", "cm4"] as const) {
          const target: ConfiguredTarget = { name: source, configuration, type: "EXECUTABLE", artifacts: [], sources: [], includes: [], definitions: [], fragments: [text] };
          if (targetMatchesCore(target, core)) result.compileCommands[core].push(text);
        }
      }
    } catch { /* Prefer File API; compile_commands is optional. */ }
    // File API is not requested by every external project. Accept only unique,
    // core-labelled ELF files in a cache belonging to this source/configuration.
    if (directory !== build) {
      try {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true }).slice(0, 500)) {
          if (!entry.isFile() || !/\.elf$/i.test(entry.name)) continue;
          fallbackTargets.push({ name: entry.name, configuration, type: "EXECUTABLE", artifacts: [path.join(directory, entry.name)], sources: [], includes: [], definitions: [], fragments: [] });
        }
      } catch { /* No outputs yet. */ }
    }
  }
  for (const core of ["cm7", "cm4"] as const) {
    if (result.artifactTargets.some(target => target.type === "EXECUTABLE" && target.artifacts.length && targetMatchesCore(target, core))) continue;
    const cached = cacheTargets.filter(target => targetMatchesCore(target, core));
    result.artifactTargets.push(...(cached.length ? cached : fallbackTargets.filter(target => targetMatchesCore(target, core))));
  }
  return result;
}

export function configuredCoreArtifact(metadata: CoreBuildMetadata, core: Qc1Core, explicit = ""): string {
  const other = core === "cm7" ? "cm4" : "cm7";
  const targets = metadata.artifactTargets.filter(target => target.type === "EXECUTABLE");
  const belongs = (file: string): boolean => {
    const owners = targets.filter(target => target.artifacts.includes(file));
    if (owners.some(target => targetMatchesCore(target, other)) || artifactMatchesCore(file, other)) return false;
    return owners.some(target => targetMatchesCore(target, core));
  };
  if (explicit) return /\.elf$/i.test(explicit) && belongs(explicit) ? explicit : "";
  const candidates = [...new Set(targets.filter(target => targetMatchesCore(target, core)).flatMap(target => target.artifacts))]
    .filter(file => /\.elf$/i.test(file) && belongs(file) && fs.existsSync(file));
  return candidates.length === 1 ? candidates[0] : "";
}

/** Effective compiler options override static hints, including evidence of missing flags. */
export function applyCoreBuildMetadata(architecture: Qc1TargetArchitecture, metadata: CoreBuildMetadata): void {
  for (const core of ["cm7", "cm4"] as const) {
    const inspection = architecture[core];
    inspection.targetName = configuredCoreTarget(metadata.buildTargets, core) || inspection.targetName;
    const targets = metadata.artifactTargets.filter(target => targetMatchesCore(target, core) || pathMatchesCore(target.name, core));
    const commands = targets.flatMap(target => target.compileFragments || []);
    const effective = commands.length ? commands : metadata.compileCommands[core];
    if (effective.length) {
      inspection.missingFlags = inspection.expectedFlags.filter(flag => !effective.every(command =>
        command.split(/[\s"']+/).includes(flag)));
      const definitions = [...targets.flatMap(target => target.definitions), ...effective].join(" ");
      inspection.missingDefines = inspection.expectedDefines.filter(define => define !== "USE_HAL_DRIVER" && !definitions.includes(define));
    }
  }
}
