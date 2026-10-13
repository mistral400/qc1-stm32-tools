# Installation et premier lancement

## Installer QC1

La version `0.4.0` est disponible dans la [release GitHub](https://github.com/mistral400/qc1-stm32-tools/releases/tag/v0.4.0) et le VSIX local est installé dans VS Code depuis `~/Downloads/QC1-Releases/qc1-stm32-tools-0.4.0.vsix`. Au dernier contrôle, la fiche Marketplace affichait toujours `0.3.1`; la publication Marketplace de `0.4.0` attend l'accès publisher.

Pour installer un paquet VSIX local :

```sh
code --install-extension /chemin/vers/qc1-stm32-tools.vsix
```

On peut aussi ouvrir la palette VS Code et choisir **Extensions: Install from VSIX…**. Le paquet final de QC1 inclut ses fichiers `out/`, le moteur CMake intégré, l'icône et la documentation listée dans `package.json`.

Le manifeste ne déclare aucune extension tierce comme dépendance bloquante. Il fournit un extension pack qui installe ensemble **Embedded Build Tools** et **Cortex-Debug** dans VS Code; elles restent gérables indépendamment de QC1 :

- **Embedded Build Tools** : recommandé pour télécharger/mettre à disposition CMake, Ninja et ARM GNU Toolchain. QC1 peut aussi utiliser des exécutables déjà présents ou configurés.
- **Cortex-Debug** : recommandé, requis pour les commandes de debug QC1. Il n'est pas requis pour analyser, compiler ou flasher.
- **CMake Tools** : non requise et absente de l'extension pack; QC1 peut lire sa valeur `cmake.cmakePath` dans un rapport, mais n'utilise pas son moteur de build.

Si Embedded Build Tools est installée, QC1 active son API lors de l'activation du workspace approuvé et peut appeler `ensureToolsInstalled()`. Cette extension peut proposer ou effectuer le téléchargement de ses outils; vérifie son interface avant de poursuivre. En mode Restricted, QC1 ne lance pas ces opérations.

## Outils selon la fonction

| Outil | Rôle | Nécessité |
| --- | --- | --- |
| VS Code | Hôte d'extension et runtime Node fourni par VS Code | Requis |
| CMake | Configure/build des projets QC1 | Build/clean/flash/debug requis; diagnostic statique non |
| ARM GNU Toolchain (`arm-none-eabi-gcc`, et `objcopy` pour le fallback BIN) | Compile STM32 et produit les artefacts | Requise par le moteur intégré; un CMake natif peut fournir son propre toolchain; `objcopy` seulement si st-flash doit convertir ELF en BIN |
| Ninja | Générateur du moteur F1 intégré et de projets configurés en Ninja | Nécessaire pour le moteur F1; l'import CubeIDE H7 choisit Make s'il n'y a pas Ninja; CMake natif garde son générateur |
| OpenOCD | Flash ELF, sélection runtime de cible, debug et serveur GDB | Flash/debug selon le backend; fortement recommandé pour vérifier la famille de cible |
| `st-info` | Inventaire ST-Link, numéro de série et informations de puce disponibles | Requis pour distinguer et associer les probes QC1 |
| `st-flash` | Backend de flash BIN de secours | Facultatif si OpenOCD est disponible |
| Cortex-Debug | Adaptateur de débogage VS Code | Requis pour le debug QC1 |
| Git | Informations de dépôt dans le rapport | Facultatif |
| Python / Node installés par l'utilisateur | QC1 ne les exige pas comme outils STM32 | Non requis pour l'usage normal; Node est utile au développement de l'extension |

Le projet peut définir d'autres besoins (Python, scripts, générateurs ou outils CubeMX) dans son propre CMake. QC1 ne prétend pas les fournir.

## Premier lancement

1. Ouvre le dossier qui contient le firmware. Pour un workspace multi-root, chaque dossier peut contenir un projet; la sélection QC1 reste unique pour la fenêtre.
2. Approuve le workspace seulement si tu fais confiance au projet : les actions build/flash/debug exécutent des outils avec la configuration du projet.
3. Ouvre **QC1 STM32**. Dans **Projet**, lance la détection ou choisis le dossier exact. Examine les preuves et avertissements avant de le définir actif.
4. Consulte **Outils** et **Show STM32 Status**. Les chemins seuls ne garantissent pas qu'un outil peut parler au matériel.
5. Branche la carte et ST-Link après avoir vérifié alimentation, masse commune et câblage. Lance **Detect ST-Link**.
6. Si plusieurs probes sont présentes, sélectionne la bonne via **Choisir la sonde** ou **QC1 STM32: Select ST-Link Probe**. La sélection est mémorisée pour ce projet.
7. Lance un build et vérifie l'ELF attendu avant tout flash.
8. Pour le debug, installe Cortex-Debug, GDB ARM et OpenOCD; vérifie les fichiers `launch.json` personnalisés avant d'utiliser une configuration personnalisée.

Le champ **Carte** est une indication issue des fichiers du projet. QC1 ne déduit pas le modèle physique depuis un numéro de série ST-Link.

## Workspace Trust

En mode Restricted, QC1 peut afficher du contenu et analyser certains fichiers; les processus d'outils et les contrôles matériels sont bloqués. Cela évite d'exécuter automatiquement des projets inconnus. Si la bannière indique que le workspace n'est pas approuvé, examine sa provenance puis utilise **Manage Workspace Trust** dans VS Code.

## Hors ligne et proxy

Un projet déjà configuré peut continuer à utiliser son CMake, son compilateur, son OpenOCD et son ST-Link local sans Marketplace. La première installation des outils via Embedded Build Tools peut exiger un accès réseau. Configure le proxy et les certificats selon les instructions de l'outil qui télécharge les binaires; QC1 n'a pas de téléchargeur indépendant de toolchain.

## Dépannage

- **Projet non détecté** : sélectionne le sous-dossier du firmware; le scan est borné et n'explore pas tout le disque.
- **CMake/GCC/générateur absent** : installe Embedded Build Tools ou configure `qc1.cmakePath`, `qc1.compilerPath` et les outils du générateur. L'import CubeIDE H7 peut utiliser Make si Ninja est absent; le moteur F1 intégré exige Ninja.
- **Aucune sonde affichée** : vérifie que `st-info --probe` fonctionne, le câble USB data, le pilote et les permissions. QC1 ne choisit pas une autre probe silencieusement.
- **Famille cible non vérifiée** : configure une version compatible d'OpenOCD ou vérifie l'identification de puce disponible par `st-info`. Le flash reste bloqué si aucune preuve fiable ne correspond.
- **Debug refusé** : vérifie l'installation de Cortex-Debug, `arm-none-eabi-gdb`, OpenOCD et l'ELF du cœur ciblé.
- **Erreur difficile à reproduire** : crée un rapport QC1, examine son aperçu et supprime les données privées avant partage.

Les détails d'opérations se trouvent dans [Build, flash et debug](BUILD_FLASH_DEBUG.md), [Multi-projet](MULTI_PROJECT.md) et [Diagnostics](DIAGNOSTICS.md).
