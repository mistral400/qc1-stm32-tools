/** Bounded, static-only STM32 project discovery for future UI consumers. */
import * as fs from "fs/promises";
import * as path from "path";
import { parseCmake } from "./cmakeInspection";

export type ProjectArchitecture = "single-core" | "dual-core" | "unknown";
export type ProjectBuildSystem = "make" | "cmake" | "mixed" | "unknown";
export type ProjectCoreId = "cortex-m3" | "cm7" | "cm4";
export type DiagnosticSeverity = "error" | "warning" | "optional";

export interface DetectionEvidence {
  type:
    | "board"
    | "build-system"
    | "core"
    | "cpu"
    | "fpu"
    | "ioc"
    | "linker"
    | "linker-memory"
    | "mcu-define"
    | "mcu-reference"
    | "startup"
    | "system";
  file: string;
  value: string;
  weight: number;
  influence: "positive" | "context";
}

export interface ProjectCore {
  id: ProjectCoreId;
  name: "Cortex-M3" | "Cortex-M7" | "Cortex-M4";
  cpu: "cortex-m3" | "cortex-m7" | "cortex-m4";
  confidence: number;
  startupFiles: string[];
  linkerScripts: string[];
  evidence: DetectionEvidence[];
}

export interface MissingComponent {
  component: "startup" | "linker" | "HAL" | "CMSIS" | "CM4" | "CM7";
  severity: DiagnosticSeverity;
  message: string;
  referencedBy?: string;
  expectedPath?: string;
}

export interface Diagnostic {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  file?: string;
}

export interface ProjectCandidate {
  path: string;
  name: string;
  family?: string;
  mcu?: string;
  board?: string;
  architecture: ProjectArchitecture;
  cores: ProjectCore[];
  buildSystem: ProjectBuildSystem;
  confidence: number;
  evidence: DetectionEvidence[];
  missingComponents: MissingComponent[];
  warnings: Diagnostic[];
}

export interface ProjectAnalysisOptions {
  maxDepth?: number;
  maxFiles?: number;
  maxAnalyzedFiles?: number;
  minConfidence?: number;
  signal?: AbortSignal;
}

export interface DiscoverProjectsOptions extends ProjectAnalysisOptions {
  roots: string[];
  maxProjects?: number;
}

interface Inventory {
  files: string[];
  truncated: boolean;
}

interface FileRecord {
  file: string;
  text: string;
}

interface McuObservation {
  value: string;
  family: string;
  weight: number;
}

interface FileReference {
  kind: "startup" | "linker";
  value: string;
  file: string;
}

const DEFAULT_MAX_DEPTH = 10;
const DEFAULT_MAX_FILES = 4000;
const DEFAULT_MAX_ANALYZED_FILES = 300;
const DEFAULT_MIN_CONFIDENCE = 40;
const DEFAULT_MAX_PROJECTS = 20;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;

const ignoredDirectories = new Set([
  ".git",
  ".vscode",
  ".vscode-test",
  ".cache",
  ".pio",
  "node_modules",
  "build",
  "out",
  "dist",
  "coverage",
  "cache",
  "__pycache__",
  ".trash",
  ".trashes",
  ".spotlight-v100",
]);

const mcuRules: Array<{ family: string; matcher: RegExp; prefix: RegExp }> = [
  {
    family: "STM32F1",
    matcher: /STM32F103(?:C8T6|CBT6|C8|CB|[xX]B)?(?![A-Za-z0-9])/gi,
    prefix: /^STM32F103/i,
  },
  {
    family: "STM32H7",
    matcher: /STM32H755(?:ZIT6|ZIT[xX]|ZI|[xX]{2})?(?![A-Za-z0-9])/gi,
    prefix: /^STM32H755/i,
  },
];

function abortIfRequested(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("STM32 project scan cancelled");
  error.name = "AbortError";
  throw error;
}

function canonicalMcu(value: string): string {
  return value
    .toUpperCase()
    .replace(/STM32F103XB$/, "STM32F103xB")
    .replace(/STM32H755XX$/, "STM32H755xx")
    .replace(/STM32H755ZITX$/, "STM32H755ZITx");
}

function mcuFamily(value: string): string | undefined {
  return mcuRules.find((rule) => rule.prefix.test(value))?.family;
}

