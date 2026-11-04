import type { DashboardState } from "./dashboardState";
import type { Qc1Command } from "./webviewMessages";
import { action, escapeHtml, row } from "./html";

function operationSummary(operation: DashboardState["operations"]["build"]): string {
  const labels = {
    "not-run": "Non exécuté",
    running: "En cours",
    success: "Réussi",
    failed: "Échoué",
    skipped: "Non lancé",
    unknown: "Non confirmé",
  } as const;
  const label = labels[operation.status];
  return operation.message ? `${label} · ${operation.message}` : label;
}

function operationRow(label: string, operation: DashboardState["operations"]["build"]): string {
  const statusClass = operation.status === "success" ? "success"
    : operation.status === "failed" ? "error"
      : operation.status === "running" ? "warning" : "";
  return `<div class="row"><span class="muted">${escapeHtml(label)}</span><span class="value operation-state ${statusClass}">${escapeHtml(operationSummary(operation))}</span></div>`;
}

function byteValue(value: number | undefined): string {
  return value === undefined ? "Non déterminé" : `${value.toLocaleString("fr-CA")} octets`;
}

function renderMemoryInspection(state: DashboardState): string {
  const report = state.memoryInspection;
  const images = report.images.map(image => {
    const summary = `<div class="row"><span class="muted">Flash chargée</span><span class="value">${escapeHtml(byteValue(image.flashLoadBytes))}</span></div>
      <div class="row"><span class="muted">RAM statique</span><span class="value">${escapeHtml(byteValue(image.staticRamBytes))}</span></div>
      <div class="row"><span class="muted">Sections .text / .data / .bss</span><span class="value">${escapeHtml(byteValue(image.textBytes))} / ${escapeHtml(byteValue(image.dataBytes))} / ${escapeHtml(byteValue(image.bssBytes))}</span></div>
      <div class="row"><span class="muted">Autres sections RAM</span><span class="value">${escapeHtml(byteValue(image.otherRamBytes))}</span></div>
      <div class="row"><span class="muted">Réservations linker heap/stack détectées</span><span class="value">${escapeHtml(byteValue(image.runtimeReservationBytes))}</span></div>`;
    const regions = image.regions.map(region => {
      const capacity = region.length === undefined ? "capacité inconnue" : `${region.length.toLocaleString("fr-CA")} octets`;
      const used = region.usedBytes === undefined ? "occupation inconnue" : `${region.usedBytes.toLocaleString("fr-CA")} octets`;
      const ratio = region.utilizationPercent === undefined ? "" : ` · ${region.utilizationPercent}%`;
      const overflow = region.overflow ? " · dépassement détecté" : "";
      const bar = region.utilizationPercent === undefined ? "" : `<div class="progress-track" role="img" aria-label="${escapeHtml(region.name)}: ${region.utilizationPercent}%"><div style="width:${Math.max(0, Math.min(region.utilizationPercent, 100))}%"></div></div>`;
      return `<div class="memory-region"><div class="row"><strong>${escapeHtml(region.name)}</strong><span class="value ${region.overflow ? "error" : ""}">${escapeHtml(used)} / ${escapeHtml(capacity)}${escapeHtml(ratio + overflow)}</span></div>${bar}</div>`;
    }).join("");
    const sections = image.sections.slice(0, 16).map(section => `<div class="row"><span class="muted">${escapeHtml(section.name)}${section.runtimeReservation ? " · réserve" : ""}</span><span class="value">${escapeHtml(section.sizeBytes.toLocaleString("fr-CA"))} octets</span></div>`).join("");
    const warnings = image.warnings.map(warning => `<li>${escapeHtml(warning)}</li>`).join("");
    const details = `<details class="memory-details"><summary>Sections et provenance ELF</summary>
      <div class="path">ELF · ${escapeHtml(image.artifactPath)}</div>
      ${image.modifiedAt ? `<div class="row"><span class="muted">ELF modifié</span><span class="value">${escapeHtml(image.modifiedAt)}</span></div>` : ""}
      ${image.linkerPath ? `<div class="path">Script linker · ${escapeHtml(image.linkerPath)}</div>` : ""}
      ${image.mapPath ? `<div class="path">Carte linker détectée · ${escapeHtml(image.mapPath)}</div>` : ""}
      ${image.regionSource ? `<div class="row"><span class="muted">Régions lues dans</span><span class="value">${escapeHtml(image.regionSource)}</span></div>` : ""}
      ${sections || "<p class=\"muted\">Aucune section allouée reconnue.</p>"}
      ${image.sections.length > 16 ? `<p class="muted">${image.sections.length - 16} autres sections restent dans l'ELF.</p>` : ""}</details>`;
    return `<article class="memory-image"><h3>${escapeHtml(image.core)} · ${escapeHtml(image.status === "available" ? "Inspection disponible" : image.status === "error" ? "Erreur d'inspection" : "Inspection indisponible")}</h3>
      <p class="muted">${escapeHtml(image.message)}</p>${summary}${regions ? `<div class="memory-regions"><strong>Régions déclarées</strong>${regions}</div>` : ""}
      ${warnings ? `<ul class="memory-warnings">${warnings}</ul>` : ""}${details}</article>`;
  }).join("");
  return `<section class="card memory-inspection"><h2>Inspection mémoire statique</h2>
    <p class="muted">${escapeHtml(report.message)}</p>
    <p class="muted">Flash estimée depuis les adresses de chargement ELF; RAM statique depuis les sections placées en RAM. La pile, le heap et leur consommation à l'exécution ne sont pas mesurés.</p>
    <p class="muted">L'analyse porte sur les ELF actuellement présents; leur date de modification ne prouve pas qu'ils proviennent du dernier build réussi.</p>
    <p class="muted">Les résultats CM7 et CM4 sont séparés et ne sont pas additionnés; des régions RAM peuvent être partagées.</p>
    ${images || "<p class=\"muted\">Aucun ELF connu à inspecter.</p>"}</section>`;
}

