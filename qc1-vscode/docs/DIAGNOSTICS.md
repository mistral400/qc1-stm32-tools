# Diagnostics et rapport QC1

## Dépannage courant

La commande **Show STM32 Status** prend une photographie du projet et des outils sans lancer build/flash. Les erreurs avant exécution doivent montrer le code QC1, la cause, le chemin concerné et une action possible.

| Signal | Vérifications |
| --- | --- |
| Projet absent / ambigu | Vérifier `qc1.projectPath`, la racine sélectionnée, les preuves CMake/MCU et les variantes conflictuelles |
| CMake configure échoue | Lire la commande, le `cwd`, stdout/stderr, preset et code de sortie; le scanner n'est pas un interpréteur CMake complet |
| Ninja/GCC absent | Distinguer projet CMake natif et moteur intégré F1; configurer les outils utilisés par le générateur |
| ELF absent | Terminer le build, examiner les cibles CMake File API et configurer les chemins de cœur si le projet est ambigu |
| ST-Link non détecté | Vérifier `st-info --probe`, câble USB data, permissions et pilote; un binaire `st-info` présent ne prouve pas un adaptateur connecté |
| Sonde/cible rejetée | Vérifier le numéro choisi, la cible runtime OpenOCD et la famille attendue; QC1 bloque si la famille n'est pas confirmée |
| Flash refusé avant programmation | Vérifier probe, famille cible, backend, ELF/BIN et linker; la sélection probe en soi n'efface ni reset la carte |
| Debug absent | Vérifier Cortex-Debug, OpenOCD, GDB ARM, ELF et le cœur choisi |

Le texte original d'une commande reste accessible dans les lignes du rapport/log; une classification ne remplace pas stdout/stderr.

## Créer et partager un rapport

1. Lance **Créer un rapport de diagnostic** après une erreur reproduite.
2. Décris l'action et l'erreur dans le champ facultatif.
3. QC1 collecte le système, les extensions pertinentes, les outils, les devices accessibles, le projet actif, les diagnostics, les artefacts connus, Git et les derniers logs.
4. Examine l'aperçu Markdown avant de copier ou d'enregistrer. Retire les informations que tu ne veux pas partager.

Les rapports sont en Markdown avec un résumé JSON `reportSchemaVersion: 2`. Ils ne lisent pas systématiquement les sources et n'exécutent pas de firmware. Ils peuvent contenir des messages d'outils ou de compilation; ces messages peuvent eux-mêmes contenir un extrait ou un chemin. QC1 masque les chemins personnels reconnus, emails, credentials communs, clés connues et numéros ST-Link complets, mais aucun filtre ne reconnaît toutes les données sensibles arbitraires.

Les serials sont remplacés par `<REDACTED>` dans les logs de QC1. L'état du projet n'affiche que le suffixe; la Quick Pick affiche le numéro complet pour rendre le choix explicite. Ne joins pas un rapport sans relire cette prévisualisation.

## Comment lire la vérification matérielle

- **Probe détectée** : un outil voit un adaptateur ST-Link; ce fait seul ne confirme aucune carte cible.
- **Probe sélectionnée** : une série est associée au projet actif.
- **Famille vérifiée** : OpenOCD a exposé une cible STM32F1/H755 correspondant à la famille analysée, ou les métadonnées `st-info` ont donné une preuve de famille quand OpenOCD est absent.
- **Board** : valeur statique inférée du projet, pas identification runtime de la carte branchée.
- **Flash/verify/reset/debug** : ne peuvent être PASS qu'après exécution physique appropriée; un test de builder ou un test simulé n'est pas une preuve matérielle.

QC1 ne lit pas encore le part number complet pour tous les STM32F1 et ne distingue pas les cartes qui utilisent le même MCU. Pour cette raison, la famille confirmée est une barrière de sécurité utile, pas une preuve complète de compatibilité électrique.

## Classification des erreurs

Les processus fournissent des faits séparés : executable, arguments affichés (numéros masqués), `cwd`, stdout, stderr, exit code, timeout et erreur de lancement. `stderr` n'est pas une condition d'échec en soi; le code de sortie, le timeout et l'erreur de spawn pilotent le résultat.

Le parseur de sortie enrichit ces faits avec les erreurs/avertissements observés dans les builds. Quand la classification n'est pas certaine, conserve le texte original et rapporte la limite plutôt que de présenter une hypothèse comme une cause confirmée.

Pour les codes QC1 par domaine, voir [QC1_CODES.md](../QC1_CODES.md). Pour les détails de commandes matérielles, voir [Build, flash et debug](BUILD_FLASH_DEBUG.md).
