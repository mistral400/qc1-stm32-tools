import type { DashboardState } from "./dashboardState";
import { action, compactPath, escapeHtml, pathData, row } from "./html";

export function renderProjectView(state: DashboardState): string {
  const discovery = state.projectDiscovery;
  const active = discovery.activeCandidate;
  const files = (kind: "startupFiles" | "linkerScripts", fallback: string): string => {
    const values = [...new Set(active?.cores.flatMap((core) => core[kind]) || [])];
    return (values.length ? values : [fallback]).filter((value) => value && value !== "--").map(escapeHtml).join("<br>") || "Non confirmé";
  };
  const evidence = active?.evidence.filter((entry) => entry.weight > 0).slice(0, 12) || [];
  const buildFiles = [...new Set(active?.evidence.map((entry) => entry.file).filter((file) => /(?:Makefile|CMakeLists\.txt|\.mk|\.cmake|CMakePresets\.json)$/i.test(file)) || [])];
  const candidates = discovery.candidates.map(({ candidate, confidenceLabel }) => `
    <article class="candidate">
      <div class="candidate-head"><strong>${escapeHtml(candidate.name)}</strong><span class="badge">${escapeHtml(candidate.confidence)} / 100 · ${escapeHtml(confidenceLabel)}</span></div>
      <div class="muted">${escapeHtml(candidate.mcu || candidate.family || "MCU inconnu")} · ${escapeHtml(candidate.buildSystem)} · ${escapeHtml(candidate.architecture)}</div>
      <div class="path" title="${escapeHtml(candidate.path)}">${escapeHtml(compactPath(candidate.path))}</div>
      <details><summary>Preuves, avertissements et éléments manquants</summary>
        <ul>${candidate.evidence.slice(0, 8).map((entry) => `<li>${escapeHtml(entry.value)} <span class="muted">${escapeHtml(compactPath(entry.file))}</span></li>`).join("")}</ul>
        <ul>${[...candidate.missingComponents, ...candidate.warnings].map((entry) => `<li>${escapeHtml(entry.severity)} · ${escapeHtml(entry.message)}</li>`).join("") || "<li>Aucun problème signalé par l'analyse statique.</li>"}</ul>
      </details>
      ${action("useProject", candidate.path === discovery.selectedPath ? "Projet actif" : "Sélectionner", pathData(candidate.path), candidate.path === discovery.selectedPath)}
    </article>`).join("");
  return `
    <section class="card"><div class="section-heading"><h2>Projet actif</h2><span class="badge ${discovery.stale ? "warning" : ""}">${discovery.stale ? "À rescanner" : escapeHtml(state.project.projectStatus)}</span></div>
      <h3>${escapeHtml(active?.name || state.projectName)}</h3>
      <div class="path">${escapeHtml(discovery.selectedPath || state.project.workspacePath)}</div>
      ${row("Famille", active?.family || state.project.targetFamily)}
      ${row("MCU", active?.mcu || state.project.targetDevice)}${row("Carte", active?.board || "Inconnue — aucune carte déduite du MCU")}
      ${row("Architecture", active?.architecture || state.project.coreMode)}
      ${row("Cœurs", active?.cores.map((core) => core.name).join(" + ") || state.project.coreMode)}
      ${row("Build system", active?.buildSystem || "Non confirmé")}${row("Confiance", active ? `${active.confidence} / 100` : "Analyse statique à effectuer")}
      ${active?.family === "STM32H7" ? row("H755 CM7 / CM4", `${active.cores.some((core) => core.id === "cm7") ? "CM7 présent" : "CM7 non confirmé"} · ${active.cores.some((core) => core.id === "cm4") ? "CM4 présent" : "CM4 non confirmé"} · ${active.architecture}`) : ""}
      <div class="actions">${action("discoverProjects", "Détecter les projets")}${action("rescanProjects", "Rescanner")}${action("chooseProjectFolder", "Choisir / changer de dossier")}${action("openProjectFolder", "Ouvrir le dossier", "", !state.project.projectDetected && !discovery.selectedPath)}${action("command", "Diagnostiquer", 'data-command="status"')}</div>
      <p class="scan-status ${discovery.status === "scanning" ? "busy" : ""}" role="status">${escapeHtml(discovery.message || "Détection manuelle, statique et bornée.")}</p>
      ${discovery.status === "scanning" ? action("cancelProjectScan", "Annuler le scan") : ""}
      <details><summary>Structure et preuves du projet actif</summary>
        ${row("Build files", buildFiles.join(" · ") || "Non confirmé")}
        <div class="row"><span class="muted">Startup</span><span class="value path">${files("startupFiles", state.project.startupPath)}</span></div>
        <div class="row"><span class="muted">Linker</span><span class="value path">${files("linkerScripts", state.project.linkerScriptPath)}</span></div>
        <ul>${evidence.map((entry) => `<li>${escapeHtml(entry.type)} · ${escapeHtml(entry.value)} (+${escapeHtml(entry.weight)})<div class="muted path">${escapeHtml(entry.file)}</div></li>`).join("") || "<li>Aucune preuve détaillée chargée.</li>"}</ul>
        <ul>${active?.missingComponents.map((entry) => `<li class="${entry.severity === "error" ? "error" : "warning"}">${escapeHtml(entry.component)} · ${escapeHtml(entry.severity)} · ${escapeHtml(entry.message)}</li>`).join("") || ""}</ul>
        <ul>${active?.warnings.map((entry) => `<li>${escapeHtml(entry.code)} · ${escapeHtml(entry.message)}</li>`).join("") || ""}</ul>
        <p class="muted">.ioc, HAL, CMSIS et CubeMX ne sont pas des prérequis. Une dépendance absente n'est signalée que lorsqu'elle est référencée.</p>
      </details>
    </section>
    <section class="card"><h2>Projets récents</h2>${state.recentProjects.map((recent) => `
      <article class="recent"><strong>${escapeHtml(recent.name)}</strong><div class="muted">${escapeHtml(recent.mcu || recent.family || "Métadonnées non chargées")}${recent.available === undefined ? " · accès non confirmé" : ""}</div>
        <div class="path" title="${escapeHtml(recent.path)}">${escapeHtml(compactPath(recent.path))}</div><div class="actions">${action("useRecentProject", "Sélectionner", pathData(recent.path))}${action("removeRecentProject", "Retirer de la liste", pathData(recent.path))}</div>
      </article>`).join("") || "<p class=\"muted\">Aucun projet récent.</p>"}</section>
    <section class="card"><h2>Résultats de détection</h2>${candidates || `<p class="muted">${discovery.status === "success" ? "Aucun candidat dans le dernier résultat." : "Lancez une détection ou choisissez un dossier."}</p>`}
      <details><summary>Racines du dernier scan</summary><ul>${discovery.roots?.map((root) => `<li class="path">${escapeHtml(root)}</li>`).join("") || "<li>—</li>"}</ul></details>
    </section>`;
}
