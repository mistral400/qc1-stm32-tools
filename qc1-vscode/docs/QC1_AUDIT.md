# Audit de mission QC1 — 26 septembre 2026

## Portée et état Git initial

La racine contrôlée est exactement le dépôt QC1 demandé. Avant toute modification, le dossier était un dépôt Git propre sur `main`, remote `origin` vers le dépôt QC1; le HEAD local était `ea13851` (`pre 0.5`), en avance d'un commit sur `origin/main`. Le commit local et la branche distante n'ont pas été modifiés. Aucun push, tag, bump de version ou publication n'a été effectué.

La mission a commencé avec `qc1-vscode/package.json` à la version `0.3.1`. Les fichiers de travail initiaux étaient propres. Les artefacts compilés suivis dans `out/` sont régénérés par TypeScript.

## Baseline avant changements

La baseline a été exécutée avant les modifications :

| Gate baseline | Résultat |
| --- | --- |
| `npm ci` | PASS — dépendances installées; audit npm initial sans vulnérabilités; npm a signalé des scripts `keytar`/signature non autorisés |
| `npm run lint` | PASS |
| `npm run typecheck` | FAIL — `processSucceeded` acceptait `error?: string`, alors que le résultat spawné exposait `unknown` |
| `npm run compile` | FAIL — même incompatibilité TypeScript |
| `npm test` | FAIL — compile bloquée; quand les JS `out/` existants ont été exécutés, 116 réussites, un fichier de test H755 invalide en syntaxe et un test optionnel ignoré |
| Packaging VSIX | FAIL — hook de prépublication bloqué par la même erreur TypeScript |
| `git diff --check` | PASS |

Ces échecs préexistants sont séparés des nouveaux tests. Après correction, les gates logiciels passaient avant l'ajout multi-probe, puis la suite enrichie ci-dessous passe également.

## Architecture et points forts observés

L'extension possède déjà une base modulaire : analyse de projet et scan borné, inspection CMake/File API/presets, modèles de cœurs H755, contrôleur de projets, exécution externe sans shell, renderer WebView à messages validés, diagnostics et anonymisation. Les tests couvrent de vrais builds CMake/ARM représentatifs, des fichiers Unicode, CMake natif, le modèle dual-core et des erreurs de processus.

Les points fragiles avant cette mission étaient le coordinateur `extension.ts` toujours volumineux, une dépendance VS Code obligatoire trop large, des instructions README affirmant des installations automatiques inexactes, des exemples liés non présents dans le paquet, le routage de flash sans sélection explicite de numéro ST-Link, et une baseline qui ne compilait plus.

## Problèmes importants et décisions

