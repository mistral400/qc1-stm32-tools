# Préparation au Visual Studio Marketplace

Cette page décrit la candidate `0.4.0` au 12 octobre 2026. L'installation locale et l'activation sont vérifiées; la publication Marketplace et la disponibilité distante doivent être confirmées séparément.

## Manifeste

| Champ | État local |
| --- | --- |
| `publisher`, `name`, `displayName`, `description`, `version` | Présents; version candidate `0.4.0`; publisher `Mistral400` |
| `engines.vscode` | `^1.118.0`; à vérifier contre les runners et versions visées |
| `activationEvents` | Vue, fichiers STM32/CMake et commandes explicites |
| `commands`, `menus` | Commandes QC1 déclarées; sélection ST-Link ajoutée à la palette |
| `configuration` | Réglages QC1 et descriptions utilisateurs présents |
| `categories`, `keywords` | `Other` et `Extension Packs` déclarés; keywords présents |
| `icon` | `media/icon.png` déclaré; vérifier le rendu Marketplace final |
| `repository`, `bugs`, `license` | URLs canoniques `mistral400/qc1-stm32-tools`; manifeste `SEE LICENSE IN LICENSE` et fichier MIT présents |
| `README`, `CHANGELOG` | Présents et inclus dans la whitelist VSIX |
| `.vscodeignore` | Absent; l'attribut `files` de `package.json` sert de liste d'inclusion. Examiner le tree VSIX final. |
| `docs/**` | Ajouté au paquet via `files` après génération des guides |

Le nom et l'identifiant de publisher n'ont pas été validés en ligne avec un compte Marketplace. La propriété du publisher, la description d'extension, les liens de support, les captures, la politique de confidentialité et le processus de signature restent à vérifier par le propriétaire avant publication.

## Extensions VS Code impliquées

| Extension | Classement fonctionnel | Manifeste |
| --- | --- | --- |
| `marus25.cortex-debug` | REQUIRED pour les commandes de debug QC1; OPTIONAL pour projet/build/flash | Incluse dans `extensionPack`; VS Code l'installe avec le pack, puis elle se gère indépendamment |
| `mylonics.embedded-build-tools` | OPTIONAL si les outils sont déjà installés; RECOMMENDED pour provisionner CMake/Ninja/ARM GCC | Incluse dans `extensionPack`; son API peut installer/télécharger des outils |
| `ms-vscode.cmake-tools` | OPTIONAL pour lire `cmake.cmakePath` dans un rapport; son moteur n'est pas utilisé par les builds QC1 | Absente de `extensionDependencies` et de l'extension pack |

Le pack installe les extensions listées avec QC1, mais ne crée pas de dépendance bloquante : l'utilisateur peut les désactiver/désinstaller et continuer à utiliser les fonctions couvertes par ses outils locaux. Les extensions ne se désinstallent pas automatiquement avec QC1. Les `extensionDependencies` sont absentes; QC1 vérifie Cortex-Debug au moment du debug.

## Outils externes

