import * as fs from "fs/promises";
import * as path from "path";
import type { ArtifactUiState } from "../dashboard/managerUiState";

/** Inspect existing outputs only; never create or transform build artifacts. */
export async function collectProjectArtifacts(
  buildPath: string,
  known: Array<{ path: string; core?: "CM7" | "CM4" }>,
): Promise<ArtifactUiState[]> {
  const files = new Map<string, "CM7" | "CM4" | undefined>();
  for (const entry of known) {
    if (!entry.path) continue;
    const extension = path.extname(entry.path);
    if (/^\.(?:elf|bin|hex|map)$/i.test(extension)) files.set(entry.path, entry.core);
    const base = extension ? entry.path.slice(0, -extension.length) : entry.path;
    for (const extension of ["elf", "bin", "hex", "map"]) files.set(`${base}.${extension}`, entry.core);
  }
  if (buildPath) {
    try {
      let visited = 0;
      for await (const entry of await fs.opendir(buildPath)) {
        if (visited++ >= 200) break;
        if (entry.isFile() && /\.(?:elf|bin|hex|map)$/i.test(entry.name)) {
          const file = path.join(buildPath, entry.name);
          if (!files.has(file)) files.set(file, /CM7/i.test(entry.name) ? "CM7" : /CM4/i.test(entry.name) ? "CM4" : undefined);
        }
      }
    } catch { /* No build yet. */ }
  }
  const result: ArtifactUiState[] = [];
  const inspected = new Set<string>();
  for (const [file, core] of files) {
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile()) continue;
      const identity = await fs.realpath(file);
      if (inspected.has(identity)) continue;
      inspected.add(identity);
      result.push({ id: `artifact-${result.length}`, path: file, core, kind: path.extname(file).slice(1).toUpperCase() as ArtifactUiState["kind"], sizeBytes: stat.size });
    } catch { /* Expected candidate, not generated yet. */ }
  }
  return result;
}
