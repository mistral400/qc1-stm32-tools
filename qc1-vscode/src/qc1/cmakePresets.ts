/** Minimal, non-executing CMakePresets reader for generated CubeMX projects. */
import * as fs from "fs";
import * as path from "path";

type Preset = {
  name?: unknown;
  hidden?: unknown;
  inherits?: unknown;
  configurePreset?: unknown;
  binaryDir?: unknown;
};

export interface Qc1CmakePresetSelection {
  file: string;
  configurePreset: string;
  buildPreset: string;
  binaryDir: string;
}

function presets(value: unknown): Preset[] {
  return Array.isArray(value) ? value.filter((item): item is Preset => Boolean(item && typeof item === "object")) : [];
}

function names(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function inspectCmakePresets(
  root: string,
  buildType: string,
  requested = "",
): Qc1CmakePresetSelection | undefined {
  const file = ["CMakePresets.json", "CMakeUserPresets.json"]
    .map((name) => path.join(root, name))
    .find((candidate) => fs.existsSync(candidate));
  if (!file) return undefined;
  let document: Record<string, unknown>;
  try {
    document = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const configure = presets(document.configurePresets);
  const build = presets(document.buildPresets);
  const equals = (value: unknown, expected: string): boolean => typeof value === "string" && value.toLowerCase() === expected.toLowerCase();
  const requestedName = requested.trim();
  let buildPreset = build.find((preset) => equals(preset.name, requestedName || buildType));
  let configureName = typeof buildPreset?.configurePreset === "string" ? buildPreset.configurePreset : "";
  if (!configureName) {
    const direct = configure.find((preset) => equals(preset.name, requestedName || buildType) && preset.hidden !== true)
      || configure.find((preset) => equals(preset.name, "default") && preset.hidden !== true);
    configureName = typeof direct?.name === "string" ? direct.name : "";
  }
  if (!configureName) return undefined;
  const configurePreset = configure.find((preset) => preset.name === configureName);
  if (!configurePreset) return undefined;
  if (!buildPreset) buildPreset = build.find((preset) => preset.configurePreset === configureName);
  const inherited = new Map(configure.filter((preset) => typeof preset.name === "string").map((preset) => [preset.name as string, preset]));
  const binary = (preset: Preset, seen = new Set<string>()): string => {
    if (typeof preset.binaryDir === "string") return preset.binaryDir;
    for (const parentName of names(preset.inherits)) {
      if (seen.has(parentName)) continue;
      seen.add(parentName);
      const parent = inherited.get(parentName);
      if (parent) {
        const value = binary(parent, seen);
        if (value) return value;
      }
    }
    return "";
  };
  const rawBinary = binary(configurePreset) || "${sourceDir}/build/${presetName}";
  const binaryDir = path.resolve(rawBinary
    .replace(/\$\{sourceDir\}/g, root)
    .replace(/\$\{sourceParentDir\}/g, path.dirname(root))
    .replace(/\$\{sourceDirName\}/g, path.basename(root))
    .replace(/\$\{presetName\}/g, configureName));
  return {
    file,
    configurePreset: configureName,
    buildPreset: typeof buildPreset?.name === "string" ? buildPreset.name : "",
    binaryDir,
  };
}
