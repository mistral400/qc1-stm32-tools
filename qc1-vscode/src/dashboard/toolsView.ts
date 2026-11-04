import type { DashboardState } from "./dashboardState";
import { action, escapeHtml, row } from "./html";

export function renderToolsView(state: DashboardState): string {
  const hardware = state.environment.stlinkProbeStatus === "OK" ? "Connecté" : state.environment.stlinkProbeStatus === "non détecté" ? "Non détecté" : "Inconnu";
  const serial = `<section class="card" id="serialMonitor"><h2>Moniteur UART</h2>
    <p class="muted">Connexion série directe · les données restent en mémoire de session et ne sont enregistrées qu'à ta demande.</p>
    <p id="serialStatus" class="status-line" role="status">Déconnecté</p><p id="serialCounters" class="muted">RX 0 octet · TX 0 octet</p><p id="serialError" class="diagnostic error" hidden></p>
    <form id="serialConnectForm" class="serial-grid">
      <label for="serialPortSelect">Port</label><select id="serialPortSelect"><option value="${escapeHtml(state.environment.serialPort)}">${escapeHtml(state.environment.serialPort || "Choisir un port")}</option></select>
      <label for="serialBaudRate">Baud rate</label><input id="serialBaudRate" type="number" min="50" max="4000000" value="${state.environment.baudRate}" required />
      <label for="serialDataBits">Bits de données</label><select id="serialDataBits"><option>8</option><option>7</option><option>6</option><option>5</option></select>
      <label for="serialParity">Parité</label><select id="serialParity"><option value="none">Aucune</option><option value="even">Paire</option><option value="odd">Impaire</option><option value="mark">Mark</option><option value="space">Space</option></select>
      <label for="serialStopBits">Bits d'arrêt</label><select id="serialStopBits"><option>1</option><option>2</option></select>
      <label class="checkbox" for="serialRtsCts"><input id="serialRtsCts" type="checkbox" /> Contrôle RTS/CTS</label><span></span>
      <div class="actions serial-actions"><button type="button" class="action-quiet" data-action="serialRefresh">Lister les ports</button><button type="submit" class="action-primary" id="serialConnectButton">Connecter</button><button type="button" class="action-secondary" data-action="serialDisconnect" id="serialDisconnectButton" disabled>Déconnecter</button></div>
    </form>
    <div class="serial-display-options"><label for="serialDisplayMode">Réception</label><select id="serialDisplayMode"><option value="ascii">ASCII</option><option value="hex">HEX</option></select><label class="checkbox" for="serialTimestamps"><input id="serialTimestamps" type="checkbox" /> Horodatage</label></div>
    <form id="serialSendForm"><label for="serialTx">Transmission</label><textarea id="serialTx" rows="3" maxlength="12300" placeholder="Texte à envoyer ou octets HEX"></textarea>
      <div class="serial-display-options"><label for="serialTxMode">Format TX</label><select id="serialTxMode"><option value="ascii">Texte UTF-8</option><option value="hex">Octets HEX</option></select><label class="checkbox" for="serialAppendNewline"><input id="serialAppendNewline" type="checkbox" /> Ajouter CR/LF</label></div>
      <div class="actions">${action("serialClear", "Effacer")}${action("serialSaveLog", "Enregistrer le journal")}<button id="serialSendButton" type="submit" class="action-secondary" disabled>Envoyer</button></div>
    </form>
    <pre id="serialOutput" class="serial-output" aria-live="off">En attente de données UART.</pre>
    <div class="serial-graph-header"><strong>Graphique QC1</strong><span id="serialGraphStatus" class="muted">Protocole JSON Lines requis</span></div>
    <svg id="serialGraph" class="serial-graph" viewBox="0 0 600 180" role="img" aria-label="Graphique des données série QC1"></svg><div id="serialGraphLegend" class="serial-legend"></div>
    <div class="actions">${action("serialGraphControl", "Pause", 'data-graph-action="pause"', true, "quiet")}${action("serialGraphControl", "Reprendre", 'data-graph-action="resume"', true, "quiet")}${action("serialGraphControl", "Réinitialiser", 'data-graph-action="clear"', true, "quiet")}${action("serialGraphControl", "Exporter CSV", 'data-graph-action="exportCsv"', true, "quiet")}</div>
    <p class="muted">Graphes : une ligne JSON par échantillon, format <code>{"qc1_plot":1,"time_ms":123,"values":{"temperature_c":22.5}}</code>. Jusqu'à 8 variables et 1 000 échantillons conservés.</p>
    <div class="actions">${action("openSerial", "Actualiser le moniteur UART")}</div></section>`;
  return `${serial}
    <section class="card"><h2>Outils</h2><div class="actions">${action("refreshTools", "Re-détecter les outils")}${action("settings", "Réglages VS Code")}</div>
    <p class="muted">Présence issue des mécanismes QC1 existants; aucune commande externe en boucle. Version inconnue si elle n'a pas été mesurée.</p>
    ${state.tools.map((tool) => `<article class="tool"><div class="candidate-head"><strong>${escapeHtml(tool.name)}</strong><span class="badge ${tool.status === "Manquant" || tool.status === "Erreur" ? "warning" : ""}">${escapeHtml(tool.status)}</span></div>${row("Version", tool.version || "Inconnue")}${row("Source", tool.source)}<div class="path">${escapeHtml(tool.path)}</div></article>`).join("")}
    </section><section class="card"><h2>Matériel / ST-Link</h2>${row("ST-Link", hardware)}${row("Sonde sélectionnée pour ce projet", state.environment.stlinkSelectedProbe || "Non sélectionnée")}${row("Modèle de sonde", state.environment.stlinkModel || "Inconnu")}${row("Dernière mesure", state.environment.stlinkCheckedAt || "Non testé")}
    <h3>Sessions matérielles connues</h3>${state.hardwareSessions.length ? state.hardwareSessions.map((session) => `<article class="tool"><strong>${escapeHtml(session.owner)}</strong>${row("Sonde", session.probe)}${row("Projet", session.project)}</article>`).join("") : `<p class="muted">Aucune session QC1 connue.</p>`}
    <p class="muted">La carte affichée sur la page Projet est une preuve statique, pas une carte physiquement connectée.</p>
    <div class="actions">${action("detectStlink", "Rafraîchir ST-Link")}${action("selectStlink", "Choisir la sonde")}${action("startOpenOcd", "Serveur OpenOCD")}</div></section>`;
}
