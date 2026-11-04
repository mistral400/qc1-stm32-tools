# Moniteur UART QC1

Le moniteur UART se trouve dans **Outils**. Il utilise le runtime natif `serialport` 13.0.0 pour énumérer et ouvrir les ports série de l'hôte VS Code. L'import natif est différé jusqu'à l'actualisation ou à l'ouverture du moniteur afin qu'une plateforme sans binding utilisable puisse quand même activer l'extension.

## Connexion et transmission

Actualise la liste, sélectionne le port, règle le baud rate (50 à 4 000 000), 5 à 8 bits, la parité, 1 ou 2 bits d'arrêt et RTS/CTS, puis connecte. Une ouverture en attente expire après 10 secondes et peut être annulée. La transmission est bornée à 4 096 octets par envoi et attend le vidage TX avant d'annoncer son succès. Les erreurs d'ouverture, d'écriture ou de vidage restent visibles dans le panneau.

Le mode texte transmet de l'UTF-8; le mode HEX exige des paires complètes d'octets. L'ajout CRLF est facultatif. La réception montre les caractères imprimables et échappe les octets de contrôle en ASCII; le mode HEX conserve les octets visibles. Le journal mémoire garde au plus 500 fragments de 256 octets et le tampon d'affichage en attente au plus 100 fragments. Quand ces limites sont dépassées, les plus anciens fragments sont supprimés et le compteur l'indique.

Les données ne sont ni persistées ni envoyées automatiquement. Les boutons d'enregistrement écrivent uniquement après sélection explicite d'un fichier. Les ports ne sont accessibles que dans un workspace approuvé.

## Format du graphique

Le graphique reçoit uniquement des lignes JSON Lines terminées par LF et conformes à cette forme :

```json
{"qc1_plot":1,"time_ms":123,"values":{"temperature_c":22.5,"adc_voltage":1.82}}
```

`qc1_plot` doit valoir `1`; `time_ms` et chaque valeur doivent être des nombres finis non négatifs. Les noms de variables respectent `[A-Za-z][A-Za-z0-9_.-]{0,31}`. Une ligne peut contenir de 1 à 8 variables et mesure au plus 2 048 caractères. Une ligne invalide est ignorée; une ligne trop longue est abandonnée jusqu'au prochain LF. Les échantillons sont bornés à 1 000 en mémoire. La pause arrête l'ajout au graphique mais laisse la réception UART visible. L'export CSV comprend le temps cible et les variables présentes.

## Plateformes et limites

`serialport` déclare l'accès série pour Node.js et Electron via Node-API, et fournit des bindings natifs précompilés. La matrice de support publiée par le projet couvre officiellement Linux x64, macOS x64/Apple Silicon et Windows x64; les bindings ARM Linux sont produits mais restent best effort. Cette matrice amont est publiée pour SerialPort 12.x et peut ne pas refléter toutes les combinaisons disponibles dans le paquet 13.0.0. QC1 utilise 13.0.0; les validations de l'extension sur macOS arm64 ne prouvent pas le fonctionnement matériel ou le packaging sur Windows et Linux.

Les droits d'accès dépendent du système, du pilote et de l'utilisateur. Une ouverture refusée peut nécessiter une permission USB/série accordée par l'administrateur de la machine. QC1 ne change pas les permissions système. Voir la [matrice SerialPort](https://serialport.io/docs/guide-platform-support/) et le [guide Electron SerialPort](https://serialport.io/docs/guide-electron/).
