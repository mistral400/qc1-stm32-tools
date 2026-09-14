# Audit QC1 — portabilité et diagnostic, 11 septembre 2026

## Résultat et portée

Le diagnostic utilise un schéma JSON `reportSchemaVersion: 2`, intégré au rapport Markdown. Les commandes publiques et la version publiée 0.3.1 sont conservées; ces changements sont une évolution locale non publiée.

| Élément | Avant | Après | Test |
| --- | --- | --- | --- |
| Dossiers source | `Src` ou `Core/Src` obligatoires | Scan borné indépendant du nom; sources CMake résolues quand possible | Huit structures, espaces, accents, apostrophe, Unicode |
| Projet natif | Startup, linker et dossier source obligatoires avant configuration | Leur absence reste une information/warning; CMake peut les générer ou les fournir via une bibliothèque | Validation complète via contrôleur d'extension |
| Types de projets | CMake, CubeMX, bare-metal | Identification supplémentaire Makefile, PlatformIO, CubeIDE, marqueurs conservés | Fixtures par marqueur |
| CMake | Nom extrait par regex | Lexer parenthésé, arguments cités/bracket, variables, listes, sources, glob, sous-dossiers, includes, options et cache | Variables, GLOB_RECURSE, fichier linker avec espaces, syntaxe invalide |
| Résultats CMake | Artefact supposé `<project>.elf` | Réponses File API existantes, vraies cibles/artefacts, `qc1.elfPath` pour lever les ambiguïtés | Index, codemodel, artefacts renommés, JSON invalide et traversal |
| Générateur | Ninja et ARM GCC imposés également aux projets natifs | Le CMake natif conserve son générateur et son toolchain; moteur intégré toujours F103/CMake/Ninja | Arguments générés via contrôleur |
| Startup/linker | Nom F103 et premier résultat trouvé | Startups génériques, assemblage personnalisé avec vecteurs, préférence aux références CMake, ambiguïtés explicites | Aucun startup, multiples startups/linkers, exclusion de build |
| Casse | Existence seule | Comparaison segment par segment; `CASE_MISMATCH` avec chemin demandé/réel, y compris includes cités | `Src/main.c` vs `src/main.c`, `Device.h` vs `device.h` |
| Multi-root | Premier workspace toujours sélectionné | Priorité au dossier actif contenant un projet, puis aux dossiers configurés/détectés; réglages associés au dossier | Workspace notes + firmware dans le deuxième dossier |
| Chemins | PATH Windows sensible au nom de variable, contrôle de préfixe fragile | `Path`/`PATH`, PATHEXT, UNC, chemins relatifs/home; test d'appartenance par segments | Windows simulé, dossier légitime `..notes`, voisin hors racine |
| Symlinks | Pas de politique de scan explicite | Cycle détecté; liens externes non parcourus; limites en entrées, profondeur et durée entre accès | Lien cyclique, externe, limite du scan |
| Exécutables | Existence du chemin | Fichier et permission d'exécution, résolution explicite, architecture ELF/PE/Mach-O, statut de test indépendant | Dossier non exécutable, fichier sans X, ELF ARM64, PE x64 |
| Toolchain | Six programmes interrogés | 28 outils/shells, versions, provenance, chemins, cible GCC, architecture, retour, timeout, stderr; six workers, cache 15 s | Inventaire sans PATH, workspace non approuvé, collecte réelle macOS |
| J-Link | Risque de confondre le `jlink` Java de macOS | `JLinkExe` sur POSIX, noms SEGGER Windows séparés | Faux positif trouvé pendant la collecte réelle |
| ST-Link | Mot « stlink » suffisant pour annoncer OK | Preuve positive de nombre de probes; erreurs d'accès distinctes de présence | Bannière seule, zéro probe, permission refusée |
| USB/série | Un port choisi, Windows absent | Inventaire borné sysfs Linux, system_profiler macOS, CIM Windows; COM, ttyACM/USB, cu/tty; champs indisponibles explicites | Classification des trois OS; collecte réelle macOS |
| Système | Plateforme/architecture seulement | os-release, kernel, version, processus/architecture physique, Rosetta, SSH/WSL/container/desktop/shell | os-release, WSL, SSH; collecte réelle Apple Silicon |
| Extensions | Deux dépendances uniquement | API VS Code + manifests dans les répertoires d'extensions déjà connus; version, actif, provenance, pertinence | Rapport d'intégration; données absentes tolérées |
| MCU | Conventions F103 | Preuves startup/linker/CMake/macros/.ioc, régions MEMORY, conflit entre séries/exacts; pas de capacité matérielle inventée | Conflit F103/F407, FLASH/RAM linker |
| Processus | Timeout SIGTERM pouvant ne jamais résoudre | Processus de diagnostic/build sans shell, timeout dur, résultat borné, erreurs de spawn/sortie capturées | Outil absent, argument NUL, sortie volumineuse, timeout, annulation |
| Terminal/OpenOCD | Commandes envoyées dans le shell utilisateur | Programme et arguments séparés; validation COM; nom ELF protégé contre rupture de l'argument Tcl | Chemin Windows/espaces et injection Tcl |
| Concurrence | Plusieurs builds possibles dans le même dossier | Verrou par contrôleur pour build/flash et génération de rapport | Garde intégrée au contrôleur |
| Journal | Accumulation de chunks et scans à chaque écriture | Tampons bornés, pas d'inspection complète depuis appendOutput | Tests de sortie volumineuse |
| Confidentialité | Remplacements textuels après sérialisation | Redaction récursive avant JSON, secrets/PEM/emails/IDs/serials, racines et URL; aucune collecte globale de l'environnement | JSON log, Windows échappé, arrays série, longs fences |
| Qualité | Tests et compilation | ESLint recommandé + TypeScript strict + tests de régression + paquet VSIX | `npm run lint`, `npm run typecheck`, `npm test`, `vsce package` |

