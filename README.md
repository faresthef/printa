# Printa

App iPhone (Capacitor) pour imprimer du texte et des images sur une imprimante thermique
PeriPage (A6 / A6+) en Bluetooth Low Energy, sans l'app officielle.

## Ce que fait l'app

- **Connecter** : cherche les appareils dont le nom commence par `PeriPage` (ex. `PeriPage_7B26_BLE`),
  puis affiche le modèle et la batterie.
- **Texte** : texte libre (français, arabe, emojis), avec la taille, le gras et l'alignement.
- **Image** : photo de la galerie, tramage photo, luminosité et rotation de 90°.
- **Aperçu** exact de ce qui sortira sur le papier, puis **Imprimer**.

## Installer sur ton iPhone

### Avec un Mac (le plus simple)
1. Installe Xcode (App Store) et Node.js 22.
2. Dans ce dossier : `npm install` puis `npm run ios` (Xcode s'ouvre).
3. Dans Xcode : *App › Signing & Capabilities › Team*, choisis ton identifiant Apple.
4. Branche l'iPhone, sélectionne-le en haut, puis clique ▶︎.
   Sur l'iPhone : *Réglages › Général › VPN et gestion de l'appareil*, puis fais confiance au développeur.
   Il faut aussi activer le *Mode développeur* (*Réglages › Confidentialité et sécurité*).

Avec un compte Apple gratuit, l'app expire au bout de 7 jours : il suffit de relancer ▶︎.
Avec le compte développeur (99 €/an), elle tient un an et peut passer par TestFlight.

### Sans Mac
1. Mets ce dossier dans un dépôt GitHub.
2. Dans l'onglet *Actions*, lance **iOS (.ipa non signé)**, puis télécharge `Printa.ipa`.
3. Installe-le depuis un PC avec [Sideloadly](https://sideloadly.io) ou [AltStore](https://altstore.io)
   et ton identifiant Apple (même limite de 7 jours avec un compte gratuit).

## Tester dans un navigateur
`npm run dev` : le même code marche dans Chrome (ordinateur ou Android) grâce à Web Bluetooth.

## Structure
- `src/peripage.ts` : protocole Bluetooth PeriPage (service `FF00`, écriture `FF02`,
  contrôle de flux par crédits sur `FF03`, fin de job `AA` sur `FF01`).
- `src/raster.ts` : rendu du texte et des images en points noir et blanc (1 bit).
- `src/main.ts` : interface.

Protocole d'après la rétro-ingénierie publiée dans
[aaa4xu/peripage](https://github.com/aaa4xu/peripage) (docs/ble_protocol_v1.36.md)
et [bitrate16/ppa6-python](https://github.com/bitrate16/ppa6-python).