| Fichier / emplacement | Gravité / confiance | Conséquence constatée | Action et validation |
| --- | --- | --- | --- |
| `src/qc1/processTools.ts`, signature `processSucceeded` | P2, élevée | Le résultat de processus du pipeline ne passait plus le typecheck (`error: unknown`); package impossible | Signature élargie à une erreur inconnue; régression couvrant erreur de spawn avec exit 0; typecheck et suite passent |
| `test/h755Pipeline.test.js`, fixture CMake imbriquée | P2, élevée | Le test ne se parse pas et ne peut être exécuté | Parenthèse corrigée; les tests H755/build passent |
| `src/qc1/hardware.ts`, arguments OpenOCD/st-flash/debug | P1, élevée | Sans numéro de probe, plusieurs ST-Link pouvaient être pris dans l'ordre découvert par l'outil | Numéro choisi transmis aux trois backends; arguments testés |
| `src/qc1/probeSelection.ts`, nouvel inventaire et état | P1, élevée | Pas d'association probe par projet ni protection contre une série absente | Inventaire/déduplication, Quick Pick, état validé haché par projet, choix explicite et logs masqués; test d'intégration simulé F103/H755 |
| `src/qc1/probeSelection.ts`, `redactStlinkSerials` | P2, élevée | Le journal de commande `st-flash` citait les arguments entre guillemets; le masque initial ne couvrait pas la forme `"--serial" "…"` | Le masque traite maintenant `--serial` avec ou sans guillemets/`=`; régression vérifiée sur les formes citées et non citées |
| `src/extension.ts`, précontrôle flash/debug | P1, élevée | Changement de projet/config pendant la sélection pouvait réutiliser une empreinte recalculée et masquer la race | Empreinte stable sans serial comparée avant/après le précontrôle; le serial courant est ensuite gelé et contrôlé |
| `src/extension.ts`, démarrage OpenOCD | P1, élevée | Le projet pouvait changer pendant le Quick Pick puis démarrer le serveur sur le nouvel état actif | L'entrée capture l'état initial et vérifie configuration/projet/serial après la sélection; l'intégration F103→H755 confirme qu'aucun terminal ne démarre |
| `hardware.ts`/précontrôle | P1, moyenne | Un banner ST-Link seul ne prouve pas que la cible a la famille du projet | Nom runtime `stm32f1x.cpu`/`stm32h7x.cpuN` requis avec OpenOCD; sans OpenOCD, chip ID/description st-info; tests unitaires. Pas de preuve du part number exact |
| `package.json`, `extensionDependencies` | P2, élevée | CMake Tools déclarée obligatoire bien que seuls son réglage de chemin dans le rapport soit lu; Cortex-Debug requis même aux utilisateurs qui ne déboguent pas | Déclaration bloquante retirée; Embedded Build Tools et Cortex-Debug incluses dans le pack installable; CMake Tools est une intégration diagnostic facultative |
| `README.md`, exemples et premier lancement | P2, élevée | Plusieurs chemins d'exemple ne sont pas dans `examples/`; texte affirmait que les extensions s'installent automatiquement | README remplacé par des instructions cohérentes et guides pointés; aucune dépendance personnelle codée dans l'extension |
| `src/extension.ts` | P2, élevée | Un seul fichier orchestre configuration, UI, rapports, pipeline et matériel; revue/extraction difficile | Pas de réécriture aveugle. Dette documentée; extraire le service matériel/flash séparément dans une prochaine étape |
| Vérification MCU/board | P1, élevée | Un chip ID ST-Link ne distingue pas nécessairement toutes les références F1 ni les cartes utilisant le même MCU | Limitation rendue explicite dans dashboard/docs; la barrière actuelle garantit au mieux la famille, pas le modèle exact |
| Environnement de mission / USB | P1, élevée | L'inventaire USB a fluctué durant la mission; la NUCLEO-H755ZI-Q a une connexion USB instable | La portée matérielle a été réduite à la Blue Pill / F103 et son ST-Link V2. Le H755 et le multi-probe physique sont NOT TESTED intentionnellement, sans conclure à un défaut QC1 |
| Test H755 `ExternalProject` | P2, élevée | Ninja absent localement; test spécifiquement ignoré | Scénario reste visible comme non validé; ne pas transformer le skip en PASS |

## Changements livrés dans cette étape

- Inventaire ST-Link parsé par numéro avec `hla-serial` ignoré et entrées dupliquées réunies.
- Sélection explicite, association limitée à 50 projets récents et sauvegarde workspaceState sous un hash de chemin.
- Routage exact du serial à OpenOCD (`adapter serial`), `st-flash` (`--serial`) et Cortex-Debug (`serialNumber`).
- Précontrôle en lecture seule avec barrière de famille cible; une sonde/mapping/cible non vérifiable bloque le flash/debug.
- Masquage du serial complet dans le journal QC1; label suffixe dans l'état et la Quick Pick qui montre le serial complet pour éviter une confusion de choix.
- Arrêt de l'opération si projet/configuration change durant l'attente de sélection.
- Démarrage OpenOCD annulé si le projet ou la sonde change pendant la sélection asynchrone.
- Choix depuis Outils, palette de commandes et manifeste d'activation.
- Extension pack clarifié, métadonnées Marketplace complétées, README réécrit et guides d'installation/architecture/build/multi-projet/diagnostic/tests/compatibilité/Marketplace/audit ajoutés.
- Version maintenue à `0.3.1`; aucun firmware du projet utilisateur n'a été modifié. Un firmware smoke temporaire sans configuration GPIO/périphérique a été flashé pour valider F103, puis la sauvegarde complète a été restaurée et relue à l'identique. Aucun option byte ni réglage RDP/protection n'a été modifié.

