import { action } from "./html";
export function renderSettingsView(): string {
  return `<section class="card"><h2>Réglages QC1</h2><p id="configurationScope" class="muted">Configuration VS Code · qc1.projectPath est l'unique source de vérité.</p>
    <form id="projectSettingsForm">
      <label for="projectPathInput">Projet actif — qc1.projectPath</label><input id="projectPathInput" name="projectPath" />
      <label for="buildTypeInput">Build type</label><select id="buildTypeInput" name="buildType"><option>Debug</option><option>Release</option><option>RelWithDebInfo</option><option>MinSizeRel</option></select>
      <label for="cmakePresetInput">Preset CMake (vide = détection)</label><input id="cmakePresetInput" name="cmakePreset" />
      <label for="buildDirectoryInput">Dossier de build</label><input id="buildDirectoryInput" name="buildDirectory" />
      <label for="serialPortInput">Port série</label><input id="serialPortInput" name="serialPort" />
      <label for="baudRateInput">Baud rate</label><input id="baudRateInput" name="baudRate" type="number" min="1" max="4000000" />
      <fieldset><legend>Reset OpenOCD — profil du projet actif</legend>
        <label for="resetModeInput">Méthode</label><select id="resetModeInput" name="resetMode">
          <option value="backend-default">Par défaut du backend</option><option value="software">Logiciel (SYSRESETREQ)</option>
          <option value="hardware-nrst">Matériel via NRST</option><option value="connect-under-reset">Connexion sous reset (NRST)</option>
        </select>
        <p class="muted">Les deux modes NRST exigent une ligne NRST câblée et prise en charge par la sonde. « Par défaut » conserve la configuration du backend. st-flash ne permet que ce mode par défaut. QC1 conserve ce profil par projet sous une clé hachée; le chemin du projet n'est pas stocké avec le profil.</p>
        <label for="adapterSpeedKHzInput">Vitesse SWD (kHz, vide = backend)</label><input id="adapterSpeedKHzInput" name="adapterSpeedKHz" type="number" min="1" max="10000" />
        <label for="srstPulseWidthMsInput">Impulsion NRST (ms, vide = backend)</label><input id="srstPulseWidthMsInput" name="srstPulseWidthMs" type="number" min="1" max="1000" />
        <label for="srstDelayMsInput">Délai après NRST (ms, vide = backend)</label><input id="srstDelayMsInput" name="srstDelayMs" type="number" min="0" max="10000" />
      </fieldset>
      <label class="checkbox"><input id="autoDiscoverProjectsInput" name="autoDiscoverProjects" type="checkbox" /> Détection automatique contrôlée (désactivée par défaut)</label>
      <label for="discoveryRootsInput">Racines personnalisées — une par ligne, ~/ supporté</label><textarea id="discoveryRootsInput" name="discoveryRoots" rows="4"></textarea>
      <p class="muted">Seuls workspace, projet actif, projets récents valides et ces racines sont utilisés. Jamais le disque complet ni le dossier home entier.</p>
      <button type="submit">Enregistrer</button>
    </form><div class="actions">${action("refreshSettings", "Relire les réglages")}${action("settings", "Tous les réglages VS Code")}${action("autoDetectPaths", "Enregistrer les chemins auto-détectés existants")}</div>
    <p class="muted">Avec un workspace, le projet actif est conservé dans sa configuration, même s'il est externe. Sans workspace, il est conservé dans les réglages User. Les autres réglages QC1 existants ne sont pas migrés.</p></section>`;
}
