# QC1 STM32 Tools

QC1 est une extension VS Code pour découvrir, compiler, flasher et déboguer des projets STM32. Le backend de build intégré vise STM32F1. Les projets STM32H7 natifs gardent leurs cibles CMake et leurs presets. QC1 peut aussi importer un projet STM32CubeIDE dual-core H745/H747/H755/H757 sans `CMakeLists.txt`, en séparant les sources, startups, linkers et options CM7/CM4.

L'import CubeIDE exige le HAL, CMSIS Core, le header CMSIS Device exact et le BSP lorsqu'il est utilisé. QC1 ne les télécharge pas. Le nom de MCU du projet ne confirme pas le composant soudé sur la carte; consulte le [guide STM32H7](docs/STM32H7_CUBEIDE.md) et la [matrice de compatibilité](docs/COMPATIBILITY_MATRIX.md).

## Démarrage rapide

1. Installe QC1 depuis le VSIX de la version livrée, ou utilise **Install from VSIX…** dans VS Code.
2. Ouvre le dossier STM32, puis l'icône **QC1 STM32** dans la barre latérale.
3. Dans **Projet**, détecte les projets ou choisis leur dossier, puis sélectionne le projet actif.
4. Dans **Outils**, utilise **Choisir la sonde** pour associer une ST-Link au projet. Quand plusieurs sondes sont présentes, QC1 demande un choix explicite.
5. Vérifie les outils détectés et lance **Build Project**. Lance **Flash STM32** seulement après avoir vérifié la carte, le câblage et l'alimentation.

QC1 mémorise la sonde choisie par projet. Il transmet son numéro de série à OpenOCD ou `st-flash`; les journaux n'affichent qu'un suffixe. Avant flash/debug, QC1 vérifie la famille de cible quand OpenOCD fournit une cible reconnue. Sans preuve suffisante, l'opération est arrêtée. Le nom de carte affiché provient des fichiers du projet : il ne prouve pas quelle carte physique est connectée.

## Extensions et outils

QC1 fournit son UI et ses fonctions sans dépendance bloquante; son `extensionPack` installe ensemble **Embedded Build Tools** et **Cortex-Debug** dans VS Code. Elles restent indépendamment désinstallables : les outils locaux fonctionnent sans Embedded Build Tools, et seul le debug QC1 requiert Cortex-Debug. QC1 ne requiert pas **CMake Tools** pour compiler; il peut lire son réglage `cmake.cmakePath` lors de la collecte des outils du rapport.

Les outils système restent distincts des extensions VS Code :

- **Build** : CMake et ARM GNU Toolchain; Ninja sert au moteur intégré et au générateur Ninja, pas à tous les projets CMake natifs.
- **Flash** : OpenOCD ou `st-flash`, plus un ST-Link détecté par `st-info`.
- **Debug** : Cortex-Debug, OpenOCD et `arm-none-eabi-gdb`.
- **Git** : facultatif pour utiliser QC1; utilisé dans les rapports de diagnostic s'il est disponible.
- **Node.js** : requis pour développer QC1, pas à installer pour utiliser l'extension dans VS Code.

L'extension Embedded Build Tools peut demander de télécharger sa toolchain quand elle est installée. Voir [Installation et premier lancement](docs/INSTALLATION.md) pour les rôles, les chemins personnalisés et les limites hors ligne.

## Projets pris en charge

- **STM32F1** : build CMake intégré ou projet CMake natif; flash OpenOCD ou `st-flash`; debug single-core avec Cortex-Debug.
- **STM32H7 dual-core** : build CMake natif ou import CubeIDE H745/H747/H755/H757 avec les deux images reconnues; flash des deux ELF avec vérification, puis un reset final; sessions de debug CM7 et CM4 séparées. Le debug coordonné simultané et la synchronisation HSEM ne sont pas fournis par QC1.
- **Autres familles** : analyse statique et découverte seulement, sauf backend explicitement indiqué dans la [matrice](docs/COMPATIBILITY_MATRIX.md).

## Commandes

- **Build Project**, **Clean Project**, **Rebuild Project** : opérations CMake sur le projet actif.
- **Flash STM32** : compile puis programme avec le backend sélectionné, vérifie et demande le reset selon l'outil.
- **Debug STM32F1 / projet single-core** : compile et démarre Cortex-Debug.
- **Build/Flash/Debug STM32H7 CM7 ou CM4** : opère sur les cibles et artefacts de cœur identifiés.
- **Build + Flash + Status** : séquence principale.
- **Detect ST-Link** et **Select ST-Link Probe** : inventaire manuel puis association vérifiée par projet.
- **Start OpenOCD Server**, **Open Serial Monitor**, **Show STM32 Status** : outils et état.
- **Créer un rapport de diagnostic** : prévisualise un rapport partageable avant enregistrement ou copie.

Les commandes sont aussi accessibles depuis la palette VS Code avec `Cmd+Shift+P` sur macOS ou `Ctrl+Shift+P` sur Windows/Linux.

## Sécurité et limites

Les commandes QC1 sont lancées sans shell avec des arguments séparés. Build, flash, debug et collecte des outils requièrent un workspace approuvé. La sélection de sonde ne programme, n'efface et ne réinitialise pas la carte; le reset intervient seulement dans une commande de flash explicitement demandée.

Le diagnostic matériel n'est pas une preuve de build, de flash, de vérification d'ELF, de boot ou de fonctionnement physique. QC1 n'identifie pas automatiquement chaque modèle de carte et les identifiants ST-Link confirment une famille de cible, pas nécessairement la référence exacte du composant.

## Documentation

- [Installation et premier lancement](docs/INSTALLATION.md)
- [Architecture développeur](docs/ARCHITECTURE.md)
- [Build, flash et debug](docs/BUILD_FLASH_DEBUG.md)
- [Import STM32CubeIDE STM32H7 dual-core](docs/STM32H7_CUBEIDE.md)
- [Gestion multi-projet](docs/MULTI_PROJECT.md)
- [Diagnostics et rapports](docs/DIAGNOSTICS.md)
- [Tests reproductibles](docs/TESTING.md)
- [Matrice de compatibilité](docs/COMPATIBILITY_MATRIX.md)
- [Préparation Marketplace](docs/MARKETPLACE_READINESS.md)
- [Audit QC1](docs/QC1_AUDIT.md)
- [Gestionnaire et WebView](PROJECT_MANAGER.md)
- [Audit de portabilité](AUDIT_PORTABILITY.md)

## Développer et empaqueter

Dans `qc1-vscode/` :

```sh
npm ci
npm run typecheck
npm run lint
npm test
npx vsce package --out /tmp/qc1-stm32-tools.vsix
```

Ces commandes ne publient pas l'extension. Les validations exécutées et celles qui restent à faire sur matériel réel sont consignées dans [l'audit QC1](docs/QC1_AUDIT.md) et la [matrice de compatibilité](docs/COMPATIBILITY_MATRIX.md).

ST indique que les projets CubeH7 du répertoire NUCLEO-H745ZI-Q sont compatibles avec la carte NUCLEO-H755ZI-Q. Pour GPIO_Demo, QC1 conserve `STM32H745ZITx` comme MCU du projet et affiche `NUCLEO-H755ZI-Q` comme carte compatible documentée. Cette compatibilité n'identifie pas le composant physique; voir le [guide d'import CubeIDE](docs/STM32H7_CUBEIDE.md).
