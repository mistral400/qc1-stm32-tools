import type { DashboardState } from "./dashboardState";
import type { Qc1Command } from "./webviewMessages";
import { action, escapeHtml, row } from "./html";

export function availableProjectCommands(state: DashboardState): Qc1Command[] {
  const candidate = state.projectDiscovery.activeCandidate;
  const family = candidate?.family || state.project.targetFamily;
  const result: Qc1Command[] = [];
  if (!state.project.projectDetected && !candidate && !state.project.cmakeProjectReady) return result;
  if (family === "STM32F1" || family === "stm32f1") result.push("build", "flash", "debug", "run");
  else if (family === "STM32H7" || family === "stm32h755") {
    const cm7 = candidate ? candidate.cores.some((core) => core.id === "cm7") : state.project.cm7Present;
    const cm4 = candidate ? candidate.cores.some((core) => core.id === "cm4") : state.project.cm4Present;
    if (cm7) result.push("build-cm7", "flash-cm7", "debug-cm7");
    if (cm4) result.push("build-cm4", "flash-cm4", "debug-cm4");
    if (cm7 && cm4) result.push("build", "flash");
    if (!cm7 && !cm4) result.push("build");
  } else if (state.project.cmakeProjectReady) result.push("build");
  result.push("clean", "rebuild");
  return result;
}

export function renderBuildView(state: DashboardState): string {
  const available = availableProjectCommands(state);
  const labels: Partial<Record<Qc1Command, string>> = {
    build: state.project.cm7Present && state.project.cm4Present ? "Build all" : "Build",
    flash: state.project.cm7Present && state.project.cm4Present ? "Flash all" : "Flash",
    debug: "Debug", run: "Build + Flash", "build-cm7": "Build CM7", "build-cm4": "Build CM4",
    "flash-cm7": "Flash CM7", "flash-cm4": "Flash CM4", "debug-cm7": "Debug CM7", "debug-cm4": "Debug CM4", clean: "Clean", rebuild: "Rebuild",
  };
  const progress = state.progress;
  const percent = Math.max(0, Math.min(100, progress.progressPercent));
  return `<section class="card"><h2>Build / Flash / Debug</h2><p class="muted">Actions contextuelles · backends QC1 existants · aucun debug dual-core simultané.</p>
    <div class="actions">${available.map((command) => action("command", labels[command] || command, `data-command="${escapeHtml(command)}" data-task-command`, progress.active)).join("") || "<span class=\"muted\">Sélectionnez un projet.</span>"}</div>
    <div class="progress-heading"><strong id="progressTask">${escapeHtml(progress.taskName || "Prêt")}</strong><span id="progressRuntime">${escapeHtml(progress.runtimeSeconds)} s</span></div>
    <div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><div id="progressFill" style="width:${percent}%"></div></div>
    <div class="row"><span id="progressPhase">${escapeHtml(progress.phase)}</span><span id="progressCounter">${progress.measured ? `${progress.completedSteps} / ${progress.totalSteps}` : "Étape non mesurée"}</span><span id="progressPercent">${percent}%</span></div>
    <p id="progressStep" class="muted">${escapeHtml(progress.currentStep || "Les compteurs Ninja sont utilisés lorsqu'ils sont disponibles.")}</p>
    ${row("Dernier build", `${state.build.lastBuildTime} · ${state.build.lastBuildSuccess ? "Réussi" : "Aucun succès confirmé"}`)}${row("Durée", `${(state.build.buildRuntimeMs / 1000).toFixed(1)} s`)}
    ${row("Erreurs / warnings", `${state.build.errors} / ${state.build.warnings}`)}
    ${row("Flash utilisée (sortie du build)", state.build.flashUsage)}${row("RAM utilisée (sortie du build)", state.build.ramUsage)}
    <p class="muted">Usage affiché uniquement s'il est fourni par le build. Aucun pourcentage ou capacité n'est supposé; les usages par cœur restent non attribués sans sortie fiable.</p>
    ${row("Dernier flash", `${state.flash.lastFlashTime} · ${state.flash.lastFlashSuccess ? "Réussi" : "Non confirmé"}`)}
  </section><section class="card"><h2>Artefacts existants</h2>${state.artifacts.map((artifact) => `<div class="artifact"><strong>${escapeHtml(artifact.core ? `${artifact.core} ${artifact.kind}` : artifact.kind)}</strong><span>${(artifact.sizeBytes / 1024).toFixed(1)} KB</span><div class="path">${escapeHtml(artifact.path)}</div>${action("openArtifact", "Révéler", `data-id="${escapeHtml(artifact.id)}"`)}</div>`).join("") || "<p class=\"muted\">Aucun ELF/BIN/HEX/MAP trouvé dans les chemins connus du build.</p>"}</section>`;
}
