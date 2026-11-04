export interface DiagnosticGuidanceInput {
  code?: string;
  title?: string;
  message?: string;
  cause?: string;
}

export interface DiagnosticGuidance {
  id: string;
  title: string;
  steps: string[];
}

interface GuidanceRule extends DiagnosticGuidance {
  matches: RegExp;
}

const rules: GuidanceRule[] = [
  {
    id: "serial-busy",
    title: "Libérer le port UART",
    matches: /(?:port série|port uart|serial port).*(?:occup|busy|déjà ouvert|in use)/i,
    steps: ["Déconnecte QC1, puis ferme tout autre moniteur série, terminal ou débogueur qui utilise ce port.", "Actualise la liste des ports et réessaie."],
  },
  {
    id: "usb-permission",
    title: "Vérifier l'accès USB",
    matches: /(?:permission|access denied|eacces|eperm|usb.*denied)/i,
    steps: ["Vérifie les permissions du système pour le périphérique USB.", "Sous Linux, contrôle les règles udev et l'appartenance au groupe série; reconnecte le périphérique après un changement."],
  },
  {
    id: "openocd-conflict",
    title: "Identifier une session OpenOCD concurrente",
    matches: /(?:openocd|3333|4444).*(?:occup|conflict|déjà utilisé|address in use)/i,
    steps: ["Vérifie si une session OpenOCD ou Cortex-Debug utilise déjà la sonde.", "Ferme proprement la session propriétaire ou sélectionne explicitement une autre sonde."],
  },
  {
    id: "verification-failed",
    title: "Contrôler la vérification mémoire",
    matches: /(?:verify|vérification|readback|lecture indépendante).*(?:failed|échou|error|erreur|mismatch|diff)/i,
    steps: ["Ne considère pas l'image comme confirmée.", "Vérifie l'adresse Flash, l'artefact sélectionné, la connexion SWD et les messages de lecture/compare."],
  },
  {
    id: "programming-failed",
    title: "Contrôler la programmation",
    matches: /(?:programming|programmation|flash).*(?:failed|échou|error|erreur|open failed)/i,
    steps: ["Vérifie le câblage SWD, l'alimentation de la cible et la sonde sélectionnée.", "Relis le premier message OpenOCD/st-flash et vérifie que la famille détectée correspond au projet."],
  },
  {
    id: "reset-unconfirmed",
    title: "Interpréter le résultat du reset",
    matches: /(?:reset|nrst).*(?:failed|échou|unconfirm|non confirmé|timeout|délai)/i,
    steps: ["Le retour de commande ne prouve pas à lui seul que NRST a basculé ni que le firmware a démarré.", "Vérifie le profil de reset, le câblage NRST et les messages du backend; conserve les preuves physiques séparément."],
  },
  {
    id: "elf-missing",
    title: "Retrouver l'ELF du projet actif",
    matches: /(?:elf|exécutable).*(?:missing|introuv|absent|ambigu|invalid|invalide)/i,
    steps: ["Relance une compilation du projet actuellement sélectionné.", "Vérifie la cible exécutable CMake et le chemin de l'artefact dans la page Build."],
  },
  {
    id: "cmake-invalid",
    title: "Corriger la configuration CMake",
    matches: /(?:cmake|configure|configuration).*(?:invalid|invalide|failed|échou|error|erreur)/i,
    steps: ["Ouvre la première erreur de configuration CMake dans le terminal QC1.", "Vérifie les chemins source, toolchain, preset et dépendances réellement référencés par le projet."],
  },
  {
    id: "toolchain-missing",
    title: "Configurer la toolchain",
    matches: /(?:gcc_arm|arm gcc|compilateur|cmake|ninja).*(?:missing|introuv|absent|manquant)/i,
    steps: ["Installe ou rends disponible l'outil indiqué dans le PATH.", "Si l'outil est déjà installé, configure son chemin dans les réglages QC1 et relance le diagnostic."],
  },
  {
    id: "wrong-target",
    title: "Confirmer la famille de cible",
    matches: /(?:famille|target family|mcu|stm32f1|stm32h7).*(?:mismatch|correspond|incompat|incorrect)/i,
    steps: ["Compare la cible CMake, le MCU déclaré par le projet et la famille observée par OpenOCD.", "Ne lance pas la programmation tant que ces sources ne concordent pas."],
  },
  {
    id: "stlink-missing",
    title: "Vérifier la sonde ST-Link",
    matches: /(?:st.?link|probe|sonde).*(?:missing|absent|indispon|not detected|non détect)/i,
    steps: ["Reconnecte la sonde et vérifie son alimentation USB.", "Actualise l'inventaire ST-Link; si plusieurs sondes sont présentes, sélectionne explicitement celle reliée à la cible."],
  },
];

export function getDiagnosticGuidance(input: DiagnosticGuidanceInput): DiagnosticGuidance[] {
  const text = [input.code, input.title, input.message, input.cause].filter(Boolean).join(" ");
  return rules.filter((rule) => rule.matches.test(text)).slice(0, 2).map(({ id, title, steps }) => ({ id, title, steps }));
}
