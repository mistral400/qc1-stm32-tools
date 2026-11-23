import { action, escapeHtml } from "../../dashboard/html";
import { formatAddress, getDatabaseMetadata, getRegister, getRegisterField, listDeviceModels, listRegisters, getPackagePins } from "../catalog";
import { listGpioModes } from "../recipes/gpioConfiguration";
import { defaultRegixPreferences, REGIX_ENGINE_VERSION } from "../preferences";
import type { RegisterDefinition } from "../types";

function selectedOption(value: string, selected: string): string {
  return value === selected ? " selected" : "";
}

function accessLabel(access: string): string {
  return ({ "read-only": "RO · lecture seule", "read-write": "RW · lecture/écriture", "write-only": "WO · écriture seule", "write-one-to-clear": "W1C" } as Record<string, string>)[access] || access;
}

function registerDetail(register: RegisterDefinition): string {
  const fields = register.fields.map((field) => {
    const mask = getRegisterField(register, field.name).mask;
    const end = field.lsb + field.width - 1;
    const range = field.width === 1 ? String(field.lsb) : `${end}:${field.lsb}`;
    return `<tr><td>${escapeHtml(field.name)}</td><td>${range}</td><td>${field.width}</td><td>0x${mask.toString(16).toUpperCase().padStart(8, "0")}</td><td>${escapeHtml(accessLabel(field.access))}</td></tr>`;
  }).join("");
  return `<div class="row"><span class="muted">Adresse</span><span class="value">${formatAddress(register.address)}</span></div>
    <div class="row"><span class="muted">Offset</span><span class="value">${formatAddress(register.offset)}</span></div>
    <div class="row"><span class="muted">Largeur / accès</span><span class="value">${register.width} bits · ${escapeHtml(accessLabel(register.access))}</span></div>
    <div class="terminal-output regix-field-list"><table><thead><tr><th>Champ</th><th>Bits</th><th>Largeur</th><th>Masque</th><th>Accès</th></tr></thead><tbody>${fields}</tbody></table></div>
    <p class="muted">Lecture avec effet : ${register.readSideEffects ? "oui" : "non"} · Écriture avec effet : ${register.writeSideEffects ? "oui" : "non"} · ${escapeHtml(register.writeSemantics)}</p>`;
}

