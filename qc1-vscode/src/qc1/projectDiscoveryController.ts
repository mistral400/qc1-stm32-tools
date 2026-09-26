/** UI orchestration only. The static scanner remains the sole analysis engine. */
import { analyzeProject, discoverProjects, DiscoverProjectsOptions, ProjectCandidate } from "./projectScanner";

export type DiscoveryStatus = "idle" | "scanning" | "success" | "error" | "cancelled";
export interface DiscoveryState {
  status: DiscoveryStatus;
  roots: string[];
  selectedPath: string;
  activeCandidate?: ProjectCandidate;
  candidates: ProjectCandidate[];
  message: string;
  stale: boolean;
  lastScanAt?: number;
}
export interface DiscoveryDependencies {
  discover(options: DiscoverProjectsOptions): Promise<ProjectCandidate[]>;
  analyze(projectPath: string, options: { signal: AbortSignal }): Promise<ProjectCandidate | undefined>;
}

export class ProjectDiscoveryController {
  private generation = 0;
  private abort?: AbortController;
  private disposed = false;
  private state: DiscoveryState = {
    status: "idle", roots: [], selectedPath: "", candidates: [], message: "", stale: false,
  };
  constructor(
    private readonly publish: (state: DiscoveryState) => void,
    private readonly dependencies: DiscoveryDependencies = { discover: discoverProjects, analyze: analyzeProject },
  ) {}

  get snapshot(): DiscoveryState { return this.state; }
  get requestId(): number { return this.generation; }
  private emit(changes: Partial<DiscoveryState>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...changes };
    this.publish(this.state);
  }
  private begin(message: string): { id: number; abort: AbortController } {
    this.abort?.abort();
    const abort = new AbortController();
    this.abort = abort;
    const id = ++this.generation;
    this.emit({ status: "scanning", message });
    return { id, abort };
  }
  private current(id: number): boolean { return !this.disposed && id === this.generation; }

  setSelectedPath(selectedPath: string): void {
    if (selectedPath === this.state.selectedPath) return;
    this.cancel(false);
    this.emit({
      selectedPath,
      activeCandidate: this.state.candidates.find((candidate) => candidate.path === selectedPath),
      stale: false,
      status: "idle",
      message: "",
    });
  }

  async scan(roots: string[]): Promise<void> {
    if (this.disposed) return;
    const uniqueRoots = [...new Set(roots)].slice(0, 24);
    const { id, abort } = this.begin("Recherche statique des projets STM32…");
    this.emit({ roots: uniqueRoots });
    try {
      const candidates = uniqueRoots.length ? await this.dependencies.discover({
        roots: uniqueRoots, maxDepth: 10, maxFiles: 4000, maxAnalyzedFiles: 300,
        maxProjects: 20, minConfidence: 40, signal: abort.signal,
      }) : [];
      if (!this.current(id) || abort.signal.aborted) return;
      this.emit({
        status: "success", candidates,
        activeCandidate: candidates.find((candidate) => candidate.path === this.state.selectedPath) || this.state.activeCandidate,
        message: uniqueRoots.length ? `${candidates.length} projet(s) détecté(s).` : "Choisissez un dossier ou une racine de recherche.",
        stale: candidates.some((candidate) => candidate.path === this.state.selectedPath) ? false : this.state.stale,
        lastScanAt: Date.now(),
      });
    } catch (error) {
      this.finishError(id, abort, error);
    } finally {
      if (this.current(id)) this.abort = undefined;
    }
  }

  async refreshActive(force = false): Promise<void> {
    const selectedPath = this.state.selectedPath;
    if (!selectedPath || this.disposed) return;
    if (!force && !this.state.stale && this.state.activeCandidate) return;
    const { id, abort } = this.begin("Analyse du projet actif…");
    try {
      const activeCandidate = await this.dependencies.analyze(selectedPath, { signal: abort.signal });
      if (!this.current(id) || abort.signal.aborted || selectedPath !== this.state.selectedPath) return;
      this.emit({
        activeCandidate, status: "success", stale: false, lastScanAt: Date.now(),
        message: activeCandidate ? "Projet actif analysé." : "Projet absent, non STM32 ou preuves insuffisantes.",
      });
    } catch (error) { this.finishError(id, abort, error); }
    finally { if (this.current(id)) this.abort = undefined; }
  }

  async inspectForSelection(projectPath: string): Promise<ProjectCandidate | undefined> {
    if (this.disposed) return;
    const { id, abort } = this.begin("Vérification du projet à sélectionner…");
    try {
      const candidate = await this.dependencies.analyze(projectPath, { signal: abort.signal });
      if (!this.current(id) || abort.signal.aborted) return;
      this.emit({ status: "success", message: candidate ? "Projet vérifié." : "Projet STM32 non détecté." });
      return candidate;
    } catch (error) { this.finishError(id, abort, error); }
    finally { if (this.current(id)) this.abort = undefined; }
  }

  private finishError(id: number, abort: AbortController, error: unknown): void {
    if (!this.current(id)) return;
    const cancelled = abort.signal.aborted || (error instanceof Error && error.name === "AbortError");
    this.emit({
      status: cancelled ? "cancelled" : "error",
      message: cancelled ? "Détection annulée." : `Erreur de lecture: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  rescan(): Promise<void> {
    return this.state.selectedPath ? this.refreshActive(true) : this.scan(this.state.roots);
  }
  markStale(): void {
    this.cancel(false);
    this.emit({ status: "idle", stale: true, message: "Fichiers structurants modifiés : projet à rescanner." });
  }
  invalidate(clearResults = false): void {
    this.cancel(false);
    this.emit({ activeCandidate: undefined, ...(clearResults ? { candidates: [], roots: [] } : {}), stale: true, status: "idle" });
  }
  cancel(notify = true): void {
    this.abort?.abort();
    this.abort = undefined;
    ++this.generation;
    if (notify) this.emit({ status: "cancelled", message: "Détection annulée." });
  }
  dispose(): void { this.cancel(false); this.disposed = true; }
}
