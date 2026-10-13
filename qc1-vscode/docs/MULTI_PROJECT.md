# Gestion multi-projet et multi-probe

## Projet actif

QC1 conserve une sélection de projet par fenêtre VS Code dans `qc1.projectPath`. Un workspace multi-root peut donc contenir plusieurs projets, mais les actions QC1 opèrent sur un seul projet à la fois. La page **Projet** montre le projet actif, les projets détectés, leur MCU/famille, la carte inférée, le système de build, la confiance et les preuves.

Pour choisir un projet :

1. Ouvre **Projet** et lance **Détecter les projets** ou **Choisir / changer de dossier**.
2. Examine la liste des candidats et ouvre les détails d'évidence.
3. Clique **Sélectionner** pour définir le projet actif.
4. Vérifie le nom et le chemin du projet avant **Build**, **Clean**, **Flash** ou **Debug**.

Le scan est borné; un projet profond ou dans une racine externe peut nécessiter une racine configurée ou la sélection directe du dossier. L'extension découvre/analyse CMake, CubeMX, CubeIDE, PlatformIO et Makefile, mais seule une partie de ces formats possède un backend build QC1.

Les changements de projet annulent les scans obsolètes. Une opération compare sa configuration avant les étapes suivantes; si le projet ou un réglage change, les commandes restantes sont arrêtées et leur résultat n'est pas attribué au nouveau projet.

## Workspace multi-root

`qc1.projectPath` est un réglage de fenêtre, pas un réglage distinct par racine VS Code. Sélectionner un firmware dans le deuxième dossier n'écrit pas les valeurs de build dans son `settings.json`; la sélection s'applique à la fenêtre. Pour utiliser en parallèle deux projets ayant des configurations incompatibles, ouvre deux fenêtres VS Code.

Les racines personnalisées restent explicites et limitées. QC1 n'analyse pas le disque entier, le home entier ou des liens symboliques externes.

## Association de probe

Le projet, le MCU, la carte et la sonde sont des informations différentes :

```text
Projet A ── preuves du projet ──> STM32F103 / carte déduite ou inconnue
       └── choix opérateur ─────> ST-Link numéro A

Projet B ── preuves du projet ──> STM32H755 / NUCLEO-H755ZI-Q si trouvée
       └── choix opérateur ─────> ST-Link numéro B
```

La carte n'est pas détectée depuis la sonde; elle provient de fichiers ou noms de projet. Le numéro de série, lui, distingue les adaptateurs. L'association est persistée dans `ExtensionContext.workspaceState` sous une clé SHA-256 du chemin normalisé du projet, et les entrées invalides sont rejetées.

### Sélection manuelle

- Depuis **Outils**, clique **Choisir la sonde** ou lance **QC1 STM32: Select ST-Link Probe**.
- Avec une seule sonde, QC1 la sélectionne automatiquement uniquement si la famille runtime peut être vérifiée.
- Avec plusieurs sondes ou une sélection forcée, QC1 présente la description, le firmware, le chip ID et le numéro complet.
- Si la sonde mémorisée n'est pas connectée, QC1 demande explicitement un autre choix. Il ne substitue pas silencieusement la première sonde de la liste.
- Avant d'enregistrer, QC1 lance un contrôle en lecture seule sur le numéro sélectionné. OpenOCD doit exposer une cible de la bonne famille; si OpenOCD est absent, l'ID/description donné par `st-info` doit permettre de distinguer la famille.
- Le numéro de série est passé explicitement à OpenOCD (`adapter serial`) et à `st-flash` (`--serial`). Les journaux et les rapports masquent l'identifiant complet.

La vérification actuelle confirme au plus la famille STM32; elle n'identifie pas toutes les références F1 au niveau du part number ni la board physique. Quand la description/ID de `st-info` est ambiguë, QC1 bloque plutôt que d'inférer.

## Scénarios couverts automatiquement

La suite crée deux projets temporaires F103/H755 avec deux numéros ST-Link simulés. Elle vérifie les Quick Picks, les arguments OpenOCD routés par numéro, la persistance séparée, les changements rapides de projet et l'absence des numéros complets dans les logs simulés. Ces tests n'interagissent pas avec un ST-Link réel.

Cas encore à valider dans VS Code et sur matériel : deux adaptateurs USB réels simultanés, leur ordre de découverte réel, une sonde manquante/remplacée, plusieurs sondes de même famille, ainsi qu'un cycle F103 → H755 → F103 avec flash et debug.

## Problèmes usuels

- **Un seul projet candidat** : sélectionne le sous-dossier du firmware plutôt que son dossier parent ou ajoute une racine personnalisée.
- **Le mauvais projet semble actif** : vérifie `qc1.projectPath` dans les réglages de la fenêtre et le chemin affiché sur la page Projet.
- **Le mauvais MCU est déduit** : ouvre l'évidence et cherche des définitions CMake contradictoires; corrige le projet ou la configuration `qc1.targetMcu`.
- **La probe change de port USB** : l'ordre de la liste n'est pas une identité. Utilise le numéro complet et sélectionne explicitement.
- **Même famille mais board différente** : la vérification de famille ne suffit pas à distinguer le modèle de carte; vérifie le numéro de probe et le câblage avant programmation.
