# Gestionnaire QC1 — Bloc 3

## Frontières et architecture

Avant : découverte, annulation, historique et persistance de sélection dans `extension.ts`; HTML, styles, scripts et pages fortement couplés dans `dashboardHtml.ts`.

Après :

- `projectScanner.ts` reste inchangé : analyse statique, preuves et découverte bornée.
- `projectDiscoveryController.ts` orchestre scan/analyse, cache du candidat actif, racines, état et génération. Il n'analyse aucun fichier lui-même.
- `projectConfiguration.ts` valide et sérialise les écritures via un port VS Code; aucune configuration parallèle.
- `recentProjectsController.ts` utilise seulement la clé existante `qc1.recentProjectPaths` de `globalState`, avec huit chemins au maximum; métadonnées bornées en mémoire.
- `projectArtifacts.ts` inspecte les sorties déjà présentes, sans lancer de build ni modifier leur génération.
- `dashboardHtml.ts` assemble une petite shell; les renderers Projet, Build, Outils, Diagnostics et Réglages, styles, helpers HTML et client sont indépendants.
- `webviewMessages.ts` définit et valide le contrat du bridge. `extension.ts` demeure l'adaptateur VS Code et conserve les backends build/flash/debug/matériel existants.

La seule correction de validation legacy concerne H755 : la présence de dossiers HAL/CMSIS ou de fichiers générables par CMake ne doit pas être un prérequis arbitraire pour un projet natif manuel. Les absences statiques deviennent des warnings, pas une preuve que le build réussira. Aucun startup, linker, CMake ou code firmware n'est réécrit.

## Sélection et scopes

`qc1.projectPath` est une propriété **window** : un seul projet actif pour la fenêtre, pas un projet différent par dossier. La lecture de cette clé se fait sans resource URI. Les chemins du contrôleur et du dashboard ne sont que des miroirs non persistés.

Politique d'écriture :

| Contexte | Cible |
| --- | --- |
| Workspace mono-dossier ou multi-root, projet interne ou externe | `ConfigurationTarget.Workspace` |
| Fenêtre sans workspace | `ConfigurationTarget.Global` (User) |

Les settings Workspace peuvent contenir un chemin extérieur. Écrire seulement dans User pour un projet extérieur serait masqué par une ancienne valeur Workspace. Cette politique garde la sélection attachée à la fenêtre/workspace et persistante à la réouverture. Dans une fenêtre vide, elle est attachée à User et peut donc s'appliquer à d'autres fenêtres vides.

Les anciennes valeurs User ne sont ni migrées ni supprimées. Les anciennes valeurs folder de `projectPath` ne servent plus de sélection distincte, puisque la propriété est désormais window-scoped. Les autres settings ne changent pas arbitrairement de scope : un override WorkspaceFolder existant reste écrit à cette cible, sinon Workspace ou User selon le contexte. Les options window de découverte suivent la politique de la sélection.

Les chemins relatifs des outils sont résolus contre le projet actif explicite, y compris extérieur, et non contre un dossier workspace sans rapport.

