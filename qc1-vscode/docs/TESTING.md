# Tests reproductibles

## Commandes depuis `qc1-vscode/`

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm audit --audit-level=high
npx --no-install vsce package --out /tmp/qc1-stm32-tools.vsix
npx --no-install vsce ls --tree
git diff --check
```

`npm test` compile TypeScript dans `out/` puis exécute tous les `test/*.test.js`. Les tests temporaires retirent leurs dossiers via `t.after()`. Les tests de build peuvent appeler un vrai CMake/ARM GCC local lorsqu'ils sont présents.

## Ce que couvre la suite

- Scan de structures et noms de dossiers variés, CMake, presets, File API, linkers et ambiguïtés.
- Projets F103/H755, cibles CM7/CM4, builds représentatifs et résultats ELF.
- Processus sans shell : stdout/stderr, erreur de lancement, sortie bornée, timeout, annulation, processus enfant et code de sortie.
- UI Dashboard, WebView et messages validés; réglages, récents, annulation et sélection multi-root sous VS Code mocké.
- Deux projets simulés F103/H755 avec ST-Link aux séries distinctes; sélection, routage OpenOCD, persistance par projet et bascules.
- Sanitization des rapports, chemins, secrets, serials et absence de fichiers d'IA dans le runtime.
- Cibles portables et chemins Windows/Linux/macOS simulés dans les tests unitaires.

Les tests d'intégration exécutent des binaires temporaires ou remplacent les réponses externes. Ils ne simulent pas électriquement SWD et ne prouvent pas un flash réel.

## Exécution locale précédente — 26 septembre 2026

Sur le Mac de cette mission (`darwin arm64`, Node 26.8.2), après les changements multi-probe, des guides, du manifeste, du masquage de série et de la protection de démarrage OpenOCD :

| Gate | Résultat |
| --- | --- |
| `npm run typecheck` | PASS — TypeScript |
| `npm run lint` | PASS — ESLint |
| `npm test` | PASS — 131 tests réussis; un test CubeMX `ExternalProject` ignoré faute de Ninja local |
| `npm audit --audit-level=high` | PASS — 0 vulnérabilité |
| Packaging VSIX | PASS — 93 fichiers; manifeste, modules runtime, ressources et 9 guides présents |
| Installation isolée du VSIX | PASS — VS Code CLI accepte le VSIX 0.3.1; le pack installe Cortex-Debug et Embedded Build Tools |
| Activation dans un host VS Code isolé | NOT TESTED — confirmation utilisateur requise avant exécution de l'extension locale |
| `git diff --check` | PASS après revue des sources et documents |
| Détection hardware Blue Pill / F103 | PASS — ST-Link V2 choisi explicitement; OpenOCD identifie `stm32f1x.cpu`, Cortex-M3, cible à 3,24 V et flash de 128 Kio |
| Build du firmware de test F103 | PASS — projet CMake temporaire compilé avec ARM GNU GCC 15.2.1; image `wfi` de 80 octets, sans configuration de périphérique |
| Flash / verify / reset F103 | PASS — commande OpenOCD construite avec le helper QC1 et lancée hors de l'interface VS Code; `Programming Finished`, `Verified OK`, reset |
| Debug matériel F103 | PASS — OpenOCD + GDB CLI; halt, lecture PC/SP, reprise, détachement et sortie 0. La session Cortex-Debug dans VS Code reste NOT TESTED |
| Sauvegarde/restauration flash | PASS — sauvegarde et lecture après restauration de 131072 octets identiques; SHA-256 `cb390d006b02a25b4493411f8a59395d46f3ec3366303a5d7e1148ed25c3fc70` |
| Hardware H755 / NUCLEO | NOT TESTED intentionnellement — NUCLEO-H755ZI-Q laissée débranchée à cause de l'instabilité USB; ce statut n'est pas un défaut QC1 |
| Multi-probe physique | NOT TESTED intentionnellement — seul le ST-Link V2 de la Blue Pill a été utilisé; les cas multi-probe restent simulés |

## Candidate 0.4.0 — 12 octobre 2026

| Gate | Résultat |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm test` | PASS — 138 réussites, 0 échec, 1 test ignoré faute de Ninja |
| `npm audit` | PASS — zéro vulnérabilité après mise à niveau vers `@vscode/vsce` 4.0.0 et correctifs transitifs compatibles |
| Importeur CubeIDE intégré | PASS — deux firmwares H745 de fixture compilés séparément avec ARM GCC, linkers et options par cœur |
| Détection du GPIO_Demo réel | PASS — projet et deux cœurs détectés; startup MDK ignoré |
| Build CM7/CM4 du GPIO_Demo réel | PASS — compilation réelle des deux cœurs via le pipeline QC1, CMake et Make |
| Flash H755 | NOT TESTED — aucun ST-Link trouvé (`st-info --probe` retourne zéro sonde) |

Le build réel utilise STM32CubeH7 `v1.13.0`, récupéré dans `~/Downloads/QC1-Releases/STM32CubeH7-v1.13.0` avec son fichier de licence et les sous-modules requis sous `Drivers/`. Aucun fichier du projet GPIO_Demo n'a été modifié. Le test passe par `getQc1Status`, `buildProcessInvocations`, CMake, Make, ARM GCC et le rapport QC1; il vérifie les artefacts des deux cœurs et leurs vecteurs à `0x08000000` (CM7) et `0x08100000` (CM4). Sur cette machine, QC1 choisit `Unix Makefiles` parce que Ninja n'est pas installé. Le test H755 `ExternalProject` reste ignoré faute de Ninja.

Les ELF et fichiers BIN/HEX/MAP des deux cœurs sont dans le `build/qc1` du projet. Le rapport `build/qc1/build-report.json` indique `built`. Aucun flash ni test LED n'a été lancé : `st-info --probe` n'a trouvé aucune sonde.

## CI

Pour le commit `21a313b` du 13 octobre 2026, les six jobs de `.github/workflows/qc1-portability.yml` ont passé `npm ci`, lint, typecheck, tests, audit et le packaging VSIX : Ubuntu 24.04 x64/ARM64, Windows Server 2022 x64, Windows 11 ARM64 et macOS 15 Intel/Apple Silicon. Ces résultats vérifient la suite et le paquet sur ces runners; ils ne valident pas le matériel STM32.

## Installation et activation VSIX locale

Le VSIX `qc1-stm32-tools-0.4.0.vsix` a été installé avec succès par la commande VS Code CLI. `code --list-extensions --show-versions` affiche `mistral400.qc1-stm32-tools@0.4.0`. VS Code a ouvert le dossier GPIO_Demo; le journal Extension Host confirme l'activation de QC1 via `workspaceContains`. L'affichage visuel du dashboard n'a pas été inspecté.

## Tests hardware

Le test physique de cette étape était limité à la Blue Pill / STM32F103 et à son ST-Link V2, selon la portée confirmée par l'utilisateur. La sonde a été sélectionnée par numéro de série explicite (non reproduit dans les rapports). OpenOCD 0.12.0 a identifié `stm32f1x.cpu`, Cortex-M3, l'ID détecté `0x20036410`, 128 Kio de flash et une tension cible de 3,24 V. `st-info` a reconnu `STM32F1xx_MD`/ID `0x410` et 20 Kio de SRAM; son champ taille flash a affiché 0, alors que la détection et la programmation OpenOCD ont confirmé 128 Kio.

Un firmware de test temporaire ne configurant aucun GPIO ou périphérique a été compilé, flashé, vérifié et suivi d'un reset. Le débogage GDB CLI a lu PC=`0x0800004e` et SP=`0x20004ffc`, repris l'exécution et détaché la cible. Ces commandes matérielles ont utilisé les helpers d'arguments et le lanceur de processus compilés de QC1; elles n'ont pas été déclenchées dans l'interface VS Code. Avant le flash, la flash principale complète (128 Kio) a été sauvegardée. Après le test, OpenOCD a restauré cette sauvegarde, confirmé `Verified OK` et reset la cible; une lecture indépendante a le même SHA-256 que la sauvegarde. Les option bytes et la protection RDP n'ont pas été modifiés.

Le premier essai de restauration du fichier brut via `st-flash` a renvoyé `Unknown memory region` avant toute écriture; la restauration a réussi via OpenOCD avec l'adresse explicite `0x08000000`. La NUCLEO-H755ZI-Q a été laissée débranchée à cause d'une instabilité USB et n'a pas été testée; les cas H755 physiques et le routage multi-probe physique sont donc **NOT TESTED**, sans les attribuer à un défaut QC1. Voir [COMPATIBILITY_MATRIX.md](COMPATIBILITY_MATRIX.md) pour les niveaux de preuve.
