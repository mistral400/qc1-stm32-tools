# Inspection mémoire statique

QC1 inspecte les ELF connus lors de l'actualisation du tableau de bord. L'analyse est locale, en lecture seule et ne se connecte pas au MCU. Elle requiert `arm-none-eabi-objdump`; aucun artefact n'est généré ou modifié.

## Mesures

- **Flash chargée** : somme des sections ELF `ALLOC, LOAD` dont l'adresse LMA tombe dans une région Flash/ROM déclarée par la carte linker ou le script linker.
- **RAM statique** : sections allouées dont la VMA tombe dans une région RAM déclarée. Les `.data`, `.bss`/`.noinit` et les autres sections allouées en RAM sont incluses. Les réserves linker dont le nom contient `heap` ou `stack` sont présentées à part.
- **Régions** : occupation placée selon les sections ELF par rapport aux origines et capacités déclarées. Les réservations explicites heap/stack comptent dans l'occupation de région, mais pas dans la RAM statique.
- **Sections** : `.text`, `.data`, `.bss` et les autres sections allouées sont listées par ELF.

Les images STM32F1 sont présentées séparément des images CM7/CM4. Les totaux CM7 et CM4 ne sont jamais additionnés, car une région RAM peut être partagée ou recouverte entre les scripts de linker.

## Sources et limites

L'outil lit `objdump -h` avec des arguments séparés, dans un processus à timeout et sortie bornée. La carte `*.map` adjacente fournit en priorité les régions MEMORY résolues par le linker si sa date est proche de celle de l'ELF. Une carte éloignée de plus de dix minutes est ignorée; le script linker courant sert de repli seulement s'il n'a pas été modifié après l'ELF. Les résultats affichent leurs chemins et date ELF pour faciliter la vérification de provenance.

Les capacités proviennent des définitions du projet; QC1 n'infère aucune capacité depuis le nom du MCU. Les expressions `ORIGIN(...)`, `LENGTH(...)`, les régions dont le nom ne révèle pas le type mémoire, une section non classée, un script modifié après le build ou une carte absente peuvent rendre les totaux ou pourcentages inconnus. Un dépassement calculable, des sections ELF potentiellement superposées et des différences entre la carte et le script actuel sont signalés. Une région linker superposée à une autre n'a pas d'occupation individuelle inventée. L'absence d'alerte n'est pas une validation matérielle.

Une réservation linker identifiée pour le heap ou la pile indique uniquement l'espace déclaré dans l'ELF. QC1 ne mesure ni le haut de pile, ni le heap courant, ni les allocations dynamiques, ni la marge au runtime. Les résultats portent sur les ELF actuellement présents : leur date de modification ne prouve pas qu'ils proviennent du dernier build réussi.

L'estimation de charge Flash n'inclut pas nécessairement l'effacement réel, les zones de bootloader, les protections, le padding du fichier BIN, la configuration option bytes ou les régions non déclarées. Elle ne confirme ni programmation, ni vérification, ni reset, ni démarrage du firmware.

## Validation logicielle

Les tests unitaires emploient des sorties `objdump` simulées et des fichiers temporaires isolés. Ils couvrent les VMA/LMA, les régions F1/H7, les sections non allouées, les capacités non résolues, les dépassements, les cartes potentiellement obsolètes, le timeout, la sortie tronquée et le workspace non approuvé. Ils ne remplacent pas une comparaison avec des linkers et ELF réels sur chaque plateforme.