export function renderRegixView(): string {
  const registers = listRegisters();
  const devices = listDeviceModels();
  const pins = getPackagePins(defaultRegixPreferences.deviceId);
  const modes = listGpioModes();
  const initialRegister = getRegister("GPIOC_CRH");
  const registerOptions = registers.map((register) => `<option value="${escapeHtml(register.id)}"${selectedOption(register.id, "GPIOC_CRH")}>${escapeHtml(register.id)} · ${formatAddress(register.address)}</option>`).join("");
  const deviceOptions = devices.map((device) => `<option value="${escapeHtml(device.id)}"${selectedOption(device.id, defaultRegixPreferences.deviceId)}>${escapeHtml(device.partNumber)} · ${device.flashKiB} KiB Flash · ${escapeHtml(device.packageId)}${device.status === "course-reference" ? " · référence du cours" : " · modèle voisin"}</option>`).join("");
  const pinOptions = pins.map((pin) => `<option value="${escapeHtml(pin.name)}" data-max-speed="${pin.maxOutputMHz ?? 50}" data-default-function="${escapeHtml(pin.defaultFunction || "")}" data-electrical-note="${escapeHtml(pin.electricalNote || "")}" data-remap-required="${escapeHtml(pin.remapRequired || "")}"${selectedOption(pin.name, "PC13")}>${escapeHtml(pin.name)} · broche ${pin.physicalPin}${pin.defaultFunction ? ` · ${escapeHtml(pin.defaultFunction)}` : ""}</option>`).join("");
  const modeOptions = modes.map((mode) => `<option value="${escapeHtml(mode.id)}" data-output="${mode.output ? "true" : "false"}" data-speed="${mode.speedMHz ?? 0}"${selectedOption(mode.id, "outputPushPull2MHz")}>${escapeHtml(mode.labelFr)}</option>`).join("");
  const databaseVersion = getDatabaseMetadata().databaseVersion;
  return `<section class="card regix-card">
    <div class="regix-title"><div><h2>REGIX — Register Engineering &amp; Generation Engine</h2><p class="muted">Moteur déterministe hors ligne · version ${REGIX_ENGINE_VERSION} · base de données ${escapeHtml(databaseVersion)}</p></div><span class="badge">v${REGIX_ENGINE_VERSION}</span></div>
    <p class="warning">La cible affichée est un choix logiciel, pas une lecture de la puce ni une détection de la carte. Le modèle réel reste à confirmer.</p>
    <p class="muted">STM32F103CBT6 est la référence de cours. STM32F103C8T6 est un modèle voisin distinct; les deux utilisent la classe CMSIS STM32F103xB.</p>
  </section>
  <section class="card">
    <h2>Explorateur RCC et GPIO</h2>
    <label for="regixRegisterSelect">Registre</label><select id="regixRegisterSelect">${registerOptions}</select>
    <div id="regixRegisterDetail">${registerDetail(initialRegister)}</div>
    <p class="muted">Le catalogue couvre RCC_APB2ENR et les registres GPIO CRL, CRH, IDR, ODR, BSRR et BRR. Les registres listés sont des descriptions, pas des lectures matérielles.</p>
  </section>
  <section class="card">
    <h2>Configuration GPIO</h2>
    <label for="regixPinSelect">Broche du boîtier LQFP48</label><select id="regixPinSelect">${pinOptions}</select>
    <label for="regixGpioMode">Mode</label><select id="regixGpioMode">${modeOptions}</select>
    <p id="regixPinWarning" class="warning" role="status" hidden></p>
    <div class="actions">${action("regixGenerate", "Prévisualiser le code", "", false, "primary")}</div>
    <div class="regix-values" id="regixGeneratedValues" hidden></div>
    <div class="regix-explanations" id="regixExplanations"></div>
    <div class="regix-preview-controls">
      <label for="regixPreviewTarget">Aperçu</label>
      <select id="regixPreviewTarget"><option value="snippet">Extrait C</option><option value="header">Fichier .h</option><option value="source">Fichier .c</option></select>
      <pre id="regixPreviewCode" class="terminal-output" aria-label="Code C prévisualisé">Cliquez sur « Prévisualiser le code » pour calculer le résultat.</pre>
      <div class="actions">${action("regixOpenPreview", "Ouvrir dans un onglet C non enregistré", 'data-target="selected"', true)}${action("regixOpenPreview", "Ouvrir les deux fichiers", 'data-target="all"', true)}${action("regixCopyPreview", "Copier l’aperçu", 'data-target="selected"', true)}</div>
      <p id="regixPreviewStatus" class="muted" role="status">L’aperçu est obligatoire avant ouverture selon les préférences.</p>
    </div>
  </section>
  <section class="card">
    <h2>Préférences REGIX</h2>
    <form id="regixPreferencesForm">
      <label for="regixDeviceSelect">Modèle logiciel</label><select id="regixDeviceSelect" data-regix-preference="deviceId">${deviceOptions}</select>
      <label for="regixBoardProfile">Profil de carte</label><select id="regixBoardProfile" data-regix-preference="boardProfileId"><option value="unconfirmed" selected>Aucun profil confirmé</option></select>
      <label for="regixGenerationMode">Mode de génération</label><select id="regixGenerationMode" data-regix-preference="mode"><option value="bare-metal">Bare-metal</option><option value="cmsis">CMSIS</option></select>
      <details><summary>Options de génération</summary>
        <label for="regixComments">Commentaires</label><select id="regixComments" data-regix-preference="comments"><option value="none">Aucun</option><option value="simple">Simples</option><option value="detailed">Détaillés</option></select>
        <label for="regixCommentLanguage">Langue des commentaires</label><select id="regixCommentLanguage" data-regix-preference="commentsLanguage"><option value="fr">Français</option><option value="en">Anglais</option></select>
        <div class="regix-check-grid">
          <label class="checkbox"><input type="checkbox" data-regix-preference="showHex"> Valeurs HEX</label>
          <label class="checkbox"><input type="checkbox" data-regix-preference="showBin"> Valeurs BIN</label>
          <label class="checkbox"><input type="checkbox" data-regix-preference="showDec"> Valeurs DEC</label>
          <label class="checkbox"><input type="checkbox" data-regix-preference="explainOffsetsAndMasks"> Expliquer offsets et masques</label>
          <label class="checkbox"><input type="checkbox" data-regix-preference="emitDefines"> Émettre les constantes en #define</label>
          <label class="checkbox"><input type="checkbox" data-regix-preference="previewRequired"> Aperçu obligatoire avant ouverture</label>
          <label class="checkbox"><input type="checkbox" data-regix-preference="expertMode"> Mode expert</label>
        </div>
        <label for="regixMacroPrefix">Préfixe des macros</label><input id="regixMacroPrefix" data-regix-preference="macroPrefix" type="text" maxlength="32" value="REGIX">
        <label for="regixFunctionPrefix">Préfixe des fonctions</label><input id="regixFunctionPrefix" data-regix-preference="functionPrefix" type="text" maxlength="32" value="REGIX">
        <label for="regixOutputKind">Format</label><select id="regixOutputKind" data-regix-preference="outputKind"><option value="snippet">Extrait C</option><option value="files">Paire .h / .c</option></select>
      </details>
    </form>
    <p class="muted">Les préférences sont enregistrées dans les paramètres QC1 de la fenêtre. Le kit TEP et la puce réelle ne sont pas déduits du projet ouvert.</p>
  </section>
  <section class="card" id="regixExpertSection" hidden>
    <h2>Calculateur générique de bits et champs</h2>
    <label for="regixBitOperation">Opération</label><select id="regixBitOperation"><option value="and">AND</option><option value="or">OR</option><option value="xor">XOR</option><option value="not">NOT (32 bits)</option><option value="readBits">Lire un champ de bits</option></select>
    <label for="regixBitOperandA">Valeur A</label><input id="regixBitOperandA" type="text" value="0x00000010" autocomplete="off">
    <label for="regixBitOperandB">Valeur B</label><input id="regixBitOperandB" type="text" value="0x00000004" autocomplete="off">
    <label for="regixBitOffset">Décalage de champ (Lire un champ seulement)</label><input id="regixBitOffset" type="number" min="0" max="31" value="0" disabled>
    <label for="regixBitWidth">Largeur de champ (Lire un champ seulement)</label><input id="regixBitWidth" type="number" min="1" max="32" value="1" disabled>
    <div class="actions">${action("regixCalculate", "Calculer les bits", "", false, "primary")}</div>
    <div id="regixBitResult" class="terminal-output" role="status">Résultat du calcul.</div>
  </section>
  <section class="card"><h2>Sources et état</h2><p>Registres : RM0008 rév. 21. Brochage et contraintes électriques : DS5319 rév. 20. Classe CMSIS : cmsis-device-f1 v4.3.3.</p><p class="muted">Aucun profil de carte n'est fourni. Vérifiez les fonctions alternatives, le câblage, les limites électriques et le modèle réellement installé avant d'utiliser le code.</p></section>`;
}
