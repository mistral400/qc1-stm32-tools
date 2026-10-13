import type { DashboardState } from "./dashboardState";
import { action, escapeHtml, row } from "./html";
export function renderToolsView(state: DashboardState): string {
  const hardware = state.environment.stlinkProbeStatus === "OK" ? "Connecté" : state.environment.stlinkProbeStatus === "non détecté" ? "Non détecté" : "Inconnu";
  return `<section class="card"><h2>Outils</h2><div class="actions">${action("refreshTools", "Re-détecter les outils")}${action("settings", "Réglages VS Code")}</div>
    <p class="muted">Présence issue des mécanismes QC1 existants; aucune commande externe en boucle. Version inconnue si elle n'a pas été mesurée.</p>
    ${state.tools.map((tool) => `<article class="tool"><div class="candidate-head"><strong>${escapeHtml(tool.name)}</strong><span class="badge ${tool.status === "Manquant" || tool.status === "Erreur" ? "warning" : ""}">${escapeHtml(tool.status)}</span></div>${row("Version", tool.version || "Inconnue")}${row("Source", tool.source)}<div class="path">${escapeHtml(tool.path)}</div></article>`).join("")}
    </section><section class="card"><h2>Matériel / ST-Link</h2>${row("ST-Link", hardware)}${row("Sonde sélectionnée pour ce projet", state.environment.stlinkSelectedProbe || "Non sélectionnée")}${row("Modèle de sonde", state.environment.stlinkModel || "Inconnu")}${row("Dernière mesure", state.environment.stlinkCheckedAt || "Non testé")}
    <p class="muted">La carte affichée sur la page Projet est une preuve statique, pas une carte physiquement connectée.</p>
    <div class="actions">${action("detectStlink", "Rafraîchir ST-Link")}${action("selectStlink", "Choisir la sonde")}${action("openSerial", "Moniteur série")}${action("startOpenOcd", "Serveur OpenOCD")}</div></section>`;
}
