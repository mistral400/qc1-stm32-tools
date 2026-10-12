# Matrice de compatibilité et de validation

État local de mission du 26 septembre 2026. **PASS** signifie que le niveau indiqué a réellement été exécuté; un test automatisé ne devient pas un test de matériel.

| Scénario | Résultat | Niveau / preuve |
| --- | --- | --- |
| VSIX installé depuis un profil propre | PASS — VS Code CLI accepte le VSIX 0.3.1; 93 fichiers | AUTOMATED — profil/dossier d'extensions isolés |
| Extension pack | PASS — QC1, Cortex-Debug et Embedded Build Tools listés après installation | AUTOMATED — VS Code CLI |
| Première activation Marketplace-like | NOT TESTED | Host VS Code isolé non lancé; l'activation exécute le code de l'extension |
| Découverte projet unique | PASS | AUTOMATED — fixtures F103/H755 et projet CMake natif |
| Deux projets dans un parent | PASS | AUTOMATED — fixtures multiples du scanner |
| Projets imbriqués/profondeurs différentes | PASS | AUTOMATED — découverte bornée avec projets nested |
| Workspace VS Code multi-root | PASS | AUTOMATED — VS Code mock, projet dans une deuxième racine |
| STM32 + dossier non STM32 | PASS | AUTOMATED — scanner et fixtures de négatifs |
| F103 + H755 dans une session | PASS | AUTOMATED — modèle et fixtures multi-projet |
| Plusieurs projets du même MCU | PASS | AUTOMATED — sélection/contrôleurs, pas flash physique |
| H755 avec targets CM7/CM4 | PASS | AUTOMATED — deux cibles et artefacts distingués |
| Changement rapide F103 → H755 → F103 | PASS | AUTOMATED — sélection de projet et mapping de probes simulés |
| F103 discovery | PASS | AUTOMATED — CMake, Makefile, layouts bare metal |
| F103 build | PASS | AUTOMATED — build CMake avec ARM GNU dans test représentatif |
| Blue Pill / F103 probe et target detection | PASS — ST-Link V2 sélectionné par série; `stm32f1x.cpu`, Cortex-M3, 3,24 V et ID `0x20036410` | REAL HARDWARE — OpenOCD 0.12.0; `st-info` reconnaît STM32F1xx_MD / ID `0x410`, mais affiche 0 pour la taille flash |
| F103 smoke firmware build | PASS — CMake + ARM GNU GCC 15.2.1, 80 octets, boucle `wfi` sans GPIO/périphériques | CLI local; projet temporaire de test, hors interface QC1 |
| F103 flash réel | PASS — firmware de test programmé via les arguments et le lanceur QC1; OpenOCD `Programming Finished` | REAL HARDWARE; commande lancée en CLI, pas depuis l'interface VS Code |
| F103 verify réel | PASS — OpenOCD `Verified OK` | REAL HARDWARE; helper d'arguments QC1 |
| F103 reset réel | PASS — OpenOCD a exécuté `Resetting Target` après programmation | REAL HARDWARE; helper d'arguments QC1 |
| F103 debug GDB CLI réel | PASS — halt, lecture PC=`0x0800004e` / SP=`0x20004ffc`, reprise, détachement, sortie 0 | REAL HARDWARE — arguments serveur OpenOCD QC1 + `arm-none-eabi-gdb`; activation VS Code/Cortex-Debug non testée |
| Restauration flash utilisateur | PASS — sauvegarde complète de 131072 octets restaurée et relue à l'identique; SHA-256 `cb390d006b02a25b4493411f8a59395d46f3ec3366303a5d7e1148ed25c3fc70` | REAL HARDWARE — OpenOCD `Verified OK`; option bytes/RDP non modifiés |
| H755 discovery | PASS | AUTOMATED — H755/CM7/CM4 détectés dans fixtures |
| H755 CM7 build | PASS | AUTOMATED — build CMake représentatif et ELF CM7 |
| H755 CM4 build | PASS | AUTOMATED — build CMake représentatif et ELF CM4 |
| H755 ExternalProject + Ninja | NOT TESTED | AUTOMATED — test ignoré, Ninja absent localement |
| H755 CM7 flash | NOT TESTED intentionnellement | REAL HARDWARE — NUCLEO-H755ZI-Q laissée débranchée à cause de l'instabilité USB; aucun défaut QC1 n'est conclu |
| H755 CM7 debug | NOT TESTED intentionnellement | REAL HARDWARE — NUCLEO-H755ZI-Q laissée débranchée |
| H755 CM4 flash/debug | NOT TESTED intentionnellement | REAL HARDWARE — NUCLEO-H755ZI-Q laissée débranchée |
| H755 dual-core boot/HSEM | NOT TESTED intentionnellement | REAL HARDWARE — NUCLEO-H755ZI-Q laissée débranchée |
| Plusieurs ST-Link physiques | NOT TESTED intentionnellement | REAL HARDWARE — scope matériel limité à la Blue Pill et à son ST-Link V2 |
| Découverte/sélection/routage multi-probe | PASS | AUTOMATED — deux serials simulés et arguments OpenOCD vérifiés |
| Changement de probe physique | NOT TESTED intentionnellement | REAL HARDWARE — portée limitée à la Blue Pill et à son ST-Link V2 |
| macOS Apple Silicon | PASS | AUTOMATED + REAL HARDWARE — gates locales et flash/debug CLI F103; activation de l'extension dans VS Code non testée |
| macOS Intel | NOT TESTED | CI — workflow défini, résultat distant non observé |
| Windows x64 | NOT TESTED | CI — workflow défini, résultat distant non observé |
| Windows ARM64 | NOT TESTED | CI — workflow défini, résultat distant non observé |
| Linux x64 | NOT TESTED | CI — workflow défini, résultat distant non observé |
| Linux ARM64 | NOT TESTED | CI — workflow défini, résultat distant non observé |
| Clean install npm | PASS | AUTOMATED — `npm ci`; 372 paquets audités, 0 vulnérabilité |
| Cortex-Debug configuration générée | PASS | AUTOMATED — forme F1/H755 testée; extension host non exécuté |
| Cortex-Debug UI session réelle | NOT TESTED | VS Code host non activé; la session GDB CLI réelle est validée séparément |
| Fonctionnement offline complet | NOT TESTED | STATIC ANALYSIS — chemins locaux supportés; téléchargement initial dépend de l'outil externe |
| Workspace Trust | PASS | AUTOMATED — opérations d'outils bloquées en mode non approuvé |

