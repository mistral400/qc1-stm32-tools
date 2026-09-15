# QC1 STM32 CMake Tools

QC1 permet de compiler, flasher et déboguer les projets STM32F1 single-core et les projets STM32H755 CM7/CM4 directement depuis VS Code. Le moteur intégré F1 utilise **CMake + Ninja**. Pour H755, QC1 orchestre le CMake natif généré par STM32CubeMX et ne remplace ni son code, ni sa toolchain, ni sa séquence de boot HSEM.

Le rapport `QC1: Créer un rapport de diagnostic` comprend vingt sections et un résumé JSON `reportSchemaVersion: 2`. Il inspecte les chemins, la casse, CMake, les outils, les extensions, l'OS et le matériel avec des limites de lecture et des timeouts. Voir [l'audit de portabilité](AUDIT_PORTABILITY.md) pour les contrôles, tests et limites.

Les réglages facultatifs `qc1.toolPaths`, `qc1.targetMcu`, `qc1.elfPath`, `qc1.cm7ElfPath` et `qc1.cm4ElfPath` permettent de déclarer des outils supplémentaires, une preuve de MCU et des artefacts personnalisés.

## Par quoi commencer

1. Installe l'extension QC1 :

   ```sh
   code --install-extension qc1-stm32-tools-0.3.1.vsix --force
   ```

2. Redémarre VS Code. Les extensions **CMake Tools**, **Embedded Build Tools** et **Cortex-Debug** sont installées automatiquement. Au premier lancement, Embedded Build Tools télécharge CMake, Ninja et ARM GCC, puis les conserve dans le stockage de VS Code.
3. Ouvre le dossier du firmware, ou un workspace qui le contient. QC1 inspecte les sources dans les dossiers personnalisés et les références CMake; les noms de dossiers conservent leur casse exacte.
4. Ouvre l'icône **QC1 STM32** dans la barre latérale.
5. Lance **Show STM32 Status**, puis **Build Project**.
6. Branche le ST-Link et lance **Flash STM32**.

Les fichiers compilés se trouvent dans `build/qc1/`, ou dans le `binaryDir` du preset CubeMX sélectionné.

## Structure minimale du projet

QC1 accepte un projet CMake bare-metal :

```text
MonProjet/
├── CMakeLists.txt
├── Inc/
├── Src/
│   └── startup_stm32f103xx.s
└── stm32f103xx_flash.ld
```

Il accepte aussi la structure STM32CubeMX :

```text
MonProjet/
├── Core/
│   ├── Inc/
│   ├── Src/
│   └── Startup/
├── Drivers/                 # facultatif en bare-metal
└── STM32F103xxxx_FLASH.ld
```

Le moteur intégré exige un startup et un linker non ambigus. Un projet CMake natif peut les générer ou les fournir via une bibliothèque : leur absence lors du scan ne bloque pas automatiquement la configuration. `Core/`, `Drivers/` et HAL restent facultatifs.

### Projet STM32H755 CubeMX

QC1 reconnaît notamment `STM32H755`, `STM32H755ZI`, `STM32H755ZIT6`, `STM32H755xx` et `NUCLEO-H755ZI-Q` à partir de plusieurs preuves concordantes : `.ioc`, dossiers CM7/CM4, defines, CMake, startups, linkers et HAL H7.

```text
MonProjetH755/
├── CM7/                    # firmware Cortex-M7 distinct
├── CM4/                    # firmware Cortex-M4 distinct
├── Drivers/
├── Common/
├── CMakeLists.txt
├── CMakePresets.json
├── gcc-arm-none-eabi.cmake
└── carte.ioc
```

Le build global compile les cibles par défaut CM7 et CM4. Les commandes **Build STM32H755 CM7** et **Build STM32H755 CM4** ajoutent `--target` avec la cible réellement découverte. Le flash global programme successivement les deux ELF avec `interface/stlink-dap.cfg`, `DUAL_CORE=1` et `target/stm32h7x.cfg`; les adresses proviennent des segments liés. Le fallback BIN `st-flash` n'est utilisé que si l'origine FLASH est lisible dans le linker CubeMX correspondant.

Les commandes **Debug STM32H755 CM7** et **Debug STM32H755 CM4** lancent des sessions Cortex-Debug séparées avec OpenOCD, SWD, `DUAL_CORE=1` et le processeur 0 ou 1. Le debug simultané coordonné n'est pas annoncé comme supporté.

## Exemple prêt à copier : faire clignoter la LED D1-1 sans HAL

`D1-1` est le nom physique écrit sur la carte; le microcontrôleur, lui, contrôle une broche GPIO. Il faut donc vérifier dans le schéma à quelle broche D1-1 est reliée.