## Modules et responsabilités

- `src/extension.ts` : sélection multi-root, configuration, collecte partielle, validation, exécution, prévisualisation.
- `src/qc1/filesystem.ts` : chemins, limites de scan, symlinks et casse.
- `src/qc1/cmakeInspection.ts` et `cmakeFileApi.ts` : preuve statique et résultats d'une configuration CMake précédente.
- `src/qc1/projectDiscovery.ts` et `projectDiagnostics.ts` : classification, startup/linker, structure, MCU et includes.
- `src/qc1/processTools.ts` : processus bornés, recherche d'exécutables, architectures et inventaire d'outils.
- `src/qc1/systemInspection.ts` et `extensionInventory.ts` : OS, devices et extensions.
- `src/qc1/diagnosticReport.ts` : JSON versionné, vingt sections Markdown, confidentialité.
- `src/qc1/hardware.ts`, modules `src/ai/` concernés : parseur ST-Link, Tcl, processus, sélection workspace, permissions et lint.
- `resources/cmake/CMakeLists.txt` : dossier source explicite pour le moteur intégré.
- `test/portability.test.js` et `test/extensionPortability.test.js` : fixtures et intégration.

## Limites explicites

L'analyse statique ne constitue pas un interpréteur CMake. Les conditions, fonctions, macros, generator expressions et sources générées sont signalées comme incertaines. Elle ne lance jamais CMake pour établir un diagnostic. Les réponses File API et le cache représentent une configuration précédente et peuvent être périmés. Les requêtes File API ne sont créées que pendant une commande de build explicitement demandée.

Les scans excluent build/cache/dependencies et les liens externes; les statistiques sont celles de ce périmètre, pas une mesure complète du disque. Les accès synchrones individuels au filesystem ne peuvent pas être interrompus par JavaScript si un montage réseau lui-même bloque.

Les projets Makefile, PlatformIO et CubeIDE sont identifiés; cela n'ajoute pas de moteur d'exécution natif pour leurs commandes. Le moteur CMake de secours et les commandes de flash par défaut restent dédiés à STM32F103. La détection d'une autre famille ne signifie pas qu'elle est prise en charge par ce moteur.

Les capacités FLASH/RAM du linker sont déclaratives; elles ne prouvent pas celles du composant physique. Les macros CMSIS globales peuvent contenir plusieurs variantes. Les conflits restent des avertissements accompagnés des preuves.

Les drivers USB, firmwares de probes, métadonnées des ports série et permissions effectives ne sont pas toujours accessibles sans ouvrir le matériel. Les règles udev sont identifiées par leurs noms, pas interprétées; une règle présente ne prouve pas l'accès. Aucune programmation, effacement, reset ou installation de driver n'est effectué par le diagnostic.

L'API VS Code ne fournit pas tous les détails de build/commit ni l'état d'activation/désactivation de tous les profils. Les manifests trouvés sur disque peuvent appartenir à un autre profil ou à une ancienne version; leur état est affiché unknown. Les numéros de série ne sont jamais conservés dans les inventaires structurés.

La validation exécutée ici porte sur macOS Apple Silicon. Les tests simulent les chemins Windows/Linux, les permissions, formats de binaires et inventaires. Un workflow Windows/macOS/Linux est fourni, mais ses exécutions distantes et des essais physiques x64/ARM64 restent nécessaires avant d'annoncer une certification de toutes les plateformes et distributions.

## Vérification reproductible

Depuis `qc1-vscode` :

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm audit
npx vsce package --out qc1-portability-review.vsix
```

Le rapport est prévisualisé avec la commande publique `qc1.createDiagnosticReport`. Vérifier son contenu avant partage : aucun filtre générique ne peut reconnaître chaque secret arbitraire dans un journal utilisateur.

Références de format : [CMake File API](https://cmake.org/cmake/help/latest/manual/cmake-file-api.7.html), [VS Code API](https://code.visualstudio.com/api/references/vscode-api).
