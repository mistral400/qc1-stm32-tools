# Importer un projet STM32H7 CubeIDE dual-core

QC1 peut importer un projet STM32CubeIDE H745/H747/H755/H757 qui contient des dossiers CM7 et CM4, même si le projet n'a pas de `CMakeLists.txt`. Il lit les fichiers enregistrés; STM32CubeIDE n'a pas besoin d'être installé.

## Détection

QC1 s'appuie sur les `.cproject` et `.project` de chaque cœur. Il lit le MCU, la carte déclarée, les includes, les définitions, le FPU et l'ABI. Il attribue à chaque cœur ses sources, ses headers, son startup et son linker. Les sources sous `Common/` sont compilées dans les deux cibles. Les startups sous `MDK-ARM/` ne sont pas mélangés aux startups référencés par CubeIDE.

Le nom de MCU dans les réglages identifie le projet logiciel. ST indique dans le [readme du dossier NUCLEO-H755ZI-Q](https://github.com/STMicroelectronics/STM32CubeH7/blob/master/Projects/NUCLEO-H755ZI-Q/readme.txt) que les projets sous `Projects/NUCLEO-H745ZI-Q` sont compatibles avec cette carte. L'exemple conserve donc son identité logicielle H745 et peut être utilisé avec la carte H755 compatible; QC1 ne renomme jamais le MCU source en H755. Une cible OpenOCD `stm32h7x.cpu0` ou `cpu1` prouve uniquement la famille H7, pas la référence exacte du composant connecté. Les cartes embarquent des références différentes (`STM32H745ZIT6` et `STM32H755ZIT6`); la documentation de la carte reste la référence pour le câblage et les particularités matérielles.

## Dépendances

Dans **Preferences: Open User Settings (JSON)**, indique au besoin la racine locale d'une version STM32CubeH7 compatible :

```json
{
  "qc1.cubeH7Path": "/chemin/vers/STM32Cube_FW_H7_VX.Y.Z"
}
```

Cette racine doit contenir `Drivers/`. QC1 cherche aussi les dossiers `Drivers/` du projet et les installations usuelles dans `~/STM32Cube/Repository/`. Il n'installe ni ne télécharge de composants.

Pour un import CubeIDE qui utilise HAL, QC1 vérifie `stm32h7xx_hal.h`, `stm32h7xx_hal.c` et la configuration `stm32h7xx_hal_conf.h` de chaque cœur. Il choisit les sources HAL correspondant aux macros `HAL_*_MODULE_ENABLED` présentes dans cette configuration. Il vérifie les headers CMSIS Core nécessaires et le header CMSIS Device propre au MCU, par exemple `stm32h745xx.h`. Le BSP STM32H7 Nucleo n'est requis que si le projet l'inclut ou appelle `BSP_*`; quand il est requis, QC1 vérifie son header et son source.

Un build importé est bloqué lorsqu'une dépendance ou une option CPU/FPU/ABI nécessaire manque. Les diagnostics donnent le composant et le chemin attendu. Les projets CMake natifs gardent la responsabilité de leurs dépendances propres au projet.

## Compilation et rapport

Après avoir ouvert le dossier du projet, utilise **QC1: Build STM32H7 CM7**, **QC1: Build STM32H7 CM4**, ou **Build Project** pour les deux cœurs. Les cibles CMake intégrées sont `firmware_cm7` et `firmware_cm4`. Chaque cible utilise ses options CPU/FPU/ABI, ses sources, son startup et son linker.

Le build intégré écrit les fichiers dans le dossier réglé par `qc1.buildDirectory` (par défaut `build/qc1`) :

```text
build/qc1/
├── CM7/firmware.elf, firmware.bin, firmware.hex, firmware.map
├── CM4/firmware.elf, firmware.bin, firmware.hex, firmware.map
└── build-report.json
```

Le rapport indique `configured` après configuration CMake. Après un build QC1 réussi, il enregistre l'état des artefacts et les régions mémoire extraites des scripts de linker. Un build CM7 seul marque CM4 comme non demandé dans cette exécution. Les valeurs mémoire sont lues dans les linkers; QC1 ne crée pas de régions mémoire.

## GPIO_Demo local

Ouvre le dossier fourni avec :

```sh
code --reuse-window "/Users/matisserheaume-viale/Downloads/STMicroelectronics STM32CubeH7 master Projects-NUCLEO-H745ZI-Q_Examples_GPIO_GPIO_Demo"
```

Le dossier local est détecté comme `GPIO_Demo`, MCU `STM32H745ZITx`, carte déclarée `NUCLEO-H745ZI-Q`, carte compatible documentée `NUCLEO-H755ZI-Q`, architecture dual-core. Les fichiers CubeIDE fournissent un startup et un linker distincts par cœur. Le startup `MDK-ARM/startup_stm32h745xx.s` est ignoré.

Les scripts de linker locaux déclarent statiquement :

| Cœur | FLASH | RAM | Autres régions / pile |
| --- | --- | --- | --- |
| CM7 | `0x08000000`, 1024 KiB | `0x20000000`, 128 KiB | ITCM `0x00000000`, 64 KiB; `_estack = 0x20020000` |
| CM4 | `0x08100000`, 1024 KiB | `0x10000000`, 288 KiB | `_estack = 0x10048000` |

Les plages FLASH ne se chevauchent pas dans ces fichiers. Cela prouve uniquement la configuration statique des linkers; il faut construire les vrais ELF pour vérifier les sections et utiliser la référence matérielle exacte avant programmation.

Le dossier GPIO_Demo reste intact. Les dépendances utilisées pour le build local sont dans `~/Downloads/QC1-Releases/STM32CubeH7-v1.13.0`; cette copie ciblée contient `Drivers/`, le fichier de licence ST et les sous-modules CMSIS Device, HAL et BSP requis. Dans VS Code, règle `qc1.cubeH7Path` sur cette racine. QC1 ne télécharge pas ces fichiers automatiquement.

Le pipeline QC1 a compilé les deux vrais cœurs de cet exemple avec CMake, Make (`Unix Makefiles`) et ARM GNU Toolchain. Il a produit un ELF, BIN, HEX et MAP par cœur sous `build/qc1/CM7/` et `build/qc1/CM4/`, plus `build-report.json` avec l'état `built`. `objdump` confirme les vecteurs CM7 à `0x08000000` et CM4 à `0x08100000`. Sur cette machine Ninja n'est pas installé : l'import CubeIDE H7 utilise Make en repli; le moteur F1 intégré exige toujours Ninja.

Pour l'essai sur NUCLEO-H755ZI-Q, ouvre le dossier ci-dessus, confirme la carte compatible `NUCLEO-H755ZI-Q` sans changer le MCU projet `STM32H745ZITx`, puis lance **Build Project**. Vérifie les deux ELF et leur rapport avant tout flash. OpenOCD doit confirmer la famille H7 et la sonde sélectionnée; QC1 ne peut pas établir par ce seul contrôle que la référence exacte est H755. N'utilise pas `st-flash` dual-core. Après flash/verify des deux cœurs, QC1 ne demande le reset qu'une fois les deux opérations réussies. Aucun ST-Link n'était détecté pendant cette validation, donc aucun flash ou test LED n'a été fait. Le test des LEDs exige une carte connectée et une vérification des affectations GPIO de l'exemple contre le manuel de la carte.

## Flash et debug

Le flash dual-core exige OpenOCD et les deux ELF. **Flash Project** sélectionne `cpu0` pour CM7 et `cpu1` pour CM4 dans une seule session, vérifie chaque image, puis demande un reset après les deux programmations. **Flash STM32H7 CM7** et **Flash STM32H7 CM4** restent des commandes ciblées par cœur. QC1 ne sélectionne pas les cœurs H7 dual-core avec `st-flash`.

Avant flash/debug, QC1 associe une sonde ST-Link au projet et exécute un précontrôle de famille en lecture seule quand OpenOCD est disponible. Ce contrôle n'identifie pas la référence exacte du MCU. Ne flashe pas le projet H745 sur une carte H755 sans confirmer cette compatibilité et ses adresses auprès de la documentation matérielle applicable.

Les sessions Cortex-Debug CM7 et CM4 sont séparées. Le lancement coordonné des deux cœurs, le boot dual-core réel, le fonctionnement HSEM et le test physique des LEDs ne sont pas validés par un build logiciel.
