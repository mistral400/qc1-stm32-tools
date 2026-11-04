# Plan de refactorisation QC1 0.5.0

## Point de départ vérifié

- Version du manifeste : **0.4.0** (`package.json`). Branche de travail : `codex/qc1-refactor-0.5.0`, créée à partir du checkout QC1 actif `2cb5b2a` (branche locale `codex/qc1-stm32h7-release-status`).
- GitHub `main` était au commit `8dae7c4`; son écart par rapport à la branche active porte sur trois fichiers de documentation de statut de release. La branche locale `main` pointe sur un historique divergent `ea13851` (`pre 0.5`, manifeste 0.3.1); elle reste intacte et n'est pas utilisée comme base.
- Deux changements préexistants non commités : `.DS_Store` et `qc1-vscode/.DS_Store`. Leurs empreintes ont été relevées avant création de branche. Aucun fichier non suivi.
- Environnement : macOS arm64, Node 26.8.2, npm 11.19.1, VS Code 1.144.1. La CI configurée utilise Node 22 sur six cibles OS/architecture. `node_modules` et `package-lock.json` existent; `npm ci` a été écarté pour ne pas remplacer l'installation locale avant d'en vérifier la nécessité.

## Baseline locale (avant refactorisation)

| Contrôle | Résultat |
| --- | --- |
| `npm run compile` | PASS |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm test` | 137 PASS, 0 échec, 2 ignorés sur 139 |
| `npm audit` | ÉCHEC : 15 avis (2 hauts, 13 modérés), dépendances de développement/packaging notamment Azure MSAL, minimatch et qs |
| Packaging `vsce` vers `/tmp/qc1-stm32-tools-baseline-0.4.0.vsix` | PASS, 96 fichiers, 324,38 KB |
| Tests physiques STM32F103/H7 | NON EFFECTUÉS |
| Rendu/activation dans un hôte Extension Development Host | NON EFFECTUÉS dans cette baseline |

Les deux tests ignorés nécessitent `QC1_CUBE_H7_PATH` (installation locale STM32CubeH7/GPIO_Demo) et CMake/Ninja/Arm GNU Toolchain pour le scénario ExternalProject. Les tests de build logiciels existants incluent une vraie compilation ARM STM32F1; cela ne constitue pas un test de flash ni matériel.

## Jalons et critères

| Jalon | Portée | Critères de validation |
| --- | --- | --- |
| 0.4.1 | Résultats séparés par opération/projet; coordination Build/Flash/Debug | Un échec matériel ne modifie pas le résultat Build; build échoué bloque Flash/Debug; états liés au bon projet; tests de succès/échec/changement de projet; compile, typecheck, lint, tests, packaging et activation VS Code |
| 0.4.2 | Provenance et validation des artefacts; programmation et vérification obligatoires; état reset distinct | Aucun artefact absent/ancien/ambigu utilisé; vérifier OpenOCD/st-flash selon capacités démontrées; tests de processus simulés; pas de revendication de démarrage |
| 0.4.3 | Suivi des sessions matérielles et résolution des conflits | Sessions Debug/OpenOCD connues suivies sans les arrêter; ports OpenOCD externes signalés comme suspectés; conflits de sonde bloqués; tests simulés |
| 0.4.4 | Reset configurable par backend et projet | Modes disponibles seulement quand documentés/supportés; incompatibilités refusées; NRST non présumé; tests d'arguments sans carte |
| 0.4.5 | Modernisation du Webview existant | Navigation compacte, hiérarchie d'actions, états lisibles, accessibilité sémantique, thèmes; tests UI automatisés et vérifications visuelles déclarées séparément |
| 0.4.6 | Navigation hybride VS Code / TreeViews / dashboard éditeur | Synchronisation sans état métier dupliqué, commandes existantes préservées, activation et packaging |
| 0.4.7 | UART TX/RX, données graphiques bornées, historique et diagnostics guidés | Tests avec ports/processus simulés, mémoire bornée, documentation multiplateforme; aucun test matériel implicite |
| 0.5.0 | Inspection statique ELF/MAP Flash/RAM et stabilisation intégrée | Ne pas confondre RAM statique et runtime; STM32F1/H7 couverts; CI, tests, packaging, documentation et limites matérielles vérifiés |

## Garde-fous

- Une version ne sera pas incrémentée ni déclarée livrée si ses critères ne passent pas. Chaque changement restera sur cette branche; les commits et tags de jalon ne seront créés qu'après validation.
- Pas de flash, reset matériel, effacement, option bytes, test physique, merge dans `main` ni publication Marketplace sans autorisation explicite.
- Les modifications utilisateur préexistantes et la branche locale divergente `main` sont conservées. Les tests externes ignorés, résultats CI, activation VS Code et validations physiques seront rapportés séparément.

## État de travail

Inspection et baseline terminées. Jalons 0.4.1 à 0.4.4 sont validés et checkpointés. Le jalon 0.4.5 est implémenté et validé par les contrôles logiciels et le smoke VS Code; inspection visuelle du rendu et validation multiplateforme non effectuées. Prochain jalon : **0.4.6 — navigation hybride VS Code / Webview**.

### Jalon validé et checkpointé localement — 0.4.1

- Ajout de résultats typés pour Build, validation d'artefact, programmation, vérification, reset, session Debug et exécution.
- Le tableau Build affiche les étapes séparément; les résultats sont conservés dans un historique borné par projet pendant la session.
- Le statut Build est calculé séparément du résultat global de la commande. Les diagnostics CMake/GCC/linker et erreurs explicites de programmation sont aussi examinés lorsque le processus retourne 0.
- Ajout de tests unitaires pour le classement Build, les textes d'erreur, l'isolation de l'historique projet et la règle stricte de succès Flash.
- Validation locale : `npm test` PASS (149, 2 ignorés, 151 total), `npm run typecheck` PASS, `npm run lint` PASS, `git diff --check` PASS. Les deux tests ignorés restent ceux décrits dans la baseline.
- Activation smoke en VS Code 1.144.1/macOS arm64 : PASS, extension activée et commandes publiques vérifiées. Le test a utilisé un lanceur et un profil temporaires dans `/tmp`; aucune commande matérielle n'a été invoquée.
- Packaging 0.4.1 : PASS, `qc1-vscode/qc1-stm32-tools-0.4.1.vsix` (101 fichiers, 336,78 KB); `unzip -t` confirme l'intégrité de l'archive.
- Aucun test CI distant ni test matériel n'a été effectué. La tranche est localement validée; tag/commit de jalon à enregistrer avant de poursuivre.

### Jalon validé et checkpointé localement — 0.4.2

- `src/qc1/artifactValidation.ts` vérifie l'ELF associé à une cible CMake exécutable unique, son périmètre projet/build, sa taille et son empreinte SHA-256; les backends reçoivent un snapshot privé vérifié. Le module valide aussi le BIN temporaire et compare les octets lus après programmation.
- OpenOCD reçoit l'ELF validé avec sa séquence `program … verify reset exit`. Le fallback st-flash produit un BIN neuf dans un répertoire temporaire, écrit, relit la plage exacte, compare le résultat puis demande un reset distinct. Tout échec arrête les étapes suivantes; aucun ancien BIN n'est utilisé.
- Le dashboard marque Flash pleinement réussi uniquement après validation d'artefact, programmation, vérification et reset acceptés. Le message précise que NRST effectif et démarrage du firmware ne sont pas observés.
- Pour le fallback st-flash v1.8.0, documenter le reset déclenché par `write` sans `--reset`, puis la commande distincte après comparaison; signaler que NRST/software reset effectif n'est pas déductible du seul retour CLI.
- Tests locaux : `npm test` PASS (158, 2 ignorés, 160 total), `npm run typecheck` PASS, `npm run lint` PASS, `git diff --check` PASS. Deux tests H7 restent ignorés pour les dépendances locales documentées plus haut.
- VS Code 1.144.1 / macOS arm64, fenêtre sans workspace : activation et commandes publiques PASS (1 test), aucune commande matérielle appelée.
- Packaging 0.4.2 PASS : `qc1-stm32-tools-0.4.2.vsix` (103 fichiers); intégrité ZIP et version du manifeste vérifiées après ajout du snapshot ELF.
- Aucun test matériel ni CI distante. Le jalon est validé par les contrôles logiciels; checkpoint local avant la tranche 0.4.3 — ressources et conflits.

### Jalon validé et checkpointé localement — 0.4.3

- `src/qc1/hardwareResources.ts` suit les sessions connues et les réservations de ressources par numéro de ST-Link. Les sessions à sonde inconnue bloquent prudemment tout nouvel usage; une autre sonde explicitement connue reste indépendante.
- Les événements VS Code suivent les sessions Cortex-Debug; QC1 suit son terminal OpenOCD, les opérations Flash réservent la sonde jusqu'à leur terminaison, et la page Outils liste les sessions actives avec un numéro masqué.
- Les ports locaux OpenOCD 3333/4444 sont sondés brièvement. Un port ouvert sans propriétaire QC1 est classé suspecté, sans inventer de processus ni de numéro de sonde; les ports personnalisés restent hors détection.
- La configuration du reset est décalée au jalon 0.4.4 afin de la concevoir selon les capacités spécifiques d'OpenOCD/st-flash et les contraintes NRST, plutôt que de l'agréger au suivi des ressources.
- Validation logicielle : `npm test` PASS (162, 2 ignorés, 164 total), `npm run typecheck` PASS, `npm run lint` PASS, `git diff --check` PASS.
- VS Code 1.144.1 / macOS arm64, fenêtre sans workspace : activation et commandes publiques PASS (1 test); aucun test matériel n'est lancé.
- Packaging local PASS : `qc1-stm32-tools-0.4.3.vsix` (105 fichiers), ZIP valide et version 0.4.3 du manifeste confirmée.
- Validation locale uniquement; aucune publication ni CI distante. Aucun test de reset ou autre test matériel n'est effectué.

### Jalon 0.4.4 — profils de reset OpenOCD par projet

- `src/qc1/resetConfiguration.ts` valide des modes par défaut, SYSRESETREQ, NRST et connexion sous reset ainsi que les limites de vitesse SWD et de temporisation. Les profils sont persistés sous un SHA-256 du chemin normalisé, sans enregistrer ce chemin dans la valeur.
- `src/qc1/hardware.ts` traduit uniquement ces choix autorisés en commandes OpenOCD; Flash F1/H7 et Cortex-Debug reçoivent le profil. Le mode backend par défaut conserve les arguments existants. Un profil personnalisé est refusé avant le pipeline Flash si seul `st-flash` est disponible.
- Le panneau Réglages expose les options avec un avertissement NRST et préserve les valeurs non enregistrées lors des rafraîchissements. L'état du profil est inclus dans l'empreinte de configuration d'opération.
- Validation : `npm test` PASS (169, 2 ignorés, 171 total), `npm run typecheck` PASS, `npm run lint` PASS, `git diff --check` PASS.
- VS Code 1.144.1 / macOS arm64, fenêtre sans workspace : activation/commandes publiques PASS (1 test).
- Packaging local PASS : `qc1-stm32-tools-0.4.4.vsix` (107 fichiers), ZIP valide et manifeste version 0.4.4 confirmé. Aucun test matériel ni CI distante.

### Jalon 0.4.5 — modernisation du Webview

- Navigation compacte : libellés courts jusqu'à 600 px, noms complets sur les fenêtres larges, relations ARIA et navigation clavier avec flèches, Home et End.
- Styles fondés sur les tokens de thème VS Code, cartes et actions hiérarchisées, prise en charge du contraste forcé et du mouvement réduit.
- Build principal visible; Flash/Debug secondaires; entretien et commandes par cœur dual-core sous Actions avancées. Les commandes Flash/Debug d'une cible H7 mono-cœur restent visibles. Aucune commande n'est supprimée; Build, validation d'artefact, programmation, vérification et reset restent séparés.
- Tests UI ajoutés pour les cinq onglets, les commandes STM32F1/H7, les états d'opération et les points de rupture responsive.
- Validation logicielle : `npm test` PASS (175 réussis, 2 ignorés, 177 total), `npm run typecheck` PASS, `npm run lint` PASS, `git diff --check` PASS.
- VS Code 1.144.1 / macOS arm64, fenêtre sans workspace : activation et commandes publiques PASS (1 test). Le rendu à 320/400/600 px, le zoom 200 %, les autres OS et les thèmes ne sont pas inspectés visuellement.
- Packaging local PASS : `qc1-stm32-tools-0.4.5.vsix` (107 fichiers, environ 361 KB); intégrité ZIP et version 0.4.5 du manifeste confirmées. Le checkpoint Git local est créé après validation.
- Aucun test matériel ni CI distante; inspection visuelle et validation sur Windows/Linux restent à faire.
