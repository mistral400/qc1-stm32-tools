# Build, flash et debug

## Build

QC1 exécute CMake comme processus externe avec `cwd` à la racine du projet actif et des arguments séparés. Le CMake natif conserve son générateur et ses presets visibles; QC1 utilise les cibles et chemins d'artefacts disponibles dans la CMake File API. S'il existe plusieurs ELF ambigus, configure `qc1.elfPath`, `qc1.cm7ElfPath` ou `qc1.cm4ElfPath` au lieu de laisser QC1 deviner.

Sans CMake natif, le moteur intégré STM32F1 utilise le `CMakeLists.txt`, le toolchain file et Ninja embarqués/configurés. Un import CubeIDE H7 construit un CMake QC1; il choisit Ninja si disponible, sinon Make (`Unix Makefiles` sur macOS/Linux, ou un générateur Make compatible détecté sous Windows). Cette solution de repli ne change pas le générateur des projets CMake natifs. Un Makefile ou projet PlatformIO peut être reconnu par le scanner sans que QC1 exécute ces systèmes de build.

Pour les projets STM32H7 natifs, QC1 lit les presets CMake, les cibles exécutables et leurs métadonnées de cœur. Pour un import CubeIDE sans `CMakeLists.txt`, il construit un target CMake QC1 séparé par cœur à partir de `.cproject`, des sources communes, du startup, du linker et des dépendances disponibles. Une expression CMake non résolue n'est pas inventée en cible.

Le pipeline distingue configure, clean, build, création de BIN et flash. Les durées de build sont limitées à dix minutes; les autres processus QC1 à deux minutes. CMake et le générateur choisi transmettent stdout et stderr au journal. Un processus qui écrit sur stderr avec code 0 réussit; un timeout, une erreur de spawn ou un code de sortie non nul échoue.

## Flash

Avant de lancer un outil de programmation :

1. QC1 exécute `st-info --probe` pour inventorier les sondes connectées.
2. Il choisit l'association mémorisée pour le projet actif, associe automatiquement la probe seulement s'il n'y en a qu'une et que la vérification peut la confirmer, ou demande une sélection explicite.
3. Il utilise OpenOCD avec le numéro de série choisi puis vérifie que la cible runtime correspond à la famille du projet. Si OpenOCD n'est pas installé, il compare la famille au chip ID/à la description de la probe disponible.
4. Si l'inventaire est ambigu, la sonde absente, le numéro invalide ou la famille non confirmée, le flash s'arrête avant `program`, `write`, `erase` ou `reset`.

Le numéro de série est transmis à OpenOCD par `adapter serial` et à `st-flash` par `--serial`. Les lignes QC1 masquent les numéros complets, mais la Quick Pick les montre pour permettre à l'utilisateur de distinguer deux adaptateurs. Le stockage `workspaceState` garde le numéro par clé de projet hachée.

QC1 suit les sessions Cortex-Debug connues (avec la sonde déclarée par la session), le serveur OpenOCD démarré depuis QC1 et les opérations de programmation en cours. La page Outils affiche ces sessions; une nouvelle opération sur la même ST-Link est bloquée avec une instruction de fermeture. QC1 ne termine jamais une session active à la place de l'utilisateur. Avant une opération OpenOCD, QC1 vérifie aussi les ports locaux standards 3333/4444 : un port ouvert sans session suivie est seulement signalé comme occupation externe suspectée, car QC1 ne peut pas identifier son processus ni la sonde associée. Les ports OpenOCD personnalisés et les sessions démarrées avant l'activation que VS Code ne signale pas restent des limites de détection.

| Cible/backend | Artefact et comportement |
| --- | --- |
| STM32F1 + OpenOCD | ELF de la cible CMake active, validé puis passé à `program`, `verify`, `reset`, `exit` avec le target STM32F1 |
| STM32F1 + st-flash | ELF de la cible CMake active validé, conversion fraîche par `objcopy` dans un dossier temporaire isolé, `write`, `read` de même adresse/taille et comparaison exacte, puis commande `reset` séparée |
| H7 dual-core + OpenOCD | Un ELF par cœur; `cpu0` CM7 / `cpu1` CM4, `DUAL_CORE` et `DUAL_BANK`; le flash all programme et vérifie les deux ELF puis ne demande le reset qu'après le second. |
| H7 dual-core + st-flash | Non pris en charge par QC1 : il ne sélectionne pas CM7/CM4 avec le backend actuel. |

La validation de l'ELF exige une cible exécutable CMake unique, un artefact non vide dans le projet/dossier de build, une association de cœur non ambiguë lorsqu'elle s'applique, ainsi qu'une empreinte capturée. QC1 programme une copie ELF privée et vérifie que son empreinte correspond à l'artefact validé. Le fallback `st-flash` refuse les anciens BIN du dossier de build : il exige `objcopy` et compare le BIN temporaire à sa lecture Flash avant de demander un reset. L'absence de BIN, une lecture de taille différente, une comparaison différente ou une erreur textuelle reconnue arrête la séquence et empêche le reset explicite suivant.