Références : [API configuration VS Code](https://code.visualstudio.com/api/references/vscode-api#ConfigurationTarget), [workspaces multi-root](https://code.visualstudio.com/docs/editing/workspaces/multi-root-workspaces).

## UX et mises à jour

Les cinq pages sont de vrais tabpanels. La route est mémorisée par `acquireVsCodeApi().setState`. Les rafraîchissements remplacent uniquement quatre containers HTML fixes, rendus et échappés côté host. Le terminal et le formulaire ne sont pas reconstruits. Un formulaire modifié n'est pas écrasé par les messages settings avant enregistrement ou rafraîchissement explicite.

La page Projet distingue le candidat actif du dernier résultat de découverte. Famille, MCU, carte explicite, architecture, cœurs, build system, confiance, fichiers structurants, preuves, warnings et composants manquants y sont visibles. Les récents font seulement un `stat` asynchrone avant affichage; une sélection récente est analysée avant écriture. Les chemins absents sont purgés, les erreurs d'accès restent inconnues, et retirer un récent n'efface aucun dossier.

Les actions sont contextuelles : F1 build/flash/debug/run; H755 CM7 ou CM4 selon le cœur; dual-core build/flash all et actions séparées par cœur. Aucun debug dual-core coordonné n'est promis. Un projet Makefile découvert n'introduit pas de nouvel exécuteur Make.

Outils réutilise `Qc1Status`, sans seconde détection indépendante. Les versions non mesurées restent inconnues. ST-Link est inconnu avant probe manuel; la carte statique n'est pas une carte connectée. Il n'y a aucun timer de polling hardware. Rapport complet et commandes hardware restent des actions explicites.

Les diagnostics centralisent code, titre, cause, chemin et sévérité. Les seules actions de correction sont déterministes : rescanner, redétecter, sélectionner, ouvrir/révéler, rebuild. Aucun patch automatique du projet.

## Performance, cache et annulation

`autoDiscoverProjects` vaut false par défaut. Quand activé, le démarrage et les changements de configuration/workspace peuvent lancer une découverte sur les racines pertinentes. Le changement de configuration est debounced à 150 ms; les écritures du formulaire sont sérialisées et regroupées avant rafraîchissement. Un fichier structurant modifié marque seulement l'état stale.

Racines : workspace, sélection explicite, récents valides, racines personnalisées. `~/` est résolu par les helpers portables existants; racines de volume/disque et home entier sont rejetés. Maximum 24 racines; scan limité à profondeur 10, 4 000 fichiers, 300 fichiers analysés, 20 projets. Le scanner garde ses exclusions et protections symlinks.

Le candidat actif est réutilisé tant qu'il n'est pas stale. Rescan manuel le réanalyse; configuration, workspace et fichiers structurants invalident le cache. Un cache legacy en mémoire de 15 secondes (20 entrées maximum) évite les inspections synchrones répétées du statut. Ce backend legacy existe toujours; il ne s'agit pas d'une conversion intégrale en I/O asynchrone.

Sept watchers relatifs au seul projet actif ciblent Makefile, CMakeLists, linker, startup STM32, `.ioc`, presets et `.cmake`. Aucun `**/*`; événements sous build/out/dist/node_modules/.git ignorés. Watchers/listeners sont libérés au changement de projet et au dispose.

Chaque nouveau scan/analyse annule le précédent et incrémente la génération. Un résultat ou une erreur obsolètes sont ignorés, même si la dépendance termine après abort. La cancellation de notification ne s'applique que si son signal n'a pas déjà été annulé; une ancienne notification ne peut donc pas annuler la nouvelle requête. Le listener de notification est libéré dans `finally`.

La sélection et les réglages UI sont bloqués pendant une opération QC1. Si la configuration change ailleurs, l'empreinte est vérifiée avant chaque invocation et avant démarrage du debug : les étapes restantes sont arrêtées, et le résultat de l'ancien projet n'est pas attribué au nouveau. Une commande déjà démarrée n'est pas interrompue de force par un changement de settings.

## Flash/RAM et artefacts

L'usage Flash/RAM existant est repris de la sortie parsée du build. Pas de capacité ni de pourcentage hardcodés. La mesure ELF/size et son attribution par cœur sont reportées : plusieurs sorties H755 ne peuvent pas être attribuées correctement sans parser dédié et capacité linker vérifiée par cœur.

La liste ELF/BIN/HEX/MAP provient des chemins connus et de 200 entrées maximum au premier niveau du build. CM7/CM4 sont indiqués si connus. Taille de fichier n'est pas usage mémoire. La révélation passe par un identifiant host, pas par un chemin arbitraire envoyé par la WebView. Les builds et la post-génération ne changent pas.

## Sécurité

Toutes les valeurs projet sont échappées pour texte et attributs. Le script client est statique, avec nonce aléatoire et CSP `default-src 'none'`; aucun handler inline, script projet ou chemin interpolé dans JavaScript. Les styles inline restent autorisés pour le thème et la progression. Les quatre fragments `innerHTML` sont exclusivement ceux des renderers host échappés.

Le bridge rejette les commandes et shapes inconnus. Les settings sont limités à des clés connues et validés avant écriture. Un fichier diagnostic ou artefact ne peut être ouvert que depuis l'état host connu, après contrôle d'existence/type. Les logs utilisent `textContent`, avec sortie bornée. Les règles de workspace trust et l'anonymisation du rapport existantes sont conservées.

## Validation et limites

Gates : `npm run lint`, `npm run typecheck`, `npm test`, `npm audit --audit-level=high`, `git diff --check`, puis `npx vsce package --out qc1-stm32-tools-0.3.1-block3.vsix`.

Les tests ajoutés couvrent générations/abort/erreurs tardives, cache/stale/dispose, sérialisation/scopes/settings, récents invalides/inaccessibles, bridge, injection, cinq pages/actions, client VM (route/terminal/formulaire), racines portables et artefacts. L'intégration avec mock VS Code vérifie scopes internes/externes, override resource, fenêtre vide, recréation du provider, watchers, listeners de notification et H755 manuel sans HAL.

La suite conserve les vrais builds ARM F1 intégré et H755 dual-core représentatif, ainsi qu'un build CMake natif sous chemin Unicode. Les tests de commandes vérifient arguments F1/H755, reset, ELF, adresses linker et debug séparé. Cela ne prouve pas un flash, un boot HSEM, une connexion série ou une session debug sur carte réelle.

Un aperçu du renderer réel avec API VS Code simulée est vérifié visuellement sous Chrome headless à 360 px, avec navigation sur les cinq pages et absence de débordement horizontal. Ce n'est pas une validation dans un Extension Development Host, ni une validation UI native Windows/Linux. Les comportements spécifiques filesystem/watchers/permissions doivent encore être exercés sur ces plateformes.

Dettes restantes : adaptateur `extension.ts` encore volumineux avec backend legacy, inspections de statut partiellement synchrones malgré cache, versions outils non mesurées par la simple page Outils, mesure mémoire ELF et attribution par cœur, refresh de fragments réinitialisant les détails dépliés. Une matrice Extension Host multi-OS et du matériel F103/H755 sont les prochaines validations utiles.

Ce bloc génère uniquement un paquet local de test, sans commit, push, installation automatique ni publication Marketplace. La version manifeste reste 0.3.1.