## Résultats logiciels de l'étape

À la dernière exécution complète après multi-probe, intégration simulée et mise à jour du manifeste :

| Gate | Résultat |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm test` | PASS — 131 tests; un test H755 ExternalProject ignoré faute de Ninja local |
| Build CMake/ARM F103 représentatif | PASS — dans la suite automatisée, pas dans le projet de firmware utilisateur |
| Build CM7/CM4 H755 représentatif | PASS — fixtures/build représentatifs, pas la NUCLEO physique |
| Sélection projet/probe F103↔H755 | PASS — deux sondes simulées; aucune action USB |
| Package VSIX final / tree | PASS — 93 fichiers; neuf guides inclus |
| Installation isolée du VSIX / extension pack | PASS — QC1 0.3.1, Cortex-Debug et Embedded Build Tools visibles dans le profil temporaire |
| Activation dans un host VS Code isolé | NOT TESTED — confirmation requise avant de lancer le VSIX local |
| `npm audit --audit-level=high` | PASS — 0 vulnérabilité |
| `git diff --check` | PASS après stabilisation des documents |

## Résultats matériels Blue Pill / F103

La sonde ST-Link V2 de la Blue Pill a été sélectionnée explicitement par numéro de série (masqué dans ce rapport). OpenOCD 0.12.0 a identifié `stm32f1x.cpu`, Cortex-M3, ID `0x20036410`, flash de 128 Kio et tension cible de 3,24 V. `st-info` a reconnu `STM32F1xx_MD` / ID `0x410` et 20 Kio de SRAM, mais son champ de taille flash a indiqué 0; la taille de 128 Kio a été confirmée par OpenOCD.

Un projet CMake temporaire et minimal a été compilé avec ARM GNU GCC 15.2.1. L'ELF de test fait 80 octets et son `main()` ne fait que boucler avec `wfi`. Le flash a été exécuté via les arguments OpenOCD construits par le helper QC1 et son lanceur de processus compilé, hors de l'interface VS Code. OpenOCD a rapporté `Programming Finished`, `Verified OK` et `Resetting Target`. Un serveur OpenOCD lancé avec le helper QC1 a ensuite été contrôlé par `arm-none-eabi-gdb` en CLI : halt, lecture PC=`0x0800004e` / SP=`0x20004ffc`, reprise, détachement et sortie 0. Cela valide les commandes matérielles QC1 et GDB CLI, pas l'activation QC1/Cortex-Debug dans VS Code.

Avant la programmation, la flash principale complète a été sauvegardée (131072 octets). Après le smoke test, OpenOCD a restauré cette image et rapporté `Verified OK`; une lecture indépendante après reset a reproduit exactement la sauvegarde, SHA-256 `cb390d006b02a25b4493411f8a59395d46f3ec3366303a5d7e1148ed25c3fc70`. Un premier essai de restauration via `st-flash` s'est arrêté sur `Unknown memory region` avant toute écriture; OpenOCD avec adresse explicite a effectué la restauration. Les option bytes et la protection RDP sont restés intacts.

## Matériel et plateformes

| Cible | Résultat | Catégorie |
| --- | --- | --- |
| Blue Pill / cible STM32F1 | Détection, flash, verify, reset et GDB CLI PASS. Sauvegarde flash restaurée et comparée à l'identique. Extension VS Code non activée | REAL HARDWARE + CLI |
| NUCLEO-H755ZI-Q | NOT TESTED intentionnellement — laissée débranchée en raison de l'instabilité USB; ce n'est pas un défaut QC1 établi | REAL HARDWARE |
| Multiple ST-Link simultanés | NOT TESTED intentionnellement sur matériel; sélection multi-probe validée sur sondes simulées | AUTOMATED / REAL HARDWARE |
| macOS Apple Silicon | Gates locales TypeScript/tests exécutées; F103 programmé et débogué en CLI via helpers QC1 | AUTOMATED / REAL HARDWARE |
| Windows/Linux et macOS Intel | NOT TESTED sur la machine locale | CI workflow défini, pas d'exécution distante observée |

Les résultats matériels ci-dessus suivent la dernière portée donnée par l'utilisateur : Blue Pill / STM32F103 uniquement. Le serial de la sonde n'est pas publié. L'identification runtime prouve la cible F1; elle ne permet pas à OpenOCD de distinguer chaque sous-modèle commercial de Blue Pill.

## Étape CubeIDE dual-core — 12 octobre 2026

### Provenance et état initial

- Dépôt canonique vérifié : `https://github.com/mistral400/qc1-stm32-tools`; le remote local historique redirige vers ce dépôt.
- `origin/main` a été récupéré sans modifier les fichiers de travail. Le HEAD de la branche `codex/qc1-stm32h7-dualcore` est `ea13851`, enfant direct du dernier `origin/main` alors observé (`2920c35`); dernier tag trouvé `v0.1.2`, aucune GitHub Release trouvée au début de cette étape.
- Version Marketplace et extension installée avant changements : `0.3.1`.
- La copie de travail comportait déjà des changements suivis/non suivis, notamment dashboard, project manager et sélection de ST-Link. Ils sont conservés.