## Portée STM32

| Famille | Détection statique | Build QC1 | Flash QC1 | Debug QC1 | Limite |
| --- | --- | --- | --- | --- | --- |
| STM32F1 (dont F103) | PASS | PASS pour fixtures automatisées; firmware smoke temporaire compilé en CLI | PASS sur Blue Pill via helper/runner QC1 appelé en CLI; verify/reset confirmés; sauvegarde restaurée à l'identique | PASS via GDB CLI et helper serveur QC1; session VS Code/Cortex-Debug non testée | Résultat physique limité à une cible F1 et un ST-Link V2; interface utilisateur QC1 non activée |
| STM32H755 | PASS | PASS pour projets CMake représentatifs et cibles identifiées | NOT TESTED intentionnellement | CM7/CM4 logiciels PASS; debug matériel NOT TESTED intentionnellement | NUCLEO-H755ZI-Q laissée débranchée pour instabilité USB; cela n'indique pas un défaut QC1 |
| Autres STM32 | Découverte indicative | NOT APPLICABLE dans les backends QC1 actuels | NOT APPLICABLE | NOT APPLICABLE | Ne pas assimiler reconnaissance à support exécutable |

Les preuves automatisées sont reproductibles avec les commandes de [TESTING.md](TESTING.md). Le test F103 réel a flashé une image temporaire sûre, puis restauré et relu les 128 Kio sauvegardés; le SHA-256 sauvegarde/après restauration est `cb390d006b02a25b4493411f8a59395d46f3ec3366303a5d7e1148ed25c3fc70`. La preuve matérielle ne couvre pas l'activation de l'extension dans VS Code, les séquences H755 physiques ni plusieurs sondes physiques. Les runners CI définis restent à exécuter avant une déclaration générale de compatibilité.

## Résultats de l'import CubeIDE — 12 octobre 2026

| Scénario | Résultat | Niveau / preuve |
| --- | --- | --- |
| Détection H745/H747/H755/H757 depuis CubeIDE | PASS | AUTOMATED — `.cproject`, MCU, board, architecture, métadonnées et séparation par cœur |
| Import et build GPIO_Demo réel | PASS — build des deux cœurs | LOCAL SAMPLE — dépendances de STM32CubeH7 `v1.13.0`; le dossier source officiel est resté intact |
| Importeur CubeIDE double cœur | PASS — deux images CMake/ARM distinctes | AUTOMATED INTEGRATION — fixture H745, linkers indépendants, CPU/FPU/ABI par cœur et chemins Unicode/espaces |
| Vérification des fichiers mémoire GPIO_Demo | PASS statique — aucun chevauchement FLASH dans les scripts CM7/CM4 | STATIC ANALYSIS — ne prouve pas la validité des sections ELF ou le démarrage sur carte |
| HAL/CMSIS/BSP du GPIO_Demo | PASS — dépendances trouvées dans l'installation locale ciblée | DEPENDENCIES — `STM32CubeH7-v1.13.0/Drivers`; licence conservée; seules les dépendances référencées ont été récupérées |
| Flash/reset et test LED H755 | NOT TESTED | HARDWARE — aucun ST-Link n'a été détecté et aucun flash n'a été lancé |
| Gates de code au 12 octobre | PASS — 138 pass, 0 fail, 1 skip | LOCAL — skip `ExternalProject` faute de Ninja; typecheck/lint PASS; npm audit zéro vulnérabilité |

Le vrai build QC1 a produit CM7 et CM4 indépendamment : ELF, BIN, HEX et MAP; le rapport `build/qc1/build-report.json` indique `built`. Les vecteurs sont à `0x08000000` et `0x08100000`, conformément aux linkers GPIO_Demo. Le générateur utilisé est `Unix Makefiles`, choisi par le repli Make de l'importeur CubeIDE en l'absence de Ninja. Aucun flash ni test LED n'a eu lieu, car aucune sonde ST-Link n'a été détectée.

ST indique que les projets de `Projects/NUCLEO-H745ZI-Q` sont compatibles avec NUCLEO-H755ZI-Q ([readme officiel](https://github.com/STMicroelectronics/STM32CubeH7/blob/master/Projects/NUCLEO-H755ZI-Q/readme.txt)). QC1 conserve l'identité source H745 et peut présenter H755 comme carte compatible; le précontrôle OpenOCD établit la famille H7, pas le modèle exact. Ne pas confondre le build d'intégration avec un build du GPIO_Demo réel.