function findMcus(text: string): string[] {
  const values: string[] = [];
  for (const { matcher } of mcuRules) {
    matcher.lastIndex = 0;
    for (const match of text.matchAll(matcher)) values.push(canonicalMcu(match[0]));
  }
  return [...new Set(values)];
}

function coreFromText(value: string): "CM7" | "CM4" | undefined {
  if (/(?:CORE[_-]?CM7|cortex-m7|(?:^|[/_.-])CM7(?:[/_.-]|$))/i.test(value)) return "CM7";
  if (/(?:CORE[_-]?CM4|cortex-m4|(?:^|[/_.-])CM4(?:[/_.-]|$))/i.test(value)) return "CM4";
  return undefined;
}

function filePriority(file: string): number {
  const name = path.basename(file);
  if (/^(?:Makefile|CMakeLists\.txt)$/i.test(name)) return 0;
  if (/\.mk$|CMakePresets\.json$|\.cmake$/i.test(name)) return 1;
  if (/^startup_stm32.*\.[sS]$|\.ld$|\.ioc$/i.test(name)) return 2;
  if (/^system_stm32.*\.c$/i.test(name)) return 3;
  if (/\.(?:h|hpp)$/i.test(name)) return 4;
  if (/\.(?:c|cc|cpp|cxx|s|S|asm)$/i.test(name)) return 5;
  return 20;
}

function isRelevant(file: string): boolean {
  return filePriority(file) < 20;
}

function withoutInactiveComments(text: string, buildFile: boolean): string {
  if (buildFile)
    return text
      .replace(/#\[(=*)\[[\s\S]*?\]\1\]/g, "")
      .replace(/#.*$/gm, "");
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

async function inventoryRoot(
  root: string,
  options: ProjectAnalysisOptions,
): Promise<Inventory> {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const files: string[] = [];
  const queue: Array<{ directory: string; depth: number }> = [
    { directory: root, depth: 0 },
  ];
  let entriesSeen = 0;
  let truncated = false;
  while (queue.length) {
    abortIfRequested(options.signal);
    const current = queue.shift();
    if (!current) break;
    if (current.depth > maxDepth) {
      truncated = true;
      continue;
    }
    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(current.directory, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      abortIfRequested(options.signal);
      entriesSeen++;
      if (entriesSeen > maxFiles) {
        truncated = true;
        break;
      }
      const entryPath = path.join(current.directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (
          ignoredDirectories.has(entry.name.toLowerCase()) ||
          /^cmake-build-/i.test(entry.name)
        )
          continue;
        queue.push({ directory: entryPath, depth: current.depth + 1 });
      } else if (entry.isFile()) {
        files.push(entryPath);
      }
      if (entriesSeen % 64 === 0)
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
    if (entriesSeen > maxFiles) break;
  }
  return { files, truncated };
}

async function readRelevantFiles(
  inventory: Inventory,
  options: ProjectAnalysisOptions,
): Promise<FileRecord[]> {
  const maxAnalyzed = options.maxAnalyzedFiles ?? DEFAULT_MAX_ANALYZED_FILES;
  const relevant = inventory.files.filter(isRelevant).sort((left, right) => left.localeCompare(right));
  const critical = relevant.filter((file) => filePriority(file) <= 3).slice(0, maxAnalyzed);
  const remaining = Math.max(0, maxAnalyzed - critical.length);
  const applicationFirst = (left: string, right: string): number => {
    const vendor = (file: string): number => /[/\\](?:Drivers|Middlewares|third[_-]?party)[/\\]/i.test(file) ? 1 : 0;
    return vendor(left) - vendor(right) || left.localeCompare(right);
  };
  const headers = relevant
    .filter((file) => filePriority(file) === 4)
    .sort(applicationFirst)
    .slice(0, Math.floor(remaining / 2));
  const sources = relevant
    .filter((file) => filePriority(file) === 5)
    .sort(applicationFirst)
    .slice(0, remaining - headers.length);
  const selected = [...critical, ...headers, ...sources];
  const records: FileRecord[] = [];
  let totalBytes = 0;
  for (const file of selected) {
    abortIfRequested(options.signal);
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES || totalBytes + stat.size > MAX_TOTAL_BYTES)
        continue;
      records.push({ file, text: await fs.readFile(file, "utf8") });
      totalBytes += stat.size;
    } catch {
      // Files can disappear or become unreadable during a scan; partial evidence is safe.
    }
    if (records.length % 32 === 0)
      await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return records;
}

function makeVariables(text: string): Record<string, string> {
  const variables: Record<string, string> = {};
  const logical = withoutInactiveComments(text, true).replace(/\\\r?\n/g, " ");
  for (const line of logical.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?::=|\?=|\+=|=)\s*(.*?)\s*$/);
    if (!match) continue;
    variables[match[1]] = match[2];
  }
  return variables;
}

function expandKnownVariables(value: string, variables: Record<string, string>): string {
  let expanded = value;
  for (let pass = 0; pass < 8; pass++) {
    const next = expanded.replace(/\$\(([^)]+)\)|\$\{([^}]+)\}/g, (whole, round: string, curly: string) => {
      const replacement = variables[round || curly];
      return replacement === undefined ? whole : replacement;
    });
    if (next === expanded || next.length > 65536) break;
    expanded = next;
  }
  return expanded;
}

