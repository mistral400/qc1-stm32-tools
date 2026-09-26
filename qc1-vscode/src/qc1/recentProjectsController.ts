import * as fs from "fs/promises";
import * as path from "path";
import type { ProjectCandidate } from "./projectScanner";

export interface RecentProject {
  path: string;
  name: string;
  mcu?: string;
  family?: string;
  available: boolean | undefined;
}
export interface RecentProjectsStorage {
  read(): string[];
  write(paths: string[]): PromiseLike<void>;
}
export async function directoryAvailable(projectPath: string): Promise<boolean | undefined> {
  try { return (await fs.stat(projectPath)).isDirectory(); }
  catch (error) {
    return ["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code || "") ? false : undefined;
  }
}

/** Only paths persist under the existing history key. Metadata is a lightweight memory cache. */
export class RecentProjectsController {
  private pending: Promise<unknown> = Promise.resolve();
  private metadata = new Map<string, ProjectCandidate>();
  constructor(
    private readonly storage: RecentProjectsStorage,
    private readonly exists = directoryAvailable,
  ) {}
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.pending.catch(() => undefined).then(operation);
    this.pending = next;
    return next;
  }
  paths(): string[] {
    const stored = this.storage.read();
    return [...new Set((Array.isArray(stored) ? stored : []).filter((value) => typeof value === "string" && value.trim()).map((value) => path.resolve(value)))].slice(0, 8);
  }
  private pruneMetadata(): void {
    const retained = new Set(this.paths());
    for (const key of this.metadata.keys()) if (!retained.has(key)) this.metadata.delete(key);
  }
  cacheMetadata(candidates: ProjectCandidate[]): void {
    for (const candidate of candidates)
      if (this.paths().includes(candidate.path)) this.metadata.set(candidate.path, candidate);
  }
  remember(candidate: ProjectCandidate): Promise<void> {
    return this.enqueue(async () => {
      const projectPath = path.resolve(candidate.path);
      this.metadata.set(projectPath, candidate);
      await this.storage.write([projectPath, ...this.paths().filter((value) => value !== projectPath)].slice(0, 8));
      this.pruneMetadata();
    });
  }
  remove(projectPath: string): Promise<void> {
    return this.enqueue(async () => {
      await this.storage.write(this.paths().filter((value) => value !== path.resolve(projectPath)));
      this.pruneMetadata();
    });
  }
  load(): Promise<RecentProject[]> {
    return this.enqueue(async () => {
      const paths = this.paths();
      const availability = await Promise.all(paths.map(this.exists));
      const valid = paths.filter((_value, index) => availability[index] !== false);
      if (valid.length !== paths.length) await this.storage.write(valid);
      this.pruneMetadata();
      return valid.map((projectPath) => {
        const candidate = this.metadata.get(projectPath);
        return {
          path: projectPath, name: candidate?.name || path.basename(projectPath),
          family: candidate?.family, mcu: candidate?.mcu,
          available: availability[paths.indexOf(projectPath)],
        };
      });
    });
  }
}
