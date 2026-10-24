# Foot Libre ⚽

Jeu de football 3D **gratuit et open source** pour PC, inspiré de FIFA. Il tourne dans le navigateur (Chrome, Edge, Firefox) et se joue au **clavier/souris** comme à la **manette** (Xbox, PlayStation ou toute manette reconnue par le navigateur).

## Modes de jeu

- **Match rapide** contre l'IA (3 niveaux de difficulté), 11 contre 11.
- **2 joueurs sur le même PC** : clavier + manette, ou deux moitiés de clavier si vous n'avez pas de manette.
- **Multijoueur en ligne** : créez une salle, partagez le code à 5 caractères, jusqu'à 4 joueurs (2 contre 2). Les places vides sont jouées par l'IA.

## Jouer tout de suite

**https://thithimtp78.github.io/foot-libre/** : rien à installer, ça marche dans Chrome, Edge ou Firefox, y compris le multijoueur en ligne. Celui qui crée la salle donne le code à 5 caractères à ses amis ; son navigateur fait office de serveur, donc il doit garder l'onglet du jeu affiché pendant le match.

## Lancer le jeu sur son PC (facultatif)

Il faut [Node.js](https://nodejs.org) 18 ou plus récent.

```bash
npm install
npm start
```

Ouvrez ensuite http://localhost:8080. Pour jouer en ligne avec un ami, hébergez le serveur sur une machine accessible (voir plus bas) et donnez-lui l'adresse.

## Commandes

| Action | Clavier / souris | Manette |
|---|---|---|
| Se déplacer | ZQSD / WASD ou flèches | Stick gauche / croix |
| Sprint | Maj | RT ou RB |
| Passe courte · *défense : tacle* | J ou clic gauche | A / ✕ |
| Tir (maintenir = puissance) · *défense : tacle glissé* | K ou clic droit | X / ▢ |
| Passe lobée / centre | L ou clic molette | B / ◯ |
| Passe en profondeur | I | Y / △ |
| Changer de joueur | Espace | LB / L1 |
| Caméra (TV, proche, large) | C | Select |
| Pause | Échap ou P | Start |

En mode 2 joueurs sans manette : le joueur 1 utilise ZQSD/WASD + J K L I, Espace, Maj gauche ; le joueur 2 utilise les flèches + pavé numérique (1 passe, 2 tir, 3 lob, 5 profondeur, 0 changer, Maj droite sprint).

Les menus se pilotent aussi entièrement à la manette (croix, A pour valider, B pour revenir).

## Architecture

```
server.js              Serveur HTTP (fichiers du jeu) + salles multijoueur WebSocket
public/
  index.html, css/     Interface et menus
  shared/sim.js        Simulation du match : physique du ballon, joueurs, règles, IA
  js/render.js         Rendu 3D Three.js : stade, pelouse procédurale, joueurs animés, caméra
  js/input.js          Clavier, souris, manettes (API Gamepad)
  js/audio.js          Sons générés (frappes, sifflet, foule) sans fichier audio
  js/net.js            Client réseau (WebSocket ou pair à pair)
  shared/rooms.js      Salles multijoueur (serveur Node ou navigateur hôte)
  js/main.js           Menus, boucle de jeu, HUD
  vendor/              Three.js r169 et PeerJS 1.5.4 (licences MIT)
test/sim.test.js       Matchs IA contre IA en accéléré
```

- La **même simulation** (`public/shared/sim.js`) tourne partout. En ligne, une seule machine fait autorité (60 ticks/s) : le serveur Node s'il est lancé, sinon le navigateur de l'hôte. Les autres joueurs envoient leurs entrées et reçoivent 30 instantanés/s qu'ils interpolent (≈100 ms) pour un rendu fluide.
- Sans serveur, les joueurs se connectent en pair à pair (WebRTC via [PeerJS](https://peerjs.com), dont le serveur public sert uniquement à la mise en relation). La logique des salles (`public/shared/rooms.js`) est commune aux deux modes.
- Le site est publié sur GitHub Pages depuis le dossier `public/` (branche `gh-pages`).
- Tout est procédural (textures, sons) : aucun asset à télécharger, le jeu pèse moins de 1 Mo hors Three.js.
- Réglages graphiques Rapides / Équilibrés / Beaux pour les petits PC.

## Héberger le serveur en ligne

N'importe quel hébergeur Node avec WebSocket convient (Render, Railway, Fly.io, un VPS…) : commande `npm start`, port lu dans la variable `PORT`. La page `/health` répond `ok`. Le mode solo marche aussi en hébergement statique (GitHub Pages) en servant le dossier `public/`.

## Tests

```bash
npm test
```

## Feuille de route

- Prédiction côté client en ligne pour supprimer la latence ressentie sur son propre joueur.
- Fautes, cartons, penalties, hors-jeu.
- IA plus fine (appels de balle, pressing coordonné, tactiques au choix).
- Ralentis des buts, célébrations, commentaires.
- Version installable (Electron) pour Windows/macOS/Linux.

## Licence

MIT.