function cleanPathToken(value: string): string {
  return value
    .replace(/^["']|["']$/g, "")
    .replace(/^[A-Za-z_][A-Za-z0-9_]*(?:\+|\?|:)?=/, "")
    .replace(/^--script=/, "")
    .replace(/^-T/, "")
    .replace(/^[(-]+/, "")
    .replace(/[),]+$/, "");
}

function referenceFromToken(
  token: string,
  file: string,
): FileReference | undefined {
  const value = cleanPathToken(token);
  if (/\$|[<>]/.test(value)) return undefined;
  const kind = /^startup_stm32.*\.[sS]$/i.test(path.basename(value))
    ? "startup"
    : /\.ld$/i.test(value)
      ? "linker"
      : undefined;
  return kind ? { kind, value, file } : undefined;
}

function makeReferences(record: FileRecord): FileReference[] {
  const variables = makeVariables(record.text);
  const expanded = expandKnownVariables(
    withoutInactiveComments(record.text, true).replace(/\\\r?\n/g, " "),
    variables,
  );
  const rawTokens = [...expanded.matchAll(/"([^"]+)"|'([^']+)'|([^\s,;]+)/g)].map(
    (match) => match[1] || match[2] || match[3],
  );
  const references: FileReference[] = [];
  for (let index = 0; index < rawTokens.length; index++) {
    const token = rawTokens[index];
    const combined = token === "-T" || token === "--script" ? rawTokens[++index] || "" : token;
    const reference = referenceFromToken(combined, record.file);
    if (reference) references.push(reference);
  }
  return references;
}

function cmakeData(record: FileRecord): {
  name?: string;
  references: FileReference[];
  invalid: boolean;
} {
  const parsed = parseCmake(record.text);
  const variables: Record<string, string> = {};
  const references: FileReference[] = [];
  let name: string | undefined;
  for (const command of parsed.commands) {
    if (command.name === "set" && command.args[0])
      variables[command.args[0]] = command.args.slice(1).join(";");
    const args = command.args.flatMap((argument) =>
      expandKnownVariables(argument, variables).split(";").filter(Boolean),
    );
    if (command.name === "project" && args[0] && !name) name = args[0];
    for (let index = 0; index < args.length; index++) {
      const token = args[index];
      const combined = token === "-T" || token === "--script" ? args[++index] || "" : token;
      const reference = referenceFromToken(combined, record.file);
      if (reference) references.push(reference);
    }
  }
  return { name, references, invalid: parsed.invalid };
}

function linkerMemory(text: string): string[] {
  const memory = text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .match(/\bMEMORY\s*\{([^}]+)\}/i)?.[1];
  if (!memory) return [];
  return [...memory.matchAll(/([A-Za-z_]\w*)\s*(?:\([^)]*\))?\s*:\s*ORIGIN\s*=\s*([^,\n]+),\s*LENGTH\s*=\s*([^\n}]+)/gi)].map(
    (match) => `${match[1]} ORIGIN=${match[2].trim()} LENGTH=${match[3].trim()}`,
  );
}