L'indication Flash pleinement réussie requiert validation d'artefact, écriture, vérification et commande de reset acceptées sans erreur détectée. Pour OpenOCD, `verify` et `reset run` font partie de la commande intégrée; pour st-flash, la lecture/comparaison et `reset` sont des processus distincts. Cela ne prouve ni l'impulsion physique sur NRST, ni le démarrage ou le fonctionnement du firmware. Le précontrôle sonde/cible reste en lecture seule (`init; targets; shutdown`) et n'exécute ni programmation, ni effacement, ni halt/reset.

**Limite st-flash :** la documentation de stlink v1.8.0 indique que `st-flash write` déclenche déjà un reset sur NRST par défaut; `--reset` en demande deux. QC1 n'ajoute pas `--reset`, mais conserve une commande `st-flash reset` distincte après la vérification. Le fallback peut donc provoquer un reset à l'écriture puis un autre après la lecture comparée. Si NRST n'est pas câblé, stlink documente un reset logiciel de repli; le retour CLI ne permet pas à QC1 de distinguer le chemin physique utilisé. Pour une séquence strictement « vérifier puis un seul reset », utiliser le backend et la configuration dont ce comportement a été confirmé sur la carte. [Manpage st-flash v1.8.0](https://github.com/stlink-org/stlink/blob/v1.8.0/doc/man/st-flash.md), [guide stlink v1.8.0](https://github.com/stlink-org/stlink/blob/v1.8.0/doc/tutorial.md#d-understanding-hardware-and-software-reset-functionality-for-st-flash-and-reset-related-device-recovery).

La vérification OpenOCD confirme au mieux la famille STM32H7, pas la référence exacte du MCU, la carte, le câblage ou la validité électrique. Pour une première carte ou une nouvelle image, vérifie la référence sur la carte et inspecte les deux scripts de linker avant de flasher.

## Debug

QC1 lance une configuration temporaire `cortex-debug` avec `servertype: openocd`, SWD, un ELF existant, le chemin GDB et le numéro de sonde sélectionnée. Il n'écrit pas et ne modifie pas le `launch.json` utilisateur. Les options personnalisées définies uniquement dans `launch.json` ne sont pas fusionnées dans cette commande QC1; démarre-les depuis la vue Run and Debug si tu veux ces options.

- F1/single-core : STM32F1, OpenOCD F1 et un cœur.
- H7 CM7 : target `stm32h7x.cpu0` / `targetProcessor: 0`.
- H7 CM4 : target `stm32h7x.cpu1` / `targetProcessor: 1` avec la configuration dual-core nécessaire.
- Les sessions H7 sont distinctes. Le debug simultané CM7+CM4, synchronisation HSEM, reset coordination, caches et mémoire partagée ne sont pas fournis par QC1.

Le debug requiert Cortex-Debug, OpenOCD, GDB ARM, l'ELF du cœur et une sonde vérifiée. La détection de l'extension seule ne prouve pas que GDB et OpenOCD démarrent.

## Réglages d'outils

- `qc1.cmakePath`, `qc1.compilerPath`, `qc1.openocdPath` : chemins explicites; vide = découverte.
- `qc1.stlinkPath` : chemin de `st-info` utilisé pour inventaire des numéros de série.
- `qc1.buildDirectory`, `qc1.buildType`, `qc1.cmakePreset` : emplacement, type et preset.
- `qc1.elfPath`, `qc1.cm7ElfPath`, `qc1.cm4ElfPath` : choix manuel d'artefacts ambigus.
- `qc1.toolPaths` : autres outils référencés par le projet.
- `qc1.cubeH7Path` : racine locale STM32CubeH7 contenant `Drivers/`; aucun téléchargement automatique n'est lancé.

Les chemins relatifs d'outils sont résolus contre le projet actif. Les presets CMake sont réévalués après sélection du projet.

## Références d'outils

- [OpenOCD `adapter serial`](https://openocd.org/doc/html/Debug-Adapter-Configuration.html) : les drivers ST-Link prennent en charge l'identifiant serial configuré.
- [`st-flash --serial`](https://github.com/stlink-org/stlink/blob/testing/doc/man/st-flash.md) : sélection d'un adaptateur par série.
- [Cortex-Debug `serialNumber`](https://github.com/Marus/cortex-debug/blob/master/debug_attributes.md) : utilisé quand plusieurs ST-Link ou J-Link sont connectés.

## Pannes fréquentes

- **OpenOCD ne trouve pas la cible** : vérifier le driver/interface, l'alimentation et les connexions SWD; une bannière ST-Link seule ne suffit pas à confirmer une famille.
- **Sonde mémorisée absente** : brancher la sonde ou choisir un adaptateur connecté depuis la palette QC1; QC1 ne bascule pas silencieusement vers un autre numéro.
- **ELF absent/ambigu** : terminer un build réussi et sélectionner le bon ELF/core.
- **CMake échoue avant Ninja/Make** : lire l'erreur d'origine et le générateur actif; QC1 garde stderr et code de sortie.
- **Débogage impossible** : vérifier séparément le binaire OpenOCD, GDB, l'extension Cortex-Debug, la cible et le transport.
