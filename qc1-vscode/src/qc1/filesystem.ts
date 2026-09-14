/** Bounded filesystem inspection. Preserve spelling; report ambiguity instead of guessing. */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface Finding {
  code: string;
  level: "info" | "warning" | "error" | "critical";
  category: string;
  title: string;
  message: string;
  cause: string;
  evidence: string;
  path: string;
  suggestion: string;
  correction: string;
}
export function finding(
  code: string,
  title: string,
  message: string,
  file = "",
  level: Finding["level"] = "warning",
  category = "project",
): Finding {
  return {
    code,
    title,
    message,
    path: file,
    level,
    category,
    cause: message,
    evidence: file,
    suggestion: "Vérifier la configuration et le chemin indiqué.",
    correction: "Correction manuelle après vérification.",
  };
}
export const ignoredDirectories = new Set([
  ".git",
  ".vscode",
  ".pio",
  "node_modules",
  "build",
  "dist",
  "out",
  "cache",
  ".cache",
  "backups",
  "__pycache__",
]);
export function inside(root: string, candidate: string, api = path): boolean {
  const rel = api.relative(root, candidate);
  return (
    rel === "" ||
    (rel !== ".." && !rel.startsWith(`..${api.sep}`) && !api.isAbsolute(rel))
  );
}
export function resolveUserPath(
  value: string,
  root: string,
  platform: string = os.platform(),
  home = os.homedir(),
): string {
  const api = platform === "win32" ? path.win32 : path.posix;
  const expanded =
    value === "~"
      ? home
      : /^~[\\/]/.test(value)
        ? api.join(home, value.slice(2))
        : value;
  return api.resolve(root, expanded || ".");
}
export function readText(file: string, maxBytes = 512 * 1024): string {
  try {
    const stat = fs.statSync(file);
    return stat.isFile() && stat.size <= maxBytes
      ? fs.readFileSync(file, "utf8")
      : "";
  } catch {
    return "";
  }
}
export function checkSpelling(requested: string): {
  exists: boolean;
  actual: string;
  mismatch: boolean;
  ambiguous: boolean;
} {
  const absolute = path.resolve(requested);
  let current = path.parse(absolute).root;
  let mismatch = false;
  for (const segment of absolute
    .slice(current.length)
    .split(path.sep)
    .filter(Boolean)) {
    let entries: string[];
    try {
      entries = fs.readdirSync(current);
    } catch {
      return { exists: false, actual: current, mismatch, ambiguous: false };
    }
    const matches = entries.filter(
      (entry) => entry.toLowerCase() === segment.toLowerCase(),
    );
    const chosen = entries.includes(segment)
      ? segment
      : matches.length === 1
        ? matches[0]
        : undefined;
    if (!chosen)
      return {
        exists: false,
        actual: current,
        mismatch,
        ambiguous: matches.length > 1,
      };
    mismatch ||= chosen !== segment;
    current = path.join(current, chosen);
  }
  return {
    exists: fs.existsSync(requested),
    actual: current,
    mismatch,
    ambiguous: false,
  };
}
export interface ProjectScan {
  files: string[];
  directories: number;
  bytes: number;
  truncated: boolean;
  findings: Finding[];
}
export function scanProject(
  root: string,
  maxDepth = 10,
  maxEntries = 6000,
): ProjectScan {
  const result: ProjectScan = {
    files: [],
    directories: 0,
    bytes: 0,
    truncated: false,
    findings: [],
  };
  const visited = new Set<string>();
  let entriesSeen = 0;
  const deadline = Date.now() + 500;
  let realRoot: string;
  try {
    realRoot = fs.realpathSync(root);
  } catch {
    return result;
  }
  const walk = (directory: string, depth: number): void => {
    if (
      depth > maxDepth ||
      entriesSeen >= maxEntries ||
      Date.now() > deadline
    ) {
      result.truncated = true;
      return;
    }
    try {
      const real = fs.realpathSync(directory);
      if (visited.has(real) || !inside(realRoot, real)) return;
      visited.add(real);
      result.directories++;
      for (const entry of fs
        .readdirSync(directory, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name))) {
        if (++entriesSeen > maxEntries || Date.now() > deadline) {
          result.truncated = true;
          break;
        }
        if (
          ignoredDirectories.has(entry.name.toLowerCase()) ||
          /^cmake-build-/i.test(entry.name)
        )
          continue;
        const file = path.join(directory, entry.name);
        try {
          if (
            entry.isSymbolicLink() &&
            !inside(realRoot, fs.realpathSync(file))
          ) {
            result.findings.push(
              finding(
                "QC1-PATH-003",
                "EXTERNAL_SYMLINK",
                "Lien externe non parcouru.",
                file,
                "info",
                "filesystem",
              ),
            );
            continue;
          }
          const stat = fs.statSync(file);
          if (stat.isDirectory()) walk(file, depth + 1);
          else if (stat.isFile()) {
            result.files.push(file);
            result.bytes += stat.size;
          }
        } catch {
          result.findings.push(
            finding(
              "QC1-FS-001",
              "FILE_INACCESSIBLE",
              "Accès refusé ou fichier supprimé pendant le scan.",
              file,
              "warning",
              "filesystem",
            ),
          );
        }
      }
    } catch {
      result.findings.push(
        finding(
          "QC1-FS-002",
          "DIRECTORY_INACCESSIBLE",
          "Lecture du dossier impossible.",
          directory,
          "warning",
          "filesystem",
        ),
      );
    }
  };
  walk(root, 0);
  if (result.truncated)
    result.findings.push(
      finding(
        "QC1-FS-003",
        "SCAN_TRUNCATED",
        "Limite de profondeur ou de fichiers atteinte; statistiques partielles.",
        root,
        "info",
        "filesystem",
      ),
    );
  return result;
}