Dans le projet de référence présent sur cette machine, la LED d'état utilise :

```text
Exemple local : LED d'état = PC13
D1-1 : mapping à confirmer sur le schéma de la carte
```

L'exemple utilise donc **PC13**. Il ne fait aucun appel à `HAL_GPIO_*`, `HAL_Delay` ou `HAL_GetTick` : il écrit directement dans les registres `RCC`, `GPIOC` et `SysTick` définis par CMSIS.

### 1. Ajouter le module bare metal

Copie ces deux fichiers du modèle dans ton firmware :

- [`m400_led_bare_metal.h`](examples/blink-led-d1-1/m400_led_bare_metal.h) vers `Core/Inc/`;
- [`m400_led_bare_metal.c`](examples/blink-led-d1-1/m400_led_bare_metal.c) vers `Core/Src/`.

Le module reprend le fonctionnement non bloquant de [`M400_vLEDBlinkTask`](https://github.com/matisserheaumeviale-ux/Mistral400-STM32-Lib/blob/main/src/m400_vLEDBlinkTask.c), mais remplace la fonction HAL utilisée plus bas dans la bibliothèque par des écritures atomiques dans `GPIOx->BSRR`.

### 2. Utiliser le modèle `main.c`

Le fichier [`main-bare-metal.c`](examples/blink-led-d1-1/main-bare-metal.c) contient l'exemple complet. Les lignes essentielles sont :

```c
static M400_LED_t xD1_1;

M400_vD1_1GPIOInit(1U); /* D1-1 active à l'état haut. */
M400_vLEDInit(&xD1_1, GPIOC, (1UL << 13U), 1U);
SysTick_Config(SystemCoreClock / 1000U);

for (;;)
{
  M400_vLEDBlinkTask(&xD1_1, g_uiNowMs, 500U, 1U);
  __WFI();
}
```

`SysTick_Handler` incrémente `g_uiNowMs` toutes les millisecondes. La tâche retourne immédiatement à chaque passage et ne bloque jamais le processeur. La LED change d'état toutes les 500 ms, donc elle effectue un cycle complet allumé/éteint chaque seconde.

Le modèle est entièrement embarqué dans le VSIX sous [`examples/blink-led-d1-1`](examples/blink-led-d1-1/README.md); la bibliothèque GitHub n'est pas nécessaire à son exécution.

> Un projet ne doit définir qu'un seul `SysTick_Handler`. S'il existe déjà dans un autre fichier, retire celui du modèle, déclare `extern volatile uint32_t g_uiNowMs;` dans le fichier d'interruption et ajoute `g_uiNowMs++;` dans le gestionnaire existant. Si le firmware pilote déjà PC13 ailleurs, désactive cette autre logique pendant le test.

### 3. Compiler

Dans le panneau QC1, clique sur **Build Project**. Avec le CMake embarqué, les résultats attendus sont :

```text
build/qc1/firmware.elf
build/qc1/firmware.bin
build/qc1/firmware.hex
build/qc1/firmware.map
```

Avec un CMake natif, QC1 conserve le nom de cible du projet, par exemple `Prog3-Lab-0.elf`, `.bin`, `.hex` et `.map`.

Pendant la compilation, QC1 lit directement les compteurs Ninja comme `[14/37]`. Le Dashboard affiche donc les tâches terminées, le total, le pourcentage réel, l'étape courante et le temps écoulé. La configuration CMake et le flash affichent leur phase sans fabriquer de faux pourcentage lorsqu'aucun compteur mesurable n'est disponible.

### 4. Brancher le ST-Link

Pour une connexion SWD standard STM32F103 :

| ST-Link | STM32F103 |
| --- | --- |
| SWDIO | PA13 / SWDIO |
| SWCLK | PA14 / SWCLK |
| GND | GND |
| 3.3 V | 3.3 V, seulement si le ST-Link alimente la carte |

Ne branche pas le 5 V sur une entrée 3,3 V. Si la carte possède sa propre alimentation, relie au minimum les masses ensemble. Pour démarrer normalement après le flash, place généralement `BOOT0` à `0`.

### 5. Flasher

Clique sur **Flash STM32**. QC1 compile d'abord le firmware, puis essaie OpenOCD et `st-flash`.

Le flash physique demande encore :

- un ST-Link reconnu par le système;
- son pilote si le système en exige un;
- OpenOCD ou `st-flash` accessible par QC1.

Pour exécuter les deux étapes en une fois, utilise **Build + Flash + Status**.

## Commandes QC1

- **Build Project** : configure et compile avec CMake + Ninja.
- **Clean Project** : nettoie la cible CMake.
- **Rebuild Project** : nettoie puis recompile.
- **Flash STM32** : compile, puis flashe avec OpenOCD ou `st-flash`.
- **Build/Flash STM32H755 CM7** et **CM4** : limite l'opération à la cible CMake du cœur demandé.
- **Debug STM32F1 / projet single-core** : compile puis lance Cortex-Debug.
- **Debug STM32H755 CM7** et **CM4** : compile puis lance la session SWD du cœur choisi.
- **Build + Flash + Status** : exécute toute la séquence.
- **Detect ST-Link** : vérifie la détection du programmateur.
- **Open Serial Monitor** : ouvre `qc1.serialPort` au débit `qc1.baudRate`.
- **Start OpenOCD Server** : choisit automatiquement la target OpenOCD STM32F1 ou STM32H7.
- **Show STM32 Status** : affiche l'état du projet et des outils.
- **Créer un rapport de diagnostic** : prépare un rapport Markdown partageable avec les versions, l'état du projet, des outils, du matériel, du build, de Git, les problèmes VS Code et le journal QC1 récent.

Toutes les commandes sont aussi accessibles avec `Cmd+Shift+P` sur macOS ou `Ctrl+Shift+P` sur Windows/Linux, puis en recherchant `QC1 STM32`.

## Configuration facultative

L'auto-détection suffit normalement. Ces réglages VS Code permettent toutefois de forcer un chemin :

- `qc1.projectPath` : racine du projet STM32;
- `qc1.cmakePath` : exécutable CMake personnalisé;
- `qc1.compilerPath` : compilateur ARM GCC personnalisé;
- `qc1.openocdPath` : exécutable OpenOCD personnalisé;
- `qc1.stlinkPath` : exécutable `st-info` utilisé pour détecter le ST-Link;
- `qc1.serialPort` et `qc1.baudRate` : port et débit du moniteur série;
- `qc1.autoDetectProject` : active ou désactive la recherche récursive du firmware;
- `qc1.buildDirectory` : dossier de build, `build/qc1` par défaut;
- `qc1.buildType` : type de build, `Debug` par défaut.
- `qc1.cmakePreset` : preset explicite; vide, QC1 choisit le preset correspondant à `qc1.buildType`;
- `qc1.cm7ElfPath` et `qc1.cm4ElfPath` : exceptions manuelles si la CMake File API ne peut pas attribuer les deux ELF.

## Dépannage rapide

### Envoyer une erreur avec tout son contexte

Après une erreur QC1, clique directement sur **Créer un rapport** dans la notification. Tu peux aussi utiliser le bouton du panneau QC1 ou ouvrir la palette de commandes et lancer **QC1 STM32: Créer un rapport de diagnostic**. Décris brièvement ce qui s'est passé; QC1 collecte ensuite les états utiles et ouvre une prévisualisation Markdown. Vérifie le contenu, puis enregistre-le ou copie-le avant de l'envoyer.

QC1 ne lit pas directement le contenu du code source pour créer le rapport. Un message du compilateur déjà présent dans le journal ou dans les problèmes VS Code peut néanmoins contenir un extrait. Le rapport ne collecte pas les variables d'environnement ni l'URL du dépôt Git, et il masque automatiquement les chemins personnels, les clés, les jetons et les mots de passe connus.

### Le projet n'est pas détecté

Ouvre le dossier du firmware, laisse `qc1.autoDetectProject` activé, ou définis précisément `qc1.projectPath`. Un chemin relatif est résolu depuis le workspace.

### La compilation ne démarre pas

Redémarre VS Code après l'installation et laisse Embedded Build Tools terminer son premier téléchargement. Lance ensuite **Show STM32 Status**.

### Le build fonctionne, mais pas le flash

Vérifie le câblage SWD, l'alimentation, la masse commune et la détection du ST-Link. Le problème n'est alors généralement pas lié à CMake.

### La LED ne clignote pas

Vérifie d'abord que D1-1 est réellement reliée à PC13 et qu'aucun autre module ne modifie cette broche. Le modèle utilise `1U` pour une LED active à l'état haut; utilise `0U` dans les appels d'initialisation si ta LED est active à l'état bas.

## Ce qui est autonome

Le VSIX contient l'interface QC1, le moteur TypeScript et le modèle CMake STM32F103. Les projets H755 conservent leurs fichiers CubeMX HAL/CMSIS/BSP, startups et linkers. CMake, Ninja et ARM GCC peuvent être fournis par Embedded Build Tools; OpenOCD, le pilote ST-Link et le matériel restent des prérequis externes pour flash/debug.

La seule limite concerne le matériel : un flash réel ne peut pas être autonome sans ST-Link, pilote compatible et outil de communication avec le programmateur.