function selectMcu(
  observations: McuObservation[],
  warnings: Diagnostic[],
  root: string,
): { family?: string; mcu?: string } {
  const familyScores = new Map<string, number>();
  for (const item of observations)
    familyScores.set(item.family, (familyScores.get(item.family) || 0) + item.weight);
  const rankedFamilies = [...familyScores].sort((left, right) => right[1] - left[1]);
  if (!rankedFamilies.length) return {};
  if (rankedFamilies.length > 1) {
    warnings.push({
      code: "QC1-SCAN-MCU-CONFLICT",
      severity: "warning",
      message: `Preuves MCU de familles incompatibles: ${rankedFamilies.map(([family]) => family).join(", ")}.`,
      file: root,
    });
    if (rankedFamilies[0][1] === rankedFamilies[1][1]) return {};
  }
  const family = rankedFamilies[0][0];
  const values = [...new Set(observations.filter((item) => item.family === family).map((item) => item.value))];
  const concrete = values.filter((value) => !/[xX]/.test(value.slice(9)) && value !== "STM32F103" && value !== "STM32H755");
  const incompatible = concrete.some((left) =>
    concrete.some((right) => left !== right && !left.startsWith(right) && !right.startsWith(left)),
  );
  if (incompatible) {
    warnings.push({
      code: "QC1-SCAN-MCU-VARIANT-CONFLICT",
      severity: "warning",
      message: `Variantes MCU incompatibles détectées: ${concrete.join(", ")}.`,
      file: root,
    });
    return { family };
  }
  const mcu = values.sort(
    (left, right) =>
      right.length - left.length ||
      Number(/[xX]/.test(left.slice(9))) - Number(/[xX]/.test(right.slice(9))),
  )[0];
  return { family, mcu };
}

function confidenceFromEvidence(evidence: DetectionEvidence[], family?: string): number {
  if (!family) return 0;
  const supportsFamily = (item: DetectionEvidence): boolean => {
    const found = findMcus(item.value);
    if (found.length) return found.some((mcu) => mcuFamily(mcu) === family);
    if (item.type === "system") return item.value.includes(family);
    if (item.type === "board" || item.type === "core") return family === "STM32H7";
    if (item.type === "cpu")
      return item.value.includes("m3") ? family === "STM32F1" : family === "STM32H7";
    return true;
  };
  const caps: Record<DetectionEvidence["type"], number> = {
    board: 20,
    "build-system": 5,
    core: 30,
    cpu: 10,
    fpu: 0,
    ioc: 50,
    linker: 20,
    "linker-memory": 0,
    "mcu-define": 40,
    "mcu-reference": 30,
    startup: 25,
    system: 5,
  };
  let total = 0;
  for (const type of Object.keys(caps) as DetectionEvidence["type"][]) {
    const weight = evidence
      .filter((item) => item.type === type && supportsFamily(item))
      .reduce((sum, item) => sum + item.weight, 0);
    total += Math.min(caps[type], weight);
  }
  return Math.max(0, Math.min(100, total));
}

async function referenceExists(reference: FileReference, inventory: Inventory): Promise<boolean> {
  const normalized = reference.value.replace(/[\\/]/g, path.sep);
  const absolute = path.isAbsolute(normalized)
    ? normalized
    : path.resolve(path.dirname(reference.file), normalized);
  if (inventory.files.includes(absolute)) return true;
  if (!normalized.includes(path.sep))
    return inventory.files.some((file) => path.basename(file).toLowerCase() === normalized.toLowerCase());
  try {
    return (await fs.stat(absolute)).isFile();
  } catch {
    return false;
  }
}

function componentForCore(core: "CM7" | "CM4"): "CM7" | "CM4" {
  return core;
}