| Outil | QC1 global | Build | Flash | Debug | Note |
| --- | --- | --- | --- | --- | --- |
| CMake | REQUIRED pour les pipelines build/clean/flash/debug, pas pour l'UI/statut statique | REQUIRED | BUILD requis avant flash | BUILD requis avant debug | Utilise le natif ou le CMake embarqué |
| ARM GNU GCC | REQUIRED par le moteur intégré; un projet CMake natif peut fournir son propre toolchain | REQUIRED selon toolchain projet | BUILD requis avant QC1 flash/run | Build et GDB distincts | Toolchain native ou provisionnée |
| Ninja | OPTIONAL globalement | REQUIRED pour moteur F1 et générateur Ninja choisi | Même besoin que le build | Même besoin que le build | Les projets CubeIDE H7 utilisent Make si Ninja manque; CMake natif garde son générateur |
| OpenOCD | OPTIONAL globalement | Non utilisé | REQUIRED H755; backend F1 préféré/famille runtime | REQUIRED | Customisable via `qc1.openocdPath` |
| `st-info` | REQUIRED pour découverte multi-probe QC1 | Non utilisé | REQUIRED au précontrôle QC1 actuel | REQUIRED au précontrôle QC1 actuel | Via `qc1.stlinkPath` |
| `st-flash` | OPTIONAL | Non utilisé | Fallback F1 BIN uniquement | Non utilisé | H755 st-flash non pris en charge |
| `arm-none-eabi-objcopy` | OPTIONAL globalement | Produit BIN/HEX selon génération CMake | REQUIRED uniquement pour conversion du fallback st-flash | Non utilisé | Généralement livré avec la toolchain |
| `arm-none-eabi-gdb` | OPTIONAL globalement | Non utilisé | Non utilisé | REQUIRED | Peut être à côté de GCC ou dans PATH |
| Cortex-Debug | OPTIONAL globalement | Non utilisé | Non utilisé | REQUIRED | Extension VS Code distincte |
| Git | OPTIONAL | Non requis | Non requis | Non requis | Enrichit le rapport seulement |
| Python | Pas requis par QC1 | Selon projet externe seulement | Selon outil externe seulement | Selon outil externe seulement | Pas de dépendance directe QC1 |
| Node.js | Fourni par le runtime VS Code en usage extension | Non requis à installer | Non requis à installer | Non requis à installer | Développement/test QC1 seulement |

Cette classification est alignée sur les checks et backends présents dans le code. Le CMake du firmware peut imposer d'autres outils propres au projet.

## Packaging et contrôle manuel

Dans `qc1-vscode/` :

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm audit
npx --no-install vsce package --out /tmp/qc1-stm32-tools.vsix
npx --no-install vsce ls --tree
```

Inspecter l'archive et confirmer au minimum : manifest, `out/extension.js`, modules runtime `out/qc1/`, `out/dashboard/`, `resources/cmake/`, icônes, LICENSE, README, CHANGELOG et `docs/`. Les sources TypeScript et fixtures ne sont pas nécessaires à l'extension runtime.

Installer le VSIX dans un `--user-data-dir` et un `--extensions-dir` temporaires. Confirmer dans cette instance qu'il s'installe, s'active, ouvre le dashboard et détecte un projet fixture; ne pas confondre installation CLI acceptée et validation complète d'activation.

## Avant une publication future

- Observer le workflow CI sur les runners définis, corriger toute différence de packaging.
- Tester l'installation/activation dans un profil VS Code propre avec un VSIX final.
- Faire les validations hardware sur les cartes qui sont réellement connectées.
- Reconfirmer le compte publisher, droits de marque/icône, changelog, README Marketplace et URL de support.
- Vérifier l'archive, le licence scan, les dépendances et la provenance de tout outil téléchargé.
- Le build du GPIO_Demo réel est maintenant passé avec la version locale identifiée de STM32CubeH7 `v1.13.0`; le flash H755 et le test LED restent à faire sur une carte connectée.
- Revalider la liste `vsce ls --tree`, la signature, l'installation locale et l'identité du publisher pour cette candidate.

## État de la candidate 0.4.0 — 12 octobre 2026

- `npm run typecheck`, `npm run lint` et `npm test` passent; 138 tests réussissent et un test `ExternalProject` est ignoré faute de Ninja.
- `npm audit` signale zéro vulnérabilité après le passage de l'outil de développement `@vscode/vsce` à 4.0.0.
- Le test d'import CubeIDE compile un fixture H745 et le GPIO_Demo officiel réel avec des images CM7/CM4 séparées; ce dernier utilise le repli `Unix Makefiles`.
- Le VSIX 0.4.0 a été installé localement et son activation dans VS Code est confirmée par le journal Extension Host. GitHub PR/release et publication Marketplace restent à confirmer.

Référence manifeste : [Extension Manifest VS Code](https://code.visualstudio.com/api/references/extension-manifest) et [Extension Marketplace](https://code.visualstudio.com/docs/configure/extensions/extension-marketplace).