### Résultats de code et validation

| Gate | Résultat |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm test` | PASS — 138 réussites, 0 échec, 1 test ignoré faute de Ninja |
| `npm audit` | PASS — zéro vulnérabilité après `@vscode/vsce` 4.0.0 |
| Fixture CubeIDE H745 | PASS — CMake et ARM GCC produisent ELF séparés CM7/CM4, BIN/HEX/MAP et rapport avec les linkers déclarés |
| GPIO_Demo local | PASS — détection et build réel CM7/CM4 avec STM32CubeH7 `v1.13.0` et Make |
| `git diff --check` | PASS après les changements de code et de documentation |
| VSIX, installation et activation VS Code | PASS — candidate 0.4.0 installée; l'Extension Host confirme l'activation sur GPIO_Demo |
| CI GitHub | PASS — 6/6 runners Linux x64/ARM64, Windows x64/ARM64, macOS Intel/Apple Silicon |

### Limites de preuve

`st-info --probe` ne trouve aucune sonde sur cette machine; aucun flash ou test LED n'a été lancé. Le vrai build a produit les deux images; `objdump` confirme leurs sections vecteurs aux adresses des linkers. STM32CubeH7 `v1.13.0` et sa licence sont conservés dans `~/Downloads/QC1-Releases/`. La release GitHub `v0.4.0` est publiée; la fiche Marketplace reste à `0.3.1` au dernier contrôle. Voir [TESTING.md](TESTING.md) et [COMPATIBILITY_MATRIX.md](COMPATIBILITY_MATRIX.md) pour l'état révisé.

## Marketplace et risques résiduels

Le manifeste local a bugs, licence, catégories, mots-clés, icône, README/CHANGELOG, cibles d'activation et une whitelist de paquet qui inclut les guides. Le VSIX 0.4.0 a été empaqueté, installé et activé dans VS Code. La PR #2 est fusionnée dans `main` au commit `d45f002`; les six jobs CI de la PR et les six jobs post-fusion passent. Le tag `v0.4.0` et la [release GitHub](https://github.com/mistral400/qc1-stm32-tools/releases/tag/v0.4.0) sont publiés avec le VSIX attaché.

Le journal Extension Host confirme l'activation, mais le rendu du dashboard n'a pas été inspecté visuellement. Le matériel H755, les séquences dual-core/boot/HSEM et le routage multi-probe physique restent NOT TESTED. La fiche Marketplace affiche encore `0.3.1`. La tentative de publication de `0.4.0` s'arrête sur l'invite du Personal Access Token du publisher `Mistral400`; aucun jeton n'est configuré pour cette session.