export function availableProjectCommands(state: DashboardState): Qc1Command[] {
  const candidate = state.projectDiscovery.activeCandidate;
  const family = candidate?.family || state.project.targetFamily;
  const result: Qc1Command[] = [];
  if (!state.project.projectDetected && !candidate && !state.project.cmakeProjectReady) return result;
  if (family === "STM32F1" || family === "stm32f1") result.push("build", "flash", "debug", "run");
  else if (family === "STM32H7" || family === "stm32h7" || family === "stm32h755") {
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
  const isDualCore = state.projectDiscovery.activeCandidate
    ? state.projectDiscovery.activeCandidate.cores.some((core) => core.id === "cm7") && state.projectDiscovery.activeCandidate.cores.some((core) => core.id === "cm4")
    : state.project.cm7Present && state.project.cm4Present;
  const buildCommands = available.filter((command) => command === "build" || command === "build-cm7" || command === "build-cm4");
  const primaryBuilds = available.includes("build") ? ["build" as Qc1Command] : buildCommands.slice(0, 1);
  const secondaryCommands = available.filter((command) => ["flash", "debug", "run"].includes(command)
    || (!isDualCore && ["flash-cm7", "flash-cm4", "debug-cm7", "debug-cm4"].includes(command)));
  const advancedCommands = available.filter((command) => !primaryBuilds.includes(command) && !secondaryCommands.includes(command));
  const labels: Partial<Record<Qc1Command, string>> = {
    build: "Build",
    flash: "Flash",
    debug: "Debug", run: "Build + Flash", "build-cm7": "Build CM7", "build-cm4": "Build CM4",
    "flash-cm7": "Flash CM7", "flash-cm4": "Flash CM4", "debug-cm7": "Debug CM7", "debug-cm4": "Debug CM4", clean: "Clean", rebuild: "Rebuild",
  };
  if (isDualCore) {
    labels.build = "Build tous les cœurs";
    labels.flash = "Flash tous les cœurs";
  }
  const renderCommands = (commands: Qc1Command[], variant: "primary" | "secondary" | "quiet"): string => commands
    .map((command) => action("command", labels[command] || command, `data-command="${escapeHtml(command)}" data-task-command`, progress.active, variant))
    .join("");
  const progress = state.progress;
  const percent = Math.max(0, Math.min(100, progress.progressPercent));
  return `<section class="card"><h2>Build / Flash / Debug</h2><p class="muted">Les actions disponibles dépendent du projet actif. Aucun debug dual-core simultané.</p>
    ${available.length ? `<div class="action-groups">
      <div class="action-group"><span class="eyebrow">Construction</span><div class="actions">${renderCommands(primaryBuilds, "primary")}</div></div>
      ${secondaryCommands.length ? `<div class="action-group"><span class="eyebrow">Programmer et déboguer</span><div class="actions">${renderCommands(secondaryCommands, "secondary")}</div></div>` : ""}
    </div>${advancedCommands.length ? `<details class="advanced-actions"><summary>Actions avancées</summary><div class="actions">${renderCommands(advancedCommands, "quiet")}</div></details>` : ""}` : "<p class=\"muted\">Sélectionnez un projet.</p>"}
    <div class="progress-heading"><strong id="progressTask">${escapeHtml(progress.taskName || "Prêt")}</strong><span id="progressRuntime">${escapeHtml(progress.runtimeSeconds)} s</span></div>
    <div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><div id="progressFill" style="width:${percent}%"></div></div>
    <div class="row"><span id="progressPhase">${escapeHtml(progress.phase)}</span><span id="progressCounter">${progress.measured ? `${progress.completedSteps} / ${progress.totalSteps}` : "Étape non mesurée"}</span><span id="progressPercent">${percent}%</span></div>
    <p id="progressStep" class="muted">${escapeHtml(progress.currentStep || "Les compteurs Ninja sont utilisés lorsqu'ils sont disponibles.")}</p>
    ${row("Dernier build", state.build.lastBuildTime)}${operationRow("Résultat Build", state.operations.build)}${row("Durée", `${(state.build.buildRuntimeMs / 1000).toFixed(1)} s`)}
    ${row("Erreurs / warnings", `${state.build.errors} / ${state.build.warnings}`)}
    ${operationRow("Validation de l'artefact", state.operations.artifactValidation)}
    ${row("Dernier Flash", state.flash.lastFlashTime)}${operationRow("Programmation", state.operations.programming)}
    ${operationRow("Vérification", state.operations.verification)}${operationRow("Reset demandé", state.operations.reset)}
    <details class="operation-details"><summary>Résultats détaillés et ressources</summary>
    ${operationRow("Session Debug", state.operations.debugSession)}${operationRow("Exécution firmware", state.operations.execution)}</details>
  </section>${renderMemoryInspection(state)}<section class="card"><h2>Artefacts existants</h2>${state.artifacts.map((artifact) => `<div class="artifact"><strong>${escapeHtml(artifact.core ? `${artifact.core} ${artifact.kind}` : artifact.kind)}</strong><span>${(artifact.sizeBytes / 1024).toFixed(1)} KB</span><div class="path">${escapeHtml(artifact.path)}</div>${action("openArtifact", "Révéler", `data-id="${escapeHtml(artifact.id)}"`)}</div>`).join("") || "<p class=\"muted\">Aucun ELF/BIN/HEX/MAP trouvé dans les chemins connus du build.</p>"}</section>`;
}