export async function analyzeProject(
  projectPath: string,
  options: ProjectAnalysisOptions = {},
): Promise<ProjectCandidate | undefined> {
  abortIfRequested(options.signal);
  const root = path.resolve(projectPath);
  const inventory = await inventoryRoot(root, options);
  const records = await readRelevantFiles(inventory, options);
  const evidence: DetectionEvidence[] = [];
  const observations: McuObservation[] = [];
  const warnings: Diagnostic[] = [];
  const references: FileReference[] = [];
  const evidenceKeys = new Set<string>();
  const observationKeys = new Set<string>();
  const coreScoreKeys = new Set<string>();
  const buildKinds = new Set<"make" | "cmake">();
  const coreScores: Record<"CM7" | "CM4", number> = { CM7: 0, CM4: 0 };
  const names: string[] = [];

  const addEvidence = (
    type: DetectionEvidence["type"],
    file: string,
    value: string,
    weight: number,
    influence: DetectionEvidence["influence"] = weight ? "positive" : "context",
  ): void => {
    const key = `${type}\0${file}\0${value}`;
    if (evidenceKeys.has(key)) return;
    evidenceKeys.add(key);
    evidence.push({ type, file, value, weight, influence });
  };
  const addMcu = (
    raw: string,
    type: DetectionEvidence["type"],
    file: string,
    weight: number,
  ): void => {
    const value = canonicalMcu(raw);
    const family = mcuFamily(value);
    if (!family) return;
    addEvidence(type, file, value, weight);
    const key = `${type}\0${file}\0${value}`;
    if (!observationKeys.has(key)) {
      observationKeys.add(key);
      observations.push({ value, family, weight });
    }
  };
  const addCore = (core: "CM7" | "CM4", file: string, value: string, weight: number): void => {
    addEvidence("core", file, value, weight);
    const category = /path$/i.test(value)
      ? "path"
      : /^CMake target/i.test(value)
        ? "target"
      : /^CORE_/i.test(value)
        ? "define"
        : /^cortex-/i.test(value)
          ? "cpu"
          : /startup/i.test(value)
            ? "startup"
            : /\.ld$/i.test(value)
              ? "linker"
              : value;
    const key = `${core}\0${category}`;
    if (!coreScoreKeys.has(key)) {
      coreScoreKeys.add(key);
      coreScores[core] += weight;
    }
  };

  for (const [recordIndex, record] of records.entries()) {
    abortIfRequested(options.signal);
    const name = path.basename(record.file);
    const relative = path.relative(root, record.file);
    const isMake = /^Makefile$|\.mk$/i.test(name);
    const isCmake = /^CMakeLists\.txt$|CMakePresets\.json$|\.cmake$/i.test(name);
    const searchableText = withoutInactiveComments(record.text, isMake || isCmake);
    if (isMake) {
      if (!buildKinds.has("make")) addEvidence("build-system", record.file, "Make", 5);
      buildKinds.add("make");
      references.push(...makeReferences(record));
      const projectName = record.text.match(/^\s*(?:PROJECT|PROJECT_NAME|TARGET)\s*(?::=|\?=|=)\s*([^#\r\n]+)/im)?.[1].trim();
      if (projectName) names.push(projectName);
    }
    if (isCmake) {
      if (!buildKinds.has("cmake")) addEvidence("build-system", record.file, "CMake", 5);
      buildKinds.add("cmake");
      if (!/\.json$/i.test(name)) {
        const data = cmakeData(record);
        references.push(...data.references);
        if (/^CMakeLists\.txt$/i.test(name) && data.name) names.push(data.name);
        if (data.invalid)
          warnings.push({
            code: "QC1-SCAN-CMAKE-PARTIAL",
            severity: "warning",
            message: "Analyse CMake statique partielle: syntaxe dynamique ou non prise en charge.",
            file: record.file,
          });
      }
    }

    if (/\.ioc$/i.test(name)) {
      for (const line of record.text.split(/\r?\n/)) {
        const match = line.match(/^Mcu\.(?:Name|CPN)=\s*(.+?)\s*$/i);
        if (match) for (const mcu of findMcus(match[1])) addMcu(mcu, "ioc", record.file, 50);
        const board = line.match(/^(?:Board|ProjectManager\.Board|Mcu\.Board)=\s*(.+?)\s*$/i)?.[1];
        if (board && /NUCLEO[-_ ]?H755ZI[-_ ]?Q/i.test(board))
          addEvidence("board", record.file, "NUCLEO-H755ZI-Q", 20);
        const projectName = line.match(/^ProjectManager\.ProjectName=\s*(.+?)\s*$/i)?.[1];
        if (projectName) names.push(projectName);
      }
      if (/NUCLEO[-_ ]?H755ZI[-_ ]?Q/i.test(record.text))
        addMcu("STM32H755ZI", "ioc", record.file, 20);
    }

    const startup = /^startup_stm32.*\.[sS]$/i.test(name);
    const linker = /\.ld$/i.test(name);
    const system = /^system_stm32.*\.c$/i.test(name);
    for (const mcu of findMcus(startup || linker ? name : searchableText)) {
      const family = mcuFamily(mcu);
      let type: DetectionEvidence["type"];
      let weight: number;
      if (startup) {
        type = "startup";
        weight = family === "STM32F1" ? 25 : 10;
      } else if (linker) {
        type = "linker";
        weight = family === "STM32F1" ? 15 : 10;
      } else {
        const escaped = mcu.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const line = searchableText.split(/\r?\n/).find((item) => new RegExp(escaped, "i").test(item)) || "";
        const isDefine = new RegExp(`(?:-D\\s*|#\\s*define\\s+)${escaped}`, "i").test(searchableText) ||
          new RegExp(`(?:target_compile_definitions|add_definitions)\\s*\\([^)]*${escaped}`, "is").test(searchableText) ||
          /target_compile_definitions|add_definitions/i.test(line);
        type = isDefine ? "mcu-define" : "mcu-reference";
        weight = isDefine ? (family === "STM32F1" ? 40 : 30) : isMake || isCmake ? 25 : 20;
      }
      addMcu(mcu, type, record.file, weight);
    }

    if (linker)
      for (const mcu of findMcus(record.text))
        if (!findMcus(name).includes(mcu)) addMcu(mcu, "linker", record.file, 5);

    for (const match of searchableText.matchAll(/-mcpu\s*=\s*(cortex-m[347])/gi)) {
      const cpu = match[1].toLowerCase();
      addEvidence("cpu", record.file, cpu, cpu === "cortex-m3" ? 10 : 5);
      if (cpu === "cortex-m7") addCore("CM7", record.file, cpu, 5);
      if (cpu === "cortex-m4") addCore("CM4", record.file, cpu, 5);
    }
    for (const match of searchableText.matchAll(/-mfpu\s*=\s*([^\s;]+)/gi))
      addEvidence("fpu", record.file, match[1], 0);
    if (/\bCORE_CM7\b/i.test(searchableText)) addCore("CM7", record.file, "CORE_CM7", 15);
    if (/\bCORE_CM4\b/i.test(searchableText)) addCore("CM4", record.file, "CORE_CM4", 15);
    if (isCmake)
      for (const match of searchableText.matchAll(/(?:add_executable|add_library)\s*\(\s*([^\s)]+)/gi)) {
        const targetCore = coreFromText(match[1]);
        if (targetCore) addCore(targetCore, record.file, `CMake target ${match[1]}`, 8);
      }
    const pathCore = coreFromText(relative);
    if (pathCore) addCore(pathCore, record.file, `${pathCore} path`, 3);
    if (startup) {
      const core = coreFromText(name);
      if (core) addCore(core, record.file, name, 10);
    }
    if (linker) {
      const core = coreFromText(name);
      if (core) addCore(core, record.file, name, 10);
      for (const region of linkerMemory(record.text))
        addEvidence("linker-memory", record.file, region, 0);
    }
    if (system) {
      if (/stm32f1/i.test(name)) addEvidence("system", record.file, "STM32F1 system file", 5);
      if (/stm32h7/i.test(name)) addEvidence("system", record.file, "STM32H7 system file", 5);
    }
    if (/NUCLEO[-_ ]?H755ZI[-_ ]?Q/i.test(searchableText) && (isMake || isCmake || /\.ioc$/i.test(name))) {
      addEvidence("board", record.file, "NUCLEO-H755ZI-Q", 20);
      addMcu("STM32H755ZI", "mcu-reference", record.file, 20);
    }
    if ((recordIndex + 1) % 32 === 0)
      await new Promise<void>((resolve) => setImmediate(resolve));
  }

  const explicitBoardPath = [root, ...records.map((record) => record.file)].find((value) =>
    /NUCLEO[-_ ]?H755ZI[-_ ]?Q/i.test(value),
  );
  if (explicitBoardPath && buildKinds.size) {
    addEvidence("board", explicitBoardPath, "NUCLEO-H755ZI-Q", 20);
    addMcu("STM32H755ZI", "mcu-reference", explicitBoardPath, 20);
  }

  if (inventory.truncated)
    warnings.push({
      code: "QC1-SCAN-TRUNCATED",
      severity: "warning",
      message: "Scan partiel: limite de profondeur ou de fichiers atteinte.",
      file: root,
    });

  const selected = selectMcu(observations, warnings, root);
  const confidence = confidenceFromEvidence(evidence, selected.family);
  const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const nonLinkerAnchor = evidence.some(
    (item) => item.weight > 0 && !["linker", "linker-memory", "build-system"].includes(item.type),
  );
  if (!selected.family || confidence < minConfidence || !nonLinkerAnchor) return undefined;

  let architecture: ProjectArchitecture = "unknown";
  if (selected.family === "STM32F1") architecture = "single-core";
  else if (selected.family === "STM32H7") {
    if (coreScores.CM7 > 0 && coreScores.CM4 > 0) architecture = "dual-core";
    else if (coreScores.CM7 > 0 || coreScores.CM4 > 0) architecture = "single-core";
  }

  const coreEvidence = (core: "CM7" | "CM4"): DetectionEvidence[] =>
    evidence.filter((item) => item.type === "core" && coreFromText(item.value) === core);
  const startupFiles = records.filter((record) => /^startup_stm32.*\.[sS]$/i.test(path.basename(record.file)));
  const linkerFiles = records.filter((record) => /\.ld$/i.test(record.file));
  const cores: ProjectCore[] = [];
  if (selected.family === "STM32F1") {
    const derived: DetectionEvidence = {
      type: "cpu",
      file: root,
      value: "Cortex-M3 (STM32F103 family)",
      weight: 0,
      influence: "context",
    };
    if (!evidence.some((item) => item.type === "cpu" && item.value === "cortex-m3")) evidence.push(derived);
    cores.push({
      id: "cortex-m3",
      name: "Cortex-M3",
      cpu: "cortex-m3",
      confidence: 100,
      startupFiles: startupFiles.map((record) => record.file),
      linkerScripts: linkerFiles.map((record) => record.file),
      evidence: evidence.filter((item) => item.type === "cpu" || item.type === "mcu-define" || item.type === "ioc"),
    });
  } else {
    for (const core of ["CM7", "CM4"] as const) {
      if (coreScores[core] <= 0) continue;
      cores.push({
        id: core === "CM7" ? "cm7" : "cm4",
        name: core === "CM7" ? "Cortex-M7" : "Cortex-M4",
        cpu: core === "CM7" ? "cortex-m7" : "cortex-m4",
        confidence: Math.min(100, coreScores[core] * 3),
        startupFiles: startupFiles.filter((record) => coreFromText(record.file) === core).map((record) => record.file),
        linkerScripts: linkerFiles.filter((record) => coreFromText(record.file) === core).map((record) => record.file),
        evidence: coreEvidence(core),
      });
    }
  }

  const missingComponents: MissingComponent[] = [];
  for (const reference of references) {
    if (await referenceExists(reference, inventory)) continue;
    missingComponents.push({
      component: reference.kind,
      severity: "error",
      message: `${reference.kind === "linker" ? "Linker" : "Startup"} référencé mais absent: ${reference.value}`,
      referencedBy: reference.file,
      expectedPath: path.resolve(path.dirname(reference.file), reference.value.replace(/[\\/]/g, path.sep)),
    });
  }

  const sourceRecords = records.filter((record) => /\.(?:c|cc|cpp|cxx|h|hpp)$/i.test(record.file));
  const halReference = records.find((record) => /^(?:\s*#\s*include\s*[<"]stm32\w+_hal(?:_[^">]+)?\.h[>"])|\bUSE_HAL_DRIVER\b/im.test(
    withoutInactiveComments(record.text, /^(?:Makefile|CMakeLists\.txt)$|\.mk$|\.cmake$/i.test(path.basename(record.file))),
  ));
  const cmsisReference = sourceRecords.find((record) => /^\s*#\s*include\s*[<"](?:core_cm[347]|cmsis_[^">]+|stm32(?:f103|f1xx|h755|h7xx)[^">]*)\.h[>"]/im.test(
    withoutInactiveComments(record.text, false),
  ));
  const hasHal = inventory.files.some((file) => /stm32\w+_hal(?:_[^/\\]+)?\.h$/i.test(path.basename(file)));
  const hasCmsis = inventory.files.some((file) => /^(?:core_cm[347]|cmsis_[^/\\]+|stm32(?:f103|f1xx|h755|h7xx)[^/\\]*)\.h$/i.test(path.basename(file)));
  if (halReference && !hasHal)
    missingComponents.push({
      component: "HAL",
      severity: "error",
      message: "HAL référencée par le projet, mais aucun header HAL correspondant n'a été trouvé.",
      referencedBy: halReference.file,
    });
  if (cmsisReference && !hasCmsis)
    missingComponents.push({
      component: "CMSIS",
      severity: "error",
      message: "CMSIS référencé par le projet, mais aucun header CMSIS/device correspondant n'a été trouvé.",
      referencedBy: cmsisReference.file,
    });

  if (architecture === "dual-core") {
    for (const core of ["CM7", "CM4"] as const) {
      const projectCore = cores.find((item) => item.id === core.toLowerCase());
      if (!projectCore?.startupFiles.length)
        missingComponents.push({
          component: componentForCore(core),
          severity: "warning",
          message: `${core} attendu dans ce projet dual-core, mais son startup n'a pas été trouvé.`,
        });
      if (!projectCore?.linkerScripts.length)
        missingComponents.push({
          component: componentForCore(core),
          severity: "warning",
          message: `${core} attendu dans ce projet dual-core, mais son linker n'a pas été trouvé.`,
        });
    }
  }

  const buildSystem: ProjectBuildSystem = buildKinds.size === 2
    ? "mixed"
    : buildKinds.has("make")
      ? "make"
      : buildKinds.has("cmake")
        ? "cmake"
        : "unknown";
  const board = evidence.some((item) => item.type === "board" && item.value === "NUCLEO-H755ZI-Q")
    ? "NUCLEO-H755ZI-Q"
    : undefined;
  const uniqueMissing = missingComponents.filter(
    (item, index, all) =>
      all.findIndex((candidate) =>
        candidate.component === item.component &&
        candidate.message === item.message &&
        candidate.referencedBy === item.referencedBy,
      ) === index,
  );
  return {
    path: root,
    name: names.find((name) => name && !/[${}]/.test(name)) || path.basename(root),
    family: selected.family,
    mcu: selected.mcu,
    board,
    architecture,
    cores,
    buildSystem,
    confidence,
    evidence,
    missingComponents: uniqueMissing,
    warnings,
  };
}

function isProjectMarker(file: string): boolean {
  const name = path.basename(file);
  return /^(?:Makefile|CMakeLists\.txt)$/i.test(name) || /\.ioc$/i.test(name);
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export async function discoverProjects(
  options: DiscoverProjectsOptions,
): Promise<ProjectCandidate[]> {
  const maxProjects = options.maxProjects ?? DEFAULT_MAX_PROJECTS;
  const maxCandidateChecks = Math.max(maxProjects, maxProjects * 4);
  const candidateRoots = new Set<string>();
  for (const suppliedRoot of options.roots) {
    abortIfRequested(options.signal);
    const root = path.resolve(suppliedRoot);
    const inventory = await inventoryRoot(root, options);
    const markers = inventory.files.filter(isProjectMarker);
    if (markers.length) {
      for (const marker of markers) candidateRoots.add(path.dirname(marker));
    } else {
      candidateRoots.add(root);
    }
  }

  const analyzed: ProjectCandidate[] = [];
  let candidateChecks = 0;
  for (const candidateRoot of [...candidateRoots].sort((left, right) => left.length - right.length || left.localeCompare(right))) {
    abortIfRequested(options.signal);
    if (analyzed.length >= maxProjects || candidateChecks >= maxCandidateChecks) break;
    candidateChecks++;
    const candidate = await analyzeProject(candidateRoot, options);
    if (candidate) analyzed.push(candidate);
  }

  return analyzed
    .filter((candidate) => {
      const children = analyzed.filter((other) => isInside(candidate.path, other.path));
      if (!children.length) return true;
      if (
        candidate.architecture === "dual-core" &&
        children.every((child) => /(?:^|[/\\])CM[47](?:[/\\]|$)/i.test(child.path))
      )
        return true;
      const ownStrongEvidence = candidate.evidence.some(
        (item) => item.weight >= 10 && !children.some((child) => item.file === child.path || isInside(child.path, item.file)),
      );
      return ownStrongEvidence;
    })
    .filter((candidate, index, all) =>
      !all.some(
        (parent, parentIndex) =>
          parentIndex !== index &&
          parent.architecture === "dual-core" &&
          isInside(parent.path, candidate.path) &&
          /(?:^|[/\\])CM[47](?:[/\\]|$)/i.test(candidate.path),
      ),
    )
    .sort((left, right) => left.path.localeCompare(right.path));
}
